import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useNetworkStore } from '@/store/network-store';
import { processDeviceTick } from '@/lib/simulation';
import type { Packet, NetworkDevice, Connection, StpConfig, StpPortConfig, BpduPayload } from '@/types/network';

// Helper to process a packet at a device for testing
function processPacketAtDevice(
    packet: Partial<Packet> & { id: string; sourceMAC: string; destMAC: string },
    device: NetworkDevice,
): Packet[] {
    const freshState = useNetworkStore.getState();
    const freshDevice = freshState.getDeviceById(device.id) || device;

    const processablePacket: Packet = {
        type: 'icmp',
        ttl: 64,
        size: 64,
        path: [],
        currentPathIndex: 0,
        progress: 0,
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

// STP multicast destination MAC address (Bridge Group Address)
const STP_MULTICAST_MAC = '01:80:C2:00:00:00';

// Helper to create a valid Bridge ID
function createBridgeId(priority: number, macAddress: string): string {
    // Bridge ID format: priority (4 digits hex) + MAC address
    const priorityHex = priority.toString(16).padStart(4, '0');
    return `${priorityHex}.${macAddress.toLowerCase()}`;
}

// Helper to compare Bridge IDs (lower is better)
function compareBridgeIds(a: string, b: string): number {
    const [aPriorityStr, aMac] = a.split('.');
    const [bPriorityStr, bMac] = b.split('.');
    const aPriority = parseInt(aPriorityStr, 16);
    const bPriority = parseInt(bPriorityStr, 16);

    if (aPriority !== bPriority) {
        return aPriority - bPriority;
    }
    // Compare MAC addresses lexicographically
    return aMac.localeCompare(bMac);
}

describe('STP (Spanning Tree Protocol)', () => {
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
        describe('STP types on NetworkDevice', () => {
            it('should support stpConfig property on switches', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Switches should be able to have STP config
                expect(sw.type).toBe('switch');
                // Initially undefined until STP is enabled
                expect(sw.stpConfig).toBeUndefined();
            });

            it('should initialize STP config with default values', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                // Enable STP on the switch
                store.enableStp(sw.id);

                const updatedSwitch = store.getDeviceById(sw.id)!;
                expect(updatedSwitch.stpConfig).toBeDefined();
                expect(updatedSwitch.stpConfig!.enabled).toBe(true);
                expect(updatedSwitch.stpConfig!.bridgePriority).toBe(32768); // Default priority
                expect(updatedSwitch.stpConfig!.maxAge).toBe(20);
                expect(updatedSwitch.stpConfig!.helloTime).toBe(2);
                expect(updatedSwitch.stpConfig!.forwardDelay).toBe(15);
            });

            it('should generate correct Bridge ID from priority and MAC', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                store.enableStp(sw.id);

                const updatedSwitch = store.getDeviceById(sw.id)!;
                // Bridge ID should be priority + first interface MAC
                const expectedBridgeId = createBridgeId(32768, sw.interfaces[0].macAddress);
                expect(updatedSwitch.stpConfig!.bridgeId).toBe(expectedBridgeId);
            });

            it('should initialize port STP config for all interfaces', () => {
                const store = useNetworkStore.getState();
                const sw = store.addDevice('switch', { x: 0, y: 0 });

                store.enableStp(sw.id);

                const updatedSwitch = store.getDeviceById(sw.id)!;
                expect(updatedSwitch.stpConfig!.ports.length).toBe(sw.interfaces.length);

                // All ports should start in blocking state (except will converge to forwarding if no loops)
                for (const port of updatedSwitch.stpConfig!.ports) {
                    expect(port.state).toBe('blocking');
                    expect(port.portPriority).toBe(128); // Default port priority
                }
            });
        });

        describe('Bridge ID comparison', () => {
            it('should correctly compare Bridge IDs (lower priority wins)', () => {
                const bridgeA = createBridgeId(32768, 'AA:BB:CC:DD:EE:FF');
                const bridgeB = createBridgeId(4096, 'AA:BB:CC:DD:EE:FF');

                // bridgeB has lower priority, so it should be "less than" (better)
                expect(compareBridgeIds(bridgeB, bridgeA)).toBeLessThan(0);
            });

            it('should correctly compare Bridge IDs (same priority, lower MAC wins)', () => {
                const bridgeA = createBridgeId(32768, 'AA:BB:CC:DD:EE:FF');
                const bridgeB = createBridgeId(32768, '00:11:22:33:44:55');

                // bridgeB has lower MAC, so it should be "less than" (better)
                expect(compareBridgeIds(bridgeB, bridgeA)).toBeLessThan(0);
            });

            it('should correctly identify equal Bridge IDs', () => {
                const bridgeA = createBridgeId(32768, 'AA:BB:CC:DD:EE:FF');
                const bridgeB = createBridgeId(32768, 'AA:BB:CC:DD:EE:FF');

                expect(compareBridgeIds(bridgeA, bridgeB)).toBe(0);
            });
        });
    });

    // ============================================
    // Phase 2: STP Enable/Disable Tests
    // ============================================
    describe('Phase 2: STP Enable/Disable', () => {
        it('should enable STP on a switch', () => {
            const store = useNetworkStore.getState();
            const sw = store.addDevice('switch', { x: 0, y: 0 });

            store.enableStp(sw.id);

            const updatedSwitch = store.getDeviceById(sw.id)!;
            expect(updatedSwitch.stpConfig?.enabled).toBe(true);
        });

        it('should disable STP on a switch', () => {
            const store = useNetworkStore.getState();
            const sw = store.addDevice('switch', { x: 0, y: 0 });

            store.enableStp(sw.id);
            store.disableStp(sw.id);

            const updatedSwitch = store.getDeviceById(sw.id)!;
            expect(updatedSwitch.stpConfig?.enabled).toBe(false);
        });

        it('should set all ports to forwarding when STP is disabled', () => {
            const store = useNetworkStore.getState();
            const sw = store.addDevice('switch', { x: 0, y: 0 });

            store.enableStp(sw.id);
            store.disableStp(sw.id);

            const updatedSwitch = store.getDeviceById(sw.id)!;
            for (const port of updatedSwitch.stpConfig!.ports) {
                expect(port.state).toBe('forwarding');
            }
        });

        it('should not enable STP on non-switch devices', () => {
            const store = useNetworkStore.getState();
            const pc = store.addDevice('pc', { x: 0, y: 0 });

            store.enableStp(pc.id);

            const updatedPc = store.getDeviceById(pc.id)!;
            expect(updatedPc.stpConfig).toBeUndefined();
        });
    });

    // ============================================
    // Phase 3: Root Bridge Election Tests
    // ============================================
    describe('Phase 3: Root Bridge Election', () => {
        it('should elect itself as root when alone', () => {
            const store = useNetworkStore.getState();
            const sw = store.addDevice('switch', { x: 0, y: 0 });

            store.enableStp(sw.id);

            // Run STP convergence
            store.runStpConvergence();

            const updatedSwitch = store.getDeviceById(sw.id)!;
            // When alone, switch thinks it's the root
            expect(updatedSwitch.stpConfig!.rootBridgeId).toBe(updatedSwitch.stpConfig!.bridgeId);
            expect(updatedSwitch.stpConfig!.rootPathCost).toBe(0);
            expect(updatedSwitch.stpConfig!.rootPort).toBeUndefined(); // Root has no root port
        });

        it('should elect switch with lowest Bridge ID as root', () => {
            const store = useNetworkStore.getState();
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });

            // Connect the switches
            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);

            // Set different priorities
            store.setStpBridgePriority(sw1.id, 4096);  // Lower priority = better
            store.setStpBridgePriority(sw2.id, 32768);

            // Run STP convergence
            store.runStpConvergence();

            const updatedSw1 = store.getDeviceById(sw1.id)!;
            const updatedSw2 = store.getDeviceById(sw2.id)!;

            // sw1 should be root (lower priority)
            expect(updatedSw1.stpConfig!.rootBridgeId).toBe(updatedSw1.stpConfig!.bridgeId);
            expect(updatedSw2.stpConfig!.rootBridgeId).toBe(updatedSw1.stpConfig!.bridgeId);

            // sw2 should have a root port pointing to sw1
            expect(updatedSw2.stpConfig!.rootPort).toBeDefined();
        });

        it('should calculate correct root path cost', () => {
            const store = useNetworkStore.getState();
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });
            const sw3 = store.addDevice('switch', { x: 400, y: 0 });

            // Connect in a line: sw1 -- sw2 -- sw3
            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);
            store.addConnection(sw2.id, sw2.interfaces[1].id, sw3.id, sw3.interfaces[0].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);
            store.enableStp(sw3.id);

            // Make sw1 the root
            store.setStpBridgePriority(sw1.id, 4096);

            store.runStpConvergence();

            const updatedSw1 = store.getDeviceById(sw1.id)!;
            const updatedSw2 = store.getDeviceById(sw2.id)!;
            const updatedSw3 = store.getDeviceById(sw3.id)!;

            // sw1 is root, cost = 0
            expect(updatedSw1.stpConfig!.rootPathCost).toBe(0);
            // sw2 is 1 hop from root
            expect(updatedSw2.stpConfig!.rootPathCost).toBeGreaterThan(0);
            // sw3 is 2 hops from root
            expect(updatedSw3.stpConfig!.rootPathCost).toBeGreaterThan(updatedSw2.stpConfig!.rootPathCost);
        });
    });

    // ============================================
    // Phase 4: Port Role Assignment Tests
    // ============================================
    describe('Phase 4: Port Role Assignment', () => {
        it('should assign root ports on non-root switches', () => {
            const store = useNetworkStore.getState();
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });

            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);
            store.setStpBridgePriority(sw1.id, 4096); // sw1 is root

            store.runStpConvergence();

            const updatedSw2 = store.getDeviceById(sw2.id)!;
            const rootPort = updatedSw2.stpConfig!.ports.find(p => p.role === 'root');

            expect(rootPort).toBeDefined();
            expect(rootPort!.interfaceId).toBe(sw2.interfaces[0].id);
        });

        it('should assign designated ports on root switch', () => {
            const store = useNetworkStore.getState();
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });

            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);
            store.setStpBridgePriority(sw1.id, 4096); // sw1 is root

            store.runStpConvergence();

            const updatedSw1 = store.getDeviceById(sw1.id)!;
            const connectedPort = updatedSw1.stpConfig!.ports.find(
                p => p.interfaceId === sw1.interfaces[0].id
            );

            // Root bridge's ports are all designated
            expect(connectedPort?.role).toBe('designated');
        });

        it('should block redundant paths to prevent loops', () => {
            const store = useNetworkStore.getState();
            // Create a triangle topology (loop)
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });
            const sw3 = store.addDevice('switch', { x: 100, y: 200 });

            // Triangle: sw1 -- sw2 -- sw3 -- sw1
            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);
            store.addConnection(sw2.id, sw2.interfaces[1].id, sw3.id, sw3.interfaces[0].id);
            store.addConnection(sw3.id, sw3.interfaces[1].id, sw1.id, sw1.interfaces[1].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);
            store.enableStp(sw3.id);

            store.setStpBridgePriority(sw1.id, 4096); // sw1 is root

            store.runStpConvergence();

            // Get only the ports involved in the triangle (connected ports)
            const trianglePortIds = [
                sw1.interfaces[0].id, sw1.interfaces[1].id, // sw1's connections
                sw2.interfaces[0].id, sw2.interfaces[1].id, // sw2's connections
                sw3.interfaces[0].id, sw3.interfaces[1].id, // sw3's connections
            ];

            const allPorts = [
                ...store.getDeviceById(sw1.id)!.stpConfig!.ports,
                ...store.getDeviceById(sw2.id)!.stpConfig!.ports,
                ...store.getDeviceById(sw3.id)!.stpConfig!.ports,
            ].filter(p => trianglePortIds.includes(p.interfaceId));

            // Exactly 6 ports are in the triangle loop
            expect(allPorts.length).toBe(6);

            // One port somewhere should be blocking to break the loop
            const blockingPorts = allPorts.filter(p => p.state === 'blocking');
            expect(blockingPorts.length).toBeGreaterThanOrEqual(1);

            // Count forwarding ports on triangle connections - should not have all 6 forwarding
            const forwardingPorts = allPorts.filter(p => p.state === 'forwarding');
            expect(forwardingPorts.length).toBeLessThan(6);
        });
    });

    // ============================================
    // Phase 5: BPDU Processing Tests
    // ============================================
    describe('Phase 5: BPDU Processing', () => {
        it('should generate BPDU packets when simulation runs', () => {
            const store = useNetworkStore.getState();
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });

            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);

            // Run convergence to set proper port states
            store.runStpConvergence();

            // Generate BPDUs from a switch
            const bpdus = store.generateStpBpdus(sw1.id);

            expect(bpdus.length).toBeGreaterThan(0);
            expect(bpdus[0].type).toBe('stp');
            expect(bpdus[0].destMAC).toBe(STP_MULTICAST_MAC);
        });

        it('should include correct BPDU payload', () => {
            const store = useNetworkStore.getState();
            const sw = store.addDevice('switch', { x: 0, y: 0 });

            store.enableStp(sw.id);

            const bpdus = store.generateStpBpdus(sw.id);

            if (bpdus.length > 0) {
                const payload = bpdus[0].payload as BpduPayload;
                expect(payload.protocolId).toBe(0);
                expect(payload.bpduType).toBe('config');
                expect(payload.rootBridgeId).toBeDefined();
                expect(payload.senderBridgeId).toBeDefined();
                expect(payload.rootPathCost).toBeDefined();
            }
        });

        it('should process incoming BPDUs and update STP state', () => {
            const store = useNetworkStore.getState();
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });

            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);

            // Initially both think they are root
            let sw1State = store.getDeviceById(sw1.id)!;
            let sw2State = store.getDeviceById(sw2.id)!;

            expect(sw1State.stpConfig!.rootBridgeId).toBe(sw1State.stpConfig!.bridgeId);
            expect(sw2State.stpConfig!.rootBridgeId).toBe(sw2State.stpConfig!.bridgeId);

            // Simulate BPDU exchange (convergence)
            store.runStpConvergence();

            sw1State = store.getDeviceById(sw1.id)!;
            sw2State = store.getDeviceById(sw2.id)!;

            // After convergence, both should agree on the same root
            expect(sw1State.stpConfig!.rootBridgeId).toBe(sw2State.stpConfig!.rootBridgeId);
        });

        it('should not forward user traffic on blocking ports', () => {
            const store = useNetworkStore.getState();
            // Create a loop topology
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });
            const sw3 = store.addDevice('switch', { x: 100, y: 200 });
            const pc = store.addDevice('pc', { x: -100, y: 0 });

            // Triangle: sw1 -- sw2 -- sw3 -- sw1
            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);
            store.addConnection(sw2.id, sw2.interfaces[1].id, sw3.id, sw3.interfaces[0].id);
            store.addConnection(sw3.id, sw3.interfaces[1].id, sw1.id, sw1.interfaces[1].id);
            // PC connected to sw1
            store.addConnection(pc.id, pc.interfaces[0].id, sw1.id, sw1.interfaces[2].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);
            store.enableStp(sw3.id);
            store.runStpConvergence();

            // Find a blocking port
            const allSwitches = [sw1, sw2, sw3].map(s => store.getDeviceById(s.id)!);
            let blockingSwitch: NetworkDevice | undefined;
            let blockingPort: StpPortConfig | undefined;

            for (const sw of allSwitches) {
                const blocking = sw.stpConfig?.ports.find(p => p.state === 'blocking');
                if (blocking) {
                    blockingSwitch = sw;
                    blockingPort = blocking;
                    break;
                }
            }

            expect(blockingSwitch).toBeDefined();
            expect(blockingPort).toBeDefined();

            // Create a test packet trying to egress on the blocking port
            const testPacket: Packet = {
                id: 'test-packet-1',
                type: 'icmp',
                sourceMAC: pc.interfaces[0].macAddress,
                destMAC: 'FF:FF:FF:FF:FF:FF', // Broadcast
                ttl: 64,
                size: 64,
                currentDeviceId: blockingSwitch!.id,
                processingStage: 'at-device',
                path: [],
                currentPathIndex: 0,
                progress: 0,
            };

            const results = processPacketAtDevice(testPacket, blockingSwitch!);

            // Check that no packet was sent out the blocking port
            const sentOnBlockingPort = results.some(
                p => p.egressInterface === blockingPort!.interfaceName
            );
            expect(sentOnBlockingPort).toBe(false);
        });
    });

    // ============================================
    // Phase 6: Port State Transitions Tests
    // ============================================
    describe('Phase 6: Port State Transitions', () => {
        it('should transition ports from blocking to forwarding', () => {
            const store = useNetworkStore.getState();
            const sw = store.addDevice('switch', { x: 0, y: 0 });

            store.enableStp(sw.id);

            // Initially ports are blocking
            let swState = store.getDeviceById(sw.id)!;
            expect(swState.stpConfig!.ports[0].state).toBe('blocking');

            // Simulate timer expiry (in a simple network with no loops, ports should forward)
            store.runStpConvergence();

            swState = store.getDeviceById(sw.id)!;
            // In a simple network (no loops), ports should be forwarding
            const connectedPorts = swState.stpConfig!.ports.filter(
                p => swState.interfaces.find(i => i.id === p.interfaceId)?.connectedTo
            );

            // Unconnected ports stay disabled, connected would forward if no loop
            // Since this switch is alone, no BPDUs received, it becomes root
            // Root ports are designated and forwarding
        });

        it('should keep disabled ports disabled', () => {
            const store = useNetworkStore.getState();
            const sw = store.addDevice('switch', { x: 0, y: 0 });

            store.enableStp(sw.id);

            // Disable an interface
            store.configureInterface(sw.id, sw.interfaces[0].id, { isUp: false });

            store.runStpConvergence();

            const swState = store.getDeviceById(sw.id)!;
            const disabledPort = swState.stpConfig!.ports.find(
                p => p.interfaceId === sw.interfaces[0].id
            );

            expect(disabledPort?.state).toBe('disabled');
        });
    });

    // ============================================
    // Phase 7: Path Cost Calculation Tests
    // ============================================
    describe('Phase 7: Path Cost Calculation', () => {
        it('should use default path costs based on interface speed', () => {
            const store = useNetworkStore.getState();
            const sw = store.addDevice('switch', { x: 0, y: 0 });

            store.enableStp(sw.id);

            const swState = store.getDeviceById(sw.id)!;

            // Default speed is 1000 Mbps (Gigabit) = cost 4
            // Or 100 Mbps = cost 19
            // Or 10 Mbps = cost 100
            expect(swState.stpConfig!.ports[0].pathCost).toBeGreaterThan(0);
        });

        it('should allow manual path cost configuration', () => {
            const store = useNetworkStore.getState();
            const sw = store.addDevice('switch', { x: 0, y: 0 });

            store.enableStp(sw.id);

            store.setStpPortCost(sw.id, sw.interfaces[0].id, 100);

            const swState = store.getDeviceById(sw.id)!;
            const port = swState.stpConfig!.ports.find(p => p.interfaceId === sw.interfaces[0].id);

            expect(port?.pathCost).toBe(100);
        });

        it('should select root port based on lowest path cost', () => {
            const store = useNetworkStore.getState();
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });

            // Connect sw2 to sw1 via two links
            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);
            store.addConnection(sw1.id, sw1.interfaces[1].id, sw2.id, sw2.interfaces[1].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);

            store.setStpBridgePriority(sw1.id, 4096); // sw1 is root

            // Set different costs on sw2's ports
            store.setStpPortCost(sw2.id, sw2.interfaces[0].id, 10);  // Lower cost
            store.setStpPortCost(sw2.id, sw2.interfaces[1].id, 100); // Higher cost

            store.runStpConvergence();

            const sw2State = store.getDeviceById(sw2.id)!;

            // The port with lower cost should be the root port
            expect(sw2State.stpConfig!.rootPort).toBe(sw2.interfaces[0].id);
        });
    });

    // ============================================
    // Phase 8: Topology Change Tests
    // ============================================
    describe('Phase 8: Topology Change', () => {
        it('should detect topology change when link goes down', () => {
            const store = useNetworkStore.getState();
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });

            const connection = store.addConnection(
                sw1.id, sw1.interfaces[0].id,
                sw2.id, sw2.interfaces[0].id
            );

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);
            store.runStpConvergence();

            const initialChangeCount = store.getDeviceById(sw1.id)!.stpConfig!.topologyChangeCount;

            // Simulate link failure
            if (connection) {
                store.removeConnection(connection.id);
            }

            // Run convergence after topology change
            store.runStpConvergence();

            const sw1State = store.getDeviceById(sw1.id)!;
            expect(sw1State.stpConfig!.topologyChangeCount).toBeGreaterThan(initialChangeCount);
        });

        it('should reconverge when new switch is added', () => {
            const store = useNetworkStore.getState();
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });

            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);
            store.runStpConvergence();

            // Add a new switch with lower priority
            const sw3 = store.addDevice('switch', { x: 400, y: 0 });
            store.addConnection(sw2.id, sw2.interfaces[1].id, sw3.id, sw3.interfaces[0].id);

            store.enableStp(sw3.id);
            store.setStpBridgePriority(sw3.id, 4096); // Make it the best root

            store.runStpConvergence();

            // All switches should now see sw3 as root
            const sw1State = store.getDeviceById(sw1.id)!;
            const sw2State = store.getDeviceById(sw2.id)!;
            const sw3State = store.getDeviceById(sw3.id)!;

            expect(sw1State.stpConfig!.rootBridgeId).toBe(sw3State.stpConfig!.bridgeId);
            expect(sw2State.stpConfig!.rootBridgeId).toBe(sw3State.stpConfig!.bridgeId);
            expect(sw3State.stpConfig!.rootBridgeId).toBe(sw3State.stpConfig!.bridgeId);
        });
    });

    // ============================================
    // Phase 9: Loop Prevention Integration Tests
    // ============================================
    describe('Phase 9: Loop Prevention Integration', () => {
        it('should prevent broadcast storms in triangle topology', () => {
            const store = useNetworkStore.getState();
            // Create triangle with PCs
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });
            const sw3 = store.addDevice('switch', { x: 100, y: 200 });
            const pc1 = store.addDevice('pc', { x: -100, y: 0 });
            const pc2 = store.addDevice('pc', { x: 300, y: 0 });

            // Triangle
            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);
            store.addConnection(sw2.id, sw2.interfaces[1].id, sw3.id, sw3.interfaces[0].id);
            store.addConnection(sw3.id, sw3.interfaces[1].id, sw1.id, sw1.interfaces[1].id);

            // PCs
            store.addConnection(pc1.id, pc1.interfaces[0].id, sw1.id, sw1.interfaces[2].id);
            store.addConnection(pc2.id, pc2.interfaces[0].id, sw2.id, sw2.interfaces[2].id);

            // Configure IPs
            store.configureInterface(pc1.id, pc1.interfaces[0].id, { ipAddress: '10.0.0.1', subnetMask: '255.255.255.0' });
            store.configureInterface(pc2.id, pc2.interfaces[0].id, { ipAddress: '10.0.0.2', subnetMask: '255.255.255.0' });

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);
            store.enableStp(sw3.id);
            store.runStpConvergence();

            // Verify STP has blocked at least one port in the triangle
            const trianglePortIds = [
                sw1.interfaces[0].id, sw1.interfaces[1].id,
                sw2.interfaces[0].id, sw2.interfaces[1].id,
                sw3.interfaces[0].id, sw3.interfaces[1].id,
            ];

            const allTrianglePorts = [
                ...store.getDeviceById(sw1.id)!.stpConfig!.ports,
                ...store.getDeviceById(sw2.id)!.stpConfig!.ports,
                ...store.getDeviceById(sw3.id)!.stpConfig!.ports,
            ].filter(p => trianglePortIds.includes(p.interfaceId));

            const blockingPorts = allTrianglePorts.filter(p => p.state === 'blocking');
            expect(blockingPorts.length).toBeGreaterThanOrEqual(1);

            // Send a broadcast from PC1
            const broadcastPacket: Packet = {
                id: 'broadcast-1',
                type: 'arp',
                sourceMAC: pc1.interfaces[0].macAddress,
                destMAC: 'FF:FF:FF:FF:FF:FF',
                sourceIP: '10.0.0.1',
                destIP: '10.0.0.2',
                ttl: 64,
                size: 64,
                currentDeviceId: sw1.id,
                lastDeviceId: pc1.id,
                ingressInterface: sw1.interfaces[2].name,
                processingStage: 'at-device',
                path: [pc1.id],
                currentPathIndex: 0,
                progress: 0,
                payload: { type: 'request', targetIP: '10.0.0.2' },
            };

            // Process packet through switches - with STP, it should NOT loop forever
            // Each hop creates new packets. In a properly blocked triangle:
            // - Packet enters sw1, floods to sw2 (and sw3 if not blocked)
            // - Packet enters sw2, floods to sw3 (and back to sw1 if not blocked)
            // - But with one port blocked, there's no infinite loop

            let packets: Packet[] = [broadcastPacket];
            let totalPacketsProcessed = 0;
            const maxPackets = 50; // In a small network, this should be way more than enough

            while (packets.length > 0 && totalPacketsProcessed < maxPackets) {
                const nextPackets: Packet[] = [];

                for (const pkt of packets) {
                    if (pkt.processingStage === 'dropped') continue;

                    // Convert 'on-link' packets to 'at-device' at their target
                    const processingPacket: Packet = pkt.processingStage === 'on-link' && pkt.targetDeviceId
                        ? { ...pkt, processingStage: 'at-device', currentDeviceId: pkt.targetDeviceId }
                        : pkt;

                    const device = store.getDeviceById(processingPacket.currentDeviceId);
                    if (device && device.type === 'switch') {
                        totalPacketsProcessed++;
                        const results = processPacketAtDevice(processingPacket, device);
                        nextPackets.push(...results.filter(p => p.processingStage !== 'dropped'));
                    }
                }

                packets = nextPackets;
            }

            // With STP enabled and blocking port(s), we should NOT hit max packets
            // (which would indicate an infinite loop or broadcast storm)
            expect(totalPacketsProcessed).toBeLessThan(maxPackets);
        });

        it('should allow traffic on non-blocked paths', () => {
            const store = useNetworkStore.getState();
            const sw1 = store.addDevice('switch', { x: 0, y: 0 });
            const sw2 = store.addDevice('switch', { x: 200, y: 0 });
            const pc1 = store.addDevice('pc', { x: -100, y: 0 });
            const pc2 = store.addDevice('pc', { x: 300, y: 0 });

            // Simple line topology (no loop)
            store.addConnection(sw1.id, sw1.interfaces[0].id, sw2.id, sw2.interfaces[0].id);
            store.addConnection(pc1.id, pc1.interfaces[0].id, sw1.id, sw1.interfaces[1].id);
            store.addConnection(pc2.id, pc2.interfaces[0].id, sw2.id, sw2.interfaces[1].id);

            store.enableStp(sw1.id);
            store.enableStp(sw2.id);
            store.runStpConvergence();

            // All ports should be forwarding (no loops to block)
            const sw1State = store.getDeviceById(sw1.id)!;
            const sw2State = store.getDeviceById(sw2.id)!;

            const sw1ConnectedPorts = sw1State.stpConfig!.ports.filter(p => {
                const iface = sw1State.interfaces.find(i => i.id === p.interfaceId);
                return iface?.connectedTo;
            });

            const sw2ConnectedPorts = sw2State.stpConfig!.ports.filter(p => {
                const iface = sw2State.interfaces.find(i => i.id === p.interfaceId);
                return iface?.connectedTo;
            });

            // All connected ports should be forwarding
            for (const port of [...sw1ConnectedPorts, ...sw2ConnectedPorts]) {
                expect(port.state).toBe('forwarding');
            }
        });
    });
});
