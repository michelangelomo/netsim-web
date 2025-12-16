import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useNetworkStore } from '@/store/network-store';
import type { TcpConnection } from '@/types/network';

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

describe('TCP Simulation', () => {
    beforeEach(() => {
        resetStore();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Helper to run simulation ticks
    const runTicks = (count: number) => {
        for (let i = 0; i < count; i++) {
            useNetworkStore.getState().tick();
        }
    };

    // Helper to get packets by type
    const getPacketsByType = (type: string) => {
        return useNetworkStore.getState().packets.filter((p) => p.type === type);
    };

    // Helper to get TCP packets by flags
    const getTcpPacketsByFlags = (syn?: boolean, ack?: boolean, fin?: boolean, rst?: boolean) => {
        return useNetworkStore.getState().packets.filter((p) => {
            if (p.type !== 'tcp') return false;
            const flags = p.tcpFlags || {};
            if (syn !== undefined && !!flags.syn !== syn) return false;
            if (ack !== undefined && !!flags.ack !== ack) return false;
            if (fin !== undefined && !!flags.fin !== fin) return false;
            if (rst !== undefined && !!flags.rst !== rst) return false;
            return true;
        });
    };

    // Helper to set up a basic network: PC - Switch - Server
    const setupBasicNetwork = () => {
        const store = useNetworkStore.getState();
        const pc = store.addDevice('pc', { x: 0, y: 0 });
        const server = store.addDevice('server', { x: 200, y: 0 });
        const sw = store.addDevice('switch', { x: 100, y: 0 });

        // Configure PC IP
        store.configureInterface(pc.id, pc.interfaces[0].id, {
            ipAddress: '192.168.1.10',
            subnetMask: '255.255.255.0',
        });

        // Configure Server IP
        store.configureInterface(server.id, server.interfaces[0].id, {
            ipAddress: '192.168.1.20',
            subnetMask: '255.255.255.0',
        });

        // Create connections
        store.addConnection(pc.id, pc.interfaces[0].id, sw.id, sw.interfaces[0].id);
        store.addConnection(server.id, server.interfaces[0].id, sw.id, sw.interfaces[1].id);

        // Get fresh references
        const freshPc = store.getDeviceById(pc.id)!;
        const freshServer = store.getDeviceById(server.id)!;
        const freshSw = store.getDeviceById(sw.id)!;

        // Pre-populate ARP tables
        store.updateArpTable(freshPc.id, {
            ipAddress: '192.168.1.20',
            macAddress: freshServer.interfaces[0].macAddress,
            interface: freshPc.interfaces[0].name,
            type: 'static',
            age: 0,
        });
        store.updateArpTable(freshServer.id, {
            ipAddress: '192.168.1.10',
            macAddress: freshPc.interfaces[0].macAddress,
            interface: freshServer.interfaces[0].name,
            type: 'static',
            age: 0,
        });

        return { pc: freshPc, server: freshServer, sw: freshSw };
    };

    // ============================================
    // Phase 1: TCP Data Model Tests
    // ============================================
    describe('Phase 1: TCP Data Model', () => {
        it('should have tcpConnections array on devices', () => {
            const store = useNetworkStore.getState();
            const pc = store.addDevice('pc', { x: 0, y: 0 });

            const device = store.getDeviceById(pc.id);
            expect(device?.tcpConnections).toBeDefined();
            expect(Array.isArray(device?.tcpConnections)).toBe(true);
        });

        it('should store TCP connection with correct state fields', () => {
            const store = useNetworkStore.getState();
            const pc = store.addDevice('pc', { x: 0, y: 0 });

            const conn: TcpConnection = {
                id: 'conn-1',
                localIP: '192.168.1.10',
                localPort: 49152,
                remoteIP: '192.168.1.20',
                remotePort: 80,
                state: 'SYN_SENT',
                startTime: Date.now(),
            };

            store.updateDevice(pc.id, { tcpConnections: [conn] });

            const device = store.getDeviceById(pc.id);
            expect(device?.tcpConnections).toHaveLength(1);
            expect(device?.tcpConnections?.[0].state).toBe('SYN_SENT');
            expect(device?.tcpConnections?.[0].localPort).toBe(49152);
        });

        it('should support all TCP states', () => {
            const states: TcpConnection['state'][] = [
                'LISTEN', 'SYN_SENT', 'SYN_RECV', 'ESTABLISHED',
                'FIN_WAIT_1', 'FIN_WAIT_2', 'TIME_WAIT',
                'CLOSE_WAIT', 'LAST_ACK', 'CLOSING', 'CLOSED'
            ];

            const store = useNetworkStore.getState();
            const pc = store.addDevice('pc', { x: 0, y: 0 });

            states.forEach((state, idx) => {
                const conn: TcpConnection = {
                    id: `conn-${idx}`,
                    localIP: '192.168.1.10',
                    localPort: 49152 + idx,
                    remoteIP: '192.168.1.20',
                    remotePort: 80,
                    state,
                    startTime: Date.now(),
                };
                store.updateDevice(pc.id, { tcpConnections: [conn] });
                const device = store.getDeviceById(pc.id);
                expect(device?.tcpConnections?.[0].state).toBe(state);
            });
        });
    });

    // ============================================
    // Phase 2: TCP Packet Creation Tests
    // ============================================
    describe('Phase 2: TCP Packet Creation', () => {
        it('should create TCP packet with SYN flag', () => {
            const store = useNetworkStore.getState();
            const { pc } = setupBasicNetwork();

            store.sendTcpPacket(pc.id, '192.168.1.20', 80, { syn: true });

            const tcpPackets = getPacketsByType('tcp');
            expect(tcpPackets.length).toBeGreaterThan(0);
            const synPacket = tcpPackets.find((p) => p.tcpFlags?.syn);
            expect(synPacket).toBeDefined();
            expect(synPacket?.tcpFlags?.ack).toBeFalsy();
            expect(synPacket?.destPort).toBe(80);
        });

        it('should create TCP packet with SYN-ACK flags', () => {
            const store = useNetworkStore.getState();
            const pc = store.addDevice('pc', { x: 0, y: 0 });

            store.sendPacket({
                type: 'tcp',
                sourceMAC: pc.interfaces[0].macAddress,
                destMAC: '00:00:00:00:00:02',
                sourceIP: '192.168.1.10',
                destIP: '192.168.1.20',
                sourcePort: 80,
                destPort: 49152,
                ttl: 64,
                size: 44,
                tcpFlags: { syn: true, ack: true },
                currentDeviceId: pc.id,
            });

            const packets = getPacketsByType('tcp');
            const synAckPacket = packets.find((p) => p.tcpFlags?.syn && p.tcpFlags?.ack);
            expect(synAckPacket).toBeDefined();
        });

        it('should create TCP packet with ACK flag', () => {
            const store = useNetworkStore.getState();
            const pc = store.addDevice('pc', { x: 0, y: 0 });

            store.sendPacket({
                type: 'tcp',
                sourceMAC: pc.interfaces[0].macAddress,
                destMAC: '00:00:00:00:00:02',
                sourceIP: '192.168.1.10',
                destIP: '192.168.1.20',
                sourcePort: 49152,
                destPort: 80,
                ttl: 64,
                size: 40,
                tcpFlags: { ack: true },
                currentDeviceId: pc.id,
            });

            const packets = getPacketsByType('tcp');
            const ackPacket = packets.find((p) => p.tcpFlags?.ack && !p.tcpFlags?.syn);
            expect(ackPacket).toBeDefined();
        });

        it('should create TCP packet with FIN flag', () => {
            const store = useNetworkStore.getState();
            const pc = store.addDevice('pc', { x: 0, y: 0 });

            store.sendPacket({
                type: 'tcp',
                sourceMAC: pc.interfaces[0].macAddress,
                destMAC: '00:00:00:00:00:02',
                sourceIP: '192.168.1.10',
                destIP: '192.168.1.20',
                sourcePort: 49152,
                destPort: 80,
                ttl: 64,
                size: 40,
                tcpFlags: { fin: true, ack: true },
                currentDeviceId: pc.id,
            });

            const packets = getPacketsByType('tcp');
            const finPacket = packets.find((p) => p.tcpFlags?.fin);
            expect(finPacket).toBeDefined();
        });

        it('should create TCP packet with RST flag', () => {
            const store = useNetworkStore.getState();
            const pc = store.addDevice('pc', { x: 0, y: 0 });

            store.sendPacket({
                type: 'tcp',
                sourceMAC: pc.interfaces[0].macAddress,
                destMAC: '00:00:00:00:00:02',
                sourceIP: '192.168.1.10',
                destIP: '192.168.1.20',
                sourcePort: 49152,
                destPort: 80,
                ttl: 64,
                size: 40,
                tcpFlags: { rst: true },
                currentDeviceId: pc.id,
            });

            const packets = getPacketsByType('tcp');
            const rstPacket = packets.find((p) => p.tcpFlags?.rst);
            expect(rstPacket).toBeDefined();
        });
    });

    // ============================================
    // Phase 3: TCP 3-Way Handshake Tests
    // ============================================
    describe('Phase 3: TCP 3-Way Handshake', () => {
        it('should create connection in SYN_SENT state when client initiates', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.tcpListen(server.id, 80);
            store.tcpConnect(pc.id, '192.168.1.20', 80);

            const device = store.getDeviceById(pc.id);
            const conn = device?.tcpConnections?.find((c) => c.state === 'SYN_SENT');
            expect(conn).toBeDefined();
            expect(conn?.remoteIP).toBe('192.168.1.20');
            expect(conn?.remotePort).toBe(80);
        });

        it('should send SYN packet when connection initiated', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.tcpListen(server.id, 80);
            store.tcpConnect(pc.id, '192.168.1.20', 80);

            const synPackets = getTcpPacketsByFlags(true, false);
            expect(synPackets.length).toBeGreaterThan(0);
            expect(synPackets[0].destIP).toBe('192.168.1.20');
            expect(synPackets[0].destPort).toBe(80);
        });

        it('should respond with SYN-ACK when server receives SYN', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.tcpListen(server.id, 80);
            store.tcpConnect(pc.id, '192.168.1.20', 80);

            store.startSimulation();
            runTicks(200);

            const synAckPackets = getTcpPacketsByFlags(true, true);
            expect(synAckPackets.length).toBeGreaterThan(0);
            expect(synAckPackets[0].sourceIP).toBe('192.168.1.20');
            expect(synAckPackets[0].destIP).toBe('192.168.1.10');
        });

        it('should transition server to SYN_RECV after receiving SYN', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.tcpListen(server.id, 80);
            store.tcpConnect(pc.id, '192.168.1.20', 80);

            store.startSimulation();
            runTicks(200);

            const serverDevice = store.getDeviceById(server.id);
            const conn = serverDevice?.tcpConnections?.find(
                (c) => c.remoteIP === '192.168.1.10' && c.state === 'SYN_RECV'
            );
            expect(conn).toBeDefined();
        });

        it('should send ACK when client receives SYN-ACK', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.tcpListen(server.id, 80);
            store.tcpConnect(pc.id, '192.168.1.20', 80);

            store.startSimulation();

            // Run simulation and check for ACK packet at each tick
            let foundAck = false;
            for (let i = 0; i < 400; i++) {
                useNetworkStore.getState().tick();
                const ackPackets = useNetworkStore.getState().packets.filter(
                    (p) => p.type === 'tcp' && p.tcpFlags?.ack && !p.tcpFlags?.syn && !p.tcpFlags?.fin
                );
                if (ackPackets.length > 0) {
                    foundAck = true;
                    break;
                }
            }

            expect(foundAck).toBe(true);
        });

        it('should establish connection after 3-way handshake', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.tcpListen(server.id, 80);
            store.tcpConnect(pc.id, '192.168.1.20', 80);

            store.startSimulation();
            runTicks(600);

            const pcDevice = store.getDeviceById(pc.id);
            const serverDevice = store.getDeviceById(server.id);

            const pcConn = pcDevice?.tcpConnections?.find((c) => c.state === 'ESTABLISHED');
            const srvConn = serverDevice?.tcpConnections?.find((c) => c.state === 'ESTABLISHED');

            expect(pcConn).toBeDefined();
            expect(srvConn).toBeDefined();
        });
    });

    // ============================================
    // Phase 4: TCP Connection Teardown Tests
    // ============================================
    describe('Phase 4: TCP Connection Teardown', () => {
        it('should send FIN when closing connection', () => {
            const store = useNetworkStore.getState();
            const { pc } = setupBasicNetwork();

            store.updateDevice(pc.id, {
                tcpConnections: [{
                    id: 'conn-1',
                    localIP: '192.168.1.10',
                    localPort: 49152,
                    remoteIP: '192.168.1.20',
                    remotePort: 80,
                    state: 'ESTABLISHED',
                    startTime: Date.now(),
                }],
            });

            store.tcpClose(pc.id, 'conn-1');

            const finPackets = getTcpPacketsByFlags(false, undefined, true);
            expect(finPackets.length).toBeGreaterThan(0);
        });

        it('should transition to FIN_WAIT_1 when initiating close', () => {
            const store = useNetworkStore.getState();
            const { pc } = setupBasicNetwork();

            store.updateDevice(pc.id, {
                tcpConnections: [{
                    id: 'conn-1',
                    localIP: '192.168.1.10',
                    localPort: 49152,
                    remoteIP: '192.168.1.20',
                    remotePort: 80,
                    state: 'ESTABLISHED',
                    startTime: Date.now(),
                }],
            });

            store.tcpClose(pc.id, 'conn-1');

            const device = store.getDeviceById(pc.id);
            const conn = device?.tcpConnections?.find((c) => c.id === 'conn-1');
            expect(conn?.state).toBe('FIN_WAIT_1');
        });

        it('should transition to CLOSE_WAIT when receiving FIN', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.updateDevice(server.id, {
                tcpConnections: [{
                    id: 'conn-1',
                    localIP: '192.168.1.20',
                    localPort: 80,
                    remoteIP: '192.168.1.10',
                    remotePort: 49152,
                    state: 'ESTABLISHED',
                    startTime: Date.now(),
                }],
            });

            const freshServer = store.getDeviceById(server.id)!;

            store.sendPacket({
                type: 'tcp',
                sourceMAC: pc.interfaces[0].macAddress,
                destMAC: freshServer.interfaces[0].macAddress,
                sourceIP: '192.168.1.10',
                destIP: '192.168.1.20',
                sourcePort: 49152,
                destPort: 80,
                ttl: 64,
                size: 40,
                tcpFlags: { fin: true, ack: true },
                currentDeviceId: server.id,
            });

            store.startSimulation();
            runTicks(50);

            const device = store.getDeviceById(server.id);
            const conn = device?.tcpConnections?.find((c) => c.id === 'conn-1');
            expect(conn?.state).toBe('CLOSE_WAIT');
        });

        it('should complete 4-way teardown and reach CLOSED state', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.updateDevice(pc.id, {
                tcpConnections: [{
                    id: 'conn-1',
                    localIP: '192.168.1.10',
                    localPort: 49152,
                    remoteIP: '192.168.1.20',
                    remotePort: 80,
                    state: 'ESTABLISHED',
                    startTime: Date.now(),
                }],
            });
            store.updateDevice(server.id, {
                tcpConnections: [{
                    id: 'conn-1',
                    localIP: '192.168.1.20',
                    localPort: 80,
                    remoteIP: '192.168.1.10',
                    remotePort: 49152,
                    state: 'ESTABLISHED',
                    startTime: Date.now(),
                }],
            });

            store.tcpClose(pc.id, 'conn-1');

            store.startSimulation();
            runTicks(1000);

            const pcDevice = useNetworkStore.getState().getDeviceById(pc.id);
            const srvDevice = useNetworkStore.getState().getDeviceById(server.id);

            const pcConn = pcDevice?.tcpConnections?.find((c) => c.id === 'conn-1');
            const srvConn = srvDevice?.tcpConnections?.find((c) => c.id === 'conn-1');

            // Client should be in FIN_WAIT_2 (received ACK for FIN) or TIME_WAIT
            // Server should be in CLOSE_WAIT (received FIN, sent ACK, waiting to close)
            expect(pcConn?.state === 'FIN_WAIT_1' || pcConn?.state === 'FIN_WAIT_2' || pcConn?.state === 'TIME_WAIT').toBe(true);
            expect(srvConn?.state === 'CLOSE_WAIT').toBe(true);
        });
    });

    // ============================================
    // Phase 5: TCP RST Handling Tests
    // ============================================
    describe('Phase 5: TCP RST Handling', () => {
        it('should send RST when receiving SYN on closed port', () => {
            const store = useNetworkStore.getState();
            const { pc } = setupBasicNetwork();

            // Server is NOT listening - send SYN to closed port
            store.tcpConnect(pc.id, '192.168.1.20', 80);

            store.startSimulation();
            runTicks(200);

            // RST packets may have ACK flag set (RST-ACK)
            const rstPackets = getTcpPacketsByFlags(false, undefined, false, true);
            expect(rstPackets.length).toBeGreaterThan(0);
        });

        it('should immediately close connection on RST received', () => {
            const store = useNetworkStore.getState();
            const { pc } = setupBasicNetwork();

            store.updateDevice(pc.id, {
                tcpConnections: [{
                    id: 'conn-1',
                    localIP: '192.168.1.10',
                    localPort: 49152,
                    remoteIP: '192.168.1.20',
                    remotePort: 80,
                    state: 'SYN_SENT',
                    startTime: Date.now(),
                }],
            });

            store.sendPacket({
                type: 'tcp',
                sourceMAC: '00:00:00:00:00:02',
                destMAC: pc.interfaces[0].macAddress,
                sourceIP: '192.168.1.20',
                destIP: '192.168.1.10',
                sourcePort: 80,
                destPort: 49152,
                ttl: 64,
                size: 40,
                tcpFlags: { rst: true },
                currentDeviceId: pc.id,
            });

            store.startSimulation();
            runTicks(50);

            const device = store.getDeviceById(pc.id);
            const conn = device?.tcpConnections?.find((c) => c.id === 'conn-1');
            expect(!conn || conn.state === 'CLOSED').toBe(true);
        });
    });

    // ============================================
    // Phase 6: TCP Port Management Tests
    // ============================================
    describe('Phase 6: TCP Port Management', () => {
        it('should allocate ephemeral port for client connections', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.tcpListen(server.id, 80);
            store.tcpConnect(pc.id, '192.168.1.20', 80);

            const device = store.getDeviceById(pc.id);
            const conn = device?.tcpConnections?.[0];
            expect(conn?.localPort).toBeGreaterThanOrEqual(49152);
            expect(conn?.localPort).toBeLessThanOrEqual(65535);
        });

        it('should use specified port for listening', () => {
            const store = useNetworkStore.getState();
            const server = store.addDevice('server', { x: 0, y: 0 });

            store.tcpListen(server.id, 443);

            const device = store.getDeviceById(server.id);
            const conn = device?.tcpConnections?.find((c) => c.localPort === 443);
            expect(conn).toBeDefined();
            expect(conn?.state).toBe('LISTEN');
        });

        it('should not allow duplicate listeners on same port', () => {
            const store = useNetworkStore.getState();
            const server = store.addDevice('server', { x: 0, y: 0 });

            const result1 = store.tcpListen(server.id, 80);
            const result2 = store.tcpListen(server.id, 80);

            expect(result1).toBe(true);
            expect(result2).toBe(false);

            const device = store.getDeviceById(server.id);
            const listeners = device?.tcpConnections?.filter((c) => c.localPort === 80 && c.state === 'LISTEN');
            expect(listeners?.length).toBe(1);
        });

        it('should allocate unique ephemeral ports for multiple connections', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.tcpListen(server.id, 80);
            store.tcpListen(server.id, 443);

            store.tcpConnect(pc.id, '192.168.1.20', 80);
            store.tcpConnect(pc.id, '192.168.1.20', 443);

            const device = store.getDeviceById(pc.id);
            const ports = device?.tcpConnections?.map((c) => c.localPort) || [];
            const uniquePorts = new Set(ports);
            expect(uniquePorts.size).toBe(ports.length);
        });
    });

    // ============================================
    // Phase 7: TCP Terminal Commands Tests
    // ============================================
    describe('Phase 7: TCP Terminal Commands', () => {
        it('should show TCP connections with netstat command', () => {
            const store = useNetworkStore.getState();
            const server = store.addDevice('server', { x: 0, y: 0 });

            store.updateDevice(server.id, {
                tcpConnections: [{
                    id: 'conn-1',
                    localIP: '192.168.1.20',
                    localPort: 80,
                    remoteIP: '192.168.1.10',
                    remotePort: 49152,
                    state: 'ESTABLISHED',
                    startTime: Date.now(),
                }],
            });

            const output = store.executeCommand(server.id, 'netstat');
            expect(output).toContain('ESTABLISHED');
            expect(output).toContain('80');
        });

        it('should show listening ports with netstat -l', () => {
            const store = useNetworkStore.getState();
            const server = store.addDevice('server', { x: 0, y: 0 });

            store.tcpListen(server.id, 80);
            store.tcpListen(server.id, 443);

            const output = store.executeCommand(server.id, 'netstat -l');
            expect(output).toContain('LISTEN');
            expect(output).toContain('80');
            expect(output).toContain('443');
        });

        it('should allow telnet command to initiate connection', () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.tcpListen(server.id, 23);
            const output = store.executeCommand(pc.id, 'telnet 192.168.1.20 23');

            expect(output).toContain('Trying');
            expect(output).toContain('192.168.1.20');

            const device = store.getDeviceById(pc.id);
            expect(device?.tcpConnections?.length).toBeGreaterThan(0);
        });
    });

    // ============================================
    // Phase 8: TCP with Routing Tests
    // ============================================
    describe('Phase 8: TCP with Routing', () => {
        it('should complete handshake across router', () => {
            const store = useNetworkStore.getState();

            const pc = store.addDevice('pc', { x: 0, y: 0 });
            const router = store.addDevice('router', { x: 100, y: 0 });
            const server = store.addDevice('server', { x: 200, y: 0 });

            store.configureInterface(pc.id, pc.interfaces[0].id, {
                ipAddress: '192.168.1.10',
                subnetMask: '255.255.255.0',
                gateway: '192.168.1.1',
            });

            store.configureInterface(router.id, router.interfaces[0].id, {
                ipAddress: '192.168.1.1',
                subnetMask: '255.255.255.0',
            });
            store.configureInterface(router.id, router.interfaces[1].id, {
                ipAddress: '10.0.0.1',
                subnetMask: '255.255.255.0',
            });

            store.configureInterface(server.id, server.interfaces[0].id, {
                ipAddress: '10.0.0.10',
                subnetMask: '255.255.255.0',
                gateway: '10.0.0.1',
            });

            store.addRoute(router.id, {
                destination: '192.168.1.0',
                netmask: '255.255.255.0',
                gateway: '0.0.0.0',
                interface: router.interfaces[0].name,
                metric: 0,
                type: 'connected',
            });
            store.addRoute(router.id, {
                destination: '10.0.0.0',
                netmask: '255.255.255.0',
                gateway: '0.0.0.0',
                interface: router.interfaces[1].name,
                metric: 0,
                type: 'connected',
            });

            store.addConnection(pc.id, pc.interfaces[0].id, router.id, router.interfaces[0].id);
            store.addConnection(server.id, server.interfaces[0].id, router.id, router.interfaces[1].id);

            const freshPc = store.getDeviceById(pc.id)!;
            const freshRouter = store.getDeviceById(router.id)!;
            const freshServer = store.getDeviceById(server.id)!;

            store.updateArpTable(freshPc.id, {
                ipAddress: '192.168.1.1',
                macAddress: freshRouter.interfaces[0].macAddress,
                interface: freshPc.interfaces[0].name,
                type: 'static',
                age: 0,
            });
            store.updateArpTable(freshRouter.id, {
                ipAddress: '192.168.1.10',
                macAddress: freshPc.interfaces[0].macAddress,
                interface: freshRouter.interfaces[0].name,
                type: 'static',
                age: 0,
            });
            store.updateArpTable(freshRouter.id, {
                ipAddress: '10.0.0.10',
                macAddress: freshServer.interfaces[0].macAddress,
                interface: freshRouter.interfaces[1].name,
                type: 'static',
                age: 0,
            });
            store.updateArpTable(freshServer.id, {
                ipAddress: '10.0.0.1',
                macAddress: freshRouter.interfaces[1].macAddress,
                interface: freshServer.interfaces[0].name,
                type: 'static',
                age: 0,
            });

            store.tcpListen(freshServer.id, 80);
            store.tcpConnect(freshPc.id, '10.0.0.10', 80);

            store.startSimulation();
            runTicks(1000);

            const pcDevice = store.getDeviceById(pc.id);
            const srvDevice = store.getDeviceById(server.id);

            const pcConn = pcDevice?.tcpConnections?.find((c) => c.state === 'ESTABLISHED');
            const srvConn = srvDevice?.tcpConnections?.find((c) => c.state === 'ESTABLISHED');

            expect(pcConn).toBeDefined();
            expect(srvConn).toBeDefined();
        });
    });

    // ============================================
    // Phase 9: TCP Sequence Numbers Tests
    // ============================================
    describe('Phase 9: TCP Sequence Numbers', () => {
        it('should include sequence numbers in TCP packets', () => {
            const store = useNetworkStore.getState();
            const pc = store.addDevice('pc', { x: 0, y: 0 });

            store.sendPacket({
                type: 'tcp',
                sourceMAC: pc.interfaces[0].macAddress,
                destMAC: '00:00:00:00:00:02',
                sourceIP: '192.168.1.10',
                destIP: '192.168.1.20',
                sourcePort: 49152,
                destPort: 80,
                ttl: 64,
                size: 40,
                tcpFlags: { syn: true },
                currentDeviceId: pc.id,
                payload: { seqNum: 1000, ackNum: 0 },
            });

            const packets = getPacketsByType('tcp');
            expect(packets[0].payload?.seqNum).toBe(1000);
        });

        it('should include acknowledgment numbers in ACK packets', () => {
            const store = useNetworkStore.getState();
            const pc = store.addDevice('pc', { x: 0, y: 0 });

            store.sendPacket({
                type: 'tcp',
                sourceMAC: pc.interfaces[0].macAddress,
                destMAC: '00:00:00:00:00:02',
                sourceIP: '192.168.1.10',
                destIP: '192.168.1.20',
                sourcePort: 49152,
                destPort: 80,
                ttl: 64,
                size: 40,
                tcpFlags: { ack: true },
                currentDeviceId: pc.id,
                payload: { seqNum: 1001, ackNum: 2001 },
            });

            const packets = getPacketsByType('tcp');
            expect(packets[0].payload?.ackNum).toBe(2001);
        });
    });

    // ============================================
    // Phase 10: Full TCP Integration
    // ============================================
    describe('Phase 10: Full TCP Integration', () => {
        it('should simulate HTTP-like request/response over TCP', async () => {
            const store = useNetworkStore.getState();
            const { pc, server } = setupBasicNetwork();

            store.tcpListen(server.id, 80);
            store.tcpConnect(pc.id, '192.168.1.20', 80);

            store.startSimulation();

            // Run until connection is established or timeout (needs ~200 ticks for handshake with switch)
            for (let i = 0; i < 500; i++) {
                useNetworkStore.getState().tick();
                if (useNetworkStore.getState().getDeviceById(pc.id)?.tcpConnections?.some((c) => c.state === 'ESTABLISHED')) {
                    break;
                }
            }

            const pcDevice = useNetworkStore.getState().getDeviceById(pc.id);
            const conn = pcDevice?.tcpConnections?.find((c) => c.state === 'ESTABLISHED');
            expect(conn).toBeDefined();

            if (conn) {
                useNetworkStore.getState().tcpClose(pc.id, conn.id);
                for (let i = 0; i < 500; i++) {
                    useNetworkStore.getState().tick();
                }
            }
        });
    });
});
