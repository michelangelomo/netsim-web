// Network device types
export type DeviceType = 'pc' | 'laptop' | 'server' | 'router' | 'switch' | 'hub' | 'firewall' | 'cloud';

// VLAN configuration
export interface VLAN {
  id: number;           // 1-4094
  name: string;         // e.g., "default", "management", "sales"
}

// SVI (Switch Virtual Interface) for Layer 3 on switches
export interface SVIInterface {
  vlanId: number;
  ipAddress?: string;
  subnetMask?: string;
  macAddress: string; // Auto-generated MAC for the SVI
  isUp: boolean;
}

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
  // VLAN-specific properties (for switches)
  vlanMode?: 'access' | 'trunk';
  accessVlan?: number;           // For access ports (default: 1)
  allowedVlans?: number[];       // For trunk ports (default: all)
  nativeVlan?: number;           // For trunk ports (default: 1)
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

// ============================================
// STP (Spanning Tree Protocol) Types
// ============================================

// STP port states (IEEE 802.1D)
export type StpPortState = 'disabled' | 'blocking' | 'listening' | 'learning' | 'forwarding';

// STP port roles
export type StpPortRole = 'root' | 'designated' | 'alternate' | 'backup' | 'disabled';

// STP port configuration for each interface
export interface StpPortConfig {
  interfaceId: string;
  interfaceName: string;
  state: StpPortState;
  role: StpPortRole;
  pathCost: number;           // Port path cost (based on link speed)
  portPriority: number;       // Port priority (0-255, default 128)
  portId: number;             // Unique port identifier
  designatedRoot: string;     // Bridge ID of the root bridge (for this port)
  designatedCost: number;     // Cost to reach root via this port
  designatedBridge: string;   // Bridge ID of the designated bridge
  designatedPort: number;     // Port ID of the designated port
  forwardDelay: number;       // Forward delay timer (default 15s)
  messageAge: number;         // Age of the last BPDU received
  maxAge: number;             // Maximum BPDU age (default 20s)
  helloTime: number;          // Hello time (default 2s)
  lastBpduTime?: number;      // Timestamp of last BPDU received
}

// BPDU (Bridge Protocol Data Unit) payload
export interface BpduPayload {
  protocolId: number;         // Always 0 for STP
  version: number;            // 0 for STP, 2 for RSTP
  bpduType: 'config' | 'tcn'; // Configuration BPDU or Topology Change Notification
  flags: {
    topologyChange: boolean;
    topologyChangeAck: boolean;
  };
  rootBridgeId: string;       // Bridge ID of the root bridge
  rootPathCost: number;       // Cost to reach the root
  senderBridgeId: string;     // Bridge ID of the sending bridge
  senderPortId: number;       // Port ID of the sending port
  messageAge: number;         // Age of this BPDU
  maxAge: number;             // Maximum age before discard
  helloTime: number;          // Hello interval
  forwardDelay: number;       // Forward delay
}

// STP configuration for a switch
export interface StpConfig {
  enabled: boolean;
  bridgePriority: number;     // Bridge priority (0-65535, default 32768)
  bridgeId: string;           // Bridge ID = priority + MAC address
  rootBridgeId: string;       // Current root bridge ID
  rootPathCost: number;       // Cost to reach root
  rootPort?: string;          // Interface ID of the root port (undefined if this is root)
  maxAge: number;             // Maximum BPDU age (default 20s)
  helloTime: number;          // Hello interval (default 2s)
  forwardDelay: number;       // Forward delay (default 15s)
  topologyChangeCount: number;
  lastTopologyChange?: number; // Timestamp of last topology change
  ports: StpPortConfig[];     // Per-port STP configuration
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
  vlans?: VLAN[]; // For switches - configured VLANs
  sviInterfaces?: SVIInterface[]; // For switches - Layer 3 VLAN interfaces
  stpConfig?: StpConfig; // For switches - Spanning Tree Protocol configuration
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
  sourceDeviceId?: string; // Original source device
  lastDeviceId?: string; // Previous device (for ingress port determination)
  targetDeviceId?: string; // Next device (if on link)
  ingressInterface?: string; // Interface name where packet arrived
  egressInterface?: string; // Interface name where packet will leave
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
  tcpSeq?: number;
  tcpAck?: number;

  // VLAN tagging (802.1Q)
  vlanTag?: number;

  // Explicit flags for packet processing
  isLocallyGenerated?: boolean; // True if packet was generated at this device (not forwarded)
}

// Simulation state
export interface SimulationState {
  isRunning: boolean;
  speed: number; // 1x, 2x, 0.5x etc
  currentTime: number;
  packets: Packet[];
  deterministicLoss?: boolean;
}

// Link diagnostics
export interface LinkStats {
  lossHistory: number[];
  rttHistory: number[];
  drops: number;
  delivered: number;
  lastUpdated: number;
}

// Event log entry
export interface EventLogEntry {
  id: string;
  type: 'arp' | 'stp' | 'icmp' | 'tcp' | 'link' | 'system';
  message: string;
  deviceIds?: string[];
  connectionId?: string;
  timestamp: number;
  severity?: 'info' | 'warn' | 'error';
}

// Tutorials
export type TutorialTarget = 'canvas' | 'sidebar' | 'properties' | 'terminal' | 'event-feed' | 'header';

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  target?: TutorialTarget;
  completeOnEventType?: EventLogEntry['type'];
}

export interface TutorialDefinition {
  id: string;
  title: string;
  summary: string;
  steps: TutorialStep[];
}

export interface TutorialState {
  activeId: string | null;
  activeStepIndex: number;
  dismissed: boolean;
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
