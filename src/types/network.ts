// Network device types
export type DeviceType = 'pc' | 'laptop' | 'server' | 'router' | 'switch' | 'hub' | 'firewall' | 'cloud';

// Network interface
export interface NetworkInterface {
  id: string;
  name: string;
  macAddress: string;
  ipAddress: string | null;
  subnetMask: string | null;
  gateway: string | null;
  isUp: boolean;
  speed: number; // Mbps
  duplex: 'full' | 'half';
  vlan?: number;
  connectedTo?: string; // Interface ID of connected device
  dhcpEnabled?: boolean; // If true, interface uses DHCP client
  dhcpLeaseExpiry?: number; // Timestamp when DHCP lease expires
}

// Routing table entry
export interface RouteEntry {
  destination: string;
  netmask: string;
  gateway: string;
  interface: string;
  metric: number;
  type: 'connected' | 'static' | 'dynamic';
}

// ARP table entry
export interface ArpEntry {
  ipAddress: string;
  macAddress: string;
  interface: string;
  type: 'dynamic' | 'static';
  age: number; // seconds
}

// MAC address table entry (for switches)
export interface MacTableEntry {
  macAddress: string;
  port: string;
  vlan: number;
  type: 'dynamic' | 'static';
  age: number;
}

// DHCP lease
export interface DhcpLease {
  ipAddress: string;
  macAddress: string;
  hostname: string;
  leaseStart: number;
  leaseEnd: number;
  clientId?: string;
}

// DHCP Server configuration
export interface DhcpServerConfig {
  enabled: boolean;
  interfaceId: string; // Interface ID the DHCP server listens on
  interfaceName?: string; // Denormalized for display/debug (optional)
  interface?: string; // Legacy (interface name) for backward compatibility
  poolStart: string;
  poolEnd: string;
  subnetMask: string;
  defaultGateway: string;
  dnsServers: string[];
  leaseTime: number; // seconds
  leases: DhcpLease[];
  excludedAddresses: string[]; // IPs to exclude from pool
}

// Firewall rule
export interface FirewallRule {
  id: string;
  name: string;
  action: 'allow' | 'deny';
  protocol: 'tcp' | 'udp' | 'icmp' | 'any';
  sourceIp: string;
  sourcePort: string;
  destIp: string;
  destPort: string;
  direction: 'in' | 'out' | 'both';
  enabled: boolean;
}

// DNS entry
export interface DnsEntry {
  hostname: string;
  ipAddress: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'PTR';
  ttl: number;
}

// DNS server configuration
export interface DnsServerConfig {
  enabled: boolean;
  interface: string;
  zones: DnsEntry[];
  forwarders: string[];
}

// TCP Connection state
export interface TcpConnection {
  id: string;
  localIP: string;
  localPort: number;
  remoteIP: string;
  remotePort: number;
  state: 'LISTEN' | 'SYN_SENT' | 'SYN_RECV' | 'ESTABLISHED' | 'FIN_WAIT_1' | 'FIN_WAIT_2' | 'TIME_WAIT' | 'CLOSE_WAIT' | 'LAST_ACK' | 'CLOSING' | 'CLOSED';
  startTime: number;
}

// Network device base
export interface NetworkDevice {
  id: string;
  type: DeviceType;
  name: string;
  hostname: string;
  interfaces: NetworkInterface[];
  position: { x: number; y: number };
  isRunning: boolean;

  // Device-specific properties
  routingTable?: RouteEntry[];
  arpTable?: ArpEntry[];
  macTable?: MacTableEntry[]; // For switches
  dhcpServers?: DhcpServerConfig[]; // For routers/servers (per-interface)
  dnsServer?: DnsServerConfig; // For DNS servers
  firewallRules?: FirewallRule[];
  tcpConnections?: TcpConnection[]; // Active TCP connections

  // DNS client configuration
  dnsServers?: string[];

  // Configuration
  config: Record<string, unknown>;
}

// Connection between devices
export interface Connection {
  id: string;
  sourceDeviceId: string;
  sourceInterfaceId: string;
  targetDeviceId: string;
  targetInterfaceId: string;
  isUp: boolean;
  bandwidth: number; // Mbps
  latency: number; // ms
  packetLoss: number; // percentage
}

// Packet types
export type PacketType = 'icmp' | 'tcp' | 'udp' | 'arp' | 'dhcp' | 'dns' | 'http' | 'https' | 'stp' | 'cdp';

// Network packet
export interface Packet {
  id: string;
  type: PacketType;
  sourceMAC: string;
  destMAC: string;
  sourceIP?: string;
  destIP?: string;
  sourcePort?: number;
  destPort?: number;
  ttl: number;
  size: number; // bytes
  payload?: any;

  // Simulation state
  currentDeviceId: string; // Device currently holding the packet
  lastDeviceId?: string; // Previous device (for ingress port determination)
  targetDeviceId?: string; // Next device (if on link)
  processingStage: 'at-device' | 'on-link' | 'arrived' | 'dropped' | 'buffered';
  waitingForArp?: string; // IP address we are waiting ARP for
  progress: number; // 0-100 for link traversal

  // Debug/History
  path: string[]; // Device IDs
  currentPathIndex: number;

  // ICMP specific
  icmpType?: number;
  icmpCode?: number;
  icmpSeq?: number;

  // TCP specific
  tcpFlags?: {
    syn?: boolean;
    ack?: boolean;
    fin?: boolean;
    rst?: boolean;
    psh?: boolean;
  };

  // Explicit flags for packet processing
  isLocallyGenerated?: boolean; // True if packet was generated at this device (not forwarded)
}

// Simulation state
export interface SimulationState {
  isRunning: boolean;
  speed: number; // 1x, 2x, 0.5x etc
  currentTime: number;
  packets: Packet[];
}

// Terminal command result
export interface CommandResult {
  output: string;
  success: boolean;
  timestamp: number;
}

// Terminal history entry
export interface TerminalHistoryEntry {
  command: string;
  result: CommandResult;
  timestamp: number;
}

// Node position for React Flow
export interface NodePosition {
  x: number;
  y: number;
}

// Custom node data for React Flow
export interface DeviceNodeData {
  device: NetworkDevice;
  isSelected: boolean;
  onSelect: (deviceId: string) => void;
  onDoubleClick: (deviceId: string) => void;
}

// Edge data for React Flow
export interface ConnectionEdgeData {
  connection: Connection;
  isAnimated: boolean;
  hasTraffic: boolean;
}

// Notification
export interface Notification {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: number;
  duration?: number;
}

// Project data for save/load
export interface ProjectData {
  name: string;
  version: string;
  createdAt: number;
  updatedAt: number;
  devices: NetworkDevice[];
  connections: Connection[];
}
