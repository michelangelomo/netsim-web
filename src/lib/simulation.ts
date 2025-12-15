import { v4 as uuidv4 } from 'uuid';
import type {
    NetworkDevice,
    Connection,
    Packet,
    ArpEntry,
    MacTableEntry,
    RouteEntry,
    NetworkInterface,
    FirewallRule,
} from '@/types/network';
import {
    isSameNetwork,
    getNetworkAddress,
    isBroadcastMAC,
    isMulticastMAC,
    findBestRoute,
    ipToNumber,
} from '@/lib/network-utils';

// Constants
const LINK_SPEED_FACTOR = 0.1; // Adjustment for simulation speed
const ARP_TIMEOUT = 5000; // ms

// Helper to find interface by name
function getInterfaceByName(device: NetworkDevice, name: string): NetworkInterface | undefined {
    return device.interfaces.find((i) => i.name === name);
}

// Helper to find interface by MAC
function getInterfaceByMAC(device: NetworkDevice, mac: string): NetworkInterface | undefined {
    return device.interfaces.find((i) => i.macAddress === mac);
}

// Helper to check if an IP matches a rule's IP pattern
function matchesIpPattern(ip: string | undefined, pattern: string): boolean {
    if (!ip) return pattern === 'any' || pattern === '*';
    if (pattern === 'any' || pattern === '*') return true;

    // Check for CIDR notation (e.g., "192.168.1.0/24")
    if (pattern.includes('/')) {
        const [netAddr, cidrStr] = pattern.split('/');
        const cidr = parseInt(cidrStr, 10);
        const mask = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
        const ipNum = ipToNumber(ip);
        const netNum = ipToNumber(netAddr);
        return (ipNum & mask) === (netNum & mask);
    }

    // Exact match
    return ip === pattern;
}

// Helper to check if a port matches a rule's port pattern
function matchesPortPattern(port: number | undefined, pattern: string): boolean {
    if (pattern === '*' || pattern === 'any') return true;
    if (port === undefined) return true; // No port to check (e.g., ICMP)

    // Check for port range (e.g., "80-443")
    if (pattern.includes('-')) {
        const [startStr, endStr] = pattern.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        return port >= start && port <= end;
    }

    return port === parseInt(pattern, 10);
}

// Check if a packet matches a firewall rule
function matchesFirewallRule(packet: Packet, rule: FirewallRule): boolean {
    if (!rule.enabled) return false;

    // Check protocol
    if (rule.protocol !== 'any' && rule.protocol !== packet.type) {
        return false;
    }

    // Check source IP
    if (!matchesIpPattern(packet.sourceIP, rule.sourceIp)) {
        return false;
    }

    // Check destination IP
    if (!matchesIpPattern(packet.destIP, rule.destIp)) {
        return false;
    }

    // Check source port (for TCP/UDP)
    if (!matchesPortPattern(packet.sourcePort, rule.sourcePort)) {
        return false;
    }

    // Check destination port (for TCP/UDP)
    if (!matchesPortPattern(packet.destPort, rule.destPort)) {
        return false;
    }

    return true;
}

// Evaluate firewall rules for a packet
// Returns: 'allow' | 'deny' | 'no-match'
function evaluateFirewallRules(packet: Packet, rules: FirewallRule[]): 'allow' | 'deny' | 'no-match' {
    for (const rule of rules) {
        if (matchesFirewallRule(packet, rule)) {
            return rule.action;
        }
    }
    return 'no-match';
}

// Helper to add current device to packet path
function addToPath(packet: Packet, deviceId: string): string[] {
    const path = packet.path || [];
    if (path[path.length - 1] !== deviceId) {
        return [...path, deviceId];
    }
    return path;
}

// Process packet at device
export function processDeviceTick(
    device: NetworkDevice,
    packet: Packet,
    connections: Connection[],
    updateDevice: (id: string, updates: Partial<NetworkDevice>) => void
): Packet[] {
    // If packet is not at this device, ignore
    if (packet.currentDeviceId !== device.id || packet.processingStage !== 'at-device') {
        return [packet];
    }

    // Check if this is a locally generated packet (e.g., ping from switch management interface)
    // Locally generated packets should be processed through L3 logic even on L2 devices
    const isLocallyGenerated = packet.isLocallyGenerated === true ||
        (!packet.lastDeviceId && device.interfaces.some(i => i.macAddress === packet.sourceMAC));

    // L2 devices process locally generated IP packets through L3 logic
    // (for management traffic like ping from the switch itself)
    if (isLocallyGenerated && packet.destIP) {
        return processL3Logic(device, packet, connections, updateDevice);
    }

    // 1. L2 Devices - switching/hubbing for transit traffic
    if (device.type === 'switch') {
        // Check if packet is destined for the switch's management IP
        // If so, process through L3 logic to handle ICMP replies, etc.
        if (packet.destIP) {
            const isForMe = device.interfaces.some(i => i.ipAddress === packet.destIP);
            if (isForMe) {
                return processL3Logic(device, packet, connections, updateDevice);
            }
        }
        return processSwitchLogic(device, packet, connections, updateDevice);
    }

    if (device.type === 'hub') {
        return processHubLogic(device, packet, connections);
    }

    // 2. Router/Host Logic (L3)
    return processL3Logic(device, packet, connections, updateDevice);
}

// Determine the VLAN for a packet on ingress
function getIngressVlan(packet: Packet, port: NetworkInterface): number | null {
    const mode = port.vlanMode || 'access';

    if (mode === 'access') {
        // Access port: always use the configured access VLAN
        return port.accessVlan ?? 1;
    } else if (mode === 'trunk') {
        // Trunk port: use packet's VLAN tag, or native VLAN if untagged
        if (packet.vlanTag !== undefined) {
            // Check if VLAN is allowed on trunk
            const allowedVlans = port.allowedVlans ?? [1];
            if (!allowedVlans.includes(packet.vlanTag)) {
                return null; // VLAN not allowed - will drop packet
            }
            return packet.vlanTag;
        } else {
            // Untagged - use native VLAN
            return port.nativeVlan ?? 1;
        }
    }

    return 1; // Default to VLAN 1
}

// Check if a port should receive traffic for a given VLAN
function portAllowsVlan(port: NetworkInterface, vlanId: number): boolean {
    const mode = port.vlanMode || 'access';

    if (mode === 'access') {
        return (port.accessVlan ?? 1) === vlanId;
    } else if (mode === 'trunk') {
        const allowedVlans = port.allowedVlans ?? [1];
        return allowedVlans.includes(vlanId);
    }

    return vlanId === 1; // Default behavior
}

// Process egress for a port - handle tagging/untagging
function processEgressVlan(packet: Packet, port: NetworkInterface, vlanId: number): Packet {
    const mode = port.vlanMode || 'access';
    const newPacket = { ...packet };

    if (mode === 'access') {
        // Access port: remove VLAN tag (frames are untagged on access ports)
        delete newPacket.vlanTag;
    } else if (mode === 'trunk') {
        // Trunk port: tag frame, unless it's the native VLAN
        const nativeVlan = port.nativeVlan ?? 1;
        if (vlanId === nativeVlan) {
            // Native VLAN - send untagged
            delete newPacket.vlanTag;
        } else {
            // Non-native VLAN - send tagged
            newPacket.vlanTag = vlanId;
        }
    }

    return newPacket;
}

// Process packets that need Layer 3 handling via SVI
function processSviPacket(
    device: NetworkDevice,
    packet: Packet,
    frameVlan: number,
    connections: Connection[],
    updateDevice: (id: string, updates: Partial<NetworkDevice>) => void
): Packet[] | null {
    // Only switches with SVIs can do inter-VLAN routing
    if (!device.sviInterfaces || device.sviInterfaces.length === 0) {
        return null;
    }

    // Find the SVI for the packet's VLAN
    const ingressSvi = device.sviInterfaces.find(s => s.vlanId === frameVlan && s.isUp);

    // Check if packet is destined to any SVI MAC (for L3 processing)
    const destSvi = device.sviInterfaces.find(s => s.macAddress === packet.destMAC && s.isUp);

    // Handle ARP requests for SVI IPs
    if (packet.type === 'arp' && packet.payload?.type === 'request') {
        const targetIP = packet.payload.targetIP || packet.destIP;
        const sviForARP = device.sviInterfaces.find(s => s.ipAddress === targetIP && s.isUp);

        if (sviForARP) {
            // Generate ARP reply
            const arpReply: Packet = {
                id: uuidv4(),
                sourceMAC: sviForARP.macAddress,
                destMAC: packet.sourceMAC,
                sourceIP: sviForARP.ipAddress!,
                destIP: packet.sourceIP,
                type: 'arp',
                payload: {
                    type: 'reply',
                    senderMAC: sviForARP.macAddress,
                    senderIP: sviForARP.ipAddress,
                    targetMAC: packet.sourceMAC,
                    targetIP: packet.sourceIP,
                },
                ttl: 64,
                size: 42,
                currentDeviceId: device.id,
                sourceDeviceId: device.id,
                path: [...(packet.path || []), device.id],
                currentPathIndex: 0,
                progress: 0,
                processingStage: 'at-device',
            };

            // Find where to send the reply - use ingressInterface if known, or lookup MAC
            let replyInterface: NetworkInterface | undefined;

            // First try packet.ingressInterface
            if (packet.ingressInterface) {
                replyInterface = device.interfaces.find(i => i.name === packet.ingressInterface);
            }

            // Fall back to MAC table lookup
            if (!replyInterface) {
                const sourcePort = device.macTable?.find(e => e.macAddress === packet.sourceMAC && e.vlan === frameVlan)?.port;
                if (sourcePort) {
                    replyInterface = device.interfaces.find(i => i.name === sourcePort);
                }
            }

            // Try to find connection by source device
            if (!replyInterface && packet.sourceDeviceId) {
                const conn = connections.find(c =>
                    (c.sourceDeviceId === device.id && c.targetDeviceId === packet.sourceDeviceId) ||
                    (c.targetDeviceId === device.id && c.sourceDeviceId === packet.sourceDeviceId)
                );
                if (conn) {
                    const ifaceId = conn.sourceDeviceId === device.id ? conn.sourceInterfaceId : conn.targetInterfaceId;
                    replyInterface = device.interfaces.find(i => i.id === ifaceId);
                }
            }

            if (replyInterface?.connectedTo) {
                const conn = connections.find(c => c.sourceInterfaceId === replyInterface!.id || c.targetInterfaceId === replyInterface!.id);
                if (conn) {
                    const targetDeviceId = conn.sourceDeviceId === device.id ? conn.targetDeviceId : conn.sourceDeviceId;
                    arpReply.targetDeviceId = targetDeviceId;
                    arpReply.lastDeviceId = device.id;
                    return [arpReply];
                }
            }

            // If we can't find the source port, return empty (ARP consumed but no reply sent)
            return [];
        }
    }

    // Handle packets destined to SVI MAC (inter-VLAN routing)
    if (destSvi && packet.type !== 'arp') {
        // This packet needs to be routed
        const destIP = packet.destIP;
        if (!destIP) return null;

        // Find route for destination
        const route = findRouteForIP(device, destIP);
        if (!route) {
            // No route, drop packet
            return [];
        }

        // Find the egress SVI (based on route interface)
        const egressVlanMatch = route.interface?.match(/Vlan(\d+)/i);
        const egressVlanId = egressVlanMatch ? parseInt(egressVlanMatch[1], 10) : null;
        const egressSvi = egressVlanId ? device.sviInterfaces.find(s => s.vlanId === egressVlanId && s.isUp) : null;

        if (!egressSvi) {
            return []; // No egress SVI, drop
        }

        // Look up destination MAC in ARP table
        const arpEntry = device.arpTable?.find(e => e.ipAddress === destIP);
        if (!arpEntry) {
            // Would need to ARP for destination - for now just drop
            // In a real implementation, we'd generate an ARP request
            return [];
        }

        // Find egress port for destination MAC in egress VLAN
        let egressPort = device.macTable?.find(e => e.macAddress === arpEntry.macAddress && e.vlan === egressVlanId)?.port;
        if (!egressPort) {
            // Unknown destination in egress VLAN - find any port in that VLAN
            const portInfo = device.interfaces.find(i =>
                i.isUp && i.connectedTo &&
                portAllowsVlan(i, egressVlanId!)
            );
            if (!portInfo) return [];
            egressPort = portInfo.name;
        }

        // Create routed packet
        const routedPacket: Packet = {
            ...packet,
            id: uuidv4(),
            sourceMAC: egressSvi.macAddress, // Source MAC is now egress SVI
            destMAC: arpEntry.macAddress,    // Dest MAC is the final destination
            ttl: (packet.ttl || 64) - 1,     // Decrement TTL
            currentDeviceId: device.id,
            lastDeviceId: device.id,
            vlanTag: egressVlanId!,
            path: [...(packet.path || []), device.id],
            processingStage: 'at-device',
        };

        // TTL expired check
        if (routedPacket.ttl <= 0) {
            return [{ ...routedPacket, processingStage: 'dropped' }];
        }

        // Find the egress connection
        const egressIface = egressPort
            ? device.interfaces.find(i => i.name === egressPort)
            : device.interfaces.find(i => i.isUp && i.connectedTo && portAllowsVlan(i, egressVlanId!));

        if (!egressIface?.connectedTo) return [];

        const egressConn = connections.find(c => c.sourceInterfaceId === egressIface.id || c.targetInterfaceId === egressIface.id);
        if (!egressConn) return [];

        const targetDeviceId = egressConn.sourceDeviceId === device.id ? egressConn.targetDeviceId : egressConn.sourceDeviceId;

        // Process egress VLAN tagging
        const finalPacket = processEgressVlan(routedPacket, egressIface, egressVlanId!);
        finalPacket.targetDeviceId = targetDeviceId;
        finalPacket.egressInterface = egressIface.name;

        return [finalPacket];
    }

    return null; // Not SVI-related, continue with normal switch processing
}

// Find the best route for an IP address
function findRouteForIP(device: NetworkDevice, destIP: string): { destination: string; interface?: string } | null {
    const routes = device.routingTable || [];

    for (const route of routes) {
        const routeNet = route.destination;
        const routeMask = route.netmask || '255.255.255.0';

        // Check if destIP is in this network
        const destNetwork = getNetworkAddress(destIP, routeMask);
        if (destNetwork === routeNet) {
            return route;
        }
    }

    // Check for default route
    const defaultRoute = routes.find(r => r.destination === '0.0.0.0');
    return defaultRoute || null;
}

function processSwitchLogic(
    device: NetworkDevice,
    packet: Packet,
    connections: Connection[],
    updateDevice: (id: string, updates: Partial<NetworkDevice>) => void
): Packet[] {
    // Find ingress connection - use lastDeviceId or sourceDeviceId
    const ingressDeviceId = packet.lastDeviceId || packet.sourceDeviceId;
    const ingressConnection = ingressDeviceId ? connections.find(
        (c) =>
            (c.sourceDeviceId === device.id && c.targetDeviceId === ingressDeviceId) ||
            (c.targetDeviceId === device.id && c.sourceDeviceId === ingressDeviceId)
    ) : null;

    // Determine ingress interface
    const ingressInterfaceId = ingressConnection
        ? ingressConnection.sourceDeviceId === device.id
            ? ingressConnection.sourceInterfaceId
            : ingressConnection.targetInterfaceId
        : null;

    const ingressInterface = ingressInterfaceId
        ? device.interfaces.find((i) => i.id === ingressInterfaceId)
        : null;

    // If we have an ingress interface from packet.ingressInterface, use that
    const effectiveIngressInterface = ingressInterface ||
        (packet.ingressInterface ? device.interfaces.find(i => i.name === packet.ingressInterface) : null);

    // 1. Determine VLAN for this frame
    let frameVlan: number;
    if (effectiveIngressInterface) {
        const ingressVlan = getIngressVlan(packet, effectiveIngressInterface);
        if (ingressVlan === null) {
            // VLAN not allowed on trunk - drop packet
            return [];
        }
        frameVlan = ingressVlan;
    } else if (packet.vlanTag !== undefined) {
        // Packet already has a VLAN tag (e.g., from test setup)
        frameVlan = packet.vlanTag;
    } else {
        // Default to VLAN 1
        frameVlan = 1;
    }

    // 2. Learn MAC with VLAN
    if (effectiveIngressInterface) {
        const macTable = device.macTable || [];
        // Look for existing entry with same MAC and VLAN
        const existingEntryIndex = macTable.findIndex(
            (e) => e.macAddress === packet.sourceMAC && e.vlan === frameVlan
        );

        // Update if new or moved
        if (existingEntryIndex === -1 || macTable[existingEntryIndex].port !== effectiveIngressInterface.name) {
            const newEntry: MacTableEntry = {
                macAddress: packet.sourceMAC,
                port: effectiveIngressInterface.name,
                vlan: frameVlan,
                type: 'dynamic',
                age: 0,
            };

            const newTable = existingEntryIndex === -1
                ? [...macTable, newEntry]
                : macTable.map((e, i) => i === existingEntryIndex ? newEntry : e);

            updateDevice(device.id, { macTable: newTable });
        }
    }

    // 2.5 Check if this packet is destined for an SVI (Layer 3 processing)
    const sviResult = processSviPacket(device, packet, frameVlan, connections, updateDevice);
    if (sviResult !== null) {
        return sviResult;
    }

    // 3. Forwarding Decision (VLAN-aware)
    const destMac = packet.destMAC;
    let targetPorts: string[] = [];

    if (isBroadcastMAC(destMac) || isMulticastMAC(destMac)) {
        // Flood to all ports in the same VLAN except ingress
        targetPorts = device.interfaces
            .filter((i) =>
                i.isUp &&
                i.connectedTo &&
                i.id !== ingressInterfaceId &&
                i.name !== effectiveIngressInterface?.name &&
                portAllowsVlan(i, frameVlan)
            )
            .map((i) => i.name);
    } else {
        // Unicast lookup - must match both MAC and VLAN
        const entry = device.macTable?.find(
            (e) => e.macAddress === destMac && e.vlan === frameVlan
        );

        if (entry) {
            // Known unicast in same VLAN
            if (entry.port === effectiveIngressInterface?.name) {
                // Drop if dest is on same port (filtering)
                return [];
            }
            targetPorts = [entry.port];
        } else {
            // Unknown unicast -> Flood within VLAN
            targetPorts = device.interfaces
                .filter((i) =>
                    i.isUp &&
                    i.connectedTo &&
                    i.id !== ingressInterfaceId &&
                    i.name !== effectiveIngressInterface?.name &&
                    portAllowsVlan(i, frameVlan)
                )
                .map((i) => i.name);
        }
    }

    // 4. Create Packets for Targets
    const resultPackets: Packet[] = [];

    for (const portName of targetPorts) {
        const iface = device.interfaces.find((i) => i.name === portName);
        if (!iface || !iface.connectedTo) continue;

        const connection = connections.find(
            (c) =>
                (c.sourceInterfaceId === iface.id) ||
                (c.targetInterfaceId === iface.id)
        );

        if (connection) {
            const targetDeviceId = connection.sourceDeviceId === device.id
                ? connection.targetDeviceId
                : connection.sourceDeviceId;

            // Apply egress VLAN processing (tag/untag)
            const egressPacket = processEgressVlan(packet, iface, frameVlan);

            // Clone packet for flooding/forwarding
            const newPacket: Packet = {
                ...egressPacket,
                id: uuidv4(),
                currentDeviceId: device.id,
                targetDeviceId: targetDeviceId,
                lastDeviceId: device.id,
                processingStage: 'on-link',
                progress: 0,
                path: addToPath(packet, device.id),
                vlanTag: egressPacket.vlanTag, // May be undefined for access ports
                egressInterface: iface.name,
            };
            resultPackets.push(newPacket);
        }
    }

    return resultPackets;
}

function processHubLogic(
    device: NetworkDevice,
    packet: Packet,
    connections: Connection[]
): Packet[] {
    // Hub floods everything to all ports except ingress (no MAC learning)
    const ingressConnection = connections.find(
        (c) =>
            (c.sourceDeviceId === device.id && c.targetDeviceId === packet.lastDeviceId) ||
            (c.targetDeviceId === device.id && c.sourceDeviceId === packet.lastDeviceId)
    );

    const ingressInterfaceId = ingressConnection
        ? ingressConnection.sourceDeviceId === device.id
            ? ingressConnection.sourceInterfaceId
            : ingressConnection.targetInterfaceId
        : null;

    const egressIfaces = device.interfaces.filter((i) => i.isUp && i.connectedTo && i.id !== ingressInterfaceId);

    const resultPackets: Packet[] = [];
    for (const iface of egressIfaces) {
        const connection = connections.find((c) => c.sourceInterfaceId === iface.id || c.targetInterfaceId === iface.id);
        if (!connection) continue;

        const targetDeviceId = connection.sourceDeviceId === device.id
            ? connection.targetDeviceId
            : connection.sourceDeviceId;

        resultPackets.push({
            ...packet,
            id: uuidv4(),
            currentDeviceId: device.id,
            targetDeviceId,
            lastDeviceId: device.id,
            processingStage: 'on-link',
            progress: 0,
            path: addToPath(packet, device.id),
        });
    }

    return resultPackets;
}

function processL3Logic(
    device: NetworkDevice,
    packet: Packet,
    connections: Connection[],
    updateDevice: (id: string, updates: Partial<NetworkDevice>) => void
): Packet[] {
    // Determine ingress interface (best effort) for responses/errors
    const ingressConnection = connections.find(
        (c) =>
            (c.sourceDeviceId === device.id && c.targetDeviceId === packet.lastDeviceId) ||
            (c.targetDeviceId === device.id && c.sourceDeviceId === packet.lastDeviceId)
    );

    const ingressInterfaceId = ingressConnection
        ? ingressConnection.sourceDeviceId === device.id
            ? ingressConnection.sourceInterfaceId
            : ingressConnection.targetInterfaceId
        : null;

    const ingressInterface = ingressInterfaceId
        ? device.interfaces.find((i) => i.id === ingressInterfaceId)
        : undefined;

    const myInterface = getInterfaceByMAC(device, packet.destMAC);
    const isBroadcast = isBroadcastMAC(packet.destMAC);
    // A packet is locally generated if:
    // 1. Explicit flag is set, OR
    // 2. sourceMAC matches one of our interfaces AND there's no lastDeviceId
    const isLocallyGenerated = packet.isLocallyGenerated === true ||
        (!packet.lastDeviceId && device.interfaces.some(i => i.macAddress === packet.sourceMAC));
    // Check for placeholder MAC (locally generated packet needing routing)
    const isPlaceholderMAC = packet.destMAC === '00:00:00:00:00:00';

    // If not for me, not broadcast, not locally generated, and not a placeholder, drop
    if (!myInterface && !isBroadcast && !isLocallyGenerated && !isPlaceholderMAC) {
        return [];
    }

    const resultPackets: Packet[] = [];

    // --- ARP Handling ---
    if (packet.type === 'arp') {
        const payload = packet.payload as { type: 'REQUEST' | 'REPLY'; senderIP: string; targetIP: string };

        // Update ARP Table with Sender Info
        if (payload.senderIP && packet.sourceMAC) {
            const arpTable = device.arpTable || [];
            const existingIndex = arpTable.findIndex((e) => e.ipAddress === payload.senderIP);

            // Determine interface that received this
            // We need ingress interface to know where to send reply? 
            // Or just use the interface that matches the subnet?
            // For now, assume we update if we hear it.

            const entry: ArpEntry = {
                ipAddress: payload.senderIP,
                macAddress: packet.sourceMAC,
                interface: ingressInterface?.name || device.interfaces[0]?.name || 'eth0',
                type: 'dynamic',
                age: 0,
            };

            const newTable = existingIndex === -1
                ? [...arpTable, entry]
                : arpTable.map((e, i) => i === existingIndex ? entry : e);

            updateDevice(device.id, { arpTable: newTable });

            // Check for buffered packets waiting for this ARP
            // TODO: This requires access to ALL packets in store, or we assume they are passed in?
            // The `processDeviceTick` only sees ONE packet.
            // We need a mechanism to wake up buffered packets.
            // For now, we'll skip waking up buffered packets in this tick. 
            // The simulation loop should periodically check buffered packets.
        }

        // If ARP Request for ME, send Reply
        if (payload.type === 'REQUEST') {
            const targetInterface = device.interfaces.find((i) => i.ipAddress === payload.targetIP);
            if (targetInterface) {
                const replyPacket: Packet = {
                    id: uuidv4(),
                    type: 'arp',
                    sourceMAC: targetInterface.macAddress,
                    destMAC: packet.sourceMAC,
                    ttl: 64,
                    size: 64,
                    currentDeviceId: device.id,
                    processingStage: 'at-device',
                    progress: 0,
                    path: [],
                    currentPathIndex: 0,
                    payload: {
                        type: 'REPLY',
                        senderIP: targetInterface.ipAddress,
                        targetIP: payload.senderIP,
                    },
                };

                // Prefer sending it immediately on the link (when we have connection info)
                const outConn = connections.find(
                    (c) => c.sourceInterfaceId === targetInterface.id || c.targetInterfaceId === targetInterface.id
                );
                if (outConn) {
                    replyPacket.targetDeviceId = outConn.sourceDeviceId === device.id
                        ? outConn.targetDeviceId
                        : outConn.sourceDeviceId;
                    replyPacket.processingStage = 'on-link';
                    replyPacket.progress = 0;
                }

                resultPackets.push(replyPacket);
            }
        }

        return resultPackets; // ARP packets are consumed (plus any generated reply)
    }

    // --- Passive ARP Learning from IP packets ---
    // When we receive an IP packet, learn the source IP/MAC mapping if the source
    // is on a directly connected network. This reduces ARP traffic and speeds up
    // initial connectivity.
    if (packet.sourceIP && packet.sourceMAC && ingressInterface && !isLocallyGenerated) {
        // Check if source IP is on the same subnet as the ingress interface
        if (ingressInterface.ipAddress && ingressInterface.subnetMask) {
            const isSameSubnet = isSameNetwork(
                packet.sourceIP,
                ingressInterface.ipAddress,
                ingressInterface.subnetMask
            );

            if (isSameSubnet) {
                const arpTable = device.arpTable || [];
                const existingIndex = arpTable.findIndex((e) => e.ipAddress === packet.sourceIP);

                // Only add/update if not already present or if MAC changed
                if (existingIndex === -1 || arpTable[existingIndex].macAddress !== packet.sourceMAC) {
                    const entry: ArpEntry = {
                        ipAddress: packet.sourceIP,
                        macAddress: packet.sourceMAC,
                        interface: ingressInterface.name,
                        type: 'dynamic',
                        age: 0,
                    };

                    const newTable = existingIndex === -1
                        ? [...arpTable, entry]
                        : arpTable.map((e, i) => i === existingIndex ? entry : e);

                    updateDevice(device.id, { arpTable: newTable });
                }
            }
        }
    }

    // --- Firewall Rule Checking (for firewall devices) ---
    if (device.type === 'firewall' && device.firewallRules && device.firewallRules.length > 0 && !isLocallyGenerated) {
        const firewallResult = evaluateFirewallRules(packet, device.firewallRules);
        if (firewallResult === 'deny') {
            // Packet denied by firewall rule - drop silently
            return [];
        }
        if (firewallResult === 'no-match') {
            // Implicit deny at end of ruleset
            return [];
        }
        // 'allow' - continue processing
    }

    // --- IP Handling ---
    if (packet.destIP) {
        // Check if it's for me
        const isForMe = device.interfaces.some((i) => i.ipAddress === packet.destIP);

        if (isForMe) {
            // Consume
            if (packet.type === 'icmp' && packet.icmpType === 8) { // Echo Request
                // Send Echo Reply
                const replyPacket: Packet = {
                    id: uuidv4(),
                    type: 'icmp',
                    sourceMAC: packet.destMAC, // From the interface it arrived on
                    destMAC: packet.sourceMAC,
                    sourceIP: packet.destIP,
                    destIP: packet.sourceIP,
                    ttl: 64,
                    size: 64,
                    icmpType: 0, // Echo Reply
                    icmpCode: 0,
                    icmpSeq: packet.icmpSeq,
                    currentDeviceId: device.id,
                    processingStage: 'at-device',
                    progress: 0,
                    path: [],
                    currentPathIndex: 0,
                };
                resultPackets.push(replyPacket);
            } else if (packet.type === 'icmp' && packet.icmpType === 0) {
                // Echo reply arrived at destination. Keep it as 'arrived' so consumers (e.g. `ping`)
                // can observe it instead of it being immediately consumed on the next tick.
                resultPackets.push({
                    ...packet,
                    processingStage: 'arrived',
                    progress: 0,
                });
            }
            return resultPackets;
        }

        // Routing
        // 1. Check connected networks
        const connectedInterface = device.interfaces.find((i) =>
            i.ipAddress && i.subnetMask && packet.destIP && isSameNetwork(i.ipAddress, packet.destIP, i.subnetMask)
        );

        // Drop and generate ICMP Time Exceeded if TTL would expire on this hop
        if (!isLocallyGenerated && packet.ttl <= 1) {
            if (packet.sourceIP && ingressInterface) {
                const arpEntry = device.arpTable?.find((e) => e.ipAddress === packet.sourceIP);

                const timeExceeded: Packet = {
                    id: uuidv4(),
                    type: 'icmp',
                    icmpType: 11, // Time Exceeded
                    icmpCode: 0,
                    sourceMAC: ingressInterface.macAddress,
                    destMAC: arpEntry ? arpEntry.macAddress : 'FF:FF:FF:FF:FF:FF',
                    sourceIP: ingressInterface.ipAddress ?? undefined,
                    destIP: packet.sourceIP,
                    ttl: 64,
                    size: 64,
                    currentDeviceId: device.id,
                    processingStage: 'at-device',
                    progress: 0,
                    path: [],
                    currentPathIndex: 0,
                };

                const outConn = connections.find(
                    (c) => c.sourceInterfaceId === ingressInterface.id || c.targetInterfaceId === ingressInterface.id
                );

                if (arpEntry && outConn) {
                    timeExceeded.targetDeviceId = outConn.sourceDeviceId === device.id
                        ? outConn.targetDeviceId
                        : outConn.sourceDeviceId;
                    timeExceeded.processingStage = 'on-link';
                    timeExceeded.progress = 0;
                    return [timeExceeded];
                }
            }

            // If we cannot respond, silently drop
            return [];
        }

        let nextHopIP: string | undefined;
        let egressInterface: NetworkInterface | undefined;

        if (connectedInterface) {
            // Directly connected
            nextHopIP = packet.destIP;
            egressInterface = connectedInterface;
        } else {
            // 2. Check Routing Table
            let route: RouteEntry | undefined;
            if (device.routingTable) {
                const found = findBestRoute(packet.destIP, device.routingTable);
                if (found) {
                    route = {
                        destination: packet.destIP, // Not exactly true but sufficient for nextHop
                        netmask: '255.255.255.255',
                        gateway: found.gateway,
                        metric: found.metric,
                        interface: found.interface,
                        type: 'static'
                    };
                }
            }

            // 3. Check Default Gateway (from Interface)
            if (!route) {
                // Find an interface with a gateway configured
                const defaultInterface = device.interfaces.find((i) => i.gateway);
                if (defaultInterface && defaultInterface.gateway) {
                    route = {
                        destination: '0.0.0.0',
                        netmask: '0.0.0.0',
                        gateway: defaultInterface.gateway,
                        metric: 1,
                        interface: defaultInterface.name,
                        type: 'static',
                    };
                }
            }

            if (!route) {
                // No route found - send ICMP Destination Unreachable (Network Unreachable)
                if (packet.sourceIP && ingressInterface && !isLocallyGenerated) {
                    const arpEntry = device.arpTable?.find((e) => e.ipAddress === packet.sourceIP);

                    const destUnreachable: Packet = {
                        id: uuidv4(),
                        type: 'icmp',
                        icmpType: 3, // Destination Unreachable
                        icmpCode: 0, // Network Unreachable
                        sourceMAC: ingressInterface.macAddress,
                        destMAC: arpEntry ? arpEntry.macAddress : packet.sourceMAC,
                        sourceIP: ingressInterface.ipAddress ?? undefined,
                        destIP: packet.sourceIP,
                        ttl: 64,
                        size: 64,
                        currentDeviceId: device.id,
                        processingStage: 'at-device',
                        progress: 0,
                        path: addToPath(packet, device.id),
                        currentPathIndex: 0,
                        payload: {
                            originalDestIP: packet.destIP,
                            originalSourceIP: packet.sourceIP,
                            originalType: packet.type,
                        },
                    };

                    const outConn = connections.find(
                        (c) => c.sourceInterfaceId === ingressInterface.id || c.targetInterfaceId === ingressInterface.id
                    );

                    if (outConn) {
                        destUnreachable.targetDeviceId = outConn.sourceDeviceId === device.id
                            ? outConn.targetDeviceId
                            : outConn.sourceDeviceId;
                        destUnreachable.processingStage = 'on-link';
                        destUnreachable.progress = 0;
                        return [destUnreachable];
                    }
                }
                return [];
            }

            nextHopIP = route.gateway === '0.0.0.0' ? packet.destIP : route.gateway;
            egressInterface = device.interfaces.find((i) => i.name === route.interface);
        }

        if (!egressInterface || !nextHopIP) return [];

        // ARP Resolve Next Hop
        const arpEntry = device.arpTable?.find((e) => e.ipAddress === nextHopIP);

        if (arpEntry) {
            // ARP Hit -> Forward
            // Only decrement TTL if this is a forwarding operation (not locally generated)
            const newTtl = isLocallyGenerated ? packet.ttl : packet.ttl - 1;
            const forwardedPacket: Packet = {
                ...packet,
                id: uuidv4(),
                sourceMAC: egressInterface.macAddress,
                destMAC: arpEntry.macAddress,
                ttl: newTtl,
                currentDeviceId: device.id,
                lastDeviceId: device.id,
                processingStage: 'at-device',
                path: addToPath(packet, device.id),
                isLocallyGenerated: false, // Clear flag - packet is now forwarded, not locally generated
            };

            // Find connection on egress interface
            const connection = connections.find(
                (c) => c.sourceInterfaceId === egressInterface.id || c.targetInterfaceId === egressInterface.id
            );

            if (connection) {
                forwardedPacket.targetDeviceId = connection.sourceDeviceId === device.id
                    ? connection.targetDeviceId
                    : connection.sourceDeviceId;
                forwardedPacket.processingStage = 'on-link';
                forwardedPacket.progress = 0;
                return [forwardedPacket];
            }
        } else {
            // ARP Miss -> Buffer and Request ARP
            // 1. Send ARP Request
            const arpRequest: Packet = {
                id: uuidv4(),
                type: 'arp',
                sourceMAC: egressInterface.macAddress,
                destMAC: 'FF:FF:FF:FF:FF:FF',
                ttl: 64,
                size: 64,
                currentDeviceId: device.id,
                processingStage: 'at-device', // Needs to be routed/sent
                progress: 0,
                path: [],
                currentPathIndex: 0,
                payload: {
                    type: 'REQUEST',
                    senderIP: egressInterface.ipAddress,
                    targetIP: nextHopIP,
                },
            };

            // We need to send this ARP request OUT.
            // Since it's 'at-device', if we return it, it will be processed again by this device?
            // Yes. And since it's broadcast, `processL3Logic` might drop it if it thinks it's for me?
            // No, `processL3Logic` handles ARP.
            // But we want to SEND it.
            // If we return it as 'at-device', the next tick will see it.
            // But wait, if we return it, it's in the packet list.
            // The next tick will call `processDeviceTick` on it.
            // `processDeviceTick` -> `processL3Logic`.
            // `processL3Logic` sees ARP Request.
            // It will see `destMAC` is Broadcast.
            // It will see `type` is ARP.
            // It will try to process it as an INCOMING ARP.
            // But this is an OUTGOING ARP.
            // We need to distinguish incoming vs outgoing?
            // Or just put it 'on-link' immediately?
            // Yes, put it on link.

            const connection = connections.find(
                (c) => c.sourceInterfaceId === egressInterface.id || c.targetInterfaceId === egressInterface.id
            );

            if (connection) {
                arpRequest.targetDeviceId = connection.sourceDeviceId === device.id
                    ? connection.targetDeviceId
                    : connection.sourceDeviceId;
                arpRequest.processingStage = 'on-link';
                resultPackets.push(arpRequest);
            }

            // 2. Buffer original packet
            const bufferedPacket: Packet = {
                ...packet,
                processingStage: 'buffered',
                waitingForArp: nextHopIP,
                isLocallyGenerated: false, // When it wakes up, it's a forwarded packet
            };
            resultPackets.push(bufferedPacket);

            return resultPackets;
        }
    }

    return [];
}

// Process packet on link
export function processLinkTick(
    packet: Packet,
    connections: Connection[],
    simulationSpeed: number
): Packet {
    if (packet.processingStage !== 'on-link' || !packet.targetDeviceId) {
        return packet;
    }

    // Find connection to determine bandwidth/latency (optional, for now just use speed)
    // We could use connection.bandwidth to adjust speed.

    const newProgress = packet.progress + (simulationSpeed * 2); // 2% per tick at 1x speed

    if (newProgress >= 100) {
        // Arrived at target
        return {
            ...packet,
            lastDeviceId: packet.currentDeviceId, // The device it just left
            currentDeviceId: packet.targetDeviceId,
            targetDeviceId: undefined,
            processingStage: 'at-device',
            progress: 0,
        };
    }

    return {
        ...packet,
        progress: newProgress,
    };
}
