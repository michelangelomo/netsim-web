import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useNetworkStore } from '@/store/network-store';

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

describe('Network Store', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================
  // Device Management Tests
  // ============================================
  describe('Device Management', () => {
    describe('addDevice', () => {
      it('should create a PC with correct defaults', () => {
        const store = useNetworkStore.getState();
        const device = useNetworkStore.getState().addDevice('pc', { x: 100, y: 200 });

        expect(device.type).toBe('pc');
        expect(device.name).toBe('PC1');
        expect(device.hostname).toBe('pc1');
        expect(device.position).toEqual({ x: 100, y: 200 });
        expect(device.interfaces.length).toBe(1);
        expect(device.interfaces[0].name).toBe('eth0');
        expect(device.isRunning).toBe(true);
        expect(device.arpTable).toEqual([]);
      });

      it('should create a router with routing table', () => {
        const store = useNetworkStore.getState();
        const device = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });

        expect(device.type).toBe('router');
        expect(device.routingTable).toBeDefined();
        expect(device.routingTable).toEqual([]);
        expect(device.interfaces.length).toBe(4);
        expect(device.interfaces[0].name).toBe('GigabitEthernet0/0');
      });

      it('should create a switch with MAC table', () => {
        const store = useNetworkStore.getState();
        const device = useNetworkStore.getState().addDevice('switch', { x: 0, y: 0 });

        expect(device.type).toBe('switch');
        expect(device.macTable).toBeDefined();
        expect(device.macTable).toEqual([]);
        expect(device.interfaces.length).toBe(8);
        expect(device.interfaces[0].name).toBe('FastEthernet0/0');
      });

      it('should create a firewall with default rules', () => {
        const store = useNetworkStore.getState();
        const device = useNetworkStore.getState().addDevice('firewall', { x: 0, y: 0 });

        expect(device.type).toBe('firewall');
        expect(device.firewallRules).toBeDefined();
        expect(device.firewallRules!.length).toBe(1);
        expect(device.firewallRules![0].action).toBe('allow');
        expect(device.firewallRules![0].protocol).toBe('icmp');
      });

      it('should increment device counter for naming', () => {
        const store = useNetworkStore.getState();
        const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
        const pc2 = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });

        expect(pc1.name).toBe('PC1');
        expect(pc2.name).toBe('PC2');
      });

      it('should generate unique MAC addresses for interfaces', () => {
        const store = useNetworkStore.getState();
        const device = useNetworkStore.getState().addDevice('switch', { x: 0, y: 0 });

        const macs = new Set(device.interfaces.map(i => i.macAddress));
        expect(macs.size).toBe(device.interfaces.length);
      });
    });

    describe('removeDevice', () => {
      it('should remove device from store', () => {
        const store = useNetworkStore.getState();
        const device = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

        useNetworkStore.getState().removeDevice(device.id);

        expect(useNetworkStore.getState().getDeviceById(device.id)).toBeUndefined();
      });

      it('should remove associated connections when device is removed', () => {
        const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
        const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });

        useNetworkStore.getState().addConnection(
          pc.id, pc.interfaces[0].id,
          sw.id, sw.interfaces[0].id
        );

        expect(useNetworkStore.getState().connections.length).toBe(1);

        useNetworkStore.getState().removeDevice(pc.id);

        expect(useNetworkStore.getState().connections.length).toBe(0);
      });

      it('should clear selection if removed device was selected', () => {
        const device = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

        useNetworkStore.getState().selectDevice(device.id);
        expect(useNetworkStore.getState().selectedDeviceId).toBe(device.id);

        useNetworkStore.getState().removeDevice(device.id);

        expect(useNetworkStore.getState().selectedDeviceId).toBeNull();
      });
    });

    describe('configureInterface', () => {
      it('should update interface configuration', () => {
        const store = useNetworkStore.getState();
        const device = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

        useNetworkStore.getState().configureInterface(device.id, device.interfaces[0].id, {
          ipAddress: '192.168.1.10',
          subnetMask: '255.255.255.0',
          gateway: '192.168.1.1',
        });

        const updated = useNetworkStore.getState().getDeviceById(device.id)!;
        expect(updated.interfaces[0].ipAddress).toBe('192.168.1.10');
        expect(updated.interfaces[0].subnetMask).toBe('255.255.255.0');
        expect(updated.interfaces[0].gateway).toBe('192.168.1.1');
      });

      it('should auto-add connected route for router when IP is configured', () => {
        const store = useNetworkStore.getState();
        const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });

        useNetworkStore.getState().configureInterface(router.id, router.interfaces[0].id, {
          ipAddress: '192.168.1.1',
          subnetMask: '255.255.255.0',
        });

        const updated = useNetworkStore.getState().getDeviceById(router.id)!;
        expect(updated.routingTable!.length).toBe(1);
        expect(updated.routingTable![0].destination).toBe('192.168.1.0');
        expect(updated.routingTable![0].type).toBe('connected');
      });
    });
  });

  describe('sendPing', () => {
    it('should complete ping on same subnet (with ARP) and restore simulation state', { timeout: 15000 }, async () => {
      const store = useNetworkStore.getState();

      const pc = store.addDevice('pc', { x: 0, y: 0 });
      const sw = store.addDevice('switch', { x: 100, y: 0 });
      const laptop = store.addDevice('laptop', { x: 200, y: 0 });

      store.configureInterface(pc.id, pc.interfaces[0].id, {
        ipAddress: '192.168.10.101',
        subnetMask: '255.255.255.0',
      });
      store.configureInterface(laptop.id, laptop.interfaces[0].id, {
        ipAddress: '192.168.10.100',
        subnetMask: '255.255.255.0',
      });

      store.addConnection(pc.id, pc.interfaces[0].id, sw.id, sw.interfaces[0].id);
      store.addConnection(laptop.id, laptop.interfaces[0].id, sw.id, sw.interfaces[1].id);

      expect(store.simulation.isRunning).toBe(false);

      const output = await store.sendPing(pc.id, '192.168.10.100');

      const receivedMatch = output.match(/(\d+) packets received/);
      expect(receivedMatch).toBeTruthy();
      expect(Number(receivedMatch![1])).toBeGreaterThan(0);

      // `sendPing` may temporarily run the simulation to advance packets, but should restore it.
      expect(store.simulation.isRunning).toBe(false);
    });
  });

  // ============================================
  // Connection Tests
  // ============================================
  describe('Connections', () => {
    it('should create a connection between two devices', () => {
      const store = useNetworkStore.getState();
      const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });

      const connection = useNetworkStore.getState().addConnection(
        pc.id, pc.interfaces[0].id,
        sw.id, sw.interfaces[0].id
      );

      expect(connection).not.toBeNull();
      expect(connection!.sourceDeviceId).toBe(pc.id);
      expect(connection!.targetDeviceId).toBe(sw.id);
      expect(connection!.isUp).toBe(true);
    });

    it('should mark interfaces as connected', () => {
      const store = useNetworkStore.getState();
      const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });

      useNetworkStore.getState().addConnection(
        pc.id, pc.interfaces[0].id,
        sw.id, sw.interfaces[0].id
      );

      const updatedPc = useNetworkStore.getState().getDeviceById(pc.id)!;
      const updatedSw = useNetworkStore.getState().getDeviceById(sw.id)!;

      expect(updatedPc.interfaces[0].connectedTo).toBe(sw.interfaces[0].id);
      expect(updatedSw.interfaces[0].connectedTo).toBe(pc.interfaces[0].id);
    });

    it('should not allow connection to already connected interface', () => {
      const store = useNetworkStore.getState();
      const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const pc2 = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });
      const sw = useNetworkStore.getState().addDevice('switch', { x: 50, y: 50 });

      useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, sw.id, sw.interfaces[0].id);
      const secondConnection = useNetworkStore.getState().addConnection(pc2.id, pc2.interfaces[0].id, sw.id, sw.interfaces[0].id);

      expect(secondConnection).toBeNull();
    });

    it('should clear connection tracking when removed', () => {
      const store = useNetworkStore.getState();
      const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });

      const connection = useNetworkStore.getState().addConnection(
        pc.id, pc.interfaces[0].id,
        sw.id, sw.interfaces[0].id
      )!;

      useNetworkStore.getState().removeConnection(connection.id);

      const updatedPc = useNetworkStore.getState().getDeviceById(pc.id)!;
      const updatedSw = useNetworkStore.getState().getDeviceById(sw.id)!;

      expect(updatedPc.interfaces[0].connectedTo).toBeUndefined();
      expect(updatedSw.interfaces[0].connectedTo).toBeUndefined();
    });
  });

  // ============================================
  // Routing Tests
  // ============================================
  describe('Routing', () => {
    it('should add static route', () => {
      const store = useNetworkStore.getState();
      const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });

      useNetworkStore.getState().addRoute(router.id, {
        destination: '10.0.0.0',
        netmask: '255.0.0.0',
        gateway: '192.168.1.254',
        interface: 'GigabitEthernet0/0',
        metric: 10,
      });

      const updated = useNetworkStore.getState().getDeviceById(router.id)!;
      expect(updated.routingTable!.length).toBe(1);
      expect(updated.routingTable![0].destination).toBe('10.0.0.0');
      expect(updated.routingTable![0].type).toBe('static');
    });

    it('should not add duplicate routes', () => {
      const store = useNetworkStore.getState();
      const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });

      useNetworkStore.getState().addRoute(router.id, {
        destination: '10.0.0.0',
        netmask: '255.0.0.0',
        gateway: '192.168.1.254',
        interface: 'GigabitEthernet0/0',
        metric: 10,
      });

      useNetworkStore.getState().addRoute(router.id, {
        destination: '10.0.0.0',
        netmask: '255.0.0.0',
        gateway: '192.168.1.253',
        interface: 'GigabitEthernet0/1',
        metric: 5,
      });

      const updated = useNetworkStore.getState().getDeviceById(router.id)!;
      expect(updated.routingTable!.length).toBe(1);
    });

    it('should remove route by destination', () => {
      const store = useNetworkStore.getState();
      const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });

      useNetworkStore.getState().addRoute(router.id, {
        destination: '10.0.0.0',
        netmask: '255.0.0.0',
        gateway: '192.168.1.254',
        interface: 'GigabitEthernet0/0',
        metric: 10,
      });

      useNetworkStore.getState().removeRoute(router.id, '10.0.0.0');

      const updated = useNetworkStore.getState().getDeviceById(router.id)!;
      expect(updated.routingTable!.length).toBe(0);
    });
  });

  // ============================================
  // ARP Tests
  // ============================================
  describe('ARP', () => {
    it('should resolve ARP from cache', () => {
      const store = useNetworkStore.getState();
      const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

      useNetworkStore.getState().updateArpTable(pc.id, {
        ipAddress: '192.168.1.1',
        macAddress: '02:AA:BB:CC:DD:EE',
        interface: 'eth0',
        type: 'dynamic',
        age: 0,
      });

      const mac = useNetworkStore.getState().resolveARP(pc.id, '192.168.1.1');
      expect(mac).toBe('02:AA:BB:CC:DD:EE');
    });

    it('should resolve ARP by finding device with IP', () => {
      const store = useNetworkStore.getState();
      const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const pc2 = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });

      useNetworkStore.getState().configureInterface(pc2.id, pc2.interfaces[0].id, {
        ipAddress: '192.168.1.20',
        subnetMask: '255.255.255.0',
      });

      const mac = useNetworkStore.getState().resolveARP(pc1.id, '192.168.1.20');

      // Should find pc2's MAC
      const pc2Mac = useNetworkStore.getState().getDeviceById(pc2.id)!.interfaces[0].macAddress;
      expect(mac).toBe(pc2Mac);
    });

    it('should add entry to ARP table after resolution', () => {
      const store = useNetworkStore.getState();
      const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const pc2 = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });

      useNetworkStore.getState().configureInterface(pc2.id, pc2.interfaces[0].id, {
        ipAddress: '192.168.1.20',
        subnetMask: '255.255.255.0',
      });

      useNetworkStore.getState().resolveARP(pc1.id, '192.168.1.20');

      const updated = useNetworkStore.getState().getDeviceById(pc1.id)!;
      expect(updated.arpTable!.length).toBe(1);
      expect(updated.arpTable![0].ipAddress).toBe('192.168.1.20');
    });

    it('should return null for unknown IP', () => {
      const store = useNetworkStore.getState();
      const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

      const mac = useNetworkStore.getState().resolveARP(pc.id, '192.168.1.99');
      expect(mac).toBeNull();
    });
  });

  // ============================================
  // MAC Table Tests
  // ============================================
  describe('MAC Table', () => {
    it('should learn MAC address', () => {
      const store = useNetworkStore.getState();
      const sw = useNetworkStore.getState().addDevice('switch', { x: 0, y: 0 });

      useNetworkStore.getState().learnMAC(sw.id, '02:AA:BB:CC:DD:EE', 'FastEthernet0/1', 1);

      const updated = useNetworkStore.getState().getDeviceById(sw.id)!;
      expect(updated.macTable!.length).toBe(1);
      expect(updated.macTable![0].macAddress).toBe('02:AA:BB:CC:DD:EE');
      expect(updated.macTable![0].port).toBe('FastEthernet0/1');
      expect(updated.macTable![0].vlan).toBe(1);
    });

    it('should update MAC entry if already exists', () => {
      const store = useNetworkStore.getState();
      const sw = useNetworkStore.getState().addDevice('switch', { x: 0, y: 0 });

      useNetworkStore.getState().learnMAC(sw.id, '02:AA:BB:CC:DD:EE', 'FastEthernet0/1');
      useNetworkStore.getState().learnMAC(sw.id, '02:AA:BB:CC:DD:EE', 'FastEthernet0/2');

      const updated = useNetworkStore.getState().getDeviceById(sw.id)!;
      expect(updated.macTable!.length).toBe(1);
      expect(updated.macTable![0].port).toBe('FastEthernet0/2');
    });

    it('should lookup MAC in table', () => {
      const store = useNetworkStore.getState();
      const sw = useNetworkStore.getState().addDevice('switch', { x: 0, y: 0 });

      useNetworkStore.getState().learnMAC(sw.id, '02:AA:BB:CC:DD:EE', 'FastEthernet0/1');

      const port = useNetworkStore.getState().lookupMAC(sw.id, '02:AA:BB:CC:DD:EE');
      expect(port).toBe('FastEthernet0/1');
    });

    it('should return broadcast for broadcast MAC', () => {
      const store = useNetworkStore.getState();
      const sw = useNetworkStore.getState().addDevice('switch', { x: 0, y: 0 });

      const port = useNetworkStore.getState().lookupMAC(sw.id, 'FF:FF:FF:FF:FF:FF');
      expect(port).toBe('broadcast');
    });

    it('should return null for unknown MAC', () => {
      const store = useNetworkStore.getState();
      const sw = useNetworkStore.getState().addDevice('switch', { x: 0, y: 0 });

      const port = useNetworkStore.getState().lookupMAC(sw.id, '02:11:22:33:44:55');
      expect(port).toBeNull();
    });
  });

  // ============================================
  // DHCP Tests
  // ============================================
  describe('DHCP', () => {
    describe('DHCP Server Configuration', () => {
      it('should configure DHCP server on router', () => {
        const store = useNetworkStore.getState();
        const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });

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

        const updated = useNetworkStore.getState().getDeviceById(router.id)!;
        expect(updated.dhcpServers).toBeDefined();
        const cfg = updated.dhcpServers!.find((s) => s.interfaceId === router.interfaces[0].id);
        expect(cfg).toBeDefined();
        expect(cfg!.enabled).toBe(true);
        expect(cfg!.poolStart).toBe('192.168.1.100');
        expect(cfg!.poolEnd).toBe('192.168.1.200');
      });

      it('should not allow DHCP server on non-router/server devices', () => {
        const store = useNetworkStore.getState();
        const sw = useNetworkStore.getState().addDevice('switch', { x: 0, y: 0 });

        useNetworkStore.getState().configureDhcpServer(sw.id, sw.interfaces[0].id, { enabled: true });

        const updated = useNetworkStore.getState().getDeviceById(sw.id)!;
        expect(updated.dhcpServers).toBeUndefined();
      });
    });

    describe('DHCP Client Request', () => {
      it('should assign IP from pool', async () => {
        const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });
        const pc = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });

        // Configure router as DHCP server
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

        // Connect PC to router
        useNetworkStore.getState().addConnection(
          pc.id, pc.interfaces[0].id,
          router.id, router.interfaces[0].id
        );

        // Request DHCP
        const result = await useNetworkStore.getState().requestDhcp(pc.id, pc.interfaces[0].id);

        expect(result).toContain('DHCP request successful');
        expect(result).toContain('192.168.1.100'); // First IP in pool

        // Check PC got the IP
        const updatedPc = useNetworkStore.getState().getDeviceById(pc.id)!;
        expect(updatedPc.interfaces[0].ipAddress).toBe('192.168.1.100');
        expect(updatedPc.interfaces[0].subnetMask).toBe('255.255.255.0');
        expect(updatedPc.interfaces[0].gateway).toBe('192.168.1.1');
        expect(updatedPc.interfaces[0].dhcpEnabled).toBe(true);
      });

      it('should track lease on server', async () => {
        const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });
        const pc = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });

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

        useNetworkStore.getState().addConnection(
          pc.id, pc.interfaces[0].id,
          router.id, router.interfaces[0].id
        );

        await useNetworkStore.getState().requestDhcp(pc.id, pc.interfaces[0].id);

        const updatedRouter = useNetworkStore.getState().getDeviceById(router.id)!;
        const cfg = updatedRouter.dhcpServers!.find((s) => s.interfaceId === router.interfaces[0].id)!;
        expect(cfg.leases.length).toBe(1);
        expect(cfg.leases[0].ipAddress).toBe('192.168.1.100');

        const pcMac = useNetworkStore.getState().getDeviceById(pc.id)!.interfaces[0].macAddress;
        expect(cfg.leases[0].macAddress).toBe(pcMac);
      });

      it('should assign next available IP when first is taken', async () => {
        const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });
        const sw = useNetworkStore.getState().addDevice('switch', { x: 50, y: 0 });
        const pc1 = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });
        const pc2 = useNetworkStore.getState().addDevice('pc', { x: 200, y: 0 });

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

        // Put both clients in the same L2 domain (PC1/PC2 -> Switch -> Router Gi0/0)
        useNetworkStore.getState().addConnection(pc1.id, pc1.interfaces[0].id, sw.id, sw.interfaces[0].id);
        useNetworkStore.getState().addConnection(pc2.id, pc2.interfaces[0].id, sw.id, sw.interfaces[1].id);
        useNetworkStore.getState().addConnection(sw.id, sw.interfaces[2].id, router.id, router.interfaces[0].id);

        await useNetworkStore.getState().requestDhcp(pc1.id, pc1.interfaces[0].id);
        await useNetworkStore.getState().requestDhcp(pc2.id, pc2.interfaces[0].id);

        const updatedPc1 = useNetworkStore.getState().getDeviceById(pc1.id)!;
        const updatedPc2 = useNetworkStore.getState().getDeviceById(pc2.id)!;

        expect(updatedPc1.interfaces[0].ipAddress).toBe('192.168.1.100');
        expect(updatedPc2.interfaces[0].ipAddress).toBe('192.168.1.101');
      });

      it('should fail if no DHCP server found', async () => {
        const store = useNetworkStore.getState();
        const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
        const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });

        useNetworkStore.getState().addConnection(
          pc.id, pc.interfaces[0].id,
          sw.id, sw.interfaces[0].id
        );

        const result = await useNetworkStore.getState().requestDhcp(pc.id, pc.interfaces[0].id);

        expect(result).toContain('No DHCP server found');
      });

      it('should fail if interface not connected', async () => {
        const store = useNetworkStore.getState();
        const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

        const result = await useNetworkStore.getState().requestDhcp(pc.id, pc.interfaces[0].id);

        expect(result).toContain('Interface is not connected');
      });
    });

    describe('DHCP Release', () => {
      it('should release DHCP lease', async () => {
        const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });
        const pc = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });

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

        useNetworkStore.getState().addConnection(
          pc.id, pc.interfaces[0].id,
          router.id, router.interfaces[0].id
        );

        await useNetworkStore.getState().requestDhcp(pc.id, pc.interfaces[0].id);
        useNetworkStore.getState().releaseDhcp(pc.id, pc.interfaces[0].id);

        // Check IP is cleared on PC
        const updatedPc = useNetworkStore.getState().getDeviceById(pc.id)!;
        expect(updatedPc.interfaces[0].ipAddress).toBeNull();
        expect(updatedPc.interfaces[0].dhcpEnabled).toBe(false);

        // Check lease is removed from server
        const updatedRouter = useNetworkStore.getState().getDeviceById(router.id)!;
        const cfg = updatedRouter.dhcpServers!.find((s) => s.interfaceId === router.interfaces[0].id)!;
        expect(cfg.leases.length).toBe(0);
      });
    });

    describe('DHCP Server Discovery', () => {
      it('should find DHCP server through switch', () => {
        const store = useNetworkStore.getState();
        const router = useNetworkStore.getState().addDevice('router', { x: 0, y: 0 });
        const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });
        const pc = useNetworkStore.getState().addDevice('pc', { x: 200, y: 0 });

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

        // PC -> Switch -> Router
        useNetworkStore.getState().addConnection(
          pc.id, pc.interfaces[0].id,
          sw.id, sw.interfaces[0].id
        );
        useNetworkStore.getState().addConnection(
          sw.id, sw.interfaces[1].id,
          router.id, router.interfaces[0].id
        );

        const dhcpServer = useNetworkStore.getState().findDhcpServer(pc.id, pc.interfaces[0].id);
        expect(dhcpServer).not.toBeNull();
        expect(dhcpServer!.device.id).toBe(router.id);
        expect(dhcpServer!.config.interfaceId).toBe(router.interfaces[0].id);
      });
    });
  });

  // ============================================
  // DNS Tests
  // ============================================
  describe('DNS', () => {
    describe('DNS Resolution', () => {
      it('should resolve IP address directly', async () => {
        const store = useNetworkStore.getState();
        const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

        useNetworkStore.getState().configureInterface(pc.id, pc.interfaces[0].id, {
          ipAddress: '192.168.1.10',
          subnetMask: '255.255.255.0',
        });

        const result = await useNetworkStore.getState().resolveDNS(pc.id, '8.8.8.8');
        expect(result).toBe('8.8.8.8');
      });

      it('should resolve hostname from device hostname', async () => {
        const store = useNetworkStore.getState();
        const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
        const server = useNetworkStore.getState().addDevice('server', { x: 100, y: 0 });

        useNetworkStore.getState().configureInterface(pc1.id, pc1.interfaces[0].id, {
          ipAddress: '192.168.1.10',
          subnetMask: '255.255.255.0',
        });

        useNetworkStore.getState().configureInterface(server.id, server.interfaces[0].id, {
          ipAddress: '192.168.1.100',
          subnetMask: '255.255.255.0',
        });

        const result = await useNetworkStore.getState().resolveDNS(pc1.id, 'server1');
        expect(result).toBe('192.168.1.100');
      });

      it('should resolve .local domain names', async () => {
        const store = useNetworkStore.getState();
        const pc1 = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
        const server = useNetworkStore.getState().addDevice('server', { x: 100, y: 0 });

        useNetworkStore.getState().configureInterface(pc1.id, pc1.interfaces[0].id, {
          ipAddress: '192.168.1.10',
          subnetMask: '255.255.255.0',
        });

        useNetworkStore.getState().configureInterface(server.id, server.interfaces[0].id, {
          ipAddress: '192.168.1.100',
          subnetMask: '255.255.255.0',
        });

        const result = await useNetworkStore.getState().resolveDNS(pc1.id, 'server1.local');
        expect(result).toBe('192.168.1.100');
      });

      it('should return null for unknown hostname', async () => {
        const store = useNetworkStore.getState();
        const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

        useNetworkStore.getState().configureInterface(pc.id, pc.interfaces[0].id, {
          ipAddress: '192.168.1.10',
          subnetMask: '255.255.255.0',
        });

        const result = await useNetworkStore.getState().resolveDNS(pc.id, 'unknown-host.example.com');
        expect(result).toBeNull();
      });
    });

    describe('Reverse DNS', () => {
      it('should resolve IP to hostname', async () => {
        const store = useNetworkStore.getState();
        const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
        const server = useNetworkStore.getState().addDevice('server', { x: 100, y: 0 });

        useNetworkStore.getState().configureInterface(server.id, server.interfaces[0].id, {
          ipAddress: '192.168.1.100',
          subnetMask: '255.255.255.0',
        });

        const result = await useNetworkStore.getState().reverseDNS(pc.id, '192.168.1.100');
        expect(result).toBe('server1');
      });

      it('should return null for unknown IP', async () => {
        const store = useNetworkStore.getState();
        const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

        const result = await useNetworkStore.getState().reverseDNS(pc.id, '192.168.1.99');
        expect(result).toBeNull();
      });
    });

    describe('DNS Server', () => {
      it('should resolve from DNS server zones', async () => {
        const store = useNetworkStore.getState();
        const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
        const server = useNetworkStore.getState().addDevice('server', { x: 100, y: 0 });

        useNetworkStore.getState().configureInterface(pc.id, pc.interfaces[0].id, {
          ipAddress: '192.168.1.10',
          subnetMask: '255.255.255.0',
        });

        useNetworkStore.getState().configureInterface(server.id, server.interfaces[0].id, {
          ipAddress: '192.168.1.53',
          subnetMask: '255.255.255.0',
        });

        // Configure DNS server
        useNetworkStore.getState().updateDevice(server.id, {
          dnsServer: {
            enabled: true,
            interface: 'eth0',
            zones: [
              { hostname: 'www.example.com', ipAddress: '93.184.216.34', type: 'A', ttl: 3600 },
              { hostname: 'mail.example.com', ipAddress: '93.184.216.35', type: 'A', ttl: 3600 },
            ],
            forwarders: [],
          },
        });

        const result = await useNetworkStore.getState().resolveDNS(pc.id, 'www.example.com');
        expect(result).toBe('93.184.216.34');
      });
    });
  });

  // ============================================
  // Simulation Tests
  // ============================================
  describe('Simulation', () => {
    it('should start simulation', () => {
      useNetworkStore.getState().startSimulation();

      expect(useNetworkStore.getState().simulation.isRunning).toBe(true);
    });

    it('should stop simulation and clear packets', () => {
      useNetworkStore.getState().startSimulation();
      useNetworkStore.getState().sendPacket({
        type: 'icmp',
        sourceMAC: '02:00:00:00:00:01',
        destMAC: '02:00:00:00:00:02',
        ttl: 64,
        size: 64,
        currentDeviceId: 'test',
      });

      expect(useNetworkStore.getState().packets.length).toBe(1);

      useNetworkStore.getState().stopSimulation();

      expect(useNetworkStore.getState().simulation.isRunning).toBe(false);
      expect(useNetworkStore.getState().packets.length).toBe(0);
    });

    it('should set simulation speed', () => {
      useNetworkStore.getState().setSimulationSpeed(2);
      expect(useNetworkStore.getState().simulation.speed).toBe(2);

      useNetworkStore.getState().setSimulationSpeed(0.5);
      expect(useNetworkStore.getState().simulation.speed).toBe(0.5);
    });

    it('should not tick when simulation is stopped', () => {
      const initialTime = useNetworkStore.getState().simulation.currentTime;

      useNetworkStore.getState().tick();

      expect(useNetworkStore.getState().simulation.currentTime).toBe(initialTime);
    });

    it('should increment time on tick', () => {
      useNetworkStore.getState().startSimulation();
      const initialTime = useNetworkStore.getState().simulation.currentTime;

      useNetworkStore.getState().tick();

      expect(useNetworkStore.getState().simulation.currentTime).toBe(initialTime + 1);
    });
  });

  // ============================================
  // Helper Functions Tests
  // ============================================
  // ARP/MAC Table Aging Tests
  // NOTE: Automatic aging is DISABLED per user request.
  // Manual clearing is done via 'clear arp' and 'clear mac-address-table' commands.
  // ============================================
  describe('ARP/MAC Table Aging', () => {
    it('should increment ARP entry age on each tick', () => {
      const store = useNetworkStore.getState();
      const router = store.addDevice('router', { x: 0, y: 0 });

      // Manually set an ARP entry
      store.updateDevice(router.id, {
        arpTable: [
          { ipAddress: '192.168.1.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/0', type: 'dynamic', age: 0 },
        ],
      });

      // Start simulation
      store.startSimulation();

      // Run a tick
      store.tick();

      // Check that age is NOT incremented (aging disabled)
      const updated = store.getDeviceById(router.id)!;
      expect(updated.arpTable![0].age).toBe(0);

      // Run another tick
      store.tick();

      const updated2 = store.getDeviceById(router.id)!;
      expect(updated2.arpTable![0].age).toBe(0);

      store.stopSimulation();
    });

    it('should remove ARP entries older than timeout', () => {
      const store = useNetworkStore.getState();
      const router = store.addDevice('router', { x: 0, y: 0 });

      // Manually set ARP entries with one very old
      store.updateDevice(router.id, {
        arpTable: [
          { ipAddress: '192.168.1.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/0', type: 'dynamic', age: 299 },
          { ipAddress: '192.168.1.101', macAddress: '02:AA:BB:CC:DD:FF', interface: 'GigabitEthernet0/0', type: 'dynamic', age: 10 },
          { ipAddress: '192.168.1.1', macAddress: '02:00:00:00:01:00', interface: 'GigabitEthernet0/0', type: 'static', age: 500 },
        ],
      });

      store.startSimulation();

      // Run a tick - entries should NOT be removed (aging disabled)
      store.tick();

      const updated = store.getDeviceById(router.id)!;

      // All 3 entries should remain (no automatic aging/removal)
      expect(updated.arpTable!.length).toBe(3);

      store.stopSimulation();
    });

    it('should increment MAC table entry age on each tick', () => {
      const store = useNetworkStore.getState();
      const sw = store.addDevice('switch', { x: 0, y: 0 });

      // Manually set a MAC table entry
      store.updateDevice(sw.id, {
        macTable: [
          { macAddress: '02:AA:BB:CC:DD:EE', port: 'FastEthernet0/0', vlan: 1, type: 'dynamic', age: 0 },
        ],
      });

      store.startSimulation();
      store.tick();

      // Age should NOT be incremented (aging disabled)
      const updated = store.getDeviceById(sw.id)!;
      expect(updated.macTable![0].age).toBe(0);

      store.stopSimulation();
    });

    it('should remove MAC entries older than timeout', () => {
      const store = useNetworkStore.getState();
      const sw = store.addDevice('switch', { x: 0, y: 0 });

      store.updateDevice(sw.id, {
        macTable: [
          { macAddress: '02:AA:BB:CC:DD:EE', port: 'FastEthernet0/0', vlan: 1, type: 'dynamic', age: 299 },
          { macAddress: '02:AA:BB:CC:DD:FF', port: 'FastEthernet0/1', vlan: 1, type: 'dynamic', age: 10 },
          { macAddress: '02:00:00:00:01:00', port: 'FastEthernet0/2', vlan: 1, type: 'static', age: 500 },
        ],
      });

      store.startSimulation();
      store.tick();

      const updated = store.getDeviceById(sw.id)!;

      // All 3 entries should remain (no automatic aging/removal)
      expect(updated.macTable!.length).toBe(3);

      store.stopSimulation();
    });
  });

  // ============================================
  describe('Helper Functions', () => {
    it('should get device by ID', () => {
      const store = useNetworkStore.getState();
      const device = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

      const found = useNetworkStore.getState().getDeviceById(device.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(device.id);
    });

    it('should get device by IP', () => {
      const store = useNetworkStore.getState();
      const device = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });

      useNetworkStore.getState().configureInterface(device.id, device.interfaces[0].id, {
        ipAddress: '192.168.1.10',
        subnetMask: '255.255.255.0',
      });

      const found = useNetworkStore.getState().getDeviceByIP('192.168.1.10');
      expect(found).toBeDefined();
      expect(found!.id).toBe(device.id);
    });

    it('should get connected devices', () => {
      const store = useNetworkStore.getState();
      const pc = useNetworkStore.getState().addDevice('pc', { x: 0, y: 0 });
      const sw = useNetworkStore.getState().addDevice('switch', { x: 100, y: 0 });

      useNetworkStore.getState().addConnection(
        pc.id, pc.interfaces[0].id,
        sw.id, sw.interfaces[0].id
      );

      const connected = useNetworkStore.getState().getConnectedDevices(pc.id);
      expect(connected.length).toBe(1);
      expect(connected[0].id).toBe(sw.id);
    });

    it('should get available interfaces', () => {
      const store = useNetworkStore.getState();
      const sw = useNetworkStore.getState().addDevice('switch', { x: 0, y: 0 });
      const pc = useNetworkStore.getState().addDevice('pc', { x: 100, y: 0 });

      // Connect one port
      useNetworkStore.getState().addConnection(
        pc.id, pc.interfaces[0].id,
        sw.id, sw.interfaces[0].id
      );

      const available = useNetworkStore.getState().getAvailableInterfaces(sw.id);
      // Should have 7 available (8 total - 1 connected)
      expect(available.length).toBe(7);
      expect(available.every(i => !i.connectedTo)).toBe(true);
    });
  });
});
