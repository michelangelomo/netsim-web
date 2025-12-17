import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processDeviceTick, processLinkTick } from '@/lib/simulation';
import type { NetworkDevice, Connection, Packet, NetworkInterface } from '@/types/network';
import { generateMacAddress } from '@/lib/network-utils';

// Helper to create a mock device
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

// Helper to create a mock switch
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
      connectedTo: i < 2 ? `connected-${i}` : undefined, // First 2 ports connected
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

// Helper to create a mock router
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

// Helper to create a mock packet
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

describe('Simulation Engine', () => {
  let mockUpdateDevice: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUpdateDevice = vi.fn();
  });

  // ============================================
  // L2 Switch Logic Tests
  // ============================================
  describe('L2 Switch Logic', () => {
    describe('MAC Learning', () => {
      it('should learn source MAC address on ingress port', () => {
        const sw = createMockSwitch();
        const packet = createMockPacket({
          currentDeviceId: sw.id,
          lastDeviceId: 'pc-1',
          sourceMAC: '02:AA:BB:CC:DD:EE',
          destMAC: 'FF:FF:FF:FF:FF:FF', // Broadcast
        });

        const connections: Connection[] = [
          {
            id: 'conn-1',
            sourceDeviceId: 'pc-1',
            sourceInterfaceId: 'pc-iface-0',
            targetDeviceId: sw.id,
            targetInterfaceId: sw.interfaces[0].id,
            isUp: true,
            bandwidth: 100,
            latency: 1,
            packetLoss: 0,
          },
        ];

        processDeviceTick(sw, packet, connections, mockUpdateDevice);

        // Check that updateDevice was called with MAC table update
        expect(mockUpdateDevice).toHaveBeenCalled();
        const updateCall = mockUpdateDevice.mock.calls[0];
        expect(updateCall[0]).toBe(sw.id);
        expect(updateCall[1].macTable).toBeDefined();
        expect(updateCall[1].macTable.length).toBe(1);
        expect(updateCall[1].macTable[0].macAddress).toBe('02:AA:BB:CC:DD:EE');
        expect(updateCall[1].macTable[0].port).toBe('FastEthernet0/0');
      });

      it('should update MAC entry when source moves to different port', () => {
        const sw = createMockSwitch({
          macTable: [
            { macAddress: '02:AA:BB:CC:DD:EE', port: 'FastEthernet0/0', vlan: 1, type: 'dynamic', age: 0 },
          ],
        });

        const packet = createMockPacket({
          currentDeviceId: sw.id,
          lastDeviceId: 'pc-2',
          sourceMAC: '02:AA:BB:CC:DD:EE',
          destMAC: 'FF:FF:FF:FF:FF:FF',
        });

        // Connection from different port
        const connections: Connection[] = [
          {
            id: 'conn-2',
            sourceDeviceId: 'pc-2',
            sourceInterfaceId: 'pc-2-iface',
            targetDeviceId: sw.id,
            targetInterfaceId: sw.interfaces[1].id, // Port 1, not port 0
            isUp: true,
            bandwidth: 100,
            latency: 1,
            packetLoss: 0,
          },
        ];

        processDeviceTick(sw, packet, connections, mockUpdateDevice);

        expect(mockUpdateDevice).toHaveBeenCalled();
        const updateCall = mockUpdateDevice.mock.calls[0];
        expect(updateCall[1].macTable[0].port).toBe('FastEthernet0/1'); // Updated to new port
      });
    });

    describe('Forwarding Decision', () => {
      it('should flood broadcast frames to all ports except ingress', () => {
        const sw = createMockSwitch();
        // Connect ports 0, 1, and 2
        sw.interfaces[0].connectedTo = 'ext-0';
        sw.interfaces[1].connectedTo = 'ext-1';
        sw.interfaces[2].connectedTo = 'ext-2';

        const packet = createMockPacket({
          currentDeviceId: sw.id,
          lastDeviceId: 'pc-0',
          sourceMAC: '02:AA:BB:CC:DD:EE',
          destMAC: 'FF:FF:FF:FF:FF:FF', // Broadcast
        });

        const connections: Connection[] = [
          {
            id: 'conn-0',
            sourceDeviceId: 'pc-0',
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
            targetDeviceId: 'pc-1',
            targetInterfaceId: 'pc-1-iface',
            isUp: true,
            bandwidth: 100,
            latency: 1,
            packetLoss: 0,
          },
          {
            id: 'conn-2',
            sourceDeviceId: sw.id,
            sourceInterfaceId: sw.interfaces[2].id,
            targetDeviceId: 'pc-2',
            targetInterfaceId: 'pc-2-iface',
            isUp: true,
            bandwidth: 100,
            latency: 1,
            packetLoss: 0,
          },
        ];

        const result = processDeviceTick(sw, packet, connections, mockUpdateDevice);

        // Should create packets for ports 1 and 2 (not port 0 which is ingress)
        expect(result.length).toBe(2);
        result.forEach(p => {
          expect(p.processingStage).toBe('on-link');
          expect(p.targetDeviceId).not.toBe('pc-0');
        });
      });

      it('should forward known unicast to learned port only', () => {
        const sw = createMockSwitch({
          macTable: [
            { macAddress: '02:00:00:00:00:02', port: 'FastEthernet0/1', vlan: 1, type: 'dynamic', age: 0 },
          ],
        });
        sw.interfaces[0].connectedTo = 'ext-0';
        sw.interfaces[1].connectedTo = 'ext-1';
        sw.interfaces[2].connectedTo = 'ext-2';

        const packet = createMockPacket({
          currentDeviceId: sw.id,
          lastDeviceId: 'pc-0',
          sourceMAC: '02:00:00:00:00:01',
          destMAC: '02:00:00:00:00:02', // Known MAC
        });

        const connections: Connection[] = [
          {
            id: 'conn-0',
            sourceDeviceId: 'pc-0',
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
            targetDeviceId: 'pc-1',
            targetInterfaceId: 'pc-1-iface',
            isUp: true,
            bandwidth: 100,
            latency: 1,
            packetLoss: 0,
          },
          {
            id: 'conn-2',
            sourceDeviceId: sw.id,
            sourceInterfaceId: sw.interfaces[2].id,
            targetDeviceId: 'pc-2',
            targetInterfaceId: 'pc-2-iface',
            isUp: true,
            bandwidth: 100,
            latency: 1,
            packetLoss: 0,
          },
        ];

        const result = processDeviceTick(sw, packet, connections, mockUpdateDevice);

        // Should forward to port 1 only (where MAC was learned)
        expect(result.length).toBe(1);
        expect(result[0].targetDeviceId).toBe('pc-1');
      });

      it('should flood unknown unicast to all ports except ingress', () => {
        const sw = createMockSwitch(); // Empty MAC table
        sw.interfaces[0].connectedTo = 'ext-0';
        sw.interfaces[1].connectedTo = 'ext-1';

        const packet = createMockPacket({
          currentDeviceId: sw.id,
          lastDeviceId: 'pc-0',
          sourceMAC: '02:00:00:00:00:01',
          destMAC: '02:00:00:00:00:99', // Unknown MAC
        });

        const connections: Connection[] = [
          {
            id: 'conn-0',
            sourceDeviceId: 'pc-0',
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
            targetDeviceId: 'pc-1',
            targetInterfaceId: 'pc-1-iface',
            isUp: true,
            bandwidth: 100,
            latency: 1,
            packetLoss: 0,
          },
        ];

        const result = processDeviceTick(sw, packet, connections, mockUpdateDevice);

        // Should flood (only port 1 is available since port 0 is ingress)
        expect(result.length).toBe(1);
        expect(result[0].targetDeviceId).toBe('pc-1');
      });

      it('should drop frame if destination is on ingress port (filtering)', () => {
        const sw = createMockSwitch({
          macTable: [
            { macAddress: '02:00:00:00:00:02', port: 'FastEthernet0/0', vlan: 1, type: 'dynamic', age: 0 },
          ],
        });

        const packet = createMockPacket({
          currentDeviceId: sw.id,
          lastDeviceId: 'pc-0',
          sourceMAC: '02:00:00:00:00:01',
          destMAC: '02:00:00:00:00:02', // Learned on same port as ingress
        });

        const connections: Connection[] = [
          {
            id: 'conn-0',
            sourceDeviceId: 'pc-0',
            sourceInterfaceId: 'pc-0-iface',
            targetDeviceId: sw.id,
            targetInterfaceId: sw.interfaces[0].id,
            isUp: true,
            bandwidth: 100,
            latency: 1,
            packetLoss: 0,
          },
        ];

        const result = processDeviceTick(sw, packet, connections, mockUpdateDevice);

        // Should drop - dest is on same port as source
        expect(result.length).toBe(0);
      });
    });
  });

  // ============================================
  // L3 Routing Logic Tests
  // ============================================
  describe('L3 Routing Logic', () => {
    describe('Packet Reception', () => {
      it('should accept packets destined to device interface MAC', () => {
        const pc = createMockDevice();
        const packet = createMockPacket({
          currentDeviceId: pc.id,
          destMAC: pc.interfaces[0].macAddress,
          destIP: pc.interfaces[0].ipAddress!,
          icmpType: 8, // Echo request
        });

        const result = processDeviceTick(pc, packet, [], mockUpdateDevice);

        // Should generate ICMP reply
        expect(result.length).toBeGreaterThan(0);
      });

      it('should drop packets with unknown destination MAC (not for me)', () => {
        const pc = createMockDevice();
        const packet = createMockPacket({
          currentDeviceId: pc.id,
          sourceMAC: '02:00:00:00:00:99',
          destMAC: '02:00:00:00:00:XX', // Not my MAC
        });

        const result = processDeviceTick(pc, packet, [], mockUpdateDevice);

        // Should drop
        expect(result.length).toBe(0);
      });
    });

    describe('ICMP Processing', () => {
      it('should generate ICMP echo reply for echo request', () => {
        const pc = createMockDevice();
        const packet = createMockPacket({
          currentDeviceId: pc.id,
          sourceMAC: '02:00:00:00:00:02',
          destMAC: pc.interfaces[0].macAddress,
          sourceIP: '192.168.1.20',
          destIP: pc.interfaces[0].ipAddress!,
          icmpType: 8, // Echo request
          icmpCode: 0,
          icmpSeq: 1,
        });

        const result = processDeviceTick(pc, packet, [], mockUpdateDevice);

        expect(result.length).toBe(1);
        const reply = result[0];
        expect(reply.type).toBe('icmp');
        expect(reply.icmpType).toBe(0); // Echo reply
        expect(reply.icmpSeq).toBe(1);
        expect(reply.sourceIP).toBe(pc.interfaces[0].ipAddress);
        expect(reply.destIP).toBe('192.168.1.20');
        expect(reply.destMAC).toBe('02:00:00:00:00:02');
      });
    });

    describe('IP Routing', () => {
      it('should not decrement TTL for locally generated traffic on first hop', () => {
        const router = createMockRouter({
          arpTable: [
            { ipAddress: '10.0.0.2', macAddress: '02:CC:CC:CC:CC:CC', interface: 'GigabitEthernet0/0', type: 'dynamic', age: 0 },
          ],
          routingTable: [
            { destination: '192.168.1.0', netmask: '255.255.255.0', gateway: '0.0.0.0', interface: 'GigabitEthernet0/0', metric: 0, type: 'connected' },
            { destination: '10.0.0.0', netmask: '255.255.255.0', gateway: '0.0.0.0', interface: 'GigabitEthernet0/1', metric: 0, type: 'connected' },
            { destination: '0.0.0.0', netmask: '0.0.0.0', gateway: '10.0.0.2', interface: 'GigabitEthernet0/0', metric: 1, type: 'static' },
          ],
        });

        const packet = createMockPacket({
          currentDeviceId: router.id,
          sourceMAC: router.interfaces[0].macAddress, // Locally generated on Gi0/0
          destMAC: '00:00:00:00:00:00', // Placeholder to trigger routing
          sourceIP: router.interfaces[0].ipAddress!,
          destIP: '8.8.8.8',
          ttl: 64,
          isLocallyGenerated: true,
        });

        const connections: Connection[] = [
          {
            id: 'conn-out',
            sourceDeviceId: router.id,
            sourceInterfaceId: router.interfaces[0].id,
            targetDeviceId: 'upstream-router',
            targetInterfaceId: 'upstream-iface',
            isUp: true,
            bandwidth: 1000,
            latency: 1,
            packetLoss: 0,
          },
        ];

        const result = processDeviceTick(router, packet, connections, mockUpdateDevice);

        expect(result.length).toBe(1);
        const forwarded = result[0];
        expect(forwarded.processingStage).toBe('on-link');
        expect(forwarded.ttl).toBe(64); // No TTL decrement on the originating node
        expect(forwarded.destMAC).toBe('02:CC:CC:CC:CC:CC');
      });

      it('should route packets to directly connected networks', () => {
        const router = createMockRouter({
          arpTable: [
            { ipAddress: '10.0.0.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/1', type: 'dynamic', age: 0 },
          ],
        });

        const packet = createMockPacket({
          currentDeviceId: router.id,
          sourceMAC: '02:00:00:00:00:01',
          destMAC: router.interfaces[0].macAddress, // Sent to router
          sourceIP: '192.168.1.10',
          destIP: '10.0.0.100', // On connected network via Gi0/1
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
        const forwarded = result[0];
        expect(forwarded.sourceMAC).toBe(router.interfaces[1].macAddress); // Egress interface MAC
        expect(forwarded.destMAC).toBe('02:AA:BB:CC:DD:EE'); // From ARP table
        expect(forwarded.ttl).toBe(63); // Decremented
        expect(forwarded.processingStage).toBe('on-link');
      });

      it('should decrement TTL when routing', () => {
        const router = createMockRouter({
          arpTable: [
            { ipAddress: '10.0.0.100', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/1', type: 'dynamic', age: 0 },
          ],
        });

        const packet = createMockPacket({
          currentDeviceId: router.id,
          destMAC: router.interfaces[0].macAddress,
          destIP: '10.0.0.100',
          ttl: 10,
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
        expect(result[0].ttl).toBe(9);
      });

      it('should drop and send ICMP time exceeded when TTL expires', () => {
        const router = createMockRouter({
          arpTable: [
            { ipAddress: '192.168.1.10', macAddress: '02:AA:BB:CC:DD:EE', interface: 'GigabitEthernet0/0', type: 'dynamic', age: 0 },
          ],
        });

        const packet = createMockPacket({
          currentDeviceId: router.id,
          lastDeviceId: 'pc-1',
          destMAC: router.interfaces[0].macAddress,
          sourceIP: '192.168.1.10',
          destIP: '10.0.0.100',
          ttl: 1,
        });

        const connections: Connection[] = [
          {
            id: 'conn-ingress',
            sourceDeviceId: 'pc-1',
            sourceInterfaceId: 'pc-iface-1',
            targetDeviceId: router.id,
            targetInterfaceId: router.interfaces[0].id,
            isUp: true,
            bandwidth: 1000,
            latency: 1,
            packetLoss: 0,
          },
          {
            id: 'conn-egress',
            sourceDeviceId: router.id,
            sourceInterfaceId: router.interfaces[1].id,
            targetDeviceId: 'next-hop-router',
            targetInterfaceId: 'next-hop-iface',
            isUp: true,
            bandwidth: 1000,
            latency: 1,
            packetLoss: 0,
          },
        ];

        const result = processDeviceTick(router, packet, connections, mockUpdateDevice);

        expect(result.length).toBe(1);
        const timeExceeded = result[0];
        expect(timeExceeded.type).toBe('icmp');
        expect(timeExceeded.icmpType).toBe(11);
        expect(timeExceeded.icmpCode).toBe(0);
        expect(timeExceeded.destIP).toBe('192.168.1.10');
        expect(timeExceeded.sourceIP).toBe(router.interfaces[0].ipAddress);
        expect(timeExceeded.destMAC).toBe('02:AA:BB:CC:DD:EE');
        expect(timeExceeded.processingStage).toBe('on-link');
        expect(timeExceeded.targetDeviceId).toBe('pc-1');
      });

      it('should use routing table for non-connected networks', () => {
        const router = createMockRouter({
          routingTable: [
            { destination: '192.168.1.0', netmask: '255.255.255.0', gateway: '0.0.0.0', interface: 'GigabitEthernet0/0', metric: 0, type: 'connected' },
            { destination: '10.0.0.0', netmask: '255.255.255.0', gateway: '0.0.0.0', interface: 'GigabitEthernet0/1', metric: 0, type: 'connected' },
            { destination: '172.16.0.0', netmask: '255.255.0.0', gateway: '10.0.0.254', interface: 'GigabitEthernet0/1', metric: 10, type: 'static' },
          ],
          arpTable: [
            { ipAddress: '10.0.0.254', macAddress: '02:BB:BB:BB:BB:BB', interface: 'GigabitEthernet0/1', type: 'dynamic', age: 0 },
          ],
        });

        const packet = createMockPacket({
          currentDeviceId: router.id,
          destMAC: router.interfaces[0].macAddress,
          destIP: '172.16.1.100', // Matches static route via 10.0.0.254
        });

        const connections: Connection[] = [
          {
            id: 'conn-1',
            sourceDeviceId: router.id,
            sourceInterfaceId: router.interfaces[1].id,
            targetDeviceId: 'next-hop-router',
            targetInterfaceId: 'next-hop-iface',
            isUp: true,
            bandwidth: 1000,
            latency: 1,
            packetLoss: 0,
          },
        ];

        const result = processDeviceTick(router, packet, connections, mockUpdateDevice);

        expect(result.length).toBe(1);
        const forwarded = result[0];
        // Should be forwarded to next-hop MAC (10.0.0.254's MAC)
        expect(forwarded.destMAC).toBe('02:BB:BB:BB:BB:BB');
        expect(forwarded.targetDeviceId).toBe('next-hop-router');
      });

      it('should prefer most specific route when routing via SVIs', () => {
        const switchL3: NetworkDevice = {
          id: 'lsw-1',
          type: 'switch',
          name: 'L3Switch',
          hostname: 'l3switch',
          interfaces: [
            {
              id: 'sw-if-acc',
              name: 'FastEthernet0/0',
              macAddress: '02:00:00:00:10:10',
              ipAddress: null,
              subnetMask: null,
              gateway: null,
              isUp: true,
              speed: 100,
              duplex: 'full',
              vlanMode: 'access',
              accessVlan: 10,
              connectedTo: 'host-iface',
            },
            {
              id: 'sw-if-trunk',
              name: 'FastEthernet0/1',
              macAddress: '02:00:00:00:20:20',
              ipAddress: null,
              subnetMask: null,
              gateway: null,
              isUp: true,
              speed: 100,
              duplex: 'full',
              vlanMode: 'trunk',
              allowedVlans: [10, 20],
              nativeVlan: 10,
              connectedTo: 'next-hop-trunk',
            },
          ],
          position: { x: 0, y: 0 },
          isRunning: true,
          macTable: [],
          sviInterfaces: [
            { vlanId: 10, ipAddress: '10.10.0.1', subnetMask: '255.255.0.0', macAddress: 'AA:AA:AA:AA:AA:10', isUp: true },
            { vlanId: 20, ipAddress: '10.20.0.1', subnetMask: '255.255.0.0', macAddress: 'AA:AA:AA:AA:AA:20', isUp: true },
          ],
          routingTable: [
            { destination: '0.0.0.0', netmask: '0.0.0.0', gateway: '10.10.0.254', interface: 'Vlan10', metric: 50, type: 'static' },
            { destination: '10.20.0.0', netmask: '255.255.0.0', gateway: '0.0.0.0', interface: 'Vlan20', metric: 100, type: 'connected' },
          ],
          arpTable: [],
          config: {},
        };

        const packet = createMockPacket({
          id: 'pkt-svi',
          currentDeviceId: switchL3.id,
          lastDeviceId: 'host-1',
          sourceMAC: '02:11:22:33:44:55',
          destMAC: 'AA:AA:AA:AA:AA:10', // Sent to SVI in VLAN 10 (default gateway)
          sourceIP: '10.10.5.5',
          destIP: '10.20.5.5', // Matches the more specific 10.20.0.0/16 route
          ttl: 64,
          vlanTag: 10,
          processingStage: 'at-device',
        });

        const connections: Connection[] = [
          {
            id: 'conn-trunk',
            sourceDeviceId: switchL3.id,
            sourceInterfaceId: 'sw-if-trunk',
            targetDeviceId: 'next-hop',
            targetInterfaceId: 'next-hop-iface',
            isUp: true,
            bandwidth: 1000,
            latency: 1,
            packetLoss: 0,
          },
        ];

        const result = processDeviceTick(switchL3, packet, connections, mockUpdateDevice);

        const arpRequest = result.find((p) => p.type === 'arp');
        expect(arpRequest).toBeDefined();
        expect(arpRequest!.sourceMAC).toBe('AA:AA:AA:AA:AA:20'); // Should egress via Vlan20 (more specific route)
        expect(arpRequest!.vlanTag).toBe(20);
        expect(arpRequest!.targetDeviceId).toBe('next-hop');

        const buffered = result.find((p) => p.processingStage === 'buffered');
        expect(buffered).toBeDefined();
        expect((buffered as Packet).waitingForArp).toBe('10.20.5.5');
      });
    });

    describe('ARP Protocol', () => {
      it('should send ARP request when MAC is unknown', () => {
        const router = createMockRouter(); // Empty ARP table

        const packet = createMockPacket({
          currentDeviceId: router.id,
          destMAC: router.interfaces[0].macAddress,
          sourceIP: '192.168.1.10',
          destIP: '10.0.0.100', // ARP not known
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

        // Should have ARP request and buffered original packet
        expect(result.length).toBe(2);

        const arpRequest = result.find(p => p.type === 'arp');
        expect(arpRequest).toBeDefined();
        expect(arpRequest!.destMAC).toBe('FF:FF:FF:FF:FF:FF'); // Broadcast
        expect((arpRequest!.payload as any).type).toBe('REQUEST');
        expect((arpRequest!.payload as any).targetIP).toBe('10.0.0.100');

        const bufferedPacket = result.find(p => p.processingStage === 'buffered');
        expect(bufferedPacket).toBeDefined();
        expect(bufferedPacket!.waitingForArp).toBe('10.0.0.100');
      });

      it('should learn MAC from ARP reply and update table', () => {
        const pc = createMockDevice();

        const arpReply = createMockPacket({
          type: 'arp',
          currentDeviceId: pc.id,
          sourceMAC: '02:AA:AA:AA:AA:AA',
          destMAC: pc.interfaces[0].macAddress,
          payload: {
            type: 'REPLY',
            senderIP: '192.168.1.20',
            targetIP: pc.interfaces[0].ipAddress,
          },
        });

        processDeviceTick(pc, arpReply, [], mockUpdateDevice);

        expect(mockUpdateDevice).toHaveBeenCalled();
        const updateCall = mockUpdateDevice.mock.calls[0];
        expect(updateCall[1].arpTable).toBeDefined();
        expect(updateCall[1].arpTable.length).toBe(1);
        expect(updateCall[1].arpTable[0].ipAddress).toBe('192.168.1.20');
        expect(updateCall[1].arpTable[0].macAddress).toBe('02:AA:AA:AA:AA:AA');
      });

      it('should respond to ARP request for own IP', () => {
        const pc = createMockDevice();

        const arpRequest = createMockPacket({
          type: 'arp',
          currentDeviceId: pc.id,
          sourceMAC: '02:00:00:00:00:02',
          destMAC: 'FF:FF:FF:FF:FF:FF', // Broadcast
          payload: {
            type: 'REQUEST',
            senderIP: '192.168.1.20',
            targetIP: pc.interfaces[0].ipAddress, // Asking for my IP
          },
        });

        const result = processDeviceTick(pc, arpRequest, [], mockUpdateDevice);

        // Should generate ARP reply
        const arpReply = result.find(p => p.type === 'arp' && (p.payload as any).type === 'REPLY');
        expect(arpReply).toBeDefined();
        expect(arpReply!.sourceMAC).toBe(pc.interfaces[0].macAddress);
        expect(arpReply!.destMAC).toBe('02:00:00:00:00:02');
        expect((arpReply!.payload as any).senderIP).toBe(pc.interfaces[0].ipAddress);
      });

      it('should put ARP reply on-link when connected', () => {
        const pc = createMockDevice();

        const arpRequest = createMockPacket({
          type: 'arp',
          currentDeviceId: pc.id,
          sourceMAC: '02:00:00:00:00:02',
          destMAC: 'FF:FF:FF:FF:FF:FF',
          payload: {
            type: 'REQUEST',
            senderIP: '192.168.1.20',
            targetIP: pc.interfaces[0].ipAddress,
          },
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

        const result = processDeviceTick(pc, arpRequest, connections, mockUpdateDevice);
        const arpReply = result.find(p => p.type === 'arp' && (p.payload as any).type === 'REPLY');
        expect(arpReply).toBeDefined();
        expect(arpReply!.processingStage).toBe('on-link');
        expect(arpReply!.targetDeviceId).toBe('switch-1');
      });

      it('should ignore ARP request for other IPs', () => {
        const pc = createMockDevice();

        const arpRequest = createMockPacket({
          type: 'arp',
          currentDeviceId: pc.id,
          sourceMAC: '02:00:00:00:00:02',
          destMAC: 'FF:FF:FF:FF:FF:FF',
          payload: {
            type: 'REQUEST',
            senderIP: '192.168.1.20',
            targetIP: '192.168.1.99', // Not my IP
          },
        });

        const result = processDeviceTick(pc, arpRequest, [], mockUpdateDevice);

        // Should not generate ARP reply, but still learn sender's MAC
        const arpReply = result.find(p => p.type === 'arp' && (p.payload as any).type === 'REPLY');
        expect(arpReply).toBeUndefined();
      });
    });

    describe('Default Gateway', () => {
      it('should use default gateway for non-local destinations', () => {
        const pc = createMockDevice({
          arpTable: [
            { ipAddress: '192.168.1.1', macAddress: '02:00:00:00:01:00', interface: 'eth0', type: 'dynamic', age: 0 },
          ],
        });

        const packet = createMockPacket({
          currentDeviceId: pc.id,
          sourceMAC: pc.interfaces[0].macAddress,
          destMAC: '00:00:00:00:00:00', // Placeholder - needs routing
          sourceIP: pc.interfaces[0].ipAddress!,
          destIP: '8.8.8.8', // External destination
        });

        const connections: Connection[] = [
          {
            id: 'conn-1',
            sourceDeviceId: pc.id,
            sourceInterfaceId: pc.interfaces[0].id,
            targetDeviceId: 'router-1',
            targetInterfaceId: 'router-iface-0',
            isUp: true,
            bandwidth: 1000,
            latency: 1,
            packetLoss: 0,
          },
        ];

        const result = processDeviceTick(pc, packet, connections, mockUpdateDevice);

        expect(result.length).toBe(1);
        // Should use gateway's MAC
        expect(result[0].destMAC).toBe('02:00:00:00:01:00');
      });
    });
  });

  // ============================================
  // Link Processing Tests
  // ============================================
  describe('Link Processing', () => {
    describe('processLinkTick', () => {
      it('should increment packet progress on link', () => {
        const packet = createMockPacket({
          processingStage: 'on-link',
          targetDeviceId: 'target-device',
          currentDeviceId: 'device-1',
          progress: 0,
          size: 1500,
        });

        const connections: Connection[] = [
          {
            id: 'c1',
            sourceDeviceId: 'device-1',
            sourceInterfaceId: 'iface-a',
            targetDeviceId: 'target-device',
            targetInterfaceId: 'iface-b',
            isUp: true,
            bandwidth: 10,
            latency: 50,
            packetLoss: 0,
          },
        ];

        const result = processLinkTick(packet, connections, 1);

        expect(result.progress).toBeGreaterThan(0);
        expect(result.processingStage).toBe('on-link');
      });

      it('should mark packet as arrived when progress reaches 100', () => {
        const packet = createMockPacket({
          processingStage: 'on-link',
          targetDeviceId: 'target-device',
          currentDeviceId: 'source-device',
          progress: 99,
        });

        const connections: Connection[] = [
          {
            id: 'c1',
            sourceDeviceId: 'source-device',
            sourceInterfaceId: 'iface-a',
            targetDeviceId: 'target-device',
            targetInterfaceId: 'iface-b',
            isUp: true,
            bandwidth: 100,
            latency: 1,
            packetLoss: 0,
          },
        ];

        const result = processLinkTick(packet, connections, 1);

        expect(result.processingStage).toBe('at-device');
        expect(result.currentDeviceId).toBe('target-device');
        expect(result.lastDeviceId).toBe('source-device');
        expect(result.targetDeviceId).toBeUndefined();
        expect(result.progress).toBe(0);
      });

      it('should respect simulation speed', () => {
        const packet = createMockPacket({
          processingStage: 'on-link',
          targetDeviceId: 'target-device',
          currentDeviceId: 'device-1',
          progress: 0,
          size: 1500,
        });

        const connections: Connection[] = [
          {
            id: 'c1',
            sourceDeviceId: 'device-1',
            sourceInterfaceId: 'iface-a',
            targetDeviceId: 'target-device',
            targetInterfaceId: 'iface-b',
            isUp: true,
            bandwidth: 10,
            latency: 50,
            packetLoss: 0,
          },
        ];

        const result1x = processLinkTick(packet, connections, 1);
        const result2x = processLinkTick(packet, connections, 2);

        expect(result2x.progress).toBeGreaterThan(result1x.progress);
      });

      it('should be slower on low bandwidth/high latency links', () => {
        const packet = createMockPacket({
          processingStage: 'on-link',
          targetDeviceId: 'target-device',
          currentDeviceId: 'source-device',
          progress: 0,
          size: 1_000_000,
        });

        const slowConn: Connection = {
          id: 'slow',
          sourceDeviceId: 'source-device',
          sourceInterfaceId: 'iface-a',
          targetDeviceId: 'target-device',
          targetInterfaceId: 'iface-b',
          isUp: true,
          bandwidth: 10, // Mbps
          latency: 50,   // ms
          packetLoss: 0,
        };

        const fastConn: Connection = { ...slowConn, id: 'fast', bandwidth: 1000, latency: 20 };

        const slowResult = processLinkTick(packet, [slowConn], 1);
        const fastResult = processLinkTick(packet, [fastConn], 1);

        expect(fastResult.progress).toBeGreaterThan(slowResult.progress);
      });

      it('should drop packet when packetLoss triggers', () => {
        const packet = createMockPacket({
          processingStage: 'on-link',
          targetDeviceId: 'target-device',
          currentDeviceId: 'source-device',
          progress: 0,
        });

        const conn: Connection = {
          id: 'lossy',
          sourceDeviceId: 'source-device',
          sourceInterfaceId: 'iface-a',
          targetDeviceId: 'target-device',
          targetInterfaceId: 'iface-b',
          isUp: true,
          bandwidth: 100,
          latency: 1,
          packetLoss: 100,
        };

        const randSpy = vi.spyOn(Math, 'random').mockReturnValue(0.0);
        const result = processLinkTick(packet, [conn], 1);
        randSpy.mockRestore();

        expect(result.processingStage).toBe('dropped');
      });

      it('should not process packets not on link', () => {
        const packet = createMockPacket({
          processingStage: 'at-device',
          progress: 50,
        });

        const result = processLinkTick(packet, [], 1);

        expect(result.progress).toBe(50); // Unchanged
        expect(result.processingStage).toBe('at-device');
      });

      it('should not process packets without target', () => {
        const packet = createMockPacket({
          processingStage: 'on-link',
          targetDeviceId: undefined,
          progress: 0,
        });

        const result = processLinkTick(packet, [], 1);

        expect(result.progress).toBe(0); // Unchanged
      });
    });
  });
});
