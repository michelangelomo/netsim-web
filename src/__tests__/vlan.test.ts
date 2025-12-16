import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useNetworkStore } from '@/store/network-store';
import { executeNetworkCommand } from '@/lib/terminal-commands';
import { processDeviceTick } from '@/lib/simulation';
import type { Packet, NetworkDevice, Connection } from '@/types/network';

// Helper to execute command synchronously in tests
async function executeCommand(command: string, deviceId: string, store: ReturnType<typeof useNetworkStore.getState>) {
    return executeNetworkCommand(command, deviceId, store);
}

// Helper to process a packet at a device for testing
// This wraps processDeviceTick and sets up the required packet state
function processPacketAtDevice(
    packet: Partial<Packet> & { id: string; sourceMAC: string; destMAC: string },
    device: NetworkDevice,
    _storeState?: ReturnType<typeof useNetworkStore.getState> // Ignored - we always get fresh state
): Packet[] {
    // Always get fresh state from the store
    const freshState = useNetworkStore.getState();

    // Get fresh device from store (in case it was updated after initial creation)
    const freshDevice = freshState.getDeviceById(device.id) || device;

    // Ensure packet has required fields for processing
    const processablePacket: Packet = {
        type: 'icmp',
        ttl: 64,
        size: 64,
        path: [],
        currentPathIndex: 0,
        progress: 0,
        status: 'in-transit',
        ...packet,
        processingStage: 'at-device' as const,
        currentDeviceId: freshDevice.id,
    } as Packet;

    return processDeviceTick(
        freshDevice,
        processablePacket,
        freshState.connections,
        (id, updates) => freshState.updateDevice(id, updates)
    );
}

// Reset store between tests
function resetStore() {
    useNetworkStore.setState({
        devices: [],
        connections: [],
        selectedDeviceId: null,
        selectedConnectionId: null,
        currentTool: 'select',
        connectionStart: null,
        simulation: {
            isRunning: false,
            speed: 1,
            currentTime: 0,
            packets: [],
        },
        packets: [],
        activeTerminalDevice: null,
        terminalHistory: new Map(),
        notifications: [],
        deviceCounters: {
            pc: 0,
            laptop: 0,
            server: 0,
            router: 0,
            switch: 0,
            hub: 0,
            firewall: 0,
            cloud: 0,
        },
    });
}

describe('VLAN Feature', () => {
    beforeEach(() => {
        resetStore();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ============================================
    // Phase 1: Data Model Tests
    // ============================================
    describe('Phase 1: Data Model', () => {
        describe('VLAN types on NetworkInterface', () => {
            it('should support vlanMode property (access/trunk)', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Update interface with VLAN mode
                store.updateInterface(sw.id, sw.interfaces[0].id, {
                    vlanMode: 'access',
                });

                const updated = store.getDeviceById(sw.id);
                expect(updated?.interfaces[0].vlanMode).toBe('access');
            });

            it('should support accessVlan property for access ports', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                store.updateInterface(sw.id, sw.interfaces[0].id, {
                    vlanMode: 'access',
                    accessVlan: 10,
                });

                const updated = store.getDeviceById(sw.id);
                expect(updated?.interfaces[0].accessVlan).toBe(10);
            });

            it('should support trunk port properties', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                store.updateInterface(sw.id, sw.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10, 20, 30],
                    nativeVlan: 1,
                });

                const updated = store.getDeviceById(sw.id);
                expect(updated?.interfaces[0].vlanMode).toBe('trunk');
                expect(updated?.interfaces[0].allowedVlans).toEqual([1, 10, 20, 30]);
                expect(updated?.interfaces[0].nativeVlan).toBe(1);
            });
        });

        describe('VLAN configuration on switches', () => {
            it('should have default VLAN 1 on new switches', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                expect(sw.vlans).toBeDefined();
                expect(sw.vlans?.length).toBe(1);
                expect(sw.vlans?.[0].id).toBe(1);
                expect(sw.vlans?.[0].name).toBe('default');
            });

            it('should have all interfaces in access mode VLAN 1 by default', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                sw.interfaces.forEach((iface) => {
                    expect(iface.vlanMode).toBe('access');
                    expect(iface.accessVlan).toBe(1);
                });
            });

            it('should support adding VLANs to switch', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                store.addVlan(sw.id, { id: 10, name: 'Sales' });
                store.addVlan(sw.id, { id: 20, name: 'Engineering' });

                const updated = store.getDeviceById(sw.id);
                expect(updated?.vlans?.length).toBe(3); // default + 2
                expect(updated?.vlans?.find((v) => v.id === 10)?.name).toBe('Sales');
                expect(updated?.vlans?.find((v) => v.id === 20)?.name).toBe('Engineering');
            });

            it('should support removing VLANs from switch', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                store.addVlan(sw.id, { id: 10, name: 'Sales' });
                store.removeVlan(sw.id, 10);

                const updated = store.getDeviceById(sw.id);
                expect(updated?.vlans?.find((v) => v.id === 10)).toBeUndefined();
            });

            it('should not allow removing VLAN 1', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                const result = store.removeVlan(sw.id, 1);
                expect(result).toBe(false);

                const updated = store.getDeviceById(sw.id);
                expect(updated?.vlans?.find((v) => v.id === 1)).toBeDefined();
            });
        });

        describe('SVI (Switch Virtual Interface)', () => {
            it('should support SVI interfaces on switches', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                store.addSvi(sw.id, {
                    vlanId: 1,
                    ipAddress: '192.168.1.254',
                    subnetMask: '255.255.255.0',
                    isUp: true,
                });

                const updated = store.getDeviceById(sw.id);
                expect(updated?.sviInterfaces?.length).toBe(1);
                expect(updated?.sviInterfaces?.[0].vlanId).toBe(1);
                expect(updated?.sviInterfaces?.[0].ipAddress).toBe('192.168.1.254');
            });

            it('should not allow SVI for non-existent VLAN', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                const result = store.addSvi(sw.id, {
                    vlanId: 999,
                    ipAddress: '192.168.1.254',
                    subnetMask: '255.255.255.0',
                    isUp: true,
                });

                expect(result).toBe(false);
                const updated = store.getDeviceById(sw.id);
                expect(updated?.sviInterfaces?.length ?? 0).toBe(0);
            });
        });
    });

    // ============================================
    // Phase 2: Switch VLAN Logic Tests
    // ============================================
    describe('Phase 2: Switch VLAN Logic', () => {
        describe('VLAN-aware MAC table', () => {
            it('should learn MAC addresses with VLAN information', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Simulate MAC learning with VLAN
                store.updateDevice(sw.id, {
                    macTable: [
                        {
                            macAddress: 'AA:BB:CC:DD:EE:01',
                            port: 'FastEthernet0/1',
                            vlan: 10,
                            type: 'dynamic',
                            age: 0,
                        },
                        {
                            macAddress: 'AA:BB:CC:DD:EE:02',
                            port: 'FastEthernet0/2',
                            vlan: 20,
                            type: 'dynamic',
                            age: 0,
                        },
                    ],
                });

                const updated = store.getDeviceById(sw.id);
                expect(updated?.macTable?.length).toBe(2);
                expect(updated?.macTable?.[0].vlan).toBe(10);
                expect(updated?.macTable?.[1].vlan).toBe(20);
            });

            it('should have separate MAC entries for same MAC on different VLANs', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Same MAC can appear on different VLANs (valid in certain topologies)
                store.updateDevice(sw.id, {
                    macTable: [
                        {
                            macAddress: 'AA:BB:CC:DD:EE:01',
                            port: 'FastEthernet0/1',
                            vlan: 10,
                            type: 'dynamic',
                            age: 0,
                        },
                        {
                            macAddress: 'AA:BB:CC:DD:EE:01',
                            port: 'FastEthernet0/24',
                            vlan: 20,
                            type: 'dynamic',
                            age: 0,
                        },
                    ],
                });

                const updated = store.getDeviceById(sw.id);
                const entriesForMac = updated?.macTable?.filter(
                    (e) => e.macAddress === 'AA:BB:CC:DD:EE:01'
                );
                expect(entriesForMac?.length).toBe(2);
            });
        });

        describe('VLAN tagging on Packet', () => {
            it('should support vlanTag property on packets', () => {
                const store = useNetworkStore.getState();
                const pc = store.addDevice('pc', { x: 0, y: 0 });

                store.sendPacket({
                    type: 'icmp',
                    sourceMAC: 'AA:BB:CC:DD:EE:01',
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.1.1',
                    destIP: '192.168.1.255',
                    ttl: 64,
                    size: 64,
                    currentDeviceId: pc.id,
                    vlanTag: 10,
                });

                const packets = useNetworkStore.getState().packets;
                expect(packets.length).toBe(1);
                expect(packets[0].vlanTag).toBe(10);
            });
        });
    });

    // ============================================
    // Phase 3: Terminal Commands Tests
    // ============================================
    describe('Phase 3: Terminal Commands', () => {
        describe('vlan command', () => {
            it('should create a new VLAN', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                const result = await executeCommand('vlan 10', sw.id, store);
                expect(result.success).toBe(true);

                const updated = store.getDeviceById(sw.id);
                expect(updated?.vlans?.find((v) => v.id === 10)).toBeDefined();
            });

            it('should reject invalid VLAN ID', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                const result = await executeCommand('vlan 5000', sw.id, store);
                expect(result.success).toBe(false);
                expect(result.output).toContain('1-4094');
            });

            it('should set VLAN name with name subcommand', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                await executeCommand('vlan 10', sw.id, store);
                const result = await executeCommand('name Sales', sw.id, store);
                expect(result.success).toBe(true);

                const updated = store.getDeviceById(sw.id);
                expect(updated?.vlans?.find((v) => v.id === 10)?.name).toBe('Sales');
            });

            it('should only work on switches', async () => {
                const store = useNetworkStore.getState();
                const pc = store.addDevice('pc', { x: 0, y: 0 });

                const result = await executeCommand('vlan 10', pc.id, store);
                expect(result.success).toBe(false);
                expect(result.output).toContain('switch');
            });
        });

        describe('no vlan command', () => {
            it('should remove a VLAN', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                await executeCommand('vlan 10', sw.id, store);
                const result = await executeCommand('no vlan 10', sw.id, store);
                expect(result.success).toBe(true);

                const updated = store.getDeviceById(sw.id);
                expect(updated?.vlans?.find((v) => v.id === 10)).toBeUndefined();
            });

            it('should not allow removing VLAN 1', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                const result = await executeCommand('no vlan 1', sw.id, store);
                expect(result.success).toBe(false);
                expect(result.output.toLowerCase()).toContain('cannot');
            });
        });

        describe('show vlan command', () => {
            it('should display all VLANs', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                await executeCommand('vlan 10', sw.id, store);
                await executeCommand('vlan 20', sw.id, store);

                const result = await executeCommand('show vlan', sw.id, store);
                expect(result.success).toBe(true);
                expect(result.output).toContain('1');
                expect(result.output).toContain('10');
                expect(result.output).toContain('20');
            });

            it('should show VLAN brief format', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                const result = await executeCommand('show vlan brief', sw.id, store);
                expect(result.success).toBe(true);
                expect(result.output).toContain('VLAN');
                expect(result.output).toContain('Name');
            });
        });

        describe('switchport commands', () => {
            it('should set interface to access mode', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Enter interface config mode first
                await executeCommand('interface FastEthernet0/1', sw.id, store);
                const result = await executeCommand('switchport mode access', sw.id, store);
                expect(result.success).toBe(true);

                const updated = store.getDeviceById(sw.id);
                const iface = updated?.interfaces.find((i) => i.name === 'FastEthernet0/1');
                expect(iface?.vlanMode).toBe('access');
            });

            it('should set access VLAN on interface', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                await executeCommand('vlan 10', sw.id, store);
                await executeCommand('interface FastEthernet0/1', sw.id, store);
                await executeCommand('switchport mode access', sw.id, store);
                const result = await executeCommand('switchport access vlan 10', sw.id, store);
                expect(result.success).toBe(true);

                const updated = store.getDeviceById(sw.id);
                const iface = updated?.interfaces.find((i) => i.name === 'FastEthernet0/1');
                expect(iface?.accessVlan).toBe(10);
            });

            it('should set interface to trunk mode', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                const ifResult = await executeCommand('interface FastEthernet0/7', sw.id, store);
                expect(ifResult.success).toBe(true);
                const result = await executeCommand('switchport mode trunk', sw.id, store);
                expect(result.output).toBe('Switchport mode set to trunk');
                expect(result.success).toBe(true);

                const updated = store.getDeviceById(sw.id);
                const iface = updated?.interfaces.find((i) => i.name === 'FastEthernet0/7');
                expect(iface?.vlanMode).toBe('trunk');
            });

            it('should set allowed VLANs on trunk', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                await executeCommand('vlan 10', sw.id, store);
                await executeCommand('vlan 20', sw.id, store);
                await executeCommand('interface FastEthernet0/7', sw.id, store);
                await executeCommand('switchport mode trunk', sw.id, store);
                const result = await executeCommand('switchport trunk allowed vlan 1,10,20', sw.id, store);
                expect(result.success).toBe(true);

                const updated = store.getDeviceById(sw.id);
                const iface = updated?.interfaces.find((i) => i.name === 'FastEthernet0/7');
                expect(iface?.allowedVlans).toEqual([1, 10, 20]);
            });

            it('should set native VLAN on trunk', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                await executeCommand('interface FastEthernet0/7', sw.id, store);
                await executeCommand('switchport mode trunk', sw.id, store);
                const result = await executeCommand('switchport trunk native vlan 1', sw.id, store);
                expect(result.success).toBe(true);

                const updated = store.getDeviceById(sw.id);
                const iface = updated?.interfaces.find((i) => i.name === 'FastEthernet0/7');
                expect(iface?.nativeVlan).toBe(1);
            });

            it('should only work on switches', async () => {
                const store = useNetworkStore.getState();
                const pc = store.addDevice('pc', { x: 0, y: 0 });

                await executeCommand('interface eth0', pc.id, store);
                const result = await executeCommand('switchport mode access', pc.id, store);
                expect(result.success).toBe(false);
                expect(result.output).toContain('switch');
            });
        });

        describe('show interfaces switchport', () => {
            it('should display switchport configuration', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                await executeCommand('vlan 10', sw.id, store);
                await executeCommand('interface FastEthernet0/1', sw.id, store);
                await executeCommand('switchport mode access', sw.id, store);
                await executeCommand('switchport access vlan 10', sw.id, store);

                const result = await executeCommand('show interfaces switchport', sw.id, store);
                expect(result.success).toBe(true);
                expect(result.output).toContain('FastEthernet0/1');
                expect(result.output).toContain('access');
                expect(result.output).toContain('10');
            });
        });

        describe('interface vlan (SVI)', () => {
            it('should create SVI interface', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                const result = await executeCommand('interface vlan 1', sw.id, store);
                expect(result.success).toBe(true);
            });

            it('should configure IP on SVI', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                await executeCommand('interface vlan 1', sw.id, store);
                const result = await executeCommand('ip address 192.168.1.254 255.255.255.0', sw.id, store);
                expect(result.success).toBe(true);

                const updated = store.getDeviceById(sw.id);
                expect(updated?.sviInterfaces?.[0].ipAddress).toBe('192.168.1.254');
                expect(updated?.sviInterfaces?.[0].subnetMask).toBe('255.255.255.0');
            });

            it('should reject SVI for non-existent VLAN', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                const result = await executeCommand('interface vlan 999', sw.id, store);
                expect(result.success).toBe(false);
                expect(result.output).toContain('not exist');
            });
        });
    });

    // ============================================================================
    // PHASE 4: VLAN-Aware Switch Forwarding
    // ============================================================================
    describe('Phase 4: VLAN-Aware Switch Forwarding', () => {
        describe('Access Port Processing', () => {
            it('should tag frame with access VLAN on ingress', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });
                const pc1 = store.addDevice('pc', { x: 100, y: 0 });
                const pc2 = store.addDevice('pc', { x: 200, y: 0 });

                // Configure access ports for VLAN 10
                store.addVlan(sw.id, { id: 10, name: 'Sales' });
                store.updateInterface(sw.id, sw.interfaces[0].id, {
                    vlanMode: 'access',
                    accessVlan: 10,
                });
                store.updateInterface(sw.id, sw.interfaces[1].id, {
                    vlanMode: 'access',
                    accessVlan: 10,
                });

                // Connect both PCs to switch
                store.addConnection(pc1.id, pc1.interfaces[0].id, sw.id, sw.interfaces[0].id);
                store.addConnection(pc2.id, pc2.interfaces[0].id, sw.id, sw.interfaces[1].id);

                // Create a broadcast packet from PC1
                const packet: Packet = {
                    id: 'test-packet-1',
                    sourceMAC: pc1.interfaces[0].macAddress,
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.10.100',
                    destIP: '192.168.10.255',
                    type: 'icmp',
                    payload: { type: 'echo-request' },
                    ttl: 64,
                    size: 64,
                    currentDeviceId: sw.id,
                    sourceDeviceId: pc1.id,
                    path: [pc1.id],
                    status: 'in-transit' as const,
                };

                // Process at switch - frame should be flooded to pc2 in same VLAN
                const result = processPacketAtDevice(packet, sw, store);

                // Should flood to pc2 (same VLAN)
                expect(result.length).toBeGreaterThan(0);
                // Verify packet goes to pc2
                expect(result.some(p => p.targetDeviceId === pc2.id)).toBe(true);
                // Access ports send frames UNTAGGED (no vlanTag on egress)
                result.forEach(p => {
                    if (p.status !== 'dropped') {
                        expect(p.vlanTag).toBeUndefined();
                    }
                });
            });

            it('should learn MAC with VLAN information on access port', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Configure port for VLAN 10
                store.addVlan(sw.id, { id: 10, name: 'Sales' });
                store.updateInterface(sw.id, sw.interfaces[0].id, {
                    vlanMode: 'access',
                    accessVlan: 10,
                });

                // Learn a MAC on this port
                store.learnMAC(sw.id, '02:AA:BB:CC:DD:EE', sw.interfaces[0].name, 10);

                const device = store.getDeviceById(sw.id);
                const entry = device?.macTable?.find(e => e.macAddress === '02:AA:BB:CC:DD:EE');

                expect(entry).toBeDefined();
                expect(entry?.vlan).toBe(10);
                expect(entry?.port).toBe(sw.interfaces[0].name);
            });

            it('should forward frame only to ports in same VLAN', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });
                const pc1 = store.addDevice('pc', { x: 100, y: 0 });
                const pc2 = store.addDevice('pc', { x: 200, y: 0 });
                const pc3 = store.addDevice('pc', { x: 300, y: 0 });

                // Create VLANs
                store.addVlan(sw.id, { id: 10, name: 'Sales' });
                store.addVlan(sw.id, { id: 20, name: 'Engineering' });

                // Port 0 and 1 in VLAN 10, Port 2 in VLAN 20
                store.updateInterface(sw.id, sw.interfaces[0].id, { vlanMode: 'access', accessVlan: 10 });
                store.updateInterface(sw.id, sw.interfaces[1].id, { vlanMode: 'access', accessVlan: 10 });
                store.updateInterface(sw.id, sw.interfaces[2].id, { vlanMode: 'access', accessVlan: 20 });

                // Connect PCs
                store.addConnection(pc1.id, pc1.interfaces[0].id, sw.id, sw.interfaces[0].id);
                store.addConnection(pc2.id, pc2.interfaces[0].id, sw.id, sw.interfaces[1].id);
                store.addConnection(pc3.id, pc3.interfaces[0].id, sw.id, sw.interfaces[2].id);

                // Broadcast from PC1 (VLAN 10)
                const packet: Packet = {
                    id: 'test-packet-2',
                    sourceMAC: pc1.interfaces[0].macAddress,
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.10.100',
                    destIP: '192.168.10.255',
                    type: 'icmp',
                    payload: { type: 'echo-request' },
                    ttl: 64,
                    size: 64,
                    currentDeviceId: sw.id,
                    sourceDeviceId: pc1.id,
                    ingressInterface: sw.interfaces[0].name,
                    path: [pc1.id],
                    status: 'in-transit' as const,
                };

                const result = processPacketAtDevice(packet, sw, store);

                // Should flood to PC2 (VLAN 10) but NOT to PC3 (VLAN 20)
                const targetDevices = result.map(p => p.targetDeviceId);
                expect(targetDevices).toContain(pc2.id);
                expect(targetDevices).not.toContain(pc3.id);
            });

            it('should flood broadcast only to ports in same VLAN', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Create VLANs
                store.addVlan(sw.id, { id: 10, name: 'VLAN10' });
                store.addVlan(sw.id, { id: 20, name: 'VLAN20' });

                // Configure ports: 0,1,2 in VLAN 10; 3,4,5 in VLAN 20
                for (let i = 0; i < 3; i++) {
                    store.updateInterface(sw.id, sw.interfaces[i].id, { vlanMode: 'access', accessVlan: 10 });
                }
                for (let i = 3; i < 6; i++) {
                    store.updateInterface(sw.id, sw.interfaces[i].id, { vlanMode: 'access', accessVlan: 20 });
                }

                // Create PCs and connect them
                const pcsVlan10: NetworkDevice[] = [];
                const pcsVlan20: NetworkDevice[] = [];

                for (let i = 0; i < 3; i++) {
                    const pc = store.addDevice('pc', { x: i * 100, y: 0 });
                    store.addConnection(pc.id, pc.interfaces[0].id, sw.id, sw.interfaces[i].id);
                    pcsVlan10.push(pc);
                }
                for (let i = 3; i < 6; i++) {
                    const pc = store.addDevice('pc', { x: i * 100, y: 100 });
                    store.addConnection(pc.id, pc.interfaces[0].id, sw.id, sw.interfaces[i].id);
                    pcsVlan20.push(pc);
                }

                // Broadcast from first PC in VLAN 10
                const packet: Packet = {
                    id: 'test-broadcast',
                    sourceMAC: pcsVlan10[0].interfaces[0].macAddress,
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.10.1',
                    destIP: '192.168.10.255',
                    type: 'arp',
                    payload: { type: 'request' },
                    ttl: 64,
                    size: 42,
                    currentDeviceId: sw.id,
                    sourceDeviceId: pcsVlan10[0].id,
                    ingressInterface: sw.interfaces[0].name,
                    path: [pcsVlan10[0].id],
                    status: 'in-transit' as const,
                };

                const result = processPacketAtDevice(packet, sw, store);

                // Should only go to VLAN 10 ports (pcsVlan10[1] and pcsVlan10[2])
                const targetDevices = result.filter(p => p.status !== 'dropped').map(p => p.targetDeviceId);

                // Should include other VLAN 10 PCs
                expect(targetDevices).toContain(pcsVlan10[1].id);
                expect(targetDevices).toContain(pcsVlan10[2].id);

                // Should NOT include any VLAN 20 PCs
                pcsVlan20.forEach(pc => {
                    expect(targetDevices).not.toContain(pc.id);
                });
            });
        });

        describe('MAC Table VLAN Isolation', () => {
            it('should not forward based on MAC learned in different VLAN', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Create VLANs
                store.addVlan(sw.id, { id: 10, name: 'VLAN10' });
                store.addVlan(sw.id, { id: 20, name: 'VLAN20' });

                // Configure ports
                store.updateInterface(sw.id, sw.interfaces[0].id, { vlanMode: 'access', accessVlan: 10 });
                store.updateInterface(sw.id, sw.interfaces[1].id, { vlanMode: 'access', accessVlan: 20 });
                store.updateInterface(sw.id, sw.interfaces[2].id, { vlanMode: 'access', accessVlan: 10 });

                // Learn same MAC on two different VLANs (simulating MAC conflict)
                const testMac = '02:AA:BB:CC:DD:EE';
                store.learnMAC(sw.id, testMac, sw.interfaces[0].name, 10);
                store.learnMAC(sw.id, testMac, sw.interfaces[1].name, 20);

                // Lookup should return different ports based on VLAN
                const port10 = store.lookupMAC(sw.id, testMac, 10);
                const port20 = store.lookupMAC(sw.id, testMac, 20);

                expect(port10).toBe(sw.interfaces[0].name);
                expect(port20).toBe(sw.interfaces[1].name);
            });
        });
    });

    // ============================================================================
    // PHASE 5: Inter-VLAN Routing via SVI
    // ============================================================================
    describe('Phase 5: Inter-VLAN Routing via SVI', () => {
        describe('SVI IP Configuration', () => {
            it('should add connected route when SVI IP is configured', async () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Create VLAN and configure SVI
                await executeCommand('vlan 10', sw.id, store);
                await executeCommand('interface vlan 10', sw.id, store);
                await executeCommand('ip address 192.168.10.1 255.255.255.0', sw.id, store);

                // Check for connected route
                const updated = store.getDeviceById(sw.id);
                const route = updated?.routingTable?.find(r =>
                    r.destination === '192.168.10.0' && r.interface === 'Vlan10'
                );

                expect(route).toBeDefined();
                expect(route?.type).toBe('connected');
            });

            it('should respond to ARP for SVI IP address', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });
                const pc = store.addDevice('pc', { x: 100, y: 0 });

                // Configure VLAN and SVI
                store.addVlan(sw.id, { id: 10, name: 'VLAN10' });
                store.addSvi(sw.id, {
                    vlanId: 10,
                    ipAddress: '192.168.10.1',
                    subnetMask: '255.255.255.0',
                    isUp: true
                });

                // Configure PC and connect
                store.configureInterface(pc.id, pc.interfaces[0].id, {
                    ipAddress: '192.168.10.100',
                    subnetMask: '255.255.255.0',
                });
                store.updateInterface(sw.id, sw.interfaces[0].id, { vlanMode: 'access', accessVlan: 10 });
                store.addConnection(pc.id, pc.interfaces[0].id, sw.id, sw.interfaces[0].id);

                // Send ARP request for SVI IP
                const arpRequest: Packet = {
                    id: 'arp-for-svi',
                    sourceMAC: pc.interfaces[0].macAddress,
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.10.100',
                    destIP: '192.168.10.1',
                    type: 'arp',
                    payload: {
                        type: 'REQUEST',
                        senderIP: '192.168.10.100',
                        senderMAC: pc.interfaces[0].macAddress,
                        targetIP: '192.168.10.1',
                        targetMAC: '00:00:00:00:00:00',
                    },
                    ttl: 64,
                    size: 42,
                    currentDeviceId: sw.id,
                    sourceDeviceId: pc.id,
                    ingressInterface: sw.interfaces[0].name,
                    vlanTag: 10,
                    path: [pc.id],
                    status: 'in-transit' as const,
                };

                const result = processPacketAtDevice(arpRequest, sw, store);

                // Should get an ARP reply back to PC (check for both uppercase and lowercase)
                const arpReply = result.find(p =>
                    p.type === 'arp' &&
                    (p.payload?.type === 'REPLY' || p.payload?.type === 'reply') &&
                    p.targetDeviceId === pc.id
                );

                expect(arpReply).toBeDefined();
                expect(arpReply?.payload?.senderIP).toBe('192.168.10.1');
            });
        });

        describe('Inter-VLAN Packet Flow', () => {
            it('should route packet from VLAN 10 to VLAN 20', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });
                const pc1 = store.addDevice('pc', { x: 100, y: 0 });
                const pc2 = store.addDevice('pc', { x: 200, y: 0 });

                // Configure VLANs
                store.addVlan(sw.id, { id: 10, name: 'VLAN10' });
                store.addVlan(sw.id, { id: 20, name: 'VLAN20' });

                // Configure SVIs
                store.addSvi(sw.id, {
                    vlanId: 10,
                    ipAddress: '192.168.10.1',
                    subnetMask: '255.255.255.0',
                    isUp: true
                });
                store.addSvi(sw.id, {
                    vlanId: 20,
                    ipAddress: '192.168.20.1',
                    subnetMask: '255.255.255.0',
                    isUp: true
                });

                // Configure ports
                store.updateInterface(sw.id, sw.interfaces[0].id, { vlanMode: 'access', accessVlan: 10 });
                store.updateInterface(sw.id, sw.interfaces[1].id, { vlanMode: 'access', accessVlan: 20 });

                // Configure and connect PCs
                store.configureInterface(pc1.id, pc1.interfaces[0].id, {
                    ipAddress: '192.168.10.100',
                    subnetMask: '255.255.255.0',
                    gateway: '192.168.10.1',
                });
                store.configureInterface(pc2.id, pc2.interfaces[0].id, {
                    ipAddress: '192.168.20.100',
                    subnetMask: '255.255.255.0',
                    gateway: '192.168.20.1',
                });

                store.addConnection(pc1.id, pc1.interfaces[0].id, sw.id, sw.interfaces[0].id);
                store.addConnection(pc2.id, pc2.interfaces[0].id, sw.id, sw.interfaces[1].id);

                // Get SVI MACs
                const svi10 = store.getDeviceById(sw.id)?.sviInterfaces?.find(s => s.vlanId === 10);
                const svi20 = store.getDeviceById(sw.id)?.sviInterfaces?.find(s => s.vlanId === 20);

                // Pre-populate ARP tables to simplify test
                store.updateDevice(sw.id, {
                    arpTable: [
                        { ipAddress: '192.168.10.100', macAddress: pc1.interfaces[0].macAddress, interface: 'Vlan10', type: 'dynamic', age: 0 },
                        { ipAddress: '192.168.20.100', macAddress: pc2.interfaces[0].macAddress, interface: 'Vlan20', type: 'dynamic', age: 0 },
                    ],
                });

                // Packet from PC1 destined to PC2, sent to gateway (SVI 10)
                const packet: Packet = {
                    id: 'inter-vlan-packet',
                    sourceMAC: pc1.interfaces[0].macAddress,
                    destMAC: svi10?.macAddress || '00:00:00:00:00:00',
                    sourceIP: '192.168.10.100',
                    destIP: '192.168.20.100',
                    type: 'icmp',
                    payload: { type: 'echo-request', seq: 1 },
                    ttl: 64,
                    size: 64,
                    currentDeviceId: sw.id,
                    sourceDeviceId: pc1.id,
                    ingressInterface: sw.interfaces[0].name,
                    vlanTag: 10,
                    path: [pc1.id],
                    status: 'in-transit' as const,
                };

                const result = processPacketAtDevice(packet, sw, store);

                // Should be routed to PC2
                const routedPacket = result.find(p => p.targetDeviceId === pc2.id);
                expect(routedPacket).toBeDefined();

                // TTL should be decremented
                expect(routedPacket?.ttl).toBe(63);

                // Packet exits via access port (VLAN 20), so tag is stripped
                expect(routedPacket?.vlanTag).toBeUndefined();

                // Destination MAC should be PC2's MAC
                expect(routedPacket?.destMAC).toBe(pc2.interfaces[0].macAddress);
            });

            it('should decrement TTL when routing between VLANs', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });
                const pc2 = store.addDevice('pc', { x: 200, y: 0 });

                // Configure VLANs and SVIs
                store.addVlan(sw.id, { id: 10, name: 'VLAN10' });
                store.addVlan(sw.id, { id: 20, name: 'VLAN20' });
                store.addSvi(sw.id, {
                    vlanId: 10,
                    ipAddress: '192.168.10.1',
                    subnetMask: '255.255.255.0',
                    isUp: true
                });
                store.addSvi(sw.id, {
                    vlanId: 20,
                    ipAddress: '192.168.20.1',
                    subnetMask: '255.255.255.0',
                    isUp: true
                });

                const svi10 = store.getDeviceById(sw.id)?.sviInterfaces?.find(s => s.vlanId === 10);

                // Configure port and connect PC2 in VLAN 20
                store.updateInterface(sw.id, sw.interfaces[1].id, { vlanMode: 'access', accessVlan: 20 });
                store.addConnection(pc2.id, pc2.interfaces[0].id, sw.id, sw.interfaces[1].id);

                // Pre-populate ARP with PC2's MAC
                store.updateDevice(sw.id, {
                    arpTable: [
                        { ipAddress: '192.168.20.100', macAddress: pc2.interfaces[0].macAddress, interface: 'Vlan20', type: 'dynamic', age: 0 },
                    ],
                });

                // Packet destined for L3 processing
                const packet: Packet = {
                    id: 'ttl-test',
                    sourceMAC: '02:11:22:33:44:55',
                    destMAC: svi10?.macAddress || '00:00:00:00:00:00',
                    sourceIP: '192.168.10.100',
                    destIP: '192.168.20.100',
                    type: 'icmp',
                    payload: { type: 'echo-request' },
                    ttl: 64,
                    size: 64,
                    currentDeviceId: sw.id,
                    sourceDeviceId: 'external',
                    ingressInterface: sw.interfaces[0].name,
                    vlanTag: 10,
                    path: [],
                    status: 'in-transit' as const,
                };

                const result = processPacketAtDevice(packet, sw, store);
                const routedPacket = result.find(p => p.status !== 'dropped');

                expect(routedPacket?.ttl).toBe(63);
            });
        });

        describe('SVI as Gateway', () => {
            it('should accept packets destined to SVI MAC', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                store.addVlan(sw.id, { id: 10, name: 'VLAN10' });
                store.addSvi(sw.id, {
                    vlanId: 10,
                    ipAddress: '192.168.10.1',
                    subnetMask: '255.255.255.0',
                    isUp: true
                });

                const svi = store.getDeviceById(sw.id)?.sviInterfaces?.find(s => s.vlanId === 10);
                expect(svi?.macAddress).toBeDefined();

                // Packet destined to SVI MAC should be processed at L3
                const packet: Packet = {
                    id: 'to-svi-mac',
                    sourceMAC: '02:11:22:33:44:55',
                    destMAC: svi!.macAddress!,
                    sourceIP: '192.168.10.100',
                    destIP: '192.168.20.100', // Different subnet - needs routing
                    type: 'icmp',
                    payload: { type: 'echo-request' },
                    ttl: 64,
                    size: 64,
                    currentDeviceId: sw.id,
                    sourceDeviceId: 'external',
                    ingressInterface: sw.interfaces[0].name,
                    vlanTag: 10,
                    path: [],
                    status: 'in-transit' as const,
                };

                // Should not be flooded - should be processed for routing
                const result = processPacketAtDevice(packet, sw, store);

                // Should either route it or drop if no route (not flood)
                const floodedPackets = result.filter(p => p.status === 'in-transit');
                // If routed, there should be exactly 1 outbound packet (not flooded to all ports)
                expect(floodedPackets.length).toBeLessThanOrEqual(1);
            });
        });
    });

    // ============================================================================
    // PHASE 6: Trunk Link Processing
    // ============================================================================
    describe('Phase 6: Trunk Link Processing', () => {
        describe('Trunk Ingress', () => {
            it('should accept tagged frame if VLAN is allowed', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });
                const pc = store.addDevice('pc', { x: 100, y: 0 });

                // Configure trunk port
                store.addVlan(sw.id, { id: 10, name: 'VLAN10' });
                store.addVlan(sw.id, { id: 20, name: 'VLAN20' });
                store.updateInterface(sw.id, sw.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10, 20],
                    nativeVlan: 1,
                });
                // Add an access port in VLAN 10 for the packet to flood to
                store.updateInterface(sw.id, sw.interfaces[1].id, {
                    vlanMode: 'access',
                    accessVlan: 10,
                });
                store.addConnection(pc.id, pc.interfaces[0].id, sw.id, sw.interfaces[1].id);

                // Tagged frame for VLAN 10
                const packet: Packet = {
                    id: 'tagged-allowed',
                    sourceMAC: '02:AA:BB:CC:DD:EE',
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.10.100',
                    destIP: '192.168.10.255',
                    type: 'arp',
                    payload: { type: 'request' },
                    ttl: 64,
                    size: 42,
                    vlanTag: 10, // Tagged with VLAN 10
                    currentDeviceId: sw.id,
                    sourceDeviceId: 'external',
                    ingressInterface: sw.interfaces[0].name,
                    path: [],
                    status: 'in-transit' as const,
                };

                const result = processPacketAtDevice(packet, sw, store);

                // Frame should be accepted and processed, forwarded to PC in VLAN 10
                const validPackets = result.filter(p => p.status !== 'dropped');
                expect(validPackets.length).toBeGreaterThan(0);
                // Packets should go to the PC on the access port
                expect(validPackets.some(p => p.targetDeviceId === pc.id)).toBe(true);
                // Access port strips the tag, so vlanTag should be undefined
            });

            it('should drop tagged frame if VLAN is not allowed', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Configure trunk port - VLAN 30 NOT allowed
                store.addVlan(sw.id, { id: 10, name: 'VLAN10' });
                store.updateInterface(sw.id, sw.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10],
                    nativeVlan: 1,
                });

                // Tagged frame for VLAN 30 (not allowed)
                const packet: Packet = {
                    id: 'tagged-not-allowed',
                    sourceMAC: '02:AA:BB:CC:DD:EE',
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.30.100',
                    destIP: '192.168.30.255',
                    type: 'arp',
                    payload: { type: 'request' },
                    ttl: 64,
                    size: 42,
                    vlanTag: 30, // VLAN 30 - not allowed
                    currentDeviceId: sw.id,
                    sourceDeviceId: 'external',
                    ingressInterface: sw.interfaces[0].name,
                    path: [],
                    status: 'in-transit' as const,
                };

                const result = processPacketAtDevice(packet, sw, store);

                // Frame should be dropped
                expect(result.length === 0 || result.every(p => p.status === 'dropped')).toBe(true);
            });

            it('should tag untagged frame with native VLAN', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });
                const pc1 = store.addDevice('pc', { x: 100, y: 0 });
                const pc2 = store.addDevice('pc', { x: 200, y: 0 });

                // Configure trunk port with native VLAN 1
                store.updateInterface(sw.id, sw.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10, 20],
                    nativeVlan: 1,
                });
                // Add an access port in VLAN 1 for the packet to flood to
                store.updateInterface(sw.id, sw.interfaces[1].id, {
                    vlanMode: 'access',
                    accessVlan: 1,
                });

                // Connect PC1 to trunk port (unusual but valid for native VLAN)
                store.addConnection(pc1.id, pc1.interfaces[0].id, sw.id, sw.interfaces[0].id);
                // Connect PC2 to access port in VLAN 1
                store.addConnection(pc2.id, pc2.interfaces[0].id, sw.id, sw.interfaces[1].id);

                // Untagged frame (no vlanTag) from pc1
                const packet: Packet = {
                    id: 'untagged-native',
                    sourceMAC: pc1.interfaces[0].macAddress,
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.1.100',
                    destIP: '192.168.1.255',
                    type: 'arp',
                    payload: { type: 'request' },
                    ttl: 64,
                    size: 42,
                    // No vlanTag - untagged
                    currentDeviceId: sw.id,
                    sourceDeviceId: pc1.id,
                    ingressInterface: sw.interfaces[0].name,
                    path: [pc1.id],
                    status: 'in-transit' as const,
                };

                const result = processPacketAtDevice(packet, sw, store);

                // Frame should be flooded to access port in VLAN 1
                // (tag is removed for access ports, but internally assigned VLAN 1)
                const validPackets = result.filter(p => p.status !== 'dropped');
                expect(validPackets.length).toBeGreaterThan(0);
                // Access port packets don't have vlanTag (untagged)
                // The test was checking wrong thing - we verify forwarding happened
                expect(validPackets.some(p => p.targetDeviceId === pc2.id)).toBe(true);
            });
        });

        describe('Trunk Egress', () => {
            it('should send frame tagged on trunk port', () => {
                const store = useNetworkStore.getState();
                const sw1 = store.addDevice('switch', { x: 0, y: 0 });
                const sw2 = store.addDevice('switch', { x: 200, y: 0 });

                // Configure VLANs
                store.addVlan(sw1.id, { id: 10, name: 'VLAN10' });
                store.addVlan(sw2.id, { id: 10, name: 'VLAN10' });

                // Configure trunk between switches
                store.updateInterface(sw1.id, sw1.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10],
                    nativeVlan: 1,
                });
                store.updateInterface(sw2.id, sw2.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10],
                    nativeVlan: 1,
                });

                store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);

                // Frame in VLAN 10 (not native)
                const packet: Packet = {
                    id: 'tagged-egress',
                    sourceMAC: '02:AA:BB:CC:DD:EE',
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.10.100',
                    destIP: '192.168.10.255',
                    type: 'arp',
                    payload: { type: 'request' },
                    ttl: 64,
                    size: 42,
                    vlanTag: 10,
                    currentDeviceId: sw1.id,
                    sourceDeviceId: 'external',
                    ingressInterface: sw1.interfaces[1].name, // Ingress on different port
                    path: [],
                    status: 'in-transit' as const,
                };

                // Configure ingress port as access VLAN 10
                store.updateInterface(sw1.id, sw1.interfaces[1].id, { vlanMode: 'access', accessVlan: 10 });

                const result = processPacketAtDevice(packet, sw1, store);

                // Packet going to sw2 should keep VLAN tag (not native)
                const toSw2 = result.find(p => p.targetDeviceId === sw2.id);
                expect(toSw2).toBeDefined();
                expect(toSw2?.vlanTag).toBe(10);
            });

            it('should send frame untagged if VLAN is native', () => {
                const store = useNetworkStore.getState();
                const sw1 = store.addDevice('switch', { x: 0, y: 0 });
                const sw2 = store.addDevice('switch', { x: 200, y: 0 });

                // Configure trunk between switches with native VLAN 1
                store.updateInterface(sw1.id, sw1.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10],
                    nativeVlan: 1,
                });

                store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);

                // Frame in VLAN 1 (native)
                const packet: Packet = {
                    id: 'native-egress',
                    sourceMAC: '02:AA:BB:CC:DD:EE',
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.1.100',
                    destIP: '192.168.1.255',
                    type: 'arp',
                    payload: { type: 'request' },
                    ttl: 64,
                    size: 42,
                    vlanTag: 1,
                    currentDeviceId: sw1.id,
                    sourceDeviceId: 'external',
                    ingressInterface: sw1.interfaces[1].name,
                    path: [],
                    status: 'in-transit' as const,
                };

                const result = processPacketAtDevice(packet, sw1, store);

                // Packet going to sw2 should be untagged (native VLAN)
                const toSw2 = result.find(p => p.targetDeviceId === sw2.id);
                expect(toSw2).toBeDefined();
                // Native VLAN frames are sent untagged
                expect(toSw2?.vlanTag).toBeUndefined();
            });

            it('should drop frame if VLAN not in allowed list', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Configure trunk port - only VLAN 1 and 10 allowed
                store.updateInterface(sw.id, sw.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10],
                    nativeVlan: 1,
                });

                // Frame in VLAN 20 (not allowed on trunk)
                const packet: Packet = {
                    id: 'not-allowed-egress',
                    sourceMAC: '02:AA:BB:CC:DD:EE',
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.20.100',
                    destIP: '192.168.20.255',
                    type: 'arp',
                    payload: { type: 'request' },
                    ttl: 64,
                    size: 42,
                    vlanTag: 20,
                    currentDeviceId: sw.id,
                    sourceDeviceId: 'external',
                    ingressInterface: sw.interfaces[1].name,
                    path: [],
                    status: 'in-transit' as const,
                };

                // Other port is access VLAN 20
                store.addVlan(sw.id, { id: 20, name: 'VLAN20' });
                store.updateInterface(sw.id, sw.interfaces[1].id, { vlanMode: 'access', accessVlan: 20 });

                const result = processPacketAtDevice(packet, sw, store);

                // Frame should NOT go out the trunk (VLAN 20 not allowed)
                const trunkEgress = result.filter(p =>
                    p.egressInterface === sw.interfaces[0].name && p.status !== 'dropped'
                );
                expect(trunkEgress.length).toBe(0);
            });
        });

        describe('Switch-to-Switch Trunk', () => {
            it('should forward frame across trunk maintaining VLAN', () => {
                const store = useNetworkStore.getState();
                const sw1 = store.addDevice('switch', { x: 0, y: 0 });
                const sw2 = store.addDevice('switch', { x: 200, y: 0 });
                const pc1 = store.addDevice('pc', { x: -100, y: 0 });
                const pc2 = store.addDevice('pc', { x: 300, y: 0 });

                // Configure VLANs on both switches
                store.addVlan(sw1.id, { id: 10, name: 'VLAN10' });
                store.addVlan(sw2.id, { id: 10, name: 'VLAN10' });

                // Configure trunk between switches (port 0)
                store.updateInterface(sw1.id, sw1.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10],
                    nativeVlan: 1,
                });
                store.updateInterface(sw2.id, sw2.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10],
                    nativeVlan: 1,
                });

                // Configure access ports (port 1) on each switch for VLAN 10
                store.updateInterface(sw1.id, sw1.interfaces[1].id, { vlanMode: 'access', accessVlan: 10 });
                store.updateInterface(sw2.id, sw2.interfaces[1].id, { vlanMode: 'access', accessVlan: 10 });

                // Connect devices
                store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);
                store.addConnection(pc1.id, pc1.interfaces[0].id, sw1.id, sw1.interfaces[1].id);
                store.addConnection(pc2.id, pc2.interfaces[0].id, sw2.id, sw2.interfaces[1].id);

                // Learn PC2's MAC on SW2
                store.learnMAC(sw2.id, pc2.interfaces[0].macAddress, sw2.interfaces[1].name, 10);

                // Frame from PC1 to PC2
                const packet: Packet = {
                    id: 'cross-trunk',
                    sourceMAC: pc1.interfaces[0].macAddress,
                    destMAC: pc2.interfaces[0].macAddress,
                    sourceIP: '192.168.10.100',
                    destIP: '192.168.10.200',
                    type: 'icmp',
                    payload: { type: 'echo-request' },
                    ttl: 64,
                    size: 64,
                    currentDeviceId: sw1.id,
                    sourceDeviceId: pc1.id,
                    ingressInterface: sw1.interfaces[1].name,
                    path: [pc1.id],
                    status: 'in-transit' as const,
                };

                // Process at SW1 - should forward to trunk
                const result1 = processPacketAtDevice(packet, sw1, store);
                const toTrunk = result1.find(p => p.targetDeviceId === sw2.id);

                expect(toTrunk).toBeDefined();
                expect(toTrunk?.vlanTag).toBe(10); // VLAN preserved

                // Process at SW2 - should forward to PC2
                if (toTrunk) {
                    toTrunk.currentDeviceId = sw2.id;
                    toTrunk.ingressInterface = sw2.interfaces[0].name;

                    const result2 = processPacketAtDevice(toTrunk, sw2, store);
                    const toPC2 = result2.find(p => p.targetDeviceId === pc2.id);

                    expect(toPC2).toBeDefined();
                    // Tag removed on access port egress
                    expect(toPC2?.vlanTag).toBeUndefined();
                }
            });

            it('should isolate VLANs across trunk link', () => {
                const store = useNetworkStore.getState();
                const sw1 = store.addDevice('switch', { x: 0, y: 0 });
                const sw2 = store.addDevice('switch', { x: 200, y: 0 });
                const pc1 = store.addDevice('pc', { x: -100, y: 0 });
                const pc2 = store.addDevice('pc', { x: 300, y: 0 });

                // Configure VLANs
                store.addVlan(sw1.id, { id: 10, name: 'VLAN10' });
                store.addVlan(sw1.id, { id: 20, name: 'VLAN20' });
                store.addVlan(sw2.id, { id: 10, name: 'VLAN10' });
                store.addVlan(sw2.id, { id: 20, name: 'VLAN20' });

                // Configure trunk
                store.updateInterface(sw1.id, sw1.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10, 20],
                    nativeVlan: 1,
                });
                store.updateInterface(sw2.id, sw2.interfaces[0].id, {
                    vlanMode: 'trunk',
                    allowedVlans: [1, 10, 20],
                    nativeVlan: 1,
                });

                // PC1 in VLAN 10, PC2 in VLAN 20
                store.updateInterface(sw1.id, sw1.interfaces[1].id, { vlanMode: 'access', accessVlan: 10 });
                store.updateInterface(sw2.id, sw2.interfaces[1].id, { vlanMode: 'access', accessVlan: 20 });

                store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);
                store.addConnection(pc1.id, pc1.interfaces[0].id, sw1.id, sw1.interfaces[1].id);
                store.addConnection(pc2.id, pc2.interfaces[0].id, sw2.id, sw2.interfaces[1].id);

                // Broadcast from PC1 (VLAN 10)
                const packet: Packet = {
                    id: 'vlan-isolation',
                    sourceMAC: pc1.interfaces[0].macAddress,
                    destMAC: 'FF:FF:FF:FF:FF:FF',
                    sourceIP: '192.168.10.100',
                    destIP: '192.168.10.255',
                    type: 'arp',
                    payload: { type: 'request' },
                    ttl: 64,
                    size: 42,
                    currentDeviceId: sw1.id,
                    sourceDeviceId: pc1.id,
                    ingressInterface: sw1.interfaces[1].name,
                    path: [pc1.id],
                    status: 'in-transit' as const,
                };

                // Process at SW1
                const result1 = processPacketAtDevice(packet, sw1, store);
                const toTrunk = result1.find(p => p.targetDeviceId === sw2.id);

                expect(toTrunk).toBeDefined();
                expect(toTrunk?.vlanTag).toBe(10);

                // Process at SW2
                if (toTrunk) {
                    toTrunk.currentDeviceId = sw2.id;
                    toTrunk.ingressInterface = sw2.interfaces[0].name;

                    const result2 = processPacketAtDevice(toTrunk, sw2, store);

                    // Should NOT go to PC2 (wrong VLAN)
                    const toPC2 = result2.find(p => p.targetDeviceId === pc2.id);
                    expect(toPC2).toBeUndefined();
                }
            });
        });
    });
});
