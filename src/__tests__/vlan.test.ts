import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useNetworkStore } from '@/store/network-store';
import { executeNetworkCommand } from '@/lib/terminal-commands';

// Helper to execute command synchronously in tests
async function executeCommand(command: string, deviceId: string, store: ReturnType<typeof useNetworkStore.getState>) {
    return executeNetworkCommand(command, deviceId, store);
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
});
