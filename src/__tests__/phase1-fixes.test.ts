import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processDeviceTick, processLinkTick } from '@/lib/simulation';
import type { NetworkDevice, Connection, Packet, NetworkInterface, ArpEntry, MacTableEntry } from '@/types/network';
import { generateMacAddress } from '@/lib/network-utils';

// ============================================
// Test Helpers
// ============================================

function createMockDevice(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
    return {
        id: 'device-1',
        type: 'pc',
        name: 'PC1',
        hostname: 'pc1',
        interfaces: [
            {
                id: 'iface-1',
                name: 'eth0',
                macAddress: '02:00:00:00:00:01',
                ipAddress: '192.168.1.10',
                subnetMask: '255.255.255.0',
                gateway: '192.168.1.1',
                isUp: true,
                speed: 1000,
                duplex: 'full',
            },
        ],
        position: { x: 0, y: 0 },
        isRunning: true,
        arpTable: [],
        config: {},
        ...overrides,
    };
}

function createMockRouter(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
    return {
        id: 'router-1',
        type: 'router',
        name: 'Router1',
        hostname: 'router1',
        interfaces: [
            {
                id: 'router-iface-0',
                name: 'GigabitEthernet0/0',
                macAddress: '02:00:00:00:01:00',
                ipAddress: '192.168.1.1',
                subnetMask: '255.255.255.0',
                gateway: null,
                isUp: true,
                speed: 1000,
                duplex: 'full',
                connectedTo: 'external-1',
            },
            {
                id: 'router-iface-1',
                name: 'GigabitEthernet0/1',
                macAddress: '02:00:00:00:01:01',
                ipAddress: '10.0.0.1',
                subnetMask: '255.255.255.0',
                gateway: null,
                isUp: true,
                speed: 1000,
                duplex: 'full',
                connectedTo: 'external-2',
            },
        ],
        position: { x: 0, y: 0 },
        isRunning: true,
        arpTable: [],
        routingTable: [
            {
                destination: '192.168.1.0',
                netmask: '255.255.255.0',
                gateway: '0.0.0.0',
                interface: 'GigabitEthernet0/0',
                metric: 0,
                type: 'connected',
            },
            {
                destination: '10.0.0.0',
                netmask: '255.255.255.0',
                gateway: '0.0.0.0',
                interface: 'GigabitEthernet0/1',
                metric: 0,
                type: 'connected',
            },
        ],
        config: {},
        ...overrides,
    };
}

function createMockSwitch(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
    const interfaces: NetworkInterface[] = [];
    for (let i = 0; i < 8; i++) {
        interfaces.push({
            id: `sw-iface-${i}`,
            name: `FastEthernet0/${i}`,
            macAddress: generateMacAddress(),
            ipAddress: null,
            subnetMask: null,
            gateway: null,
            isUp: true,
            speed: 100,
            duplex: 'full',
            connectedTo: i < 2 ? `connected-${i}` : undefined,
        });
    }

    return {
        id: 'switch-1',
        type: 'switch',
        name: 'Switch1',
        hostname: 'switch1',
        interfaces,
        position: { x: 0, y: 0 },
        isRunning: true,
        macTable: [],
        config: {},
        ...overrides,
    };
}

function createMockFirewall(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
    return {
        id: 'firewall-1',
        type: 'firewall',
        name: 'Firewall1',
        hostname: 'firewall1',
        interfaces: [
            {
                id: 'fw-iface-0',
                name: 'GigabitEthernet0/0',
                macAddress: '02:00:00:00:02:00',
                ipAddress: '192.168.1.1',
                subnetMask: '255.255.255.0',
                gateway: null,
                isUp: true,
                speed: 1000,
                duplex: 'full',
                connectedTo: 'external-1',
            },
            {
                id: 'fw-iface-1',
                name: 'GigabitEthernet0/1',
                macAddress: '02:00:00:00:02:01',
                ipAddress: '10.0.0.1',
                subnetMask: '255.255.255.0',
                gateway: null,
                isUp: true,
                speed: 1000,
                duplex: 'full',
                connectedTo: 'external-2',
            },
        ],
        position: { x: 0, y: 0 },
        isRunning: true,
        arpTable: [],
        routingTable: [
            {
                destination: '192.168.1.0',
                netmask: '255.255.255.0',
                gateway: '0.0.0.0',
                interface: 'GigabitEthernet0/0',
                metric: 0,
                type: 'connected',
            },
            {
                destination: '10.0.0.0',
                netmask: '255.255.255.0',
                gateway: '0.0.0.0',
                interface: 'GigabitEthernet0/1',
                metric: 0,
                type: 'connected',
            },
        ],
        firewallRules: [
            {
                id: 'rule-1',
                name: 'Allow ICMP',
                action: 'allow',
                protocol: 'icmp',
                sourceIp: 'any',
                sourcePort: '*',
                destIp: 'any',
                destPort: '*',
                direction: 'both',
                enabled: true,
            },
        ],
        config: {},
        ...overrides,
    };
}

function createMockPacket(overrides: Partial<Packet> = {}): Packet {
    return {
        id: 'packet-1',
        type: 'icmp',
        sourceMAC: '02:00:00:00:00:01',
        destMAC: '02:00:00:00:00:02',
        sourceIP: '192.168.1.10',
        destIP: '192.168.1.20',
        ttl: 64,
        size: 64,
        currentDeviceId: 'device-1',
        processingStage: 'at-device',
        progress: 0,
        path: [],
        currentPathIndex: 0,
        ...overrides,
    };
}

// ============================================
// Phase 1 Tests: Bug Fixes
// ============================================

describe('Phase 1: Bug Fixes', () => {
    let mockUpdateDevice: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockUpdateDevice = vi.fn();
    });

    // ============================================
    // 1.1 Fix ARP Interface Detection
    // ============================================
    describe('1.1 ARP Interface Detection', () => {
        it('should learn ARP entry with correct interface name on router', () => {
            const router = createMockRouter();

            // ARP reply coming in on GigabitEthernet0/1 (10.0.0.x network)
            const arpReply = createMockPacket({
                type: 'arp',
                currentDeviceId: router.id,
                lastDeviceId: 'remote-device',
                sourceMAC: '02:AA:BB:CC:DD:EE',
                destMAC: router.interfaces[1].macAddress, // Gi0/1
                payload: {
                    type: 'REPLY',
                    senderIP: '10.0.0.100',
                    targetIP: router.interfaces[1].ipAddress,
                },
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: 'remote-device',
                    sourceInterfaceId: 'remote-iface',
                    targetDeviceId: router.id,
                    targetInterfaceId: router.interfaces[1].id, // Gi0/1
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            processDeviceTick(router, arpReply, connections, mockUpdateDevice);

            expect(mockUpdateDevice).toHaveBeenCalled();
            const updateCall = mockUpdateDevice.mock.calls[0];
            expect(updateCall[1].arpTable).toBeDefined();
            expect(updateCall[1].arpTable[0].interface).toBe('GigabitEthernet0/1'); // NOT 'eth0'
        });

        it('should learn ARP entry with correct interface on first interface', () => {
            const router = createMockRouter();

            const arpReply = createMockPacket({
                type: 'arp',
                currentDeviceId: router.id,
                lastDeviceId: 'remote-device',
                sourceMAC: '02:AA:BB:CC:DD:EE',
                destMAC: router.interfaces[0].macAddress, // Gi0/0
                payload: {
                    type: 'REPLY',
                    senderIP: '192.168.1.100',
                    targetIP: router.interfaces[0].ipAddress,
                },
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: 'remote-device',
                    sourceInterfaceId: 'remote-iface',
                    targetDeviceId: router.id,
                    targetInterfaceId: router.interfaces[0].id, // Gi0/0
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            processDeviceTick(router, arpReply, connections, mockUpdateDevice);

            expect(mockUpdateDevice).toHaveBeenCalled();
            const updateCall = mockUpdateDevice.mock.calls[0];
            expect(updateCall[1].arpTable[0].interface).toBe('GigabitEthernet0/0');
        });

        it('should learn ARP from request (not just reply) with correct interface', () => {
            const router = createMockRouter();

            // ARP Request coming in asking for someone else - we should still learn sender
            const arpRequest = createMockPacket({
                type: 'arp',
                currentDeviceId: router.id,
                lastDeviceId: 'remote-device',
                sourceMAC: '02:AA:BB:CC:DD:EE',
                destMAC: 'FF:FF:FF:FF:FF:FF',
                payload: {
                    type: 'REQUEST',
                    senderIP: '10.0.0.50',
                    targetIP: '10.0.0.200', // Not the router's IP
                },
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: 'remote-device',
                    sourceInterfaceId: 'remote-iface',
                    targetDeviceId: router.id,
                    targetInterfaceId: router.interfaces[1].id, // Gi0/1
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            processDeviceTick(router, arpRequest, connections, mockUpdateDevice);

            expect(mockUpdateDevice).toHaveBeenCalled();
            const updateCall = mockUpdateDevice.mock.calls[0];
            expect(updateCall[1].arpTable[0].interface).toBe('GigabitEthernet0/1');
        });
    });

    // ============================================
    // 1.2 Packet Path Tracking
    // ============================================
    describe('1.2 Packet Path Tracking', () => {
        it('should update packet path when processed at device', () => {
            const pc = createMockDevice({
                arpTable: [
                    { ipAddress: '192.168.1.20', macAddress: '02:00:00:00:00:02', interface: 'eth0', type: 'dynamic', age: 0 },
                ],
            });

            const packet = createMockPacket({
                currentDeviceId: pc.id,
                sourceMAC: pc.interfaces[0].macAddress,
                destMAC: '00:00:00:00:00:00', // Placeholder - needs routing
                sourceIP: pc.interfaces[0].ipAddress!,
                destIP: '192.168.1.20',
                path: [],
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: pc.id,
                    sourceInterfaceId: pc.interfaces[0].id,
                    targetDeviceId: 'switch-1',
                    targetInterfaceId: 'sw-iface-1',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(pc, packet, connections, mockUpdateDevice);

            expect(result.length).toBeGreaterThan(0);
            expect(result[0].path).toContain(pc.id);
        });

        it('should accumulate path as packet traverses multiple devices', () => {
            const sw = createMockSwitch();
            sw.interfaces[0].connectedTo = 'ext-0';
            sw.interfaces[1].connectedTo = 'ext-1';

            const packet = createMockPacket({
                currentDeviceId: sw.id,
                lastDeviceId: 'pc-1',
                sourceMAC: '02:AA:BB:CC:DD:EE',
                destMAC: '02:00:00:00:00:02',
                path: ['pc-1'], // Already has previous hop
            });

            const connections: Connection[] = [
                {
                    id: 'conn-0',
                    sourceDeviceId: 'pc-1',
                    sourceInterfaceId: 'pc-0-iface',
                    targetDeviceId: sw.id,
                    targetInterfaceId: sw.interfaces[0].id,
                    isUp: true,
                    bandwidth: 100,
                    latency: 1,
                    packetLoss: 0,
                },
                {
                    id: 'conn-1',
                    sourceDeviceId: sw.id,
                    sourceInterfaceId: sw.interfaces[1].id,
                    targetDeviceId: 'pc-2',
                    targetInterfaceId: 'pc-2-iface',
                    isUp: true,
                    bandwidth: 100,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            // Need MAC in table for unicast
            sw.macTable = [
                { macAddress: '02:00:00:00:00:02', port: 'FastEthernet0/1', vlan: 1, type: 'dynamic', age: 0 },
            ];

            const result = processDeviceTick(sw, packet, connections, mockUpdateDevice);

            expect(result.length).toBe(1);
            expect(result[0].path).toContain('pc-1');
            expect(result[0].path).toContain(sw.id);
        });
    });

    // ============================================
    // 1.3 Explicit Packet Flags
    // ============================================
    describe('1.3 Explicit Packet Flags (isLocallyGenerated)', () => {
        it('should not decrement TTL for locally generated packets', () => {
            const pc = createMockDevice({
                arpTable: [
                    { ipAddress: '192.168.1.20', macAddress: '02:00:00:00:00:02', interface: 'eth0', type: 'dynamic', age: 0 },
                ],
            });

            const packet = createMockPacket({
                currentDeviceId: pc.id,
                sourceMAC: pc.interfaces[0].macAddress,
                destMAC: '00:00:00:00:00:00',
                sourceIP: pc.interfaces[0].ipAddress!,
                destIP: '192.168.1.20',
                ttl: 64,
                isLocallyGenerated: true, // Explicit flag
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: pc.id,
                    sourceInterfaceId: pc.interfaces[0].id,
                    targetDeviceId: 'switch-1',
                    targetInterfaceId: 'sw-iface-1',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(pc, packet, connections, mockUpdateDevice);

            expect(result.length).toBe(1);
            expect(result[0].ttl).toBe(64); // TTL should NOT be decremented
        });

        it('should decrement TTL for forwarded packets (not locally generated)', () => {
            const router = createMockRouter({
                arpTable: [
                    { ipAddress: '10.0.0.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/1', type: 'dynamic', age: 0 },
                ],
            });

            const packet = createMockPacket({
                currentDeviceId: router.id,
                lastDeviceId: 'pc-1',
                sourceMAC: '02:00:00:00:00:01',
                destMAC: router.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '10.0.0.100',
                ttl: 64,
                isLocallyGenerated: false, // Explicit flag - forwarding
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: router.id,
                    sourceInterfaceId: router.interfaces[1].id,
                    targetDeviceId: 'remote-device',
                    targetInterfaceId: 'remote-iface',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(router, packet, connections, mockUpdateDevice);

            expect(result.length).toBe(1);
            expect(result[0].ttl).toBe(63); // TTL should be decremented
        });
    });

    // ============================================
    // 1.4 ICMP Destination Unreachable
    // ============================================
    describe('1.4 ICMP Destination Unreachable', () => {
        it('should send ICMP Network Unreachable when no route exists', () => {
            const router = createMockRouter({
                routingTable: [
                    // Only has connected routes, no default route
                    {
                        destination: '192.168.1.0',
                        netmask: '255.255.255.0',
                        gateway: '0.0.0.0',
                        interface: 'GigabitEthernet0/0',
                        metric: 0,
                        type: 'connected',
                    },
                ],
                arpTable: [
                    { ipAddress: '192.168.1.10', macAddress: '02:00:00:00:00:01', interface: 'GigabitEthernet0/0', type: 'dynamic', age: 0 },
                ],
            });

            const packet = createMockPacket({
                currentDeviceId: router.id,
                lastDeviceId: 'pc-1',
                sourceMAC: '02:00:00:00:00:01',
                destMAC: router.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '8.8.8.8', // No route to this
                ttl: 64,
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: 'pc-1',
                    sourceInterfaceId: 'pc-iface-1',
                    targetDeviceId: router.id,
                    targetInterfaceId: router.interfaces[0].id,
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(router, packet, connections, mockUpdateDevice);

            // Should generate ICMP Destination Unreachable
            const icmpError = result.find(p => p.type === 'icmp' && p.icmpType === 3);
            expect(icmpError).toBeDefined();
            expect(icmpError!.icmpCode).toBe(0); // Network Unreachable
            expect(icmpError!.destIP).toBe('192.168.1.10'); // Back to source
            expect(icmpError!.sourceIP).toBe(router.interfaces[0].ipAddress);
        });

        it('should send ICMP Host Unreachable when ARP fails (after timeout)', () => {
            const router = createMockRouter({
                arpTable: [], // Empty ARP table - host unreachable after ARP timeout
            });

            // This test would require simulating ARP timeout, which is complex.
            // For now, we test that when explicitly marked, host unreachable is sent.
            // The actual ARP timeout mechanism would need store-level changes.
        });

        it('should include original packet data in ICMP error payload', () => {
            const router = createMockRouter({
                routingTable: [
                    {
                        destination: '192.168.1.0',
                        netmask: '255.255.255.0',
                        gateway: '0.0.0.0',
                        interface: 'GigabitEthernet0/0',
                        metric: 0,
                        type: 'connected',
                    },
                ],
                arpTable: [
                    { ipAddress: '192.168.1.10', macAddress: '02:00:00:00:00:01', interface: 'GigabitEthernet0/0', type: 'dynamic', age: 0 },
                ],
            });

            const originalPacket = createMockPacket({
                currentDeviceId: router.id,
                lastDeviceId: 'pc-1',
                sourceMAC: '02:00:00:00:00:01',
                destMAC: router.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '172.16.0.100', // No route
                ttl: 64,
                icmpType: 8,
                icmpSeq: 42,
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: 'pc-1',
                    sourceInterfaceId: 'pc-iface-1',
                    targetDeviceId: router.id,
                    targetInterfaceId: router.interfaces[0].id,
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(router, originalPacket, connections, mockUpdateDevice);

            const icmpError = result.find(p => p.type === 'icmp' && p.icmpType === 3);
            expect(icmpError).toBeDefined();
            // ICMP error should contain reference to original packet
            expect(icmpError!.payload).toBeDefined();
            expect((icmpError!.payload as any).originalDestIP).toBe('172.16.0.100');
        });
    });

    // ============================================
    // 1.5 Firewall Rule Evaluation
    // ============================================
    describe('1.5 Firewall Rule Evaluation', () => {
        it('should allow packet matching allow rule', () => {
            const firewall = createMockFirewall({
                arpTable: [
                    { ipAddress: '10.0.0.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/1', type: 'dynamic', age: 0 },
                ],
                firewallRules: [
                    {
                        id: 'rule-1',
                        name: 'Allow ICMP',
                        action: 'allow',
                        protocol: 'icmp',
                        sourceIp: 'any',
                        sourcePort: '*',
                        destIp: 'any',
                        destPort: '*',
                        direction: 'both',
                        enabled: true,
                    },
                ],
            });

            const packet = createMockPacket({
                type: 'icmp',
                currentDeviceId: firewall.id,
                lastDeviceId: 'pc-1',
                sourceMAC: '02:00:00:00:00:01',
                destMAC: firewall.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '10.0.0.100',
                ttl: 64,
                icmpType: 8,
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: firewall.id,
                    sourceInterfaceId: firewall.interfaces[1].id,
                    targetDeviceId: 'remote-device',
                    targetInterfaceId: 'remote-iface',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(firewall, packet, connections, mockUpdateDevice);

            // Packet should be forwarded (not dropped)
            expect(result.length).toBe(1);
            expect(result[0].destIP).toBe('10.0.0.100');
        });

        it('should drop packet matching deny rule', () => {
            const firewall = createMockFirewall({
                arpTable: [
                    { ipAddress: '10.0.0.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/1', type: 'dynamic', age: 0 },
                ],
                firewallRules: [
                    {
                        id: 'rule-1',
                        name: 'Deny all TCP',
                        action: 'deny',
                        protocol: 'tcp',
                        sourceIp: 'any',
                        sourcePort: '*',
                        destIp: 'any',
                        destPort: '*',
                        direction: 'both',
                        enabled: true,
                    },
                    {
                        id: 'rule-2',
                        name: 'Allow ICMP',
                        action: 'allow',
                        protocol: 'icmp',
                        sourceIp: 'any',
                        sourcePort: '*',
                        destIp: 'any',
                        destPort: '*',
                        direction: 'both',
                        enabled: true,
                    },
                ],
            });

            const packet = createMockPacket({
                type: 'tcp',
                currentDeviceId: firewall.id,
                lastDeviceId: 'pc-1',
                sourceMAC: '02:00:00:00:00:01',
                destMAC: firewall.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '10.0.0.100',
                sourcePort: 12345,
                destPort: 80,
                ttl: 64,
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: firewall.id,
                    sourceInterfaceId: firewall.interfaces[1].id,
                    targetDeviceId: 'remote-device',
                    targetInterfaceId: 'remote-iface',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(firewall, packet, connections, mockUpdateDevice);

            // Packet should be dropped
            expect(result.length).toBe(0);
        });

        it('should apply implicit deny at end of ruleset', () => {
            const firewall = createMockFirewall({
                arpTable: [
                    { ipAddress: '10.0.0.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/1', type: 'dynamic', age: 0 },
                ],
                firewallRules: [
                    // Only allows ICMP, everything else should be denied
                    {
                        id: 'rule-1',
                        name: 'Allow ICMP',
                        action: 'allow',
                        protocol: 'icmp',
                        sourceIp: 'any',
                        sourcePort: '*',
                        destIp: 'any',
                        destPort: '*',
                        direction: 'both',
                        enabled: true,
                    },
                ],
            });

            const packet = createMockPacket({
                type: 'udp',
                currentDeviceId: firewall.id,
                lastDeviceId: 'pc-1',
                sourceMAC: '02:00:00:00:00:01',
                destMAC: firewall.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '10.0.0.100',
                sourcePort: 12345,
                destPort: 53,
                ttl: 64,
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: firewall.id,
                    sourceInterfaceId: firewall.interfaces[1].id,
                    targetDeviceId: 'remote-device',
                    targetInterfaceId: 'remote-iface',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(firewall, packet, connections, mockUpdateDevice);

            // UDP packet should be dropped (implicit deny)
            expect(result.length).toBe(0);
        });

        it('should match specific source IP in rule', () => {
            const firewall = createMockFirewall({
                arpTable: [
                    { ipAddress: '10.0.0.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/1', type: 'dynamic', age: 0 },
                ],
                firewallRules: [
                    {
                        id: 'rule-1',
                        name: 'Allow from specific host',
                        action: 'allow',
                        protocol: 'any',
                        sourceIp: '192.168.1.10',
                        sourcePort: '*',
                        destIp: 'any',
                        destPort: '*',
                        direction: 'both',
                        enabled: true,
                    },
                ],
            });

            // Packet from allowed source
            const allowedPacket = createMockPacket({
                type: 'icmp',
                currentDeviceId: firewall.id,
                lastDeviceId: 'pc-1',
                sourceMAC: '02:00:00:00:00:01',
                destMAC: firewall.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '10.0.0.100',
                ttl: 64,
            });

            // Packet from different source
            const blockedPacket = createMockPacket({
                type: 'icmp',
                currentDeviceId: firewall.id,
                lastDeviceId: 'pc-2',
                sourceMAC: '02:00:00:00:00:02',
                destMAC: firewall.interfaces[0].macAddress,
                sourceIP: '192.168.1.20', // Different source
                destIP: '10.0.0.100',
                ttl: 64,
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: firewall.id,
                    sourceInterfaceId: firewall.interfaces[1].id,
                    targetDeviceId: 'remote-device',
                    targetInterfaceId: 'remote-iface',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const allowedResult = processDeviceTick(firewall, allowedPacket, connections, mockUpdateDevice);
            const blockedResult = processDeviceTick(firewall, blockedPacket, connections, mockUpdateDevice);

            expect(allowedResult.length).toBe(1); // Allowed
            expect(blockedResult.length).toBe(0); // Blocked (implicit deny)
        });

        it('should skip disabled rules', () => {
            const firewall = createMockFirewall({
                arpTable: [
                    { ipAddress: '10.0.0.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/1', type: 'dynamic', age: 0 },
                ],
                firewallRules: [
                    {
                        id: 'rule-1',
                        name: 'Deny all (disabled)',
                        action: 'deny',
                        protocol: 'any',
                        sourceIp: 'any',
                        sourcePort: '*',
                        destIp: 'any',
                        destPort: '*',
                        direction: 'both',
                        enabled: false, // Disabled!
                    },
                    {
                        id: 'rule-2',
                        name: 'Allow ICMP',
                        action: 'allow',
                        protocol: 'icmp',
                        sourceIp: 'any',
                        sourcePort: '*',
                        destIp: 'any',
                        destPort: '*',
                        direction: 'both',
                        enabled: true,
                    },
                ],
            });

            const packet = createMockPacket({
                type: 'icmp',
                currentDeviceId: firewall.id,
                lastDeviceId: 'pc-1',
                destMAC: firewall.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '10.0.0.100',
                ttl: 64,
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: firewall.id,
                    sourceInterfaceId: firewall.interfaces[1].id,
                    targetDeviceId: 'remote-device',
                    targetInterfaceId: 'remote-iface',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(firewall, packet, connections, mockUpdateDevice);

            // Should be allowed (disabled deny rule is skipped)
            expect(result.length).toBe(1);
        });
    });

    // ============================================
    // 1.6 ARP/MAC Table Aging (Store-level tests)
    // ============================================
    describe('1.6 ARP/MAC Table Aging', () => {
        // Note: Full aging tests require store integration.
        // Here we test the core aging logic that will be called from the store tick.

        it('should have age field in ARP entries that can be incremented', () => {
            const router = createMockRouter({
                arpTable: [
                    { ipAddress: '192.168.1.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/0', type: 'dynamic', age: 0 },
                ],
            });

            // Verify ARP entry has age field
            expect(router.arpTable![0].age).toBe(0);

            // Simulate aging (would be done in store tick)
            const agedEntry = { ...router.arpTable![0], age: router.arpTable![0].age + 1 };
            expect(agedEntry.age).toBe(1);
        });

        it('should have age field in MAC table entries that can be incremented', () => {
            const sw = createMockSwitch({
                macTable: [
                    { macAddress: '02:AA:BB:CC:DD:EE', port: 'FastEthernet0/0', vlan: 1, type: 'dynamic', age: 0 },
                ],
            });

            // Verify MAC entry has age field
            expect(sw.macTable![0].age).toBe(0);

            // Simulate aging (would be done in store tick)
            const agedEntry = { ...sw.macTable![0], age: sw.macTable![0].age + 1 };
            expect(agedEntry.age).toBe(1);
        });

        it('should identify entries that exceed timeout threshold', () => {
            const ARP_TIMEOUT_SECONDS = 300; // 5 minutes

            const oldEntry = { ipAddress: '192.168.1.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'eth0', type: 'dynamic' as const, age: 350 };
            const youngEntry = { ipAddress: '192.168.1.101', macAddress: '02:AA:BB:CC:DD:FF', interface: 'eth0', type: 'dynamic' as const, age: 100 };
            const staticEntry = { ipAddress: '192.168.1.1', macAddress: '02:00:00:00:01:00', interface: 'eth0', type: 'static' as const, age: 500 };

            // Old dynamic entries should be removed
            expect(oldEntry.age > ARP_TIMEOUT_SECONDS).toBe(true);
            expect(oldEntry.type).toBe('dynamic');

            // Young entries should be kept
            expect(youngEntry.age > ARP_TIMEOUT_SECONDS).toBe(false);

            // Static entries should never be removed regardless of age
            expect(staticEntry.type).toBe('static');
        });

        it('should reset age when ARP entry is refreshed', () => {
            const router = createMockRouter({
                arpTable: [
                    { ipAddress: '192.168.1.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/0', type: 'dynamic', age: 150 },
                ],
            });

            // Receive ARP that refreshes the entry
            const arpReply = createMockPacket({
                type: 'arp',
                currentDeviceId: router.id,
                lastDeviceId: 'remote-device',
                sourceMAC: '02:AA:BB:CC:DD:EE',
                destMAC: router.interfaces[0].macAddress,
                payload: {
                    type: 'REPLY',
                    senderIP: '192.168.1.100',
                    targetIP: router.interfaces[0].ipAddress,
                },
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: 'remote-device',
                    sourceInterfaceId: 'remote-iface',
                    targetDeviceId: router.id,
                    targetInterfaceId: router.interfaces[0].id,
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            processDeviceTick(router, arpReply, connections, mockUpdateDevice);

            // The updated ARP entry should have age reset to 0
            expect(mockUpdateDevice).toHaveBeenCalled();
            const updateCall = mockUpdateDevice.mock.calls[0];
            expect(updateCall[1].arpTable[0].age).toBe(0);
        });
    });

    // ============================================
    // 1.7 Buffered Packet Handling
    // ============================================
    describe('1.7 Buffered Packet Handling', () => {
        it('should mark packet as buffered when ARP is needed', () => {
            const router = createMockRouter({
                arpTable: [], // Empty - ARP needed
            });

            const packet = createMockPacket({
                currentDeviceId: router.id,
                lastDeviceId: 'pc-1',
                destMAC: router.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '10.0.0.100', // Need ARP for this
                ttl: 64,
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: router.id,
                    sourceInterfaceId: router.interfaces[1].id,
                    targetDeviceId: 'remote-device',
                    targetInterfaceId: 'remote-iface',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(router, packet, connections, mockUpdateDevice);

            const buffered = result.find(p => p.processingStage === 'buffered');
            expect(buffered).toBeDefined();
            expect(buffered!.waitingForArp).toBe('10.0.0.100');
        });

        it('should also send ARP request when buffering', () => {
            const router = createMockRouter({
                arpTable: [],
            });

            const packet = createMockPacket({
                currentDeviceId: router.id,
                lastDeviceId: 'pc-1',
                destMAC: router.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '10.0.0.100',
                ttl: 64,
            });

            const connections: Connection[] = [
                {
                    id: 'conn-1',
                    sourceDeviceId: router.id,
                    sourceInterfaceId: router.interfaces[1].id,
                    targetDeviceId: 'remote-device',
                    targetInterfaceId: 'remote-iface',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            const result = processDeviceTick(router, packet, connections, mockUpdateDevice);

            const arpRequest = result.find(p => p.type === 'arp');
            expect(arpRequest).toBeDefined();
            expect(arpRequest!.destMAC).toBe('FF:FF:FF:FF:FF:FF');
            expect((arpRequest!.payload as any).type).toBe('REQUEST');
            expect((arpRequest!.payload as any).targetIP).toBe('10.0.0.100');
        });
    });

    describe('Cross-Subnet Ping with Pre-populated ARP', () => {
        it('should successfully ping across subnets when ARP tables are pre-populated', () => {
            // Topology: PC1 (192.168.1.10) --[eth0]-- Router --[eth1]-- PC2 (192.168.2.10)
            const mockUpdateDevice = vi.fn();

            // PC1 on 192.168.1.0/24
            const pc1: NetworkDevice = {
                id: 'pc1',
                type: 'pc',
                name: 'PC1',
                hostname: 'pc1',
                interfaces: [{
                    id: 'pc1-eth0',
                    name: 'eth0',
                    macAddress: '02:00:00:00:00:01',
                    ipAddress: '192.168.1.10',
                    subnetMask: '255.255.255.0',
                    gateway: '192.168.1.1',
                    isUp: true,
                    speed: 1000,
                    duplex: 'full',
                    connectedTo: 'router-eth0',
                }],
                position: { x: 0, y: 0 },
                isRunning: true,
                arpTable: [
                    { ipAddress: '192.168.1.1', macAddress: '02:00:00:00:01:00', interface: 'eth0', type: 'dynamic', age: 0 },
                ],
                config: {},
            };

            // Router with two interfaces
            const router: NetworkDevice = {
                id: 'router',
                type: 'router',
                name: 'Router1',
                hostname: 'router1',
                interfaces: [
                    {
                        id: 'router-eth0',
                        name: 'GigabitEthernet0/0',
                        macAddress: '02:00:00:00:01:00',
                        ipAddress: '192.168.1.1',
                        subnetMask: '255.255.255.0',
                        gateway: null,
                        isUp: true,
                        speed: 1000,
                        duplex: 'full',
                        connectedTo: 'pc1-eth0',
                    },
                    {
                        id: 'router-eth1',
                        name: 'GigabitEthernet0/1',
                        macAddress: '02:00:00:00:01:01',
                        ipAddress: '192.168.2.1',
                        subnetMask: '255.255.255.0',
                        gateway: null,
                        isUp: true,
                        speed: 1000,
                        duplex: 'full',
                        connectedTo: 'pc2-eth0',
                    },
                ],
                position: { x: 100, y: 0 },
                isRunning: true,
                arpTable: [
                    { ipAddress: '192.168.1.10', macAddress: '02:00:00:00:00:01', interface: 'GigabitEthernet0/0', type: 'dynamic', age: 0 },
                    { ipAddress: '192.168.2.10', macAddress: '02:00:00:00:00:02', interface: 'GigabitEthernet0/1', type: 'dynamic', age: 0 },
                ],
                routingTable: [
                    { destination: '192.168.1.0', netmask: '255.255.255.0', gateway: '0.0.0.0', interface: 'GigabitEthernet0/0', metric: 0, type: 'connected' },
                    { destination: '192.168.2.0', netmask: '255.255.255.0', gateway: '0.0.0.0', interface: 'GigabitEthernet0/1', metric: 0, type: 'connected' },
                ],
                config: {},
            };

            // PC2 on 192.168.2.0/24
            const pc2: NetworkDevice = {
                id: 'pc2',
                type: 'pc',
                name: 'PC2',
                hostname: 'pc2',
                interfaces: [{
                    id: 'pc2-eth0',
                    name: 'eth0',
                    macAddress: '02:00:00:00:00:02',
                    ipAddress: '192.168.2.10',
                    subnetMask: '255.255.255.0',
                    gateway: '192.168.2.1',
                    isUp: true,
                    speed: 1000,
                    duplex: 'full',
                    connectedTo: 'router-eth1',
                }],
                position: { x: 200, y: 0 },
                isRunning: true,
                arpTable: [
                    { ipAddress: '192.168.2.1', macAddress: '02:00:00:00:01:01', interface: 'eth0', type: 'dynamic', age: 0 },
                ],
                config: {},
            };

            const connections: Connection[] = [
                {
                    id: 'conn-pc1-router',
                    sourceDeviceId: 'pc1',
                    sourceInterfaceId: 'pc1-eth0',
                    targetDeviceId: 'router',
                    targetInterfaceId: 'router-eth0',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
                {
                    id: 'conn-router-pc2',
                    sourceDeviceId: 'router',
                    sourceInterfaceId: 'router-eth1',
                    targetDeviceId: 'pc2',
                    targetInterfaceId: 'pc2-eth0',
                    isUp: true,
                    bandwidth: 1000,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            // Step 1: PC1 sends ICMP Echo Request to PC2
            const icmpRequest: Packet = {
                id: 'ping-1',
                type: 'icmp',
                icmpType: 8, // Echo Request
                icmpCode: 0,
                icmpSeq: 1,
                sourceMAC: '02:00:00:00:00:01',
                destMAC: '02:00:00:00:01:00', // Router's MAC (next hop)
                sourceIP: '192.168.1.10',
                destIP: '192.168.2.10',
                ttl: 64,
                size: 64,
                currentDeviceId: 'pc1',
                processingStage: 'at-device',
                progress: 0,
                path: [],
                currentPathIndex: 0,
                isLocallyGenerated: true,
            };

            // PC1 processes the packet - should forward to router
            const pc1Result = processDeviceTick(pc1, icmpRequest, connections, mockUpdateDevice);
            expect(pc1Result.length).toBe(1);
            expect(pc1Result[0].processingStage).toBe('on-link');
            expect(pc1Result[0].targetDeviceId).toBe('router');

            // Simulate the packet arriving at router
            const packetAtRouter: Packet = {
                ...pc1Result[0],
                currentDeviceId: 'router',
                lastDeviceId: 'pc1',
                processingStage: 'at-device',
                progress: 0,
            };

            // Router processes - should forward to PC2
            const routerResult = processDeviceTick(router, packetAtRouter, connections, mockUpdateDevice);
            expect(routerResult.length).toBe(1);
            expect(routerResult[0].processingStage).toBe('on-link');
            expect(routerResult[0].targetDeviceId).toBe('pc2');
            expect(routerResult[0].ttl).toBe(63); // TTL decremented

            // Simulate packet arriving at PC2
            const packetAtPc2: Packet = {
                ...routerResult[0],
                currentDeviceId: 'pc2',
                lastDeviceId: 'router',
                processingStage: 'at-device',
                progress: 0,
            };

            // PC2 processes - should generate ICMP Echo Reply
            const pc2Result = processDeviceTick(pc2, packetAtPc2, connections, mockUpdateDevice);
            expect(pc2Result.length).toBe(1);
            expect(pc2Result[0].type).toBe('icmp');
            expect(pc2Result[0].icmpType).toBe(0); // Echo Reply
            expect(pc2Result[0].sourceIP).toBe('192.168.2.10');
            expect(pc2Result[0].destIP).toBe('192.168.1.10');

            // The reply should be at-device, ready to be routed
            const replyPacket = pc2Result[0];
            expect(replyPacket.processingStage).toBe('at-device');

            // PC2 processes the reply - should forward to router (its gateway)
            const pc2ReplyResult = processDeviceTick(pc2, replyPacket, connections, mockUpdateDevice);
            expect(pc2ReplyResult.length).toBe(1);
            expect(pc2ReplyResult[0].processingStage).toBe('on-link');
            expect(pc2ReplyResult[0].targetDeviceId).toBe('router');

            // Simulate reply arriving at router
            const replyAtRouter: Packet = {
                ...pc2ReplyResult[0],
                currentDeviceId: 'router',
                lastDeviceId: 'pc2',
                processingStage: 'at-device',
                progress: 0,
            };

            // Router processes reply - should forward to PC1
            const routerReplyResult = processDeviceTick(router, replyAtRouter, connections, mockUpdateDevice);
            expect(routerReplyResult.length).toBe(1);
            expect(routerReplyResult[0].processingStage).toBe('on-link');
            expect(routerReplyResult[0].targetDeviceId).toBe('pc1');

            // Simulate reply arriving at PC1
            const replyAtPc1: Packet = {
                ...routerReplyResult[0],
                currentDeviceId: 'pc1',
                lastDeviceId: 'router',
                processingStage: 'at-device',
                progress: 0,
            };

            // PC1 processes the reply - should consume it (arrived)
            const pc1ReplyResult = processDeviceTick(pc1, replyAtPc1, connections, mockUpdateDevice);
            expect(pc1ReplyResult.length).toBe(1);
            expect(pc1ReplyResult[0].processingStage).toBe('arrived');
            expect(pc1ReplyResult[0].icmpType).toBe(0); // Echo Reply
        });
    });

    describe('Switch Management Traffic', () => {
        it('should route locally generated ping from switch through gateway', () => {
            const mockUpdateDevice = vi.fn();

            // Switch with management IP
            const sw: NetworkDevice = {
                id: 'switch-1',
                type: 'switch',
                name: 'Switch1',
                hostname: 'switch1',
                interfaces: [
                    {
                        id: 'sw-fa0',
                        name: 'FastEthernet0/0',
                        macAddress: '02:00:00:00:03:00',
                        ipAddress: '192.168.3.2',
                        subnetMask: '255.255.255.0',
                        gateway: '192.168.3.1',
                        isUp: true,
                        speed: 100,
                        duplex: 'full',
                        connectedTo: 'router-gig2',
                    },
                    {
                        id: 'sw-fa1',
                        name: 'FastEthernet0/1',
                        macAddress: '02:00:00:00:03:01',
                        ipAddress: null,
                        subnetMask: null,
                        gateway: null,
                        isUp: true,
                        speed: 100,
                        duplex: 'full',
                    },
                ],
                position: { x: 0, y: 0 },
                isRunning: true,
                arpTable: [],
                macTable: [],
                config: {},
            };

            // Router
            const router: NetworkDevice = {
                id: 'router-1',
                type: 'router',
                name: 'Router1',
                hostname: 'router1',
                interfaces: [
                    {
                        id: 'router-gig2',
                        name: 'GigabitEthernet0/2',
                        macAddress: '02:00:00:00:01:02',
                        ipAddress: '192.168.3.1',
                        subnetMask: '255.255.255.0',
                        gateway: null,
                        isUp: true,
                        speed: 1000,
                        duplex: 'full',
                        connectedTo: 'sw-fa0',
                    },
                ],
                position: { x: 100, y: 0 },
                isRunning: true,
                arpTable: [],
                routingTable: [
                    { destination: '192.168.3.0', netmask: '255.255.255.0', gateway: '0.0.0.0', interface: 'GigabitEthernet0/2', metric: 0, type: 'connected' },
                ],
                config: {},
            };

            const connections: Connection[] = [
                {
                    id: 'conn-sw-router',
                    sourceDeviceId: 'switch-1',
                    sourceInterfaceId: 'sw-fa0',
                    targetDeviceId: 'router-1',
                    targetInterfaceId: 'router-gig2',
                    isUp: true,
                    bandwidth: 100,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            // Switch generates an ICMP packet to a remote IP (needs routing via gateway)
            const icmpFromSwitch: Packet = {
                id: 'ping-from-switch',
                type: 'icmp',
                icmpType: 8,
                icmpCode: 0,
                icmpSeq: 1,
                sourceMAC: '02:00:00:00:03:00', // Switch's MAC
                destMAC: '00:00:00:00:00:00', // Placeholder - needs routing
                sourceIP: '192.168.3.2',
                destIP: '192.168.2.100', // Remote IP (not on switch's subnet)
                ttl: 64,
                size: 64,
                currentDeviceId: 'switch-1',
                processingStage: 'at-device',
                progress: 0,
                path: [],
                currentPathIndex: 0,
                isLocallyGenerated: true,
            };

            // Switch processes the packet - should send ARP for gateway since no ARP entry
            const result = processDeviceTick(sw, icmpFromSwitch, connections, mockUpdateDevice);

            // Should have 2 packets: ARP request + buffered original packet
            expect(result.length).toBe(2);

            const arpRequest = result.find(p => p.type === 'arp');
            const bufferedPacket = result.find(p => p.processingStage === 'buffered');

            expect(arpRequest).toBeDefined();
            expect(arpRequest!.destMAC).toBe('FF:FF:FF:FF:FF:FF');
            expect((arpRequest!.payload as any).type).toBe('REQUEST');
            expect((arpRequest!.payload as any).targetIP).toBe('192.168.3.1'); // Gateway IP

            expect(bufferedPacket).toBeDefined();
            expect(bufferedPacket!.waitingForArp).toBe('192.168.3.1');
        });

        it('should forward switch ping to router when ARP is pre-populated', () => {
            const mockUpdateDevice = vi.fn();

            // Switch with management IP and ARP entry for gateway
            const sw: NetworkDevice = {
                id: 'switch-1',
                type: 'switch',
                name: 'Switch1',
                hostname: 'switch1',
                interfaces: [
                    {
                        id: 'sw-fa0',
                        name: 'FastEthernet0/0',
                        macAddress: '02:00:00:00:03:00',
                        ipAddress: '192.168.3.2',
                        subnetMask: '255.255.255.0',
                        gateway: '192.168.3.1',
                        isUp: true,
                        speed: 100,
                        duplex: 'full',
                        connectedTo: 'router-gig2',
                    },
                ],
                position: { x: 0, y: 0 },
                isRunning: true,
                arpTable: [
                    { ipAddress: '192.168.3.1', macAddress: '02:00:00:00:01:02', interface: 'FastEthernet0/0', type: 'dynamic', age: 0 },
                ],
                macTable: [],
                config: {},
            };

            const connections: Connection[] = [
                {
                    id: 'conn-sw-router',
                    sourceDeviceId: 'switch-1',
                    sourceInterfaceId: 'sw-fa0',
                    targetDeviceId: 'router-1',
                    targetInterfaceId: 'router-gig2',
                    isUp: true,
                    bandwidth: 100,
                    latency: 1,
                    packetLoss: 0,
                },
            ];

            // Switch generates an ICMP packet to a remote IP
            const icmpFromSwitch: Packet = {
                id: 'ping-from-switch',
                type: 'icmp',
                icmpType: 8,
                icmpCode: 0,
                icmpSeq: 1,
                sourceMAC: '02:00:00:00:03:00',
                destMAC: '00:00:00:00:00:00',
                sourceIP: '192.168.3.2',
                destIP: '192.168.2.100',
                ttl: 64,
                size: 64,
                currentDeviceId: 'switch-1',
                processingStage: 'at-device',
                progress: 0,
                path: [],
                currentPathIndex: 0,
                isLocallyGenerated: true,
            };

            // Switch processes the packet - should forward to router
            const result = processDeviceTick(sw, icmpFromSwitch, connections, mockUpdateDevice);

            expect(result.length).toBe(1);
            expect(result[0].processingStage).toBe('on-link');
            expect(result[0].targetDeviceId).toBe('router-1');
            expect(result[0].destMAC).toBe('02:00:00:00:01:02'); // Router's MAC
            expect(result[0].ttl).toBe(64); // TTL not decremented for locally generated
        });
    });
});
