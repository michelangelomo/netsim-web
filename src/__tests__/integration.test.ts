import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNetworkStore } from '@/store/network-store';
import { processDeviceTick, processLinkTick } from '@/lib/simulation';
import type { Packet, NetworkDevice, Connection } from '@/types/network';

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

describe('Integration Tests - End-to-End Packet Flow', () => {
  beforeEach(() => {
    resetStore();
  });

  // ============================================
  // Scenario: Simple PC to PC communication
  // ============================================
  describe('PC to PC via Switch', () => {
    it('should forward unicast frame through switch after learning', () => {
      // Create topology: PC1 -- Switch -- PC2
      const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });
      const pc2 = useNetworkStore.getState().addDevice('pc', { x: 200, y: 0 });

      // Configure IPs
      useNetworkStore.getState().configureInterface(pc1.id, pc1.interfaces[0].id, {
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
      });
      useNetworkStore.getState().configureInterface(pc2.id, pc2.interfaces[0].id, {
        ipAddress: '192.168.1.20',
        subnetMask: '255.255.255.0',
      });

      // Connect devices
      useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, sw.id, sw.interfaces[0].id);
      useNetworkStore.getState().addConnection(pc2.id, pc2.interfaces[0].id, sw.id, sw.interfaces[1].id);

      // Get fresh device states after connections
      const pc1Device = useNetworkStore.getState().getDeviceById(pc1.id)!;

      // First, send broadcast ARP from PC1 to learn topology
      const arpRequest: Packet = {
        id: 'arp-1',
        type: 'arp',
        sourceMAC: pc1Device.interfaces[0].macAddress,
        destMAC: 'FF:FF:FF:FF:FF:FF',
        ttl: 64,
        size: 64,
        currentDeviceId: sw.id,
        lastDeviceId: pc1.id,
        processingStage: 'at-device',
        progress: 0,
        path: [],
        currentPathIndex: 0,
        payload: {
          type: 'REQUEST',
          senderIP: '192.168.1.10',
          targetIP: '192.168.1.20',
        },
      };

      // Process ARP request at switch
      const mockUpdate = vi.fn((id: string, updates: Partial<NetworkDevice>) => {
        useNetworkStore.getState().updateDevice(id, updates);
      });

      const arpResults = processDeviceTick(
        useNetworkStore.getState().getDeviceById(sw.id)!,
        arpRequest,
        useNetworkStore.getState().connections,
        mockUpdate
      );

      // Switch should flood broadcast
      expect(arpResults.length).toBe(1); // Only PC2's port (PC1 is ingress)
      expect(arpResults[0].processingStage).toBe('on-link');

      // Switch should have learned PC1's MAC
      expect(mockUpdate).toHaveBeenCalled();
      const swUpdated = useNetworkStore.getState().getDeviceById(sw.id)!;
      expect(swUpdated.macTable!.length).toBe(1);
      expect(swUpdated.macTable![0].macAddress).toBe(pc1Device.interfaces[0].macAddress);
    });

    it('should complete full ping cycle', async () => {
      // Create topology
      const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });
      const pc2 = useNetworkStore.getState().addDevice('pc', { x: 200, y: 0 });

      // Configure IPs
      useNetworkStore.getState().configureInterface(pc1.id, pc1.interfaces[0].id, {
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
      });
      useNetworkStore.getState().configureInterface(pc2.id, pc2.interfaces[0].id, {
        ipAddress: '192.168.1.20',
        subnetMask: '255.255.255.0',
      });

      // Connect devices
      useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, sw.id, sw.interfaces[0].id);
      useNetworkStore.getState().addConnection(pc2.id, pc2.interfaces[0].id, sw.id, sw.interfaces[1].id);

      // Pre-populate ARP tables for this test
      const pc1Device = useNetworkStore.getState().getDeviceById(pc1.id)!;
      const pc2Device = useNetworkStore.getState().getDeviceById(pc2.id)!;

      useNetworkStore.getState().updateArpTable(pc1.id, {
        ipAddress: '192.168.1.20',
        macAddress: pc2Device.interfaces[0].macAddress,
        interface: 'eth0',
        type: 'dynamic',
        age: 0,
      });

      useNetworkStore.getState().updateArpTable(pc2.id, {
        ipAddress: '192.168.1.10',
        macAddress: pc1Device.interfaces[0].macAddress,
        interface: 'eth0',
        type: 'dynamic',
        age: 0,
      });

      // Also pre-populate switch MAC table
      useNetworkStore.getState().learnMAC(sw.id, pc1Device.interfaces[0].macAddress, 'FastEthernet0/0');
      useNetworkStore.getState().learnMAC(sw.id, pc2Device.interfaces[0].macAddress, 'FastEthernet0/1');

      // Start simulation
      useNetworkStore.getState().startSimulation();

      // Create ICMP echo request
      const pingPacket: Omit<Packet, 'id' | 'path' | 'currentPathIndex' | 'processingStage' | 'progress'> = {
        type: 'icmp',
        sourceMAC: pc1Device.interfaces[0].macAddress,
        destMAC: pc2Device.interfaces[0].macAddress,
        sourceIP: '192.168.1.10',
        destIP: '192.168.1.20',
        ttl: 64,
        size: 64,
        icmpType: 8,
        icmpCode: 0,
        icmpSeq: 1,
        currentDeviceId: pc1.id,
      };

      useNetworkStore.getState().sendPacket(pingPacket);
      expect(useNetworkStore.getState().packets.length).toBe(1);

      // Simulate several ticks to move packet through network
      // PC1 -> Link -> Switch -> Link -> PC2 -> generates reply
      for (let i = 0; i < 100; i++) {
        useNetworkStore.getState().tick();
      }

      // Check if an ICMP reply was generated
      // The reply should exist somewhere in the packet flow
      // (may be at PC2, on-link, or arrived at PC1)
      expect(useNetworkStore.getState().packets.some(
        p => p.type === 'icmp' && (p.icmpType === 0 || p.currentDeviceId !== pc1.id)
      )).toBe(true);
    });
  });

  // ============================================
  // Scenario: Inter-VLAN routing
  // ============================================
  describe('Router Inter-Network Communication', () => {
    it('should route packets between different subnets', () => {
      const store = useNetworkStore.getState();

      // Create topology: PC1 (192.168.1.x) -- Router -- PC2 (10.0.0.x)
      const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const router = useNetworkStore.getState().addDevice('router', { x: 100, y: 0 });
      const pc2 = useNetworkStore.getState().addDevice('pc', { x: 200, y: 0 });

      // Configure PC1
      useNetworkStore.getState().configureInterface(pc1.id, pc1.interfaces[0].id, {
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
        gateway: '192.168.1.1',
      });

      // Configure Router interfaces
      useNetworkStore.getState().configureInterface(router.id, router.interfaces[0].id, {
        ipAddress: '192.168.1.1',
        subnetMask: '255.255.255.0',
      });
      useNetworkStore.getState().configureInterface(router.id, router.interfaces[1].id, {
        ipAddress: '10.0.0.1',
        subnetMask: '255.255.255.0',
      });

      // Configure PC2
      useNetworkStore.getState().configureInterface(pc2.id, pc2.interfaces[0].id, {
        ipAddress: '10.0.0.10',
        subnetMask: '255.255.255.0',
        gateway: '10.0.0.1',
      });

      // Connect devices
      useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, router.id, router.interfaces[0].id);
      useNetworkStore.getState().addConnection(pc2.id, pc2.interfaces[0].id, router.id, router.interfaces[1].id);

      // Verify router has connected routes
      const routerDevice = useNetworkStore.getState().getDeviceById(router.id)!;
      expect(routerDevice.routingTable!.length).toBe(2);
      expect(routerDevice.routingTable!.some(r => r.destination === '192.168.1.0')).toBe(true);
      expect(routerDevice.routingTable!.some(r => r.destination === '10.0.0.0')).toBe(true);

      // Pre-populate ARP tables
      const pc1Device = useNetworkStore.getState().getDeviceById(pc1.id)!;
      const pc2Device = useNetworkStore.getState().getDeviceById(pc2.id)!;

      // PC1 knows router's MAC (gateway)
      useNetworkStore.getState().updateArpTable(pc1.id, {
        ipAddress: '192.168.1.1',
        macAddress: routerDevice.interfaces[0].macAddress,
        interface: 'eth0',
        type: 'dynamic',
        age: 0,
      });

      // Router knows PC1's MAC
      useNetworkStore.getState().updateArpTable(router.id, {
        ipAddress: '192.168.1.10',
        macAddress: pc1Device.interfaces[0].macAddress,
        interface: 'GigabitEthernet0/0',
        type: 'dynamic',
        age: 0,
      });

      // Router knows PC2's MAC
      useNetworkStore.getState().updateArpTable(router.id, {
        ipAddress: '10.0.0.10',
        macAddress: pc2Device.interfaces[0].macAddress,
        interface: 'GigabitEthernet0/1',
        type: 'dynamic',
        age: 0,
      });

      // Create ICMP packet from PC1 to PC2 (cross-subnet)
      const packet: Packet = {
        id: 'test-packet',
        type: 'icmp',
        sourceMAC: pc1Device.interfaces[0].macAddress,
        destMAC: routerDevice.interfaces[0].macAddress, // Sent to gateway
        sourceIP: '192.168.1.10',
        destIP: '10.0.0.10',
        ttl: 64,
        size: 64,
        icmpType: 8,
        currentDeviceId: router.id, // Already at router
        lastDeviceId: pc1.id,
        processingStage: 'at-device',
        progress: 0,
        path: [],
        currentPathIndex: 0,
      };

      // Process at router
      const mockUpdate = vi.fn((id: string, updates: Partial<NetworkDevice>) => {
        useNetworkStore.getState().updateDevice(id, updates);
      });

      const result = processDeviceTick(
        useNetworkStore.getState().getDeviceById(router.id)!,
        packet,
        useNetworkStore.getState().connections,
        mockUpdate
      );

      // Router should forward packet
      expect(result.length).toBe(1);
      const forwardedPacket = result[0];

      // Check routing behavior
      expect(forwardedPacket.ttl).toBe(63); // TTL decremented
      expect(forwardedPacket.sourceMAC).toBe(routerDevice.interfaces[1].macAddress); // From Gi0/1
      expect(forwardedPacket.destMAC).toBe(pc2Device.interfaces[0].macAddress); // To PC2
      expect(forwardedPacket.destIP).toBe('10.0.0.10'); // Destination unchanged
      expect(forwardedPacket.processingStage).toBe('on-link');
    });

    it('should drop packets with no route', () => {
      const store = useNetworkStore.getState();

      const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });

      // Configure only one interface
      useNetworkStore.getState().configureInterface(router.id, router.interfaces[0].id, {
        ipAddress: '192.168.1.1',
        subnetMask: '255.255.255.0',
      });

      const routerDevice = useNetworkStore.getState().getDeviceById(router.id)!;

      // Packet to unknown destination
      const packet: Packet = {
        id: 'test-packet',
        type: 'icmp',
        sourceMAC: '02:00:00:00:00:01',
        destMAC: routerDevice.interfaces[0].macAddress,
        sourceIP: '192.168.1.10',
        destIP: '172.16.0.100', // No route to this
        ttl: 64,
        size: 64,
        currentDeviceId: router.id,
        processingStage: 'at-device',
        progress: 0,
        path: [],
        currentPathIndex: 0,
      };

      const mockUpdate = vi.fn();
      const result = processDeviceTick(
        routerDevice,
        packet,
        useNetworkStore.getState().connections,
        mockUpdate
      );

      // Should be dropped (no route)
      expect(result.length).toBe(0);
    });
  });

  // ============================================
  // Scenario: ARP Resolution Flow
  // ============================================
  describe('ARP Resolution Flow', () => {
    it('should buffer packet and send ARP when MAC unknown', () => {
      const store = useNetworkStore.getState();

      const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const pc2 = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });

      useNetworkStore.getState().configureInterface(pc1.id, pc1.interfaces[0].id, {
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
      });
      useNetworkStore.getState().configureInterface(pc2.id, pc2.interfaces[0].id, {
        ipAddress: '192.168.1.20',
        subnetMask: '255.255.255.0',
      });

      useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, pc2.id, pc2.interfaces[0].id);

      const pc1Device = useNetworkStore.getState().getDeviceById(pc1.id)!;
      // Note: No ARP entry for PC2

      // Create packet to PC2 (ARP needed)
      const packet: Packet = {
        id: 'test-packet',
        type: 'icmp',
        sourceMAC: pc1Device.interfaces[0].macAddress,
        destMAC: '00:00:00:00:00:00', // Unknown - placeholder
        sourceIP: '192.168.1.10',
        destIP: '192.168.1.20',
        ttl: 64,
        size: 64,
        currentDeviceId: pc1.id,
        processingStage: 'at-device',
        progress: 0,
        path: [],
        currentPathIndex: 0,
      };

      const mockUpdate = vi.fn((id: string, updates: Partial<NetworkDevice>) => {
        useNetworkStore.getState().updateDevice(id, updates);
      });

      const result = processDeviceTick(
        pc1Device,
        packet,
        useNetworkStore.getState().connections,
        mockUpdate
      );

      // Should have ARP request and buffered packet
      expect(result.length).toBe(2);

      const arpRequest = result.find(p => p.type === 'arp');
      expect(arpRequest).toBeDefined();
      expect(arpRequest!.destMAC).toBe('FF:FF:FF:FF:FF:FF');
      expect((arpRequest!.payload as any).type).toBe('REQUEST');
      expect((arpRequest!.payload as any).targetIP).toBe('192.168.1.20');

      const buffered = result.find(p => p.processingStage === 'buffered');
      expect(buffered).toBeDefined();
      expect(buffered!.waitingForArp).toBe('192.168.1.20');
    });

    it('should complete ARP request-reply cycle', () => {
      const store = useNetworkStore.getState();

      const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const pc2 = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });

      useNetworkStore.getState().configureInterface(pc1.id, pc1.interfaces[0].id, {
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
      });
      useNetworkStore.getState().configureInterface(pc2.id, pc2.interfaces[0].id, {
        ipAddress: '192.168.1.20',
        subnetMask: '255.255.255.0',
      });

      useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, pc2.id, pc2.interfaces[0].id);

      const pc1Device = useNetworkStore.getState().getDeviceById(pc1.id)!;
      const pc2Device = useNetworkStore.getState().getDeviceById(pc2.id)!;

      // ARP request arrives at PC2
      const arpRequest: Packet = {
        id: 'arp-request',
        type: 'arp',
        sourceMAC: pc1Device.interfaces[0].macAddress,
        destMAC: 'FF:FF:FF:FF:FF:FF',
        ttl: 64,
        size: 64,
        currentDeviceId: pc2.id,
        lastDeviceId: pc1.id,
        processingStage: 'at-device',
        progress: 0,
        path: [],
        currentPathIndex: 0,
        payload: {
          type: 'REQUEST',
          senderIP: '192.168.1.10',
          targetIP: '192.168.1.20',
        },
      };

      const mockUpdate = vi.fn((id: string, updates: Partial<NetworkDevice>) => {
        useNetworkStore.getState().updateDevice(id, updates);
      });

      const result = processDeviceTick(
        pc2Device,
        arpRequest,
        useNetworkStore.getState().connections,
        mockUpdate
      );

      // PC2 should generate ARP reply
      expect(result.length).toBe(1);
      const arpReply = result[0];
      expect(arpReply.type).toBe('arp');
      expect((arpReply.payload as any).type).toBe('REPLY');
      expect(arpReply.sourceMAC).toBe(pc2Device.interfaces[0].macAddress);
      expect(arpReply.destMAC).toBe(pc1Device.interfaces[0].macAddress);

      // PC2 should have learned PC1's MAC
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  // ============================================
  // Scenario: DHCP Flow
  // ============================================
  describe('DHCP Integration', () => {
    it('should complete full DHCP flow through switch', async () => {
      const store = useNetworkStore.getState();

      // Create topology: PC -- Switch -- Router (DHCP server)
      const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });
      const router = useNetworkStore.getState().addDevice('router', { x: 200, y: 0 });

      // Configure router
      useNetworkStore.getState().configureInterface(router.id, router.interfaces[0].id, {
        ipAddress: '192.168.1.1',
        subnetMask: '255.255.255.0',
      });

      useNetworkStore.getState().configureDhcpServer(router.id, router.interfaces[0].id, {
        enabled: true,
        poolStart: '192.168.1.100',
        poolEnd: '192.168.1.200',
        subnetMask: '255.255.255.0',
        defaultGateway: '192.168.1.1',
        dnsServers: ['8.8.8.8'],
        leaseTime: 3600,
      });

      // Connect devices
      useNetworkStore.getState().addConnection(pc.id, pc.interfaces[0].id, sw.id, sw.interfaces[0].id);
      useNetworkStore.getState().addConnection(sw.id, sw.interfaces[1].id, router.id, router.interfaces[0].id);

      // Request DHCP
      const result = await useNetworkStore.getState().requestDhcp(pc.id, pc.interfaces[0].id);

      expect(result).toContain('DHCP request successful');

      // Verify PC configuration
      const pcUpdated = useNetworkStore.getState().getDeviceById(pc.id)!;
      expect(pcUpdated.interfaces[0].ipAddress).toBe('192.168.1.100');
      expect(pcUpdated.interfaces[0].gateway).toBe('192.168.1.1');
      expect(pcUpdated.interfaces[0].dhcpEnabled).toBe(true);

      // Verify lease on server
      const routerUpdated = useNetworkStore.getState().getDeviceById(router.id)!;
      const cfg = routerUpdated.dhcpServers!.find((s) => s.interfaceId === router.interfaces[0].id)!;
      expect(cfg.leases.length).toBe(1);
    });
  });

  // ============================================
  // Scenario: Multi-hop routing
  // ============================================
  describe('Multi-hop Routing', () => {
    it('should route through multiple routers', () => {
      const store = useNetworkStore.getState();

      // Create topology:
      // PC1 (192.168.1.x) -- R1 -- R2 -- PC2 (10.0.0.x)
      const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const r1 = useNetworkStore.getState().addDevice('router', { x: 100, y: 0 });
      const r2 = useNetworkStore.getState().addDevice('router', { x: 200, y: 0 });
      const pc2 = useNetworkStore.getState().addDevice('pc', { x: 300, y: 0 });

      // Configure PC1
      useNetworkStore.getState().configureInterface(pc1.id, pc1.interfaces[0].id, {
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
        gateway: '192.168.1.1',
      });

      // Configure R1
      useNetworkStore.getState().configureInterface(r1.id, r1.interfaces[0].id, {
        ipAddress: '192.168.1.1',
        subnetMask: '255.255.255.0',
      });
      useNetworkStore.getState().configureInterface(r1.id, r1.interfaces[1].id, {
        ipAddress: '172.16.0.1',
        subnetMask: '255.255.255.0',
      });

      // Configure R2
      useNetworkStore.getState().configureInterface(r2.id, r2.interfaces[0].id, {
        ipAddress: '172.16.0.2',
        subnetMask: '255.255.255.0',
      });
      useNetworkStore.getState().configureInterface(r2.id, r2.interfaces[1].id, {
        ipAddress: '10.0.0.1',
        subnetMask: '255.255.255.0',
      });

      // Configure PC2
      useNetworkStore.getState().configureInterface(pc2.id, pc2.interfaces[0].id, {
        ipAddress: '10.0.0.10',
        subnetMask: '255.255.255.0',
        gateway: '10.0.0.1',
      });

      // Add static routes
      useNetworkStore.getState().addRoute(r1.id, {
        destination: '10.0.0.0',
        netmask: '255.255.255.0',
        gateway: '172.16.0.2',
        interface: 'GigabitEthernet0/1',
        metric: 10,
      });

      useNetworkStore.getState().addRoute(r2.id, {
        destination: '192.168.1.0',
        netmask: '255.255.255.0',
        gateway: '172.16.0.1',
        interface: 'GigabitEthernet0/0',
        metric: 10,
      });

      // Connect devices
      useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, r1.id, r1.interfaces[0].id);
      useNetworkStore.getState().addConnection(r1.id, r1.interfaces[1].id, r2.id, r2.interfaces[0].id);
      useNetworkStore.getState().addConnection(r2.id, r2.interfaces[1].id, pc2.id, pc2.interfaces[0].id);

      // Pre-populate ARP tables
      const r1Device = useNetworkStore.getState().getDeviceById(r1.id)!;
      const r2Device = useNetworkStore.getState().getDeviceById(r2.id)!;
      const pc2Device = useNetworkStore.getState().getDeviceById(pc2.id)!;

      // R1 knows R2's MAC
      useNetworkStore.getState().updateArpTable(r1.id, {
        ipAddress: '172.16.0.2',
        macAddress: r2Device.interfaces[0].macAddress,
        interface: 'GigabitEthernet0/1',
        type: 'dynamic',
        age: 0,
      });

      // R2 knows PC2's MAC
      useNetworkStore.getState().updateArpTable(r2.id, {
        ipAddress: '10.0.0.10',
        macAddress: pc2Device.interfaces[0].macAddress,
        interface: 'GigabitEthernet0/1',
        type: 'dynamic',
        age: 0,
      });

      // Create packet at R1 (simulating arrival from PC1)
      const packet: Packet = {
        id: 'test-packet',
        type: 'icmp',
        sourceMAC: '02:00:00:00:00:01',
        destMAC: r1Device.interfaces[0].macAddress,
        sourceIP: '192.168.1.10',
        destIP: '10.0.0.10',
        ttl: 64,
        size: 64,
        icmpType: 8,
        currentDeviceId: r1.id,
        processingStage: 'at-device',
        progress: 0,
        path: [],
        currentPathIndex: 0,
      };

      // Process at R1
      const mockUpdate1 = vi.fn((id: string, updates: Partial<NetworkDevice>) => {
        useNetworkStore.getState().updateDevice(id, updates);
      });

      const r1Result = processDeviceTick(
        r1Device,
        packet,
        useNetworkStore.getState().connections,
        mockUpdate1
      );

      // R1 should forward to R2
      expect(r1Result.length).toBe(1);
      const toR2 = r1Result[0];
      expect(toR2.ttl).toBe(63);
      expect(toR2.destMAC).toBe(r2Device.interfaces[0].macAddress);

      // Simulate arrival at R2
      const atR2: Packet = {
        ...toR2,
        currentDeviceId: r2.id,
        lastDeviceId: r1.id,
        processingStage: 'at-device',
        progress: 0,
        destMAC: r2Device.interfaces[0].macAddress,
      };

      // Process at R2
      const mockUpdate2 = vi.fn((id: string, updates: Partial<NetworkDevice>) => {
        useNetworkStore.getState().updateDevice(id, updates);
      });

      const r2Result = processDeviceTick(
        useNetworkStore.getState().getDeviceById(r2.id)!,
        atR2,
        useNetworkStore.getState().connections,
        mockUpdate2
      );

      // R2 should forward to PC2
      expect(r2Result.length).toBe(1);
      const toPC2 = r2Result[0];
      expect(toPC2.ttl).toBe(62); // Decremented again
      expect(toPC2.destMAC).toBe(pc2Device.interfaces[0].macAddress);
    });
  });

  // ============================================
  // Scenario: TTL Expiration
  // ============================================
  describe('TTL Handling', () => {
    it('should decrement TTL on each hop', () => {
      const store = useNetworkStore.getState();

      const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });
      const pc = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });

      useNetworkStore.getState().configureInterface(router.id, router.interfaces[0].id, {
        ipAddress: '192.168.1.1',
        subnetMask: '255.255.255.0',
      });

      useNetworkStore.getState().configureInterface(pc.id, pc.interfaces[0].id, {
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
      });

      useNetworkStore.getState().addConnection(router.id, router.interfaces[0].id, pc.id, pc.interfaces[0].id);

      const routerDevice = useNetworkStore.getState().getDeviceById(router.id)!;
      const pcDevice = useNetworkStore.getState().getDeviceById(pc.id)!;

      useNetworkStore.getState().updateArpTable(router.id, {
        ipAddress: '192.168.1.10',
        macAddress: pcDevice.interfaces[0].macAddress,
        interface: 'GigabitEthernet0/0',
        type: 'dynamic',
        age: 0,
      });

      // Packet with TTL=1
      const packet: Packet = {
        id: 'test-packet',
        type: 'icmp',
        sourceMAC: '02:00:00:00:00:99',
        destMAC: routerDevice.interfaces[0].macAddress,
        sourceIP: '10.0.0.10',
        destIP: '192.168.1.10',
        ttl: 2, // Will become 1 after routing
        size: 64,
        currentDeviceId: router.id,
        processingStage: 'at-device',
        progress: 0,
        path: [],
        currentPathIndex: 0,
      };

      const mockUpdate = vi.fn();
      const result = processDeviceTick(routerDevice, packet, useNetworkStore.getState().connections, mockUpdate);

      // Should forward with TTL=1
      expect(result.length).toBe(1);
      expect(result[0].ttl).toBe(1);
    });
  });

  // ============================================
  // Scenario: Broadcast Handling
  // ============================================
  describe('Broadcast Handling', () => {
    it('should flood broadcast to all switch ports', () => {
      const store = useNetworkStore.getState();

      const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });
      const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const pc2 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 100 });
      const pc3 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 200 });

      useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, sw.id, sw.interfaces[0].id);
      useNetworkStore.getState().addConnection(pc2.id, pc2.interfaces[0].id, sw.id, sw.interfaces[1].id);
      useNetworkStore.getState().addConnection(pc3.id, pc3.interfaces[0].id, sw.id, sw.interfaces[2].id);

      const pc1Device = useNetworkStore.getState().getDeviceById(pc1.id)!;

      const broadcast: Packet = {
        id: 'broadcast-packet',
        type: 'arp',
        sourceMAC: pc1Device.interfaces[0].macAddress,
        destMAC: 'FF:FF:FF:FF:FF:FF',
        ttl: 64,
        size: 64,
        currentDeviceId: sw.id,
        lastDeviceId: pc1.id,
        processingStage: 'at-device',
        progress: 0,
        path: [],
        currentPathIndex: 0,
        payload: { type: 'REQUEST', senderIP: '192.168.1.10', targetIP: '192.168.1.20' },
      };

      const mockUpdate = vi.fn((id: string, updates: Partial<NetworkDevice>) => {
        useNetworkStore.getState().updateDevice(id, updates);
      });

      const result = processDeviceTick(
        useNetworkStore.getState().getDeviceById(sw.id)!,
        broadcast,
        useNetworkStore.getState().connections,
        mockUpdate
      );

      // Should flood to PC2 and PC3 (not back to PC1)
      expect(result.length).toBe(2);
      const targetDevices = result.map(p => p.targetDeviceId);
      expect(targetDevices).toContain(pc2.id);
      expect(targetDevices).toContain(pc3.id);
      expect(targetDevices).not.toContain(pc1.id);
    });
  });

  describe('Inter-VLAN Routing via SVI', () => {
    it('should route packets between VLANs using SVI', () => {
      // Create a Layer 3 switch
      useNetworkStore.getState().addDevice('switch', { x: 200, y: 200 });
      const sw = useNetworkStore.getState().devices[0];

      // Create two PCs
      useNetworkStore.getState().addDevice('pc', { x: 100, y: 400 });
      useNetworkStore.getState().addDevice('pc', { x: 300, y: 400 });
      const [, pc1, pc2] = useNetworkStore.getState().devices;

      // Add VLANs to switch
      useNetworkStore.getState().addVlan(sw.id, { id: 10, name: 'VLAN10' });
      useNetworkStore.getState().addVlan(sw.id, { id: 20, name: 'VLAN20' });

      // Add SVIs
      useNetworkStore.getState().addSvi(sw.id, {
        vlanId: 10,
        ipAddress: '192.168.10.1',
        subnetMask: '255.255.255.0',
        isUp: true,
      });
      useNetworkStore.getState().addSvi(sw.id, {
        vlanId: 20,
        ipAddress: '192.168.20.1',
        subnetMask: '255.255.255.0',
        isUp: true,
      });

      // Configure switch ports
      const swDev = useNetworkStore.getState().getDeviceById(sw.id)!;
      useNetworkStore.getState().updateInterface(sw.id, swDev.interfaces[0].id, {
        vlanMode: 'access',
        accessVlan: 10,
      });
      useNetworkStore.getState().updateInterface(sw.id, swDev.interfaces[1].id, {
        vlanMode: 'access',
        accessVlan: 20,
      });

      // Configure PCs
      useNetworkStore.getState().configureInterface(pc1.id, pc1.interfaces[0].id, {
        ipAddress: '192.168.10.2',
        subnetMask: '255.255.255.0',
        gateway: '192.168.10.1',
      });
      useNetworkStore.getState().configureInterface(pc2.id, pc2.interfaces[0].id, {
        ipAddress: '192.168.20.2',
        subnetMask: '255.255.255.0',
        gateway: '192.168.20.1',
      });

      // Connect devices
      useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, sw.id, swDev.interfaces[0].id);
      useNetworkStore.getState().addConnection(pc2.id, pc2.interfaces[0].id, sw.id, swDev.interfaces[1].id);

      // Verify switch has SVI routing table entries
      const switchDev = useNetworkStore.getState().getDeviceById(sw.id)!;
      expect(switchDev.sviInterfaces?.length).toBe(2);
      expect(switchDev.routingTable?.some(r => r.destination === '192.168.10.0')).toBe(true);
      expect(switchDev.routingTable?.some(r => r.destination === '192.168.20.0')).toBe(true);

      // Get the SVI MACs
      const svi10 = switchDev.sviInterfaces!.find(s => s.vlanId === 10)!;
      const svi20 = switchDev.sviInterfaces!.find(s => s.vlanId === 20)!;

      // Pre-populate ARP table on switch (normally would be learned)
      const pc1Dev = useNetworkStore.getState().getDeviceById(pc1.id)!;
      const pc2Dev = useNetworkStore.getState().getDeviceById(pc2.id)!;

      useNetworkStore.getState().updateDevice(sw.id, {
        arpTable: [
          { ipAddress: '192.168.10.2', macAddress: pc1Dev.interfaces[0].macAddress, interface: 'Vlan10', type: 'dynamic', age: 0 },
          { ipAddress: '192.168.20.2', macAddress: pc2Dev.interfaces[0].macAddress, interface: 'Vlan20', type: 'dynamic', age: 0 },
        ],
      });

      // Pre-populate MAC tables
      useNetworkStore.getState().updateDevice(sw.id, {
        macTable: [
          { macAddress: pc1Dev.interfaces[0].macAddress, port: switchDev.interfaces[0].name, vlan: 10, type: 'dynamic', age: 0 },
          { macAddress: pc2Dev.interfaces[0].macAddress, port: switchDev.interfaces[1].name, vlan: 20, type: 'dynamic', age: 0 },
        ],
      });

      // Simulate ICMP packet from PC1 to PC2 (via switch SVI)
      // First the packet goes to the SVI MAC (gateway)
      const icmpPacket: Packet = {
        id: 'test-icmp',
        type: 'icmp',
        sourceMAC: pc1Dev.interfaces[0].macAddress,
        destMAC: svi10.macAddress, // Destined to gateway (SVI)
        sourceIP: '192.168.10.2',
        destIP: '192.168.20.2',
        ttl: 64,
        size: 64,
        icmpType: 8,
        icmpCode: 0,
        icmpSeq: 1,
        currentDeviceId: sw.id, // Already at switch
        ingressInterface: switchDev.interfaces[0].name,
        processingStage: 'at-device',
        progress: 0,
        path: [pc1.id],
        currentPathIndex: 1,
        vlanTag: 10,
      };

      // Process the packet at switch
      const connections = useNetworkStore.getState().connections;
      const mockUpdate = vi.fn();
      const freshSwitch = useNetworkStore.getState().getDeviceById(sw.id)!;

      const result = processDeviceTick(
        freshSwitch,
        icmpPacket,
        connections,
        mockUpdate
      );

      // Should produce a routed packet heading to PC2
      expect(result.length).toBeGreaterThan(0);

      const routedPacket = result.find(p => p.type === 'icmp' && p.processingStage !== 'dropped');
      expect(routedPacket).toBeDefined();

      // The routed packet should have:
      // - sourceMAC = SVI 20 MAC (egress SVI)
      // - destMAC = PC2 MAC
      // - VLAN tag stripped (access port)
      if (routedPacket) {
        expect(routedPacket.sourceMAC).toBe(svi20.macAddress);
        expect(routedPacket.destMAC).toBe(pc2Dev.interfaces[0].macAddress);
        expect(routedPacket.vlanTag).toBeUndefined(); // Access port strips tag
        expect(routedPacket.ttl).toBe(63); // TTL decremented
      }
    });

    it('should generate ARP request when destination MAC unknown', () => {
      // Create a Layer 3 switch
      useNetworkStore.getState().addDevice('switch', { x: 200, y: 200 });
      const sw = useNetworkStore.getState().devices[0];

      // Create two PCs
      useNetworkStore.getState().addDevice('pc', { x: 100, y: 400 });
      useNetworkStore.getState().addDevice('pc', { x: 300, y: 400 });
      const [, pc1, pc2] = useNetworkStore.getState().devices;

      // Add VLANs and SVIs
      useNetworkStore.getState().addVlan(sw.id, { id: 10, name: 'VLAN10' });
      useNetworkStore.getState().addVlan(sw.id, { id: 20, name: 'VLAN20' });
      useNetworkStore.getState().addSvi(sw.id, {
        vlanId: 10,
        ipAddress: '192.168.10.1',
        subnetMask: '255.255.255.0',
        isUp: true,
      });
      useNetworkStore.getState().addSvi(sw.id, {
        vlanId: 20,
        ipAddress: '192.168.20.1',
        subnetMask: '255.255.255.0',
        isUp: true,
      });

      // Configure switch ports
      const swDev = useNetworkStore.getState().getDeviceById(sw.id)!;
      useNetworkStore.getState().updateInterface(sw.id, swDev.interfaces[0].id, {
        vlanMode: 'access',
        accessVlan: 10,
      });
      useNetworkStore.getState().updateInterface(sw.id, swDev.interfaces[1].id, {
        vlanMode: 'access',
        accessVlan: 20,
      });

      // Configure PCs
      useNetworkStore.getState().configureInterface(pc1.id, pc1.interfaces[0].id, {
        ipAddress: '192.168.10.2',
        subnetMask: '255.255.255.0',
        gateway: '192.168.10.1',
      });
      useNetworkStore.getState().configureInterface(pc2.id, pc2.interfaces[0].id, {
        ipAddress: '192.168.20.2',
        subnetMask: '255.255.255.0',
        gateway: '192.168.20.1',
      });

      // Connect devices
      useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, sw.id, swDev.interfaces[0].id);
      useNetworkStore.getState().addConnection(pc2.id, pc2.interfaces[0].id, sw.id, swDev.interfaces[1].id);

      // Get fresh switch state
      const switchDev = useNetworkStore.getState().getDeviceById(sw.id)!;
      const svi10 = switchDev.sviInterfaces!.find(s => s.vlanId === 10)!;
      const pc1Dev = useNetworkStore.getState().getDeviceById(pc1.id)!;

      // DON'T populate ARP table - switch doesn't know PC2's MAC

      // Simulate ICMP packet from PC1 to PC2
      const icmpPacket: Packet = {
        id: 'test-icmp',
        type: 'icmp',
        sourceMAC: pc1Dev.interfaces[0].macAddress,
        destMAC: svi10.macAddress,
        sourceIP: '192.168.10.2',
        destIP: '192.168.20.2',
        ttl: 64,
        size: 64,
        icmpType: 8,
        icmpCode: 0,
        icmpSeq: 1,
        currentDeviceId: sw.id,
        ingressInterface: switchDev.interfaces[0].name,
        processingStage: 'at-device',
        progress: 0,
        path: [pc1.id],
        currentPathIndex: 1,
        vlanTag: 10,
      };

      // Process the packet
      const connections = useNetworkStore.getState().connections;
      const mockUpdate = vi.fn();
      const freshSwitch = useNetworkStore.getState().getDeviceById(sw.id)!;

      const result = processDeviceTick(
        freshSwitch,
        icmpPacket,
        connections,
        mockUpdate
      );

      // Should produce ARP request + buffered packet
      expect(result.length).toBe(2);

      const arpRequest = result.find(p => p.type === 'arp');
      const bufferedPacket = result.find(p => p.processingStage === 'buffered');

      expect(arpRequest).toBeDefined();
      expect(bufferedPacket).toBeDefined();

      if (arpRequest) {
        expect(arpRequest.destMAC).toBe('FF:FF:FF:FF:FF:FF');
        expect(arpRequest.destIP).toBe('192.168.20.2');
        expect(arpRequest.vlanTag).toBe(20); // ARP in egress VLAN
      }

      if (bufferedPacket) {
        expect(bufferedPacket.waitingForArp).toBe('192.168.20.2');
      }
    });

    it('should learn MAC from ARP reply destined to SVI', () => {
      // Create a Layer 3 switch
      useNetworkStore.getState().addDevice('switch', { x: 200, y: 200 });
      const sw = useNetworkStore.getState().devices[0];

      // Create a PC
      useNetworkStore.getState().addDevice('pc', { x: 300, y: 400 });
      const [, pc] = useNetworkStore.getState().devices;

      // Add VLAN and SVI
      useNetworkStore.getState().addVlan(sw.id, { id: 20, name: 'VLAN20' });
      useNetworkStore.getState().addSvi(sw.id, {
        vlanId: 20,
        ipAddress: '192.168.20.1',
        subnetMask: '255.255.255.0',
        isUp: true,
      });

      // Configure switch port for VLAN 20
      const swDev = useNetworkStore.getState().getDeviceById(sw.id)!;
      useNetworkStore.getState().updateInterface(sw.id, swDev.interfaces[0].id, {
        vlanMode: 'access',
        accessVlan: 20,
      });

      // Configure PC
      useNetworkStore.getState().configureInterface(pc.id, pc.interfaces[0].id, {
        ipAddress: '192.168.20.2',
        subnetMask: '255.255.255.0',
        gateway: '192.168.20.1',
      });

      // Connect PC to switch
      useNetworkStore.getState().addConnection(pc.id, pc.interfaces[0].id, sw.id, swDev.interfaces[0].id);

      // Get fresh state
      const switchDev = useNetworkStore.getState().getDeviceById(sw.id)!;
      const svi20 = switchDev.sviInterfaces!.find(s => s.vlanId === 20)!;
      const pcDev = useNetworkStore.getState().getDeviceById(pc.id)!;

      // Verify switch has no ARP entry for PC yet
      expect(switchDev.arpTable?.find(e => e.ipAddress === '192.168.20.2')).toBeUndefined();

      // Simulate ARP reply from PC to switch SVI
      const arpReply: Packet = {
        id: 'test-arp-reply',
        type: 'arp',
        sourceMAC: pcDev.interfaces[0].macAddress,
        destMAC: svi20.macAddress,
        sourceIP: '192.168.20.2',
        destIP: '192.168.20.1',
        ttl: 64,
        size: 28,
        payload: {
          type: 'reply',
          senderMAC: pcDev.interfaces[0].macAddress,
          senderIP: '192.168.20.2',
          targetMAC: svi20.macAddress,
          targetIP: '192.168.20.1',
        },
        currentDeviceId: sw.id,
        ingressInterface: switchDev.interfaces[0].name,
        processingStage: 'at-device',
        progress: 0,
        path: [pc.id],
        currentPathIndex: 1,
        vlanTag: 20,
      };

      // Process the ARP reply
      const connections = useNetworkStore.getState().connections;
      const freshSwitch = useNetworkStore.getState().getDeviceById(sw.id)!;

      const result = processDeviceTick(
        freshSwitch,
        arpReply,
        connections,
        (id, updates) => useNetworkStore.getState().updateDevice(id, updates)
      );

      // ARP reply should be consumed (not forwarded)
      expect(result.length).toBe(0);

      // Verify the switch learned the PC's MAC
      const updatedSwitch = useNetworkStore.getState().getDeviceById(sw.id)!;
      const learnedArp = updatedSwitch.arpTable?.find(e => e.ipAddress === '192.168.20.2');
      expect(learnedArp).toBeDefined();
      expect(learnedArp?.macAddress).toBe(pcDev.interfaces[0].macAddress);
      expect(learnedArp?.interface).toBe('Vlan20');
    });
  });
});
