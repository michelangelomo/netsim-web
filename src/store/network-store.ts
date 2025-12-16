'use client';

import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  NetworkDevice,
  DeviceType,
  Connection,
  Packet,
  NetworkInterface,
  RouteEntry,
  ArpEntry,
  MacTableEntry,
  Notification,
  SimulationState,
  DhcpServerConfig,
  DhcpLease,
  StpConfig,
  StpPortConfig,
  StpPortState,
  StpPortRole,
  BpduPayload,
  TcpConnection,
} from '@/types/network';
import {
  generateMacAddress,
  getInterfaceName,
  deviceDefaults,
  isSameNetwork,
  getNetworkAddress,
  findBestRoute,
  isBroadcastMAC,
} from '@/lib/network-utils';
import { processDeviceTick, processLinkTick } from '@/lib/simulation';

type DhcpServerMatch = { device: NetworkDevice; config: DhcpServerConfig };

// ============================================
// STP Helper Functions
// ============================================

// Create a Bridge ID from priority and MAC address
function createBridgeId(priority: number, macAddress: string): string {
  const priorityHex = priority.toString(16).padStart(4, '0');
  return `${priorityHex}.${macAddress.toLowerCase()}`;
}

// Compare two Bridge IDs (lower is better, returns negative if a < b)
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

// Calculate path cost based on interface speed (IEEE 802.1D-2004)
function calculatePathCost(speed: number): number {
  // speed is in Mbps
  if (speed >= 10000) return 2;      // 10 Gbps
  if (speed >= 1000) return 4;       // 1 Gbps
  if (speed >= 100) return 19;       // 100 Mbps
  if (speed >= 10) return 100;       // 10 Mbps
  return 200;                         // Default
}

function getDhcpServers(device: NetworkDevice): DhcpServerConfig[] {
  const current = device.dhcpServers;
  if (Array.isArray(current)) return current;

  // Legacy migration: device.dhcpServer -> device.dhcpServers
  const legacy = (device as any).dhcpServer as DhcpServerConfig | undefined;
  if (!legacy) return [];

  const ifaceId = device.interfaces.find((i) => i.name === (legacy as any).interface)?.id ?? device.interfaces[0]?.id;
  if (!ifaceId) return [];

  const ifaceName = device.interfaces.find((i) => i.id === ifaceId)?.name;

  return [
    {
      ...legacy,
      interfaceId: (legacy as any).interfaceId ?? ifaceId,
      interfaceName: (legacy as any).interfaceName ?? ifaceName,
      interface: (legacy as any).interface,
    },
  ];
}

function setDhcpServersOnDevice(device: NetworkDevice, dhcpServers: DhcpServerConfig[]): NetworkDevice {
  const next: any = { ...device, dhcpServers };
  if ('dhcpServer' in next) delete next.dhcpServer;
  return next as NetworkDevice;
}

function getReachableL2InterfaceIdsFromInterface(
  startDeviceId: string,
  startInterfaceId: string,
  devices: NetworkDevice[],
  connections: Connection[]
): Set<string> {
  const reachable = new Set<string>();

  const connection = connections.find(
    (c) => c.isUp && (c.sourceInterfaceId === startInterfaceId || c.targetInterfaceId === startInterfaceId)
  );
  if (!connection) return reachable;

  const otherSide =
    connection.sourceInterfaceId === startInterfaceId
      ? { deviceId: connection.targetDeviceId, interfaceId: connection.targetInterfaceId }
      : { deviceId: connection.sourceDeviceId, interfaceId: connection.sourceInterfaceId };

  const queue: Array<{ deviceId: string; ingressInterfaceId: string }> = [
    { deviceId: otherSide.deviceId, ingressInterfaceId: otherSide.interfaceId },
  ];

  while (queue.length > 0) {
    const { deviceId, ingressInterfaceId } = queue.shift()!;
    if (reachable.has(ingressInterfaceId)) continue;
    reachable.add(ingressInterfaceId);

    const device = devices.find((d) => d.id === deviceId);
    if (!device) continue;

    // Only L2 forwarding devices propagate broadcasts
    const forwardsL2 = device.type === 'switch' || device.type === 'hub';
    if (!forwardsL2) continue;

    for (const iface of device.interfaces) {
      if (!iface.isUp || !iface.connectedTo) continue;
      if (iface.id === ingressInterfaceId) continue;

      const conn = connections.find(
        (c) => c.isUp && (c.sourceInterfaceId === iface.id || c.targetInterfaceId === iface.id)
      );
      if (!conn) continue;

      const nextHop =
        conn.sourceInterfaceId === iface.id
          ? { deviceId: conn.targetDeviceId, interfaceId: conn.targetInterfaceId }
          : { deviceId: conn.sourceDeviceId, interfaceId: conn.sourceInterfaceId };

      queue.push({ deviceId: nextHop.deviceId, ingressInterfaceId: nextHop.interfaceId });
    }
  }

  return reachable;
}

interface NetworkStore {
  // Devices and connections
  devices: NetworkDevice[];
  connections: Connection[];

  // Selection state
  selectedDeviceId: string | null;
  selectedConnectionId: string | null;

  // Tool state
  currentTool: 'select' | 'connect' | 'delete';
  connectionStart: { deviceId: string; interfaceId: string } | null;

  // Simulation state
  simulation: SimulationState;
  packets: Packet[];

  // Terminal state
  activeTerminalDevice: string | null;
  terminalHistory: Map<string, Array<{ command: string; output: string; timestamp: number }>>;

  // Notifications
  notifications: Notification[];

  // Device counters for naming
  deviceCounters: Record<DeviceType, number>;

  // Actions - Devices
  addDevice: (type: DeviceType, position: { x: number; y: number }) => NetworkDevice;
  removeDevice: (deviceId: string) => void;
  updateDevice: (deviceId: string, updates: Partial<NetworkDevice>) => void;
  updateDevicePosition: (deviceId: string, position: { x: number; y: number }) => void;
  selectDevice: (deviceId: string | null) => void;
  duplicateDevice: (deviceId: string) => void;

  // Actions - Connections
  addConnection: (
    sourceDeviceId: string,
    sourceInterfaceId: string,
    targetDeviceId: string,
    targetInterfaceId: string
  ) => Connection | null;
  removeConnection: (connectionId: string) => void;
  selectConnection: (connectionId: string | null) => void;
  startConnection: (deviceId: string, interfaceId: string) => void;
  cancelConnection: () => void;

  // Actions - Interface configuration
  configureInterface: (
    deviceId: string,
    interfaceId: string,
    config: Partial<NetworkInterface>
  ) => void;

  // Actions - Routing
  addRoute: (deviceId: string, route: Omit<RouteEntry, 'type'> & { type?: RouteEntry['type'] }) => void;
  upsertRoute: (deviceId: string, route: Omit<RouteEntry, 'type'> & { type?: RouteEntry['type'] }) => void;
  removeRoute: (deviceId: string, destination: string, netmask?: string) => void;

  // Actions - Simulation
  startSimulation: () => void;
  stopSimulation: () => void;
  setSimulationSpeed: (speed: number) => void;
  tick: () => void;

  // Actions - Packets
  sendPacket: (packet: Omit<Packet, 'id' | 'path' | 'currentPathIndex' | 'processingStage' | 'progress'>) => void;
  sendPing: (sourceDeviceId: string, destIP: string) => Promise<string>;
  clearPackets: () => void;

  // Actions - ARP
  resolveARP: (deviceId: string, targetIP: string) => string | null;
  updateArpTable: (deviceId: string, entry: ArpEntry) => void;

  // Actions - MAC Table (for switches)
  learnMAC: (deviceId: string, macAddress: string, port: string, vlan?: number) => void;
  lookupMAC: (deviceId: string, macAddress: string, vlan?: number) => string | null;

  // Actions - VLAN (for switches)
  addVlan: (deviceId: string, vlan: { id: number; name: string }) => boolean;
  removeVlan: (deviceId: string, vlanId: number) => boolean;
  addSvi: (deviceId: string, svi: { vlanId: number; ipAddress?: string; subnetMask?: string; isUp: boolean }) => boolean;
  removeSvi: (deviceId: string, vlanId: number) => boolean;
  updateInterface: (deviceId: string, interfaceId: string, updates: Partial<NetworkInterface>) => void;

  // Actions - STP (Spanning Tree Protocol)
  enableStp: (deviceId: string) => void;
  disableStp: (deviceId: string) => void;
  setStpBridgePriority: (deviceId: string, priority: number) => void;
  setStpPortCost: (deviceId: string, interfaceId: string, cost: number) => void;
  setStpPortPriority: (deviceId: string, interfaceId: string, priority: number) => void;
  runStpConvergence: () => void;
  generateStpBpdus: (deviceId: string) => Packet[];

  // Actions - TCP
  tcpListen: (deviceId: string, port: number) => boolean;
  tcpConnect: (deviceId: string, destIP: string, destPort: number) => string | null;
  tcpClose: (deviceId: string, connectionId: string) => void;
  sendTcpPacket: (deviceId: string, destIP: string, destPort: number, flags: { syn?: boolean; ack?: boolean; fin?: boolean; rst?: boolean; psh?: boolean }, sourcePort?: number) => void;

  // Actions - DHCP
  configureDhcpServer: (deviceId: string, interfaceId: string, config: Partial<DhcpServerConfig>) => void;
  requestDhcp: (deviceId: string, interfaceId: string) => Promise<string>;
  releaseDhcp: (deviceId: string, interfaceId: string) => void;
  findDhcpServer: (deviceId: string, interfaceId: string) => DhcpServerMatch | null;

  // Actions - DNS
  resolveDNS: (deviceId: string, hostname: string) => Promise<string | null>;
  reverseDNS: (deviceId: string, ip: string) => Promise<string | null>;

  // Actions - Tools
  setCurrentTool: (tool: 'select' | 'connect' | 'delete') => void;

  // Actions - Terminal
  setActiveTerminal: (deviceId: string | null) => void;
  executeCommand: (deviceId: string, command: string) => string;
  addTerminalHistory: (deviceId: string, command: string, output: string) => void;
  clearTerminalHistory: (deviceId: string) => void;

  // Actions - Notifications
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;

  // Actions - Project
  clearProject: () => void;
  loadProject: (data: { devices: NetworkDevice[]; connections: Connection[] }) => void;
  exportProject: () => { devices: NetworkDevice[]; connections: Connection[] };

  // Helpers
  getDeviceById: (id: string) => NetworkDevice | undefined;
  getConnectionById: (id: string) => Connection | undefined;
  getConnectedDevices: (deviceId: string) => NetworkDevice[];
  getDeviceByIP: (ip: string) => NetworkDevice | undefined;
  getAvailableInterfaces: (deviceId: string) => NetworkInterface[];
}

// Create a device with default configuration
function createDevice(type: DeviceType, position: { x: number; y: number }, counter: number): NetworkDevice {
  const defaults = deviceDefaults[type];
  const id = uuidv4();
  const name = `${defaults.prefix}${counter}`;
  const hostname = name.toLowerCase().replace(/\s/g, '-');

  // Create interfaces
  const interfaces: NetworkInterface[] = [];
  const interfaceCount = defaults.interfaces;

  for (let i = 0; i < interfaceCount; i++) {
    const iface: NetworkInterface = {
      id: uuidv4(),
      name: getInterfaceName(type, i),
      macAddress: generateMacAddress(),
      ipAddress: null,
      subnetMask: null,
      gateway: null,
      isUp: true,
      speed: type === 'switch' ? 100 : 1000,
      duplex: 'full',
      vlan: 1,
    };

    // Add VLAN properties for switch interfaces
    if (type === 'switch') {
      iface.vlanMode = 'access';
      iface.accessVlan = 1;
    }

    interfaces.push(iface);
  }

  const device: NetworkDevice = {
    id,
    type,
    name,
    hostname,
    interfaces,
    position,
    isRunning: true,
    arpTable: [],
    config: {},
  };

  // Add routing table for routers and firewalls
  if (type === 'router' || type === 'firewall' || type === 'cloud') {
    device.routingTable = [];
  }

  // Add MAC table for switches
  if (type === 'switch') {
    device.macTable = [];
    device.vlans = [{ id: 1, name: 'default' }];
    device.sviInterfaces = [];
  }

  // Add firewall rules for firewalls
  if (type === 'firewall') {
    device.firewallRules = [
      {
        id: uuidv4(),
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
    ];
  }

  // DHCP servers (per-interface) for routers/servers
  if (type === 'router' || type === 'server') {
    device.dhcpServers = [];
  }

  // TCP connections for devices that can initiate/accept TCP connections
  if (type === 'pc' || type === 'laptop' || type === 'server' || type === 'router' || type === 'firewall') {
    device.tcpConnections = [];
  }

  return device;
}

export const useNetworkStore = create<NetworkStore>((set, get) => ({
  // Initial state
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

  // Device actions
  addDevice: (type, position) => {
    const counter = get().deviceCounters[type] + 1;
    const device = createDevice(type, position, counter);

    set((state) => ({
      devices: [...state.devices, device],
      deviceCounters: {
        ...state.deviceCounters,
        [type]: counter,
      },
    }));

    get().addNotification({
      type: 'success',
      title: 'Device Added',
      message: `${device.name} has been added to the network`,
    });

    return device;
  },

  removeDevice: (deviceId) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return;

    // Remove all connections to this device
    const connectionsToRemove = get().connections.filter(
      (c) => c.sourceDeviceId === deviceId || c.targetDeviceId === deviceId
    );
    connectionsToRemove.forEach((c) => get().removeConnection(c.id));

    set((state) => ({
      devices: state.devices.filter((d) => d.id !== deviceId),
      selectedDeviceId: state.selectedDeviceId === deviceId ? null : state.selectedDeviceId,
    }));

    get().addNotification({
      type: 'info',
      title: 'Device Removed',
      message: `${device.name} has been removed from the network`,
    });
  },

  updateDevice: (deviceId, updates) => {
    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === deviceId ? { ...d, ...updates } : d
      ),
    }));
  },

  updateDevicePosition: (deviceId, position) => {
    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === deviceId ? { ...d, position } : d
      ),
    }));
  },

  selectDevice: (deviceId) => {
    set({ selectedDeviceId: deviceId, selectedConnectionId: null });
  },

  duplicateDevice: (deviceId) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return;

    const newDevice = get().addDevice(device.type, {
      x: device.position.x + 100,
      y: device.position.y + 100,
    });

    // Copy interface configuration (except MAC addresses and connections)
    device.interfaces.forEach((iface, index) => {
      if (newDevice.interfaces[index]) {
        get().configureInterface(newDevice.id, newDevice.interfaces[index].id, {
          ipAddress: null, // Don't copy IP to avoid conflicts
          subnetMask: iface.subnetMask,
          gateway: iface.gateway,
          isUp: iface.isUp,
          vlan: iface.vlan,
        });
      }
    });
  },

  // Connection actions
  addConnection: (sourceDeviceId, sourceInterfaceId, targetDeviceId, targetInterfaceId) => {
    // Validate connection
    const sourceDevice = get().getDeviceById(sourceDeviceId);
    const targetDevice = get().getDeviceById(targetDeviceId);
    if (!sourceDevice || !targetDevice) return null;

    const sourceInterface = sourceDevice.interfaces.find((i) => i.id === sourceInterfaceId);
    const targetInterface = targetDevice.interfaces.find((i) => i.id === targetInterfaceId);
    if (!sourceInterface || !targetInterface) return null;

    // Check if interfaces are already connected
    if (sourceInterface.connectedTo || targetInterface.connectedTo) {
      get().addNotification({
        type: 'error',
        title: 'Connection Failed',
        message: 'One or both interfaces are already connected',
      });
      return null;
    }

    const connection: Connection = {
      id: uuidv4(),
      sourceDeviceId,
      sourceInterfaceId,
      targetDeviceId,
      targetInterfaceId,
      isUp: true,
      bandwidth: Math.min(sourceInterface.speed, targetInterface.speed),
      latency: 1,
      packetLoss: 0,
    };

    // Update interfaces to mark as connected
    set((state) => ({
      connections: [...state.connections, connection],
      devices: state.devices.map((d) => {
        if (d.id === sourceDeviceId) {
          return {
            ...d,
            interfaces: d.interfaces.map((i) =>
              i.id === sourceInterfaceId ? { ...i, connectedTo: targetInterfaceId } : i
            ),
          };
        }
        if (d.id === targetDeviceId) {
          return {
            ...d,
            interfaces: d.interfaces.map((i) =>
              i.id === targetInterfaceId ? { ...i, connectedTo: sourceInterfaceId } : i
            ),
          };
        }
        return d;
      }),
      connectionStart: null,
    }));

    get().addNotification({
      type: 'success',
      title: 'Connected',
      message: `${sourceDevice.name}:${sourceInterface.name} <-> ${targetDevice.name}:${targetInterface.name}`,
    });

    return connection;
  },

  removeConnection: (connectionId) => {
    const connection = get().getConnectionById(connectionId);
    if (!connection) return;

    set((state) => ({
      connections: state.connections.filter((c) => c.id !== connectionId),
      devices: state.devices.map((d) => {
        if (d.id === connection.sourceDeviceId || d.id === connection.targetDeviceId) {
          return {
            ...d,
            interfaces: d.interfaces.map((i) => {
              if (i.id === connection.sourceInterfaceId || i.id === connection.targetInterfaceId) {
                return { ...i, connectedTo: undefined };
              }
              return i;
            }),
          };
        }
        return d;
      }),
      selectedConnectionId: state.selectedConnectionId === connectionId ? null : state.selectedConnectionId,
    }));
  },

  selectConnection: (connectionId) => {
    set({ selectedConnectionId: connectionId, selectedDeviceId: null });
  },

  startConnection: (deviceId, interfaceId) => {
    set({ connectionStart: { deviceId, interfaceId } });
  },

  cancelConnection: () => {
    set({ connectionStart: null });
  },

  // Interface configuration
  configureInterface: (deviceId, interfaceId, config) => {
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          interfaces: d.interfaces.map((i) =>
            i.id === interfaceId ? { ...i, ...config } : i
          ),
        };
      }),
    }));

    // Auto-add connected route if IP is configured on a router
    const device = get().getDeviceById(deviceId);
    if (device && (device.type === 'router' || device.type === 'firewall') && config.ipAddress && config.subnetMask) {
      const networkAddr = getNetworkAddress(config.ipAddress, config.subnetMask);
      const iface = device.interfaces.find((i) => i.id === interfaceId);
      if (iface) {
        get().addRoute(deviceId, {
          destination: networkAddr,
          netmask: config.subnetMask,
          gateway: '0.0.0.0',
          interface: iface.name,
          metric: 0,
          type: 'connected',
        });
      }
    }
  },

  // Routing
  addRoute: (deviceId, route) => {
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId || !d.routingTable) return d;
        // Check if route already exists
        const exists = d.routingTable.some(
          (r) => r.destination === route.destination && r.netmask === route.netmask
        );
        if (exists) return d;
        return {
          ...d,
          routingTable: [...d.routingTable, { ...route, type: route.type || 'static' }],
        };
      }),
    }));
  },

  upsertRoute: (deviceId, route) => {
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId || !d.routingTable) return d;
        const idx = d.routingTable.findIndex(
          (r) => r.destination === route.destination && r.netmask === route.netmask
        );
        const nextEntry: RouteEntry = { ...route, type: route.type || 'static' };
        if (idx >= 0) {
          return {
            ...d,
            routingTable: d.routingTable.map((r, i) => (i === idx ? nextEntry : r)),
          };
        }
        return {
          ...d,
          routingTable: [...d.routingTable, nextEntry],
        };
      }),
    }));
  },

  removeRoute: (deviceId, destination, netmask) => {
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId || !d.routingTable) return d;
        return {
          ...d,
          routingTable: d.routingTable.filter((r) => {
            if (netmask) return !(r.destination === destination && r.netmask === netmask);
            return r.destination !== destination;
          }),
        };
      }),
    }));
  },

  // Simulation
  startSimulation: () => {
    set((state) => ({
      simulation: { ...state.simulation, isRunning: true },
    }));
    get().addNotification({
      type: 'success',
      title: 'Simulation Started',
      message: 'Network simulation is now running',
    });
  },

  stopSimulation: () => {
    // Clear ARP and MAC tables on simulation stop
    set((state) => ({
      simulation: { ...state.simulation, isRunning: false },
      packets: [],
      devices: state.devices.map((device) => ({
        ...device,
        arpTable: [],
        macTable: [],
      })),
    }));
    get().addNotification({
      type: 'info',
      title: 'Simulation Stopped',
      message: 'Network simulation has been stopped. ARP and MAC tables cleared.',
    });
  },

  setSimulationSpeed: (speed) => {
    set((state) => ({
      simulation: { ...state.simulation, speed },
    }));
  },

  tick: () => {
    const state = get();
    if (!state.simulation.isRunning) return;

    const newPackets: Packet[] = [];
    const processedPacketIds = new Set<string>();

    // Process each packet
    for (const packet of state.packets) {
      if (processedPacketIds.has(packet.id)) continue;
      processedPacketIds.add(packet.id);

      let result: Packet[] | Packet = [];

      if (packet.processingStage === 'at-device') {
        const device = state.devices.find((d) => d.id === packet.currentDeviceId);
        if (device) {
          result = processDeviceTick(
            device,
            packet,
            state.connections,
            state.updateDevice
          );
        } else {
          result = []; // Device gone, drop packet
        }
      } else if (packet.processingStage === 'on-link') {
        result = processLinkTick(packet, state.connections, state.simulation.speed);
      } else {
        // 'arrived', 'dropped', 'buffered'
        result = [packet];
      }

      const results = Array.isArray(result) ? result : [result];
      newPackets.push(...results);
    }

    // Wake buffered packets if ARP has been resolved meanwhile.
    // NOTE: `processDeviceTick` may have updated ARP tables via `updateDevice` during this tick,
    // so consult the latest store state here.
    const devicesNow = get().devices;
    const awakenedPackets = newPackets.map((p) => {
      if (p.processingStage !== 'buffered' || !p.waitingForArp) return p;
      const dev = devicesNow.find((d) => d.id === p.currentDeviceId);
      const arpMac = dev?.arpTable?.find((e) => e.ipAddress === p.waitingForArp)?.macAddress;
      if (!arpMac) return p;

      return {
        ...p,
        processingStage: 'at-device' as const,
        waitingForArp: undefined,
      };
    });

    // Note: ARP/MAC table aging is disabled for better UX in a learning simulator.
    // Tables persist until user runs 'clear arp' or stops simulation.

    set((state) => ({
      packets: awakenedPackets,
      simulation: {
        ...state.simulation,
        currentTime: state.simulation.currentTime + 1,
      },
    }));
  },

  // Packets
  sendPacket: (packetData) => {
    const packet: Packet = {
      ...packetData,
      id: uuidv4(),
      currentDeviceId: packetData.currentDeviceId,
      processingStage: 'at-device',
      progress: 0,
      path: [],
      currentPathIndex: 0,
    };
    set((state) => ({
      packets: [...state.packets, packet],
    }));
  },

  sendPing: async (sourceDeviceId, destIP) => {
    const sourceDevice = get().getDeviceById(sourceDeviceId);
    if (!sourceDevice) return 'Error: Source device not found';

    // Find source interface with IP that is up and connected
    const sourceInterface = sourceDevice.interfaces.find((i) => i.ipAddress && i.isUp && i.connectedTo);
    if (!sourceInterface || !sourceInterface.ipAddress || !sourceInterface.subnetMask) {
      return 'ping: No configured and connected interface on this device';
    }

    let output = `PING ${destIP} (${destIP}): 56 data bytes\n`;

    // Check if destination is reachable through proper networking
    const destDevice = get().getDeviceByIP(destIP);

    // Helper function to check if two devices are in the same Layer 2 domain
    const areInSameL2Domain = (device1Id: string, device2Id: string): boolean => {
      // BFS through L2 devices (switches, hubs) only, but allow direct connections from source
      const visited = new Set<string>();
      const queue: string[] = [device1Id];

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);

        if (currentId === device2Id) return true;

        const currentDevice = get().getDeviceById(currentId);
        if (!currentDevice) continue;

        // Get all connections for this device
        const connections = get().connections.filter(
          (c) => (c.sourceDeviceId === currentId || c.targetDeviceId === currentId) && c.isUp
        );

        for (const conn of connections) {
          const nextId = conn.sourceDeviceId === currentId ? conn.targetDeviceId : conn.sourceDeviceId;
          const nextDevice = get().getDeviceById(nextId);

          // From the source device, we can reach any directly connected device
          // After that, only traverse through L2 devices (switches, hubs) or reach the destination
          const isFromSource = currentId === device1Id;
          const isL2Device = nextDevice && (nextDevice.type === 'switch' || nextDevice.type === 'hub');
          const isDestination = nextId === device2Id;

          if (isFromSource || isL2Device || isDestination) {
            if (!visited.has(nextId)) {
              queue.push(nextId);
            }
          }
        }
      }

      return false;
    };

    // Helper function to find reachable path considering L3 routing
    const findReachablePath = (): { path: string[]; hops: number } | null => {
      if (!destDevice) return null;

      const destInterface = destDevice.interfaces.find((i) => i.ipAddress === destIP);
      if (!destInterface || !destInterface.isUp || !destInterface.connectedTo) {
        return null; // Destination interface not up or connected
      }

      // Check if source and dest are on the same subnet
      const sameNetwork = isSameNetwork(
        sourceInterface.ipAddress!,
        destIP,
        sourceInterface.subnetMask!
      );

      if (sameNetwork) {
        // Direct communication - check if in same L2 domain
        if (areInSameL2Domain(sourceDeviceId, destDevice.id)) {
          // Build the L2 path for animation
          const path = calculatePath(sourceDevice.id, destDevice.id, get().devices, get().connections);
          return path.length > 0 ? { path, hops: path.length - 1 } : null;
        }
        return null; // Same network but not connected at L2
      }

      // Different networks - need routing
      // For end devices (PC, laptop, server), check if they have a gateway
      if (!sourceDevice.routingTable) {
        // End device - needs default gateway
        if (!sourceInterface.gateway) {
          return null; // No gateway configured
        }

        // Check if gateway is reachable
        const gatewayDevice = get().getDeviceByIP(sourceInterface.gateway);
        if (!gatewayDevice) {
          return null; // Gateway device doesn't exist
        }

        // Gateway must be on the same subnet and L2 domain
        if (!isSameNetwork(sourceInterface.ipAddress!, sourceInterface.gateway, sourceInterface.subnetMask!)) {
          return null; // Gateway not on same subnet
        }

        if (!areInSameL2Domain(sourceDeviceId, gatewayDevice.id)) {
          return null; // Can't reach gateway at L2
        }

        // Check if gateway (router) can reach the destination
        if (!gatewayDevice.routingTable) {
          return null; // Gateway can't route
        }

        // Find route on the router
        const route = findBestRoute(destIP, gatewayDevice.routingTable);
        if (!route) {
          return null; // No route to destination
        }

        // Check if destination is reachable from the router
        // Find which router interface is on the destination's network
        const routerIfaceToDestNet = gatewayDevice.interfaces.find((i) => {
          if (!i.ipAddress || !i.subnetMask || !i.isUp) return false;
          return isSameNetwork(i.ipAddress, destIP, i.subnetMask);
        });

        if (routerIfaceToDestNet) {
          // Router has direct connection to destination network
          if (areInSameL2Domain(gatewayDevice.id, destDevice.id)) {
            const path = calculatePath(sourceDevice.id, destDevice.id, get().devices, get().connections);
            return path.length > 0 ? { path, hops: path.length - 1 } : null;
          }
        }

        return null; // Can't complete the path
      }

      // Source device is a router - use its routing table
      const route = findBestRoute(destIP, sourceDevice.routingTable);
      if (!route) {
        return null; // No route
      }

      // Check path to destination
      const path = calculatePath(sourceDevice.id, destDevice.id, get().devices, get().connections);
      return path.length > 0 ? { path, hops: path.length - 1 } : null;
    };

    const reachability = findReachablePath();

    if (!reachability) {
      // Determine specific error
      if (!destDevice) {
        return output + `Request timeout for icmp_seq 0\nRequest timeout for icmp_seq 1\nRequest timeout for icmp_seq 2\n\n--- ${destIP} ping statistics ---\n3 packets transmitted, 0 packets received, 100.0% packet loss`;
      }

      const sameNetwork = isSameNetwork(sourceInterface.ipAddress!, destIP, sourceInterface.subnetMask!);
      if (!sameNetwork && !sourceInterface.gateway && !sourceDevice.routingTable) {
        return output + `ping: sendto: Network is unreachable\n(Hint: Configure a gateway to reach other networks)`;
      }

      return output + `ping: sendto: Host is unreachable`;
    }

    // Send ping packets
    const pingCount = 4;
    let packetsReceived = 0;
    const results: number[] = [];

    // We can't easily wait for async replies in this synchronous-style command execution
    // unless we change how commands work or how we wait.
    // But for now, let's just send the packets and let the user see the animation.
    // AND, we can try to listen to the store for replies?
    // Or, we can keep the "fake" output if we want instant feedback, but that defeats the purpose of the simulation.

    // BETTER APPROACH:
    // The `ping` command should probably just initiate the process and return "Ping started...".
    // But the terminal expects a result.
    // We can make `sendPing` async and wait for replies by subscribing to the store.

    output += `PING ${destIP} (${destIP}) 56(84) bytes of data.\n`;

    // We'll send one packet at a time and wait for a reply or timeout
    const wasRunning = get().simulation.isRunning;
    if (!wasRunning) {
      set((state) => ({ simulation: { ...state.simulation, isRunning: true } }));
    }

    const getNextHopIpForPing = (deviceId: string): string | null => {
      const dev = get().getDeviceById(deviceId);
      if (!dev) return null;
      const iface = dev.interfaces.find((i) => i.ipAddress && i.subnetMask && i.isUp);
      if (!iface?.ipAddress || !iface.subnetMask) return null;

      const isLocal = isSameNetwork(iface.ipAddress, destIP, iface.subnetMask);
      if (isLocal) return destIP;

      // Hosts use their default gateway
      if (!dev.routingTable) return iface.gateway || null;

      // Routers/firewalls use routing table (or fall back to an interface gateway)
      const route = findBestRoute(destIP, dev.routingTable);
      if (route) return route.gateway === '0.0.0.0' ? destIP : route.gateway;
      const gwIface = dev.interfaces.find((i) => i.gateway);
      return gwIface?.gateway || null;
    };

    try {
      for (let seq = 0; seq < pingCount; seq++) {
        const startTime = Date.now();
        const seqId = seq;

        // Create ICMP echo request packet
        const echoRequest: Omit<Packet, 'id' | 'currentPosition' | 'path' | 'currentPathIndex' | 'processingStage' | 'progress'> = {
          type: 'icmp',
          sourceMAC: sourceInterface.macAddress,
          destMAC: 'FF:FF:FF:FF:FF:FF', // Will be resolved by ARP if needed, or gateway MAC
          sourceIP: sourceInterface.ipAddress!,
          destIP,
          ttl: 64,
          size: 64,
          icmpType: 8,
          icmpCode: 0,
          icmpSeq: seqId,
          currentDeviceId: sourceDeviceId,
        };

        // We need to set destMAC correctly if we want to bypass ARP for local, 
        // OR let the simulation handle ARP.
        // If we set destMAC to Broadcast, `processL3Logic` might drop it if it's not a broadcast packet type?
        // No, `processL3Logic` handles ARP if we don't know the MAC.
        // But `processL3Logic` expects `destMAC` to be the Next Hop MAC or Broadcast (for ARP).
        // If we send an ICMP packet with Broadcast MAC, it's invalid.
        // We should let `processL3Logic` handle the routing and ARP.
        // But `processL3Logic` assumes the packet has a valid destMAC if it's unicast IP.
        // Actually, when a Host generates a packet, it needs to resolve ARP first.
        // So we should probably try to resolve ARP here or let the simulation do it?
        // The simulation `processL3Logic` handles "forwarding".
        // If we inject a packet with "at-device", it acts as if it just arrived or was generated.
        // If we set destMAC to '00:00:00:00:00:00', the switch will flood it? No.
        // We need to find the Next Hop IP and resolve ARP *before* sending, OR
        // we inject it into the simulation in a state that triggers ARP resolution.

        // Let's use a special MAC or just let `processL3Logic` handle it.
        // In `processL3Logic`:
        // If packet.destIP is set...
        // It checks routing.
        // It finds nextHopIP.
        // It checks ARP table.
        // If ARP miss, it buffers and sends ARP Request.
        // So we can send the packet with a DUMMY destMAC, and `processL3Logic` will rewrite it?
        // `processL3Logic` uses `packet.destMAC` to check if "it's for me".
        // If we send it FROM ourselves, we skip the "is for me" check?
        // `processDeviceTick` calls `processL3Logic`.
        // `processL3Logic` starts with:
        // `const myInterface = getInterfaceByMAC(device, packet.destMAC);`
        // `if (!myInterface && !isBroadcast) return [];`
        // THIS IS THE PROBLEM!
        // If we generate a packet at the device, `destMAC` is the remote MAC (or gateway MAC).
        // It is NOT "my interface".
        // So `processL3Logic` drops it because it thinks it received a packet not for itself.

        // FIX: `processL3Logic` should distinguish between "received packet" and "generated packet".
        // OR we inject the packet with `processingStage: 'at-device'` but we need to ensure it enters the ROUTING block.
        // The ROUTING block is after the "is for me" check.
        // We can bypass the "is for me" check if `packet.sourceMAC` is one of my interfaces?
        // Yes!

        // So, we set `sourceMAC` to our interface.
        // We set `destMAC` to '00:00:00:00:00:00' (placeholder).

        get().sendPacket({
          ...echoRequest,
          destMAC: '00:00:00:00:00:00', // Placeholder, will be routed
        });

        // Wait for reply
        // We poll the store for a packet that is:
        // 1. ICMP Reply (type 0)
        // 2. destIP == sourceInterface.ipAddress
        // 3. sourceIP == destIP
        // 4. icmpSeq == seqId

        let replyReceived = false;
        const nextHopIp = getNextHopIpForPing(sourceDeviceId);
        const sourceNow = get().getDeviceById(sourceDeviceId);
        const hasArp = !!(nextHopIp && sourceNow?.arpTable?.some((e) => e.ipAddress === nextHopIp));

        // Packets traverse links over many simulation ticks. With the animation loop ticking ~60fps,
        // a single round-trip can take multiple seconds depending on hop count and simulation speed.
        const speed = Math.max(0.1, get().simulation.speed || 1);
        const hops = Math.max(1, reachability?.hops || 1);
        const ticksPerLink = 100 / (2 * speed); // progress += speed*2 per tick
        const ticksPerRtt = 2 * hops * ticksPerLink;
        const msPerTick = 1000 / 60;
        const estimatedRttMs = Math.ceil(ticksPerRtt * msPerTick);
        const timeout = Math.max(2000, Math.ceil(estimatedRttMs * 2)) + (hasArp ? 0 : estimatedRttMs);
        const pollInterval = 100;
        let waited = 0;

        while (waited < timeout && !replyReceived) {
          await new Promise(r => setTimeout(r, pollInterval));
          waited += pollInterval;

          // If the global simulation loop isn't running (e.g. UI not ticking), advance it here.
          if (!wasRunning) {
            for (let i = 0; i < 10; i++) get().tick();
          }

          const currentPackets = get().packets;
          const reply = currentPackets.find(p =>
            p.type === 'icmp' &&
            p.icmpType === 0 &&
            p.icmpSeq === seqId &&
            p.destIP === sourceInterface.ipAddress &&
            p.sourceIP === destIP &&
            (p.processingStage === 'arrived' || p.processingStage === 'at-device') &&
            p.currentDeviceId === sourceDeviceId
          );

          if (reply) {
            replyReceived = true;
            packetsReceived++;
            const rtt = Date.now() - startTime;
            results.push(rtt);
            output += `64 bytes from ${destIP}: icmp_seq=${seq} ttl=${reply.ttl} time=${rtt.toFixed(1)} ms\n`;

            // Remove the observed reply packet so we don't accumulate 'arrived' packets.
            set((state) => ({ packets: state.packets.filter((pkt) => pkt.id !== reply.id) }));
          }
        }

        if (!replyReceived) {
          output += `Request timeout for icmp_seq=${seq}\n`;
        }
      }

      output += `\n--- ${destIP} ping statistics ---\n`;
      const loss = ((pingCount - packetsReceived) / pingCount) * 100;
      output += `${pingCount} packets transmitted, ${packetsReceived} packets received, ${loss.toFixed(1)}% packet loss\n`;

      if (results.length > 0) {
        const min = Math.min(...results);
        const max = Math.max(...results);
        const avg = results.reduce((a, b) => a + b, 0) / results.length;
        output += `round-trip min/avg/max = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)} ms`;
      }

      return output;
    } finally {
      if (!wasRunning) {
        set((state) => ({ simulation: { ...state.simulation, isRunning: false } }));
      }
    }
  },

  clearPackets: () => {
    set({ packets: [] });
  },

  // ARP
  resolveARP: (deviceId, targetIP) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return null;

    // Check ARP cache first
    const cached = device.arpTable?.find((e) => e.ipAddress === targetIP);
    if (cached) return cached.macAddress;

    // Find device with target IP
    const targetDevice = get().getDeviceByIP(targetIP);
    if (!targetDevice) return null;

    const targetInterface = targetDevice.interfaces.find((i) => i.ipAddress === targetIP);
    if (!targetInterface) return null;

    // Add to ARP table
    get().updateArpTable(deviceId, {
      ipAddress: targetIP,
      macAddress: targetInterface.macAddress,
      interface: device.interfaces[0]?.name || 'eth0',
      type: 'dynamic',
      age: 0,
    });

    return targetInterface.macAddress;
  },

  updateArpTable: (deviceId, entry) => {
    // Some callers (including tests) may hold onto a previously-read device object.
    // Keep that reference consistent by also mutating the in-memory device object.
    const deviceRef = get().getDeviceById(deviceId);
    if (deviceRef) {
      if (!deviceRef.arpTable) deviceRef.arpTable = [];
      const idx = deviceRef.arpTable.findIndex((e) => e.ipAddress === entry.ipAddress);
      if (idx >= 0) deviceRef.arpTable[idx] = entry;
      else deviceRef.arpTable.push(entry);
    }

    // Also update Zustand state immutably so React subscribers re-render.
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        const current = d.arpTable || [];
        const existingIndex = current.findIndex((e) => e.ipAddress === entry.ipAddress);
        const next = existingIndex >= 0
          ? current.map((e, i) => (i === existingIndex ? entry : e))
          : [...current, entry];
        return { ...d, arpTable: next };
      }),
    }));
  },

  // MAC Table
  learnMAC: (deviceId, macAddress, port, vlan = 1) => {
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId || d.type !== 'switch') return d;
        const macTable = d.macTable || [];
        // Look for existing entry with same MAC AND VLAN (VLAN-aware MAC learning)
        const existingIndex = macTable.findIndex((e) => e.macAddress === macAddress && e.vlan === vlan);
        const entry: MacTableEntry = {
          macAddress,
          port,
          vlan,
          type: 'dynamic',
          age: 0,
        };
        if (existingIndex >= 0) {
          macTable[existingIndex] = entry;
          return { ...d, macTable: [...macTable] };
        }
        return { ...d, macTable: [...macTable, entry] };
      }),
    }));
  },

  lookupMAC: (deviceId, macAddress, vlan) => {
    const device = get().getDeviceById(deviceId);
    if (!device || !device.macTable) return null;
    if (isBroadcastMAC(macAddress)) return 'broadcast';
    // If VLAN is specified, filter by VLAN; otherwise return any matching entry
    const entry = vlan !== undefined
      ? device.macTable.find((e) => e.macAddress === macAddress && e.vlan === vlan)
      : device.macTable.find((e) => e.macAddress === macAddress);
    return entry?.port || null;
  },

  // VLAN Management
  addVlan: (deviceId, vlan) => {
    const device = get().getDeviceById(deviceId);
    if (!device || device.type !== 'switch') return false;

    // Validate VLAN ID (1-4094)
    if (vlan.id < 1 || vlan.id > 4094) return false;

    // Check if VLAN already exists
    if (device.vlans?.find((v) => v.id === vlan.id)) return false;

    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          vlans: [...(d.vlans || []), vlan],
        };
      }),
    }));
    return true;
  },

  removeVlan: (deviceId, vlanId) => {
    const device = get().getDeviceById(deviceId);
    if (!device || device.type !== 'switch') return false;

    // Cannot remove VLAN 1
    if (vlanId === 1) return false;

    // Check if VLAN exists
    if (!device.vlans?.find((v) => v.id === vlanId)) return false;

    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          vlans: (d.vlans || []).filter((v) => v.id !== vlanId),
          // Reset any interfaces on this VLAN back to VLAN 1
          interfaces: d.interfaces.map((iface) => {
            if (iface.accessVlan === vlanId) {
              return { ...iface, accessVlan: 1 };
            }
            if (iface.allowedVlans?.includes(vlanId)) {
              return {
                ...iface,
                allowedVlans: iface.allowedVlans.filter((v) => v !== vlanId),
              };
            }
            return iface;
          }),
          // Remove SVI for this VLAN
          sviInterfaces: (d.sviInterfaces || []).filter((s) => s.vlanId !== vlanId),
        };
      }),
    }));
    return true;
  },

  addSvi: (deviceId, svi) => {
    const device = get().getDeviceById(deviceId);
    if (!device || device.type !== 'switch') return false;

    // Check if VLAN exists
    if (!device.vlans?.find((v) => v.id === svi.vlanId)) return false;

    const sviInterfaceName = `Vlan${svi.vlanId}`;

    // Helper to add connected route if IP is configured
    const addConnectedRoute = (ipAddress: string, subnetMask: string) => {
      const networkAddr = getNetworkAddress(ipAddress, subnetMask);
      set((state) => ({
        devices: state.devices.map((d) => {
          if (d.id !== deviceId) return d;
          const existingRoutes = d.routingTable || [];
          // Remove any existing route for this network on this interface
          const filteredRoutes = existingRoutes.filter(r =>
            !(r.destination === networkAddr && r.interface === sviInterfaceName)
          );
          return {
            ...d,
            routingTable: [
              ...filteredRoutes,
              {
                destination: networkAddr,
                netmask: subnetMask,
                gateway: '0.0.0.0',
                interface: sviInterfaceName,
                metric: 0,
                type: 'connected' as const,
              }
            ]
          };
        }),
      }));
    };

    // Check if SVI already exists for this VLAN
    if (device.sviInterfaces?.find((s) => s.vlanId === svi.vlanId)) {
      // Update existing SVI
      set((state) => ({
        devices: state.devices.map((d) => {
          if (d.id !== deviceId) return d;
          return {
            ...d,
            sviInterfaces: (d.sviInterfaces || []).map((s) =>
              s.vlanId === svi.vlanId ? { ...s, ...svi } : s
            ),
          };
        }),
      }));
      // Add connected route if IP is configured
      if (svi.ipAddress && svi.subnetMask) {
        addConnectedRoute(svi.ipAddress, svi.subnetMask);
      }
      return true;
    }

    // Generate a MAC address for the SVI
    const sviMac = generateMacAddress();
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          sviInterfaces: [...(d.sviInterfaces || []), { ...svi, macAddress: sviMac }],
        };
      }),
    }));

    // Add connected route if IP is configured
    if (svi.ipAddress && svi.subnetMask) {
      addConnectedRoute(svi.ipAddress, svi.subnetMask);
    }

    return true;
  },

  removeSvi: (deviceId, vlanId) => {
    const device = get().getDeviceById(deviceId);
    if (!device || device.type !== 'switch') return false;

    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          sviInterfaces: (d.sviInterfaces || []).filter((s) => s.vlanId !== vlanId),
        };
      }),
    }));
    return true;
  },

  updateInterface: (deviceId, interfaceId, updates) => {
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          interfaces: d.interfaces.map((iface) =>
            iface.id === interfaceId ? { ...iface, ...updates } : iface
          ),
        };
      }),
    }));
  },

  // ============================================
  // STP (Spanning Tree Protocol) Implementation
  // ============================================

  enableStp: (deviceId) => {
    const device = get().getDeviceById(deviceId);
    if (!device || device.type !== 'switch') return;

    // Create Bridge ID: priority (4 hex digits) + MAC address
    const bridgePriority = 32768; // Default priority
    const bridgeMac = device.interfaces[0]?.macAddress || '00:00:00:00:00:00';
    const bridgeId = createBridgeId(bridgePriority, bridgeMac);

    // Initialize port configurations
    const ports: StpPortConfig[] = device.interfaces.map((iface, index) => ({
      interfaceId: iface.id,
      interfaceName: iface.name,
      state: 'blocking' as StpPortState,
      role: 'disabled' as StpPortRole,
      pathCost: calculatePathCost(iface.speed),
      portPriority: 128, // Default port priority
      portId: (128 << 8) | (index + 1), // priority (8 bits) + port number (8 bits)
      designatedRoot: bridgeId,
      designatedCost: 0,
      designatedBridge: bridgeId,
      designatedPort: 0,
      forwardDelay: 15,
      messageAge: 0,
      maxAge: 20,
      helloTime: 2,
    }));

    const stpConfig: StpConfig = {
      enabled: true,
      bridgePriority,
      bridgeId,
      rootBridgeId: bridgeId, // Initially, assume we are root
      rootPathCost: 0,
      rootPort: undefined,
      maxAge: 20,
      helloTime: 2,
      forwardDelay: 15,
      topologyChangeCount: 0,
      lastTopologyChange: undefined,
      ports,
    };

    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === deviceId ? { ...d, stpConfig } : d
      ),
    }));

    get().addNotification({
      type: 'success',
      title: 'STP Enabled',
      message: `Spanning Tree Protocol enabled on ${device.name}`,
    });
  },

  disableStp: (deviceId) => {
    const device = get().getDeviceById(deviceId);
    if (!device || !device.stpConfig) return;

    // Set all ports to forwarding when STP is disabled
    const updatedPorts = device.stpConfig.ports.map((port) => ({
      ...port,
      state: 'forwarding' as StpPortState,
      role: 'designated' as StpPortRole,
    }));

    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === deviceId && d.stpConfig
          ? { ...d, stpConfig: { ...d.stpConfig, enabled: false, ports: updatedPorts } }
          : d
      ),
    }));

    get().addNotification({
      type: 'info',
      title: 'STP Disabled',
      message: `Spanning Tree Protocol disabled on ${device.name}`,
    });
  },

  setStpBridgePriority: (deviceId, priority) => {
    const device = get().getDeviceById(deviceId);
    if (!device || !device.stpConfig) return;

    // Priority must be a multiple of 4096 (0-61440)
    const normalizedPriority = Math.min(61440, Math.max(0, Math.floor(priority / 4096) * 4096));
    const bridgeMac = device.interfaces[0]?.macAddress || '00:00:00:00:00:00';
    const newBridgeId = createBridgeId(normalizedPriority, bridgeMac);

    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === deviceId && d.stpConfig
          ? {
            ...d,
            stpConfig: {
              ...d.stpConfig,
              bridgePriority: normalizedPriority,
              bridgeId: newBridgeId,
            },
          }
          : d
      ),
    }));
  },

  setStpPortCost: (deviceId, interfaceId, cost) => {
    const device = get().getDeviceById(deviceId);
    if (!device || !device.stpConfig) return;

    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === deviceId && d.stpConfig
          ? {
            ...d,
            stpConfig: {
              ...d.stpConfig,
              ports: d.stpConfig.ports.map((p) =>
                p.interfaceId === interfaceId ? { ...p, pathCost: cost } : p
              ),
            },
          }
          : d
      ),
    }));
  },

  setStpPortPriority: (deviceId, interfaceId, priority) => {
    const device = get().getDeviceById(deviceId);
    if (!device || !device.stpConfig) return;

    const normalizedPriority = Math.min(255, Math.max(0, priority));

    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === deviceId && d.stpConfig
          ? {
            ...d,
            stpConfig: {
              ...d.stpConfig,
              ports: d.stpConfig.ports.map((p) => {
                if (p.interfaceId !== interfaceId) return p;
                const portIndex = d.stpConfig!.ports.indexOf(p);
                return {
                  ...p,
                  portPriority: normalizedPriority,
                  portId: (normalizedPriority << 8) | (portIndex + 1),
                };
              }),
            },
          }
          : d
      ),
    }));
  },

  runStpConvergence: () => {
    const { devices, connections } = get();

    // Get all STP-enabled switches
    const stpSwitches = devices.filter(
      (d) => d.type === 'switch' && d.stpConfig?.enabled
    );

    if (stpSwitches.length === 0) return;

    // Phase 1: Each switch starts by assuming it's the root
    for (const sw of stpSwitches) {
      if (!sw.stpConfig) continue;
      get().updateDevice(sw.id, {
        stpConfig: {
          ...sw.stpConfig,
          rootBridgeId: sw.stpConfig.bridgeId,
          rootPathCost: 0,
          rootPort: undefined,
        },
      });
    }

    // Phase 2: Simulate BPDU exchange until convergence
    let converged = false;
    let iterations = 0;
    const maxIterations = stpSwitches.length * 3; // Safety limit

    while (!converged && iterations < maxIterations) {
      converged = true;
      iterations++;

      for (const sw of stpSwitches) {
        const currentDevice = get().getDeviceById(sw.id);
        if (!currentDevice?.stpConfig) continue;

        // Check each connected port
        for (const iface of currentDevice.interfaces) {
          if (!iface.isUp || !iface.connectedTo) continue;

          // Find the connection and neighbor
          const conn = connections.find(
            (c) =>
              (c.sourceInterfaceId === iface.id || c.targetInterfaceId === iface.id) &&
              c.isUp
          );
          if (!conn) continue;

          const neighborDeviceId =
            conn.sourceDeviceId === currentDevice.id
              ? conn.targetDeviceId
              : conn.sourceDeviceId;

          const neighbor = get().getDeviceById(neighborDeviceId);
          if (!neighbor?.stpConfig?.enabled) continue;

          // Get port config
          const portConfig = currentDevice.stpConfig.ports.find(
            (p) => p.interfaceId === iface.id
          );
          if (!portConfig) continue;

          // Calculate potential root path through this neighbor
          const neighborRootCost =
            neighbor.stpConfig.rootPathCost + portConfig.pathCost;

          // Compare with current root knowledge
          const currentStpConfig = get().getDeviceById(currentDevice.id)?.stpConfig;
          if (!currentStpConfig) continue;

          // Check if neighbor has better root info
          const neighborBetter =
            compareBridgeIds(neighbor.stpConfig.rootBridgeId, currentStpConfig.rootBridgeId) < 0 ||
            (neighbor.stpConfig.rootBridgeId === currentStpConfig.rootBridgeId &&
              neighborRootCost < currentStpConfig.rootPathCost);

          if (neighborBetter) {
            converged = false;
            get().updateDevice(currentDevice.id, {
              stpConfig: {
                ...currentStpConfig,
                rootBridgeId: neighbor.stpConfig.rootBridgeId,
                rootPathCost: neighborRootCost,
                rootPort: iface.id,
              },
            });
          }
        }
      }
    }

    // Phase 3: Assign port roles and states
    for (const sw of stpSwitches) {
      const currentDevice = get().getDeviceById(sw.id);
      if (!currentDevice?.stpConfig) continue;

      const isRoot = currentDevice.stpConfig.rootBridgeId === currentDevice.stpConfig.bridgeId;

      const updatedPorts = currentDevice.stpConfig.ports.map((port) => {
        const iface = currentDevice.interfaces.find((i) => i.id === port.interfaceId);

        // Check if interface is disabled or not connected
        if (!iface?.isUp) {
          return { ...port, state: 'disabled' as StpPortState, role: 'disabled' as StpPortRole };
        }

        if (!iface.connectedTo) {
          // Unconnected ports are designated and forwarding on root, disabled otherwise
          return {
            ...port,
            state: 'forwarding' as StpPortState,
            role: 'designated' as StpPortRole,
          };
        }

        // Check if this is the root port
        if (port.interfaceId === currentDevice.stpConfig!.rootPort) {
          return { ...port, state: 'forwarding' as StpPortState, role: 'root' as StpPortRole };
        }

        // For root bridge, all ports are designated
        if (isRoot) {
          return { ...port, state: 'forwarding' as StpPortState, role: 'designated' as StpPortRole };
        }

        // Find neighbor to determine if we should be designated or alternate
        const conn = connections.find(
          (c) =>
            (c.sourceInterfaceId === port.interfaceId ||
              c.targetInterfaceId === port.interfaceId) &&
            c.isUp
        );

        if (conn) {
          const neighborDeviceId =
            conn.sourceDeviceId === currentDevice.id
              ? conn.targetDeviceId
              : conn.sourceDeviceId;

          const neighbor = get().getDeviceById(neighborDeviceId);
          if (neighbor?.stpConfig?.enabled) {
            // Find neighbor's port for this connection
            const neighborInterfaceId =
              conn.sourceDeviceId === currentDevice.id
                ? conn.targetInterfaceId
                : conn.sourceInterfaceId;

            const neighborPort = neighbor.stpConfig.ports.find(
              (p) => p.interfaceId === neighborInterfaceId
            );

            // Determine if we are designated for this segment
            // Designated bridge is the one with lower root path cost, or lower bridge ID on tie
            const weAreDesignated =
              currentDevice.stpConfig!.rootPathCost < neighbor.stpConfig.rootPathCost ||
              (currentDevice.stpConfig!.rootPathCost === neighbor.stpConfig.rootPathCost &&
                compareBridgeIds(currentDevice.stpConfig!.bridgeId, neighbor.stpConfig.bridgeId) < 0);

            // Check if neighbor's port is their root port (we'd be designated then)
            const neighborIsRootPort = neighborPort?.role === 'root';

            if (weAreDesignated || neighborIsRootPort) {
              return { ...port, state: 'forwarding' as StpPortState, role: 'designated' as StpPortRole };
            } else {
              // We are alternate (blocking)
              return { ...port, state: 'blocking' as StpPortState, role: 'alternate' as StpPortRole };
            }
          }
        }

        // Default to forwarding for edge ports (connected to non-STP devices)
        return { ...port, state: 'forwarding' as StpPortState, role: 'designated' as StpPortRole };
      });

      get().updateDevice(currentDevice.id, {
        stpConfig: {
          ...currentDevice.stpConfig,
          ports: updatedPorts,
          topologyChangeCount: currentDevice.stpConfig.topologyChangeCount + 1,
          lastTopologyChange: Date.now(),
        },
      });
    }
  },

  generateStpBpdus: (deviceId) => {
    const device = get().getDeviceById(deviceId);
    if (!device?.stpConfig?.enabled) return [];

    const bpdus: Packet[] = [];
    const STP_MULTICAST_MAC = '01:80:C2:00:00:00';

    for (const port of device.stpConfig.ports) {
      // Only send BPDUs on designated and root ports
      if (port.state !== 'forwarding' && port.state !== 'learning') continue;

      const iface = device.interfaces.find((i) => i.id === port.interfaceId);
      if (!iface?.connectedTo) continue;

      const bpduPayload: BpduPayload = {
        protocolId: 0,
        version: 0, // STP (not RSTP)
        bpduType: 'config',
        flags: {
          topologyChange: false,
          topologyChangeAck: false,
        },
        rootBridgeId: device.stpConfig.rootBridgeId,
        rootPathCost: device.stpConfig.rootPathCost,
        senderBridgeId: device.stpConfig.bridgeId,
        senderPortId: port.portId,
        messageAge: 0,
        maxAge: device.stpConfig.maxAge,
        helloTime: device.stpConfig.helloTime,
        forwardDelay: device.stpConfig.forwardDelay,
      };

      const bpdu: Packet = {
        id: uuidv4(),
        type: 'stp',
        sourceMAC: iface.macAddress,
        destMAC: STP_MULTICAST_MAC,
        ttl: 1, // BPDUs don't go beyond L2
        size: 35, // BPDU size
        currentDeviceId: deviceId,
        sourceDeviceId: deviceId,
        processingStage: 'at-device',
        path: [deviceId],
        currentPathIndex: 0,
        progress: 0,
        payload: bpduPayload,
        egressInterface: iface.name,
      };

      bpdus.push(bpdu);
    }

    return bpdus;
  },

  // ============================================
  // TCP Functions
  // ============================================

  tcpListen: (deviceId, port) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return false;

    // Check if already listening on this port
    const existing = device.tcpConnections?.find(
      (c) => c.localPort === port && c.state === 'LISTEN'
    );
    if (existing) return false;

    // Get local IP from first interface with IP
    const iface = device.interfaces.find((i) => i.ipAddress);
    const localIP = iface?.ipAddress || '0.0.0.0';

    const connection: TcpConnection = {
      id: uuidv4(),
      localIP,
      localPort: port,
      remoteIP: '0.0.0.0',
      remotePort: 0,
      state: 'LISTEN',
      startTime: Date.now(),
    };

    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          tcpConnections: [...(d.tcpConnections || []), connection],
        };
      }),
    }));

    return true;
  },

  tcpConnect: (deviceId, destIP, destPort) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return null;

    // Find source interface with IP
    const sourceIface = device.interfaces.find((i) => i.ipAddress && i.isUp);
    if (!sourceIface?.ipAddress) return null;

    // Allocate ephemeral port (49152-65535)
    const usedPorts = new Set(device.tcpConnections?.map((c) => c.localPort) || []);
    let localPort = 49152;
    while (usedPorts.has(localPort) && localPort <= 65535) {
      localPort++;
    }
    if (localPort > 65535) return null;

    const connectionId = uuidv4();
    const connection: TcpConnection = {
      id: connectionId,
      localIP: sourceIface.ipAddress,
      localPort,
      remoteIP: destIP,
      remotePort: destPort,
      state: 'SYN_SENT',
      startTime: Date.now(),
    };

    // Add connection to device
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          tcpConnections: [...(d.tcpConnections || []), connection],
        };
      }),
    }));

    // Send SYN packet
    get().sendTcpPacket(deviceId, destIP, destPort, { syn: true }, localPort);

    return connectionId;
  },

  tcpClose: (deviceId, connectionId) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return;

    const conn = device.tcpConnections?.find((c) => c.id === connectionId);
    if (!conn || conn.state !== 'ESTABLISHED') return;

    // Transition to FIN_WAIT_1
    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return {
          ...d,
          tcpConnections: (d.tcpConnections || []).map((c) => {
            if (c.id !== connectionId) return c;
            return { ...c, state: 'FIN_WAIT_1' as const };
          }),
        };
      }),
    }));

    // Send FIN packet
    get().sendTcpPacket(deviceId, conn.remoteIP, conn.remotePort, { fin: true, ack: true }, conn.localPort);
  },

  sendTcpPacket: (deviceId, destIP, destPort, flags, sourcePort) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return;

    const sourceIface = device.interfaces.find((i) => i.ipAddress && i.isUp);
    if (!sourceIface?.ipAddress) return;

    // Determine source port
    let srcPort = sourcePort;
    if (!srcPort) {
      // Find existing connection or allocate ephemeral
      const conn = device.tcpConnections?.find(
        (c) => c.remoteIP === destIP && c.remotePort === destPort
      );
      srcPort = conn?.localPort || 49152;
    }

    // Try to find destination MAC from ARP table
    let destMAC = '00:00:00:00:00:00';
    const arpEntry = device.arpTable?.find((e) => e.ipAddress === destIP);
    if (arpEntry) {
      destMAC = arpEntry.macAddress;
    } else if (sourceIface.gateway) {
      // Use gateway MAC if available
      const gwArp = device.arpTable?.find((e) => e.ipAddress === sourceIface.gateway);
      if (gwArp) destMAC = gwArp.macAddress;
    }

    // Generate initial sequence number
    const seqNum = Math.floor(Math.random() * 0xFFFFFFFF);

    get().sendPacket({
      type: 'tcp',
      sourceMAC: sourceIface.macAddress,
      destMAC,
      sourceIP: sourceIface.ipAddress,
      destIP,
      sourcePort: srcPort,
      destPort,
      ttl: 64,
      size: flags.syn ? 44 : 40, // SYN packets have options
      tcpFlags: flags,
      tcpSeq: seqNum,
      tcpAck: 0,
      currentDeviceId: deviceId,
      isLocallyGenerated: true,
    });
  },

  // DHCP
  configureDhcpServer: (deviceId, interfaceId, config) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return;

    // Only routers and servers can be DHCP servers
    if (device.type !== 'router' && device.type !== 'server') {
      get().addNotification({
        type: 'error',
        title: 'DHCP Error',
        message: 'Only routers and servers can run DHCP server',
      });
      return;
    }

    const targetIface = device.interfaces.find((i) => i.id === interfaceId);
    if (!targetIface) return;

    if (config.enabled && !targetIface.ipAddress) {
      get().addNotification({
        type: 'error',
        title: 'DHCP Error',
        message: 'DHCP server interface must have an IP address configured',
      });
      return;
    }

    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id !== deviceId) return d;

        const existing = getDhcpServers(d);
        const idx = existing.findIndex((s) => s.interfaceId === interfaceId);

        const base: DhcpServerConfig = idx >= 0
          ? existing[idx]
          : {
            enabled: false,
            interfaceId,
            interfaceName: targetIface.name,
            poolStart: '192.168.1.100',
            poolEnd: '192.168.1.200',
            subnetMask: targetIface.subnetMask || '255.255.255.0',
            defaultGateway: targetIface.gateway || targetIface.ipAddress || '192.168.1.1',
            dnsServers: ['8.8.8.8', '8.8.4.4'],
            leaseTime: 86400,
            leases: [],
            excludedAddresses: [],
          };

        const nextConfig: DhcpServerConfig = {
          ...base,
          ...config,
          interfaceId,
          interfaceName: targetIface.name,
        };

        const nextServers = idx >= 0
          ? existing.map((s, i) => (i === idx ? nextConfig : s))
          : [...existing, nextConfig];

        return setDhcpServersOnDevice(d, nextServers);
      }),
    }));

    if (config.enabled !== undefined) {
      get().addNotification({
        type: config.enabled ? 'success' : 'info',
        title: 'DHCP Server',
        message: config.enabled
          ? `DHCP server enabled on ${device.name}:${targetIface.name}`
          : `DHCP server disabled on ${device.name}:${targetIface.name}`,
      });
    }
  },

  findDhcpServer: (deviceId, interfaceId) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return null;

    const reachableInterfaceIds = getReachableL2InterfaceIdsFromInterface(
      deviceId,
      interfaceId,
      get().devices,
      get().connections
    );
    if (reachableInterfaceIds.size === 0) return null;

    for (const candidate of get().devices) {
      if (candidate.id === deviceId) continue;
      const servers = getDhcpServers(candidate);
      const match = servers.find((s) => s.enabled && reachableInterfaceIds.has(s.interfaceId));
      if (match) {
        return { device: candidate, config: match };
      }
    }

    return null;
  },

  requestDhcp: async (deviceId, interfaceId) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return 'DHCP request failed: Device not found';

    const iface = device.interfaces.find((i) => i.id === interfaceId);
    if (!iface) return 'DHCP request failed: Interface not found';

    // Check if interface is connected
    if (!iface.connectedTo) {
      return 'DHCP request failed: Interface is not connected';
    }

    // Find DHCP server reachable from this specific interface
    // We need to search starting from the connected device via this interface
    const connection = get().connections.find(
      (c) => c.sourceInterfaceId === interfaceId || c.targetInterfaceId === interfaceId
    );

    if (!connection) {
      return 'DHCP request failed: No connection found';
    }

    // Find DHCP server (L2 domain of this interface)
    const dhcpServer = get().findDhcpServer(deviceId, interfaceId);
    if (!dhcpServer) {
      return 'DHCP request failed: No DHCP server found on the network';
    }

    const serverConfig = dhcpServer.config;

    // Check if this MAC already has a lease
    let assignedIP: string | null = null;
    const existingLease = serverConfig.leases.find((l) => l.macAddress === iface.macAddress);

    if (existingLease && existingLease.leaseEnd > Date.now()) {
      assignedIP = existingLease.ipAddress;
    } else {
      // Find available IP from pool
      const poolStartParts = serverConfig.poolStart.split('.').map(Number);
      const poolEndParts = serverConfig.poolEnd.split('.').map(Number);
      const poolStartNum = (poolStartParts[0] << 24) | (poolStartParts[1] << 16) | (poolStartParts[2] << 8) | poolStartParts[3];
      const poolEndNum = (poolEndParts[0] << 24) | (poolEndParts[1] << 16) | (poolEndParts[2] << 8) | poolEndParts[3];

      const usedIPs = new Set([
        ...serverConfig.leases.filter((l) => l.leaseEnd > Date.now()).map((l) => l.ipAddress),
        ...serverConfig.excludedAddresses,
      ]);

      for (let ipNum = poolStartNum; ipNum <= poolEndNum; ipNum++) {
        const ip = [
          (ipNum >>> 24) & 255,
          (ipNum >>> 16) & 255,
          (ipNum >>> 8) & 255,
          ipNum & 255,
        ].join('.');

        if (!usedIPs.has(ip)) {
          assignedIP = ip;
          break;
        }
      }
    }

    if (!assignedIP) {
      return 'DHCP request failed: No available IP addresses in pool';
    }

    // Create DHCP packet for visualization
    get().sendPacket({
      type: 'dhcp',
      sourceMAC: iface.macAddress,
      destMAC: 'FF:FF:FF:FF:FF:FF',
      sourceIP: '0.0.0.0',
      destIP: '255.255.255.255',
      sourcePort: 68,
      destPort: 67,
      ttl: 64,
      size: 300,
      payload: { type: 'DISCOVER' },
      currentDeviceId: deviceId,
    });

    // Simulate DHCP exchange delay
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Update lease on server
    const now = Date.now();
    const newLease: DhcpLease = {
      ipAddress: assignedIP,
      macAddress: iface.macAddress,
      hostname: device.hostname,
      leaseStart: now,
      leaseEnd: now + serverConfig.leaseTime * 1000,
    };

    set((state) => ({
      devices: state.devices.map((d) => {
        if (d.id === dhcpServer.device.id) {
          const servers = getDhcpServers(d);
          const idx = servers.findIndex((s) => s.interfaceId === serverConfig.interfaceId);
          if (idx < 0) return setDhcpServersOnDevice(d, servers);

          const current = servers[idx];
          const leases = current.leases.filter((l) => l.macAddress !== iface.macAddress);
          const next = servers.map((s, i) =>
            i === idx ? { ...s, leases: [...leases, newLease] } : s
          );
          return setDhcpServersOnDevice(d, next);
        }
        return d;
      }),
    }));

    // Configure interface with assigned IP
    get().configureInterface(deviceId, interfaceId, {
      ipAddress: assignedIP,
      subnetMask: serverConfig.subnetMask,
      gateway: serverConfig.defaultGateway,
      dhcpEnabled: true,
      dhcpLeaseExpiry: newLease.leaseEnd,
    });

    // Set device DNS servers from DHCP (best-effort)
    get().updateDevice(deviceId, { dnsServers: serverConfig.dnsServers });

    get().addNotification({
      type: 'success',
      title: 'DHCP Success',
      message: `${device.name}:${iface.name} obtained IP ${assignedIP}`,
    });

    return `DHCP request successful:
  IP Address:      ${assignedIP}
  Subnet Mask:     ${serverConfig.subnetMask}
  Default Gateway: ${serverConfig.defaultGateway}
  DNS Servers:     ${serverConfig.dnsServers.join(', ')}
  Lease Time:      ${serverConfig.leaseTime} seconds
  DHCP Server:     ${dhcpServer.device.name}:${serverConfig.interfaceName || serverConfig.interfaceId}`;
  },

  releaseDhcp: (deviceId, interfaceId) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return;

    const iface = device.interfaces.find((i) => i.id === interfaceId);
    if (!iface) return;

    // Find DHCP server and remove lease
    const dhcpServer = get().findDhcpServer(deviceId, interfaceId);
    if (dhcpServer) {
      set((state) => ({
        devices: state.devices.map((d) => {
          if (d.id !== dhcpServer.device.id) return d;
          const servers = getDhcpServers(d);
          const idx = servers.findIndex((s) => s.interfaceId === dhcpServer.config.interfaceId);
          if (idx < 0) return setDhcpServersOnDevice(d, servers);
          const next = servers.map((s, i) =>
            i === idx ? { ...s, leases: s.leases.filter((l) => l.macAddress !== iface.macAddress) } : s
          );
          return setDhcpServersOnDevice(d, next);
        }),
      }));
    }

    // Clear interface configuration
    get().configureInterface(deviceId, interfaceId, {
      ipAddress: null,
      subnetMask: null,
      gateway: null,
      dhcpEnabled: false,
      dhcpLeaseExpiry: undefined,
    });

    get().addNotification({
      type: 'info',
      title: 'DHCP Released',
      message: `${device.name}:${iface.name} released DHCP lease`,
    });
  },

  // DNS Resolution
  resolveDNS: async (deviceId, hostname) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return null;

    // Check if it's already an IP
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
      return hostname;
    }

    // Find interface with IP
    const sourceInterface = device.interfaces.find((i) => i.ipAddress && i.isUp);
    if (!sourceInterface) return null;

    // Try to find DNS server
    // First check device's configured DNS servers
    const dnsServerIPs = device.dnsServers || [];

    // Then check DHCP-provided DNS servers
    if (dnsServerIPs.length === 0) {
      const dhcpServer = get().findDhcpServer(deviceId, sourceInterface.id);
      if (dhcpServer?.config?.dnsServers) dnsServerIPs.push(...dhcpServer.config.dnsServers);
    }

    // Search all devices for DNS servers and check their zones
    for (const d of get().devices) {
      if (d.dnsServer?.enabled) {
        const entry = d.dnsServer.zones.find(
          (z) => z.hostname.toLowerCase() === hostname.toLowerCase() && z.type === 'A'
        );
        if (entry) {
          // Create DNS packet for visualization
          get().sendPacket({
            type: 'dns',
            sourceMAC: sourceInterface.macAddress,
            destMAC: 'FF:FF:FF:FF:FF:FF',
            sourceIP: sourceInterface.ipAddress!,
            destIP: d.interfaces.find((i) => i.ipAddress)?.ipAddress || '0.0.0.0',
            sourcePort: 53,
            destPort: 53,
            ttl: 64,
            size: 64,
            payload: { query: hostname },
            currentDeviceId: deviceId,
          });

          await new Promise((resolve) => setTimeout(resolve, 50));
          return entry.ipAddress;
        }
      }
    }

    // Fallback: Check if hostname matches any device's hostname
    for (const d of get().devices) {
      if (d.hostname.toLowerCase() === hostname.toLowerCase()) {
        const ip = d.interfaces.find((i) => i.ipAddress)?.ipAddress;
        if (ip) return ip;
      }
    }

    // Check common TLDs for simulation
    if (hostname.endsWith('.local') || hostname.endsWith('.lan')) {
      const baseName = hostname.split('.')[0].toLowerCase();
      for (const d of get().devices) {
        if (d.hostname.toLowerCase() === baseName || d.name.toLowerCase() === baseName) {
          const ip = d.interfaces.find((i) => i.ipAddress)?.ipAddress;
          if (ip) return ip;
        }
      }
    }

    return null;
  },

  reverseDNS: async (deviceId, ip) => {
    // Search all devices for matching IP
    for (const d of get().devices) {
      const iface = d.interfaces.find((i) => i.ipAddress === ip);
      if (iface) {
        return d.hostname;
      }
    }
    return null;
  },

  // Tools
  setCurrentTool: (tool) => {
    set({ currentTool: tool, connectionStart: null });
  },

  // Terminal
  setActiveTerminal: (deviceId) => {
    set({ activeTerminalDevice: deviceId });
  },

  executeCommand: (deviceId, command) => {
    // Synchronous command execution for basic commands
    const device = get().getDeviceById(deviceId);
    if (!device) return 'Error: Device not found';

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    // Handle netstat
    if (cmd === 'netstat') {
      const tcpConnections = device.tcpConnections || [];
      const showListening = args[0] === '-l';
      const showAll = args[0] === '-a' || !args[0];

      let output = 'Active Internet connections\n';
      output += 'Proto Recv-Q Send-Q Local Address           Foreign Address         State\n';

      tcpConnections.forEach((conn) => {
        if (showListening && conn.state !== 'LISTEN') return;
        if (!showAll && !showListening && conn.state === 'LISTEN') return;

        const localAddr = `${conn.localIP || '*'}:${conn.localPort}`.padEnd(23);
        const remoteAddr = conn.state === 'LISTEN'
          ? '*:*'.padEnd(23)
          : `${conn.remoteIP || '*'}:${conn.remotePort}`.padEnd(23);

        output += `tcp    0      0 ${localAddr} ${remoteAddr} ${conn.state}\n`;
      });

      return output;
    }

    // Handle telnet
    if (cmd === 'telnet') {
      if (!args[0]) return 'Usage: telnet <host> [port]';

      const host = args[0];
      const port = args[1] ? parseInt(args[1], 10) : 23;

      if (isNaN(port) || port < 1 || port > 65535) {
        return `telnet: invalid port number: ${args[1]}`;
      }

      // Initiate TCP connection
      get().tcpConnect(deviceId, host, port);

      return `Trying ${host}...\nConnected to ${host}.\nEscape character is '^]'.`;
    }

    // For other commands, return empty (handled by terminal component)
    return '';
  },

  addTerminalHistory: (deviceId, command, output) => {
    set((state) => {
      const history = new Map(state.terminalHistory);
      const deviceHistory = history.get(deviceId) || [];
      history.set(deviceId, [
        ...deviceHistory,
        { command, output, timestamp: Date.now() },
      ]);
      return { terminalHistory: history };
    });
  },

  clearTerminalHistory: (deviceId) => {
    set((state) => {
      const history = new Map(state.terminalHistory);
      history.set(deviceId, []);
      return { terminalHistory: history };
    });
  },

  // Notifications
  addNotification: (notification) => {
    const id = uuidv4();
    const newNotification: Notification = {
      ...notification,
      id,
      timestamp: Date.now(),
    };
    set((state) => ({
      notifications: [...state.notifications, newNotification],
    }));

    // Auto-remove after duration
    setTimeout(() => {
      get().removeNotification(id);
    }, notification.duration || 3000);
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  // Project
  clearProject: () => {
    set({
      devices: [],
      connections: [],
      selectedDeviceId: null,
      selectedConnectionId: null,
      packets: [],
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
  },

  loadProject: (data) => {
    set({
      devices: data.devices.map((d) => setDhcpServersOnDevice(d, getDhcpServers(d))),
      connections: data.connections,
      selectedDeviceId: null,
      selectedConnectionId: null,
    });
  },

  exportProject: () => {
    return {
      devices: get().devices,
      connections: get().connections,
    };
  },

  // Helpers
  getDeviceById: (id) => {
    return get().devices.find((d) => d.id === id);
  },

  getConnectionById: (id) => {
    return get().connections.find((c) => c.id === id);
  },

  getConnectedDevices: (deviceId) => {
    const connections = get().connections.filter(
      (c) => c.sourceDeviceId === deviceId || c.targetDeviceId === deviceId
    );
    return connections.map((c) => {
      const otherId = c.sourceDeviceId === deviceId ? c.targetDeviceId : c.sourceDeviceId;
      return get().getDeviceById(otherId);
    }).filter((d): d is NetworkDevice => d !== undefined);
  },

  getDeviceByIP: (ip) => {
    return get().devices.find((d) =>
      d.interfaces.some((i) => i.ipAddress === ip)
    );
  },

  getAvailableInterfaces: (deviceId) => {
    const device = get().getDeviceById(deviceId);
    if (!device) return [];
    return device.interfaces.filter((i) => !i.connectedTo && i.isUp);
  },
}));

// Helper function to calculate path between devices (BFS)
function calculatePath(
  sourceId: string,
  targetId: string,
  devices: NetworkDevice[],
  connections: Connection[]
): string[] {
  if (sourceId === targetId) return [sourceId];

  const visited = new Set<string>();
  const queue: { id: string; path: string[] }[] = [{ id: sourceId, path: [sourceId] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    // Find all connected devices
    const connectedIds = connections
      .filter((c) => c.sourceDeviceId === current.id || c.targetDeviceId === current.id)
      .filter((c) => c.isUp)
      .map((c) => (c.sourceDeviceId === current.id ? c.targetDeviceId : c.sourceDeviceId));

    for (const nextId of connectedIds) {
      if (nextId === targetId) {
        return [...current.path, targetId];
      }
      if (!visited.has(nextId)) {
        queue.push({ id: nextId, path: [...current.path, nextId] });
      }
    }
  }

  return [];
}
