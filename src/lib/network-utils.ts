// Network utility functions for realistic networking simulation

// Generate a random MAC address
export function generateMacAddress(): string {
  const hexDigits = '0123456789ABCDEF';
  let mac = '';
  for (let i = 0; i < 6; i++) {
    if (i > 0) mac += ':';
    // First byte: set locally administered bit (bit 1) and clear multicast bit (bit 0)
    if (i === 0) {
      const byte = Math.floor(Math.random() * 256);
      const modified = (byte & 0xFC) | 0x02; // Clear bit 0, set bit 1
      mac += modified.toString(16).toUpperCase().padStart(2, '0');
    } else {
      mac += hexDigits[Math.floor(Math.random() * 16)] + hexDigits[Math.floor(Math.random() * 16)];
    }
  }
  return mac;
}

// Parse IP address to array of octets
export function parseIP(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(p => parseInt(p, 10));
  if (octets.some(o => isNaN(o) || o < 0 || o > 255)) return null;
  return octets;
}

// Convert IP octets to string
export function ipToString(octets: number[]): string {
  return octets.join('.');
}

// Convert IP to 32-bit number (unsigned)
export function ipToNumber(ip: string): number {
  const parts = parseIP(ip);
  if (!parts) return 0;
  // Use >>> 0 to convert to unsigned 32-bit integer
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// Convert 32-bit number to IP string
export function numberToIP(num: number): string {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255
  ].join('.');
}

// Parse subnet mask and get prefix length
export function getNetworkPrefix(mask: string): number {
  const num = ipToNumber(mask);
  let count = 0;
  let n = num;
  while (n) {
    count += n & 1;
    n >>>= 1;
  }
  return count;
}

// Get network address from IP and mask
export function getNetworkAddress(ip: string, mask: string): string {
  const ipNum = ipToNumber(ip);
  const maskNum = ipToNumber(mask);
  return numberToIP((ipNum & maskNum) >>> 0);
}

// Get broadcast address from IP and mask
export function getBroadcastAddress(ip: string, mask: string): string {
  const ipNum = ipToNumber(ip);
  const maskNum = ipToNumber(mask);
  const wildcard = (~maskNum) >>> 0;
  return numberToIP(((ipNum & maskNum) | wildcard) >>> 0);
}

// Check if IP is in same network
export function isSameNetwork(ip1: string, ip2: string, mask: string): boolean {
  const net1 = getNetworkAddress(ip1, mask);
  const net2 = getNetworkAddress(ip2, mask);
  return net1 === net2;
}

// Validate IP address
export function isValidIP(ip: string): boolean {
  const parts = parseIP(ip);
  return parts !== null;
}

// Validate subnet mask
export function isValidSubnetMask(mask: string): boolean {
  const parts = parseIP(mask);
  if (!parts) return false;

  const num = ipToNumber(mask);
  // Check if it's a contiguous mask (all 1s followed by all 0s)
  const inverted = (~num) >>> 0;
  return (inverted & (inverted + 1)) === 0;
}

// Get available host range
export function getHostRange(ip: string, mask: string): { first: string; last: string; count: number } {
  const network = ipToNumber(getNetworkAddress(ip, mask));
  const broadcast = ipToNumber(getBroadcastAddress(ip, mask));
  const totalAddresses = broadcast - network + 1;

  // /32 - single host, no usable range
  if (totalAddresses === 1) {
    return {
      first: numberToIP(network),
      last: numberToIP(network),
      count: 0
    };
  }

  // /31 - point-to-point link (RFC 3021), both addresses usable
  if (totalAddresses === 2) {
    return {
      first: numberToIP(network),
      last: numberToIP(broadcast),
      count: 2
    };
  }

  // Standard networks - exclude network and broadcast addresses
  return {
    first: numberToIP(network + 1),
    last: numberToIP(broadcast - 1),
    count: Math.max(0, totalAddresses - 2)
  };
}

// Calculate subnet from CIDR notation
export function cidrToSubnetMask(cidr: number): string {
  if (cidr < 0 || cidr > 32) return '0.0.0.0';
  const mask = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
  return numberToIP(mask);
}

// Get CIDR from subnet mask
export function subnetMaskToCidr(mask: string): number {
  return getNetworkPrefix(mask);
}

// Check if IP is private
export function isPrivateIP(ip: string): boolean {
  const num = ipToNumber(ip);
  // 10.0.0.0/8 (0x0A000000 = 167772160)
  if ((num & 0xFF000000) >>> 0 === 0x0A000000) return true;
  // 172.16.0.0/12 (0xAC100000 = 2886729728)
  if ((num & 0xFFF00000) >>> 0 === 0xAC100000) return true;
  // 192.168.0.0/16 (0xC0A80000 = 3232235520)
  if ((num & 0xFFFF0000) >>> 0 === 0xC0A80000) return true;
  return false;
}

// Check if IP is loopback
export function isLoopbackIP(ip: string): boolean {
  const num = ipToNumber(ip);
  return (num & 0xFF000000) === 0x7F000000;
}

// Check if MAC is broadcast
export function isBroadcastMAC(mac: string): boolean {
  return mac.toUpperCase() === 'FF:FF:FF:FF:FF:FF';
}

// Check if MAC is multicast
export function isMulticastMAC(mac: string): boolean {
  const firstByte = parseInt(mac.split(':')[0], 16);
  return (firstByte & 0x01) === 1;
}

// Generate random IP in private range
export function generatePrivateIP(network: '10' | '172' | '192' = '192'): string {
  switch (network) {
    case '10':
      return `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
    case '172':
      return `172.${16 + Math.floor(Math.random() * 16)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
    case '192':
    default:
      return `192.168.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
  }
}

// Format bytes to human readable
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format speed (bits per second)
export function formatSpeed(bps: number): string {
  if (bps === 0) return '0 bps';
  const k = 1000;
  const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  const i = Math.floor(Math.log(bps) / Math.log(k));
  return parseFloat((bps / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Calculate checksum (simplified)
export function calculateChecksum(data: number[]): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 2) {
    sum += (data[i] << 8) + (data[i + 1] || 0);
  }
  while (sum >> 16) {
    sum = (sum & 0xFFFF) + (sum >> 16);
  }
  return (~sum) & 0xFFFF;
}

// Route matching - find best route for destination
export function findBestRoute(
  destIP: string,
  routes: Array<{ destination: string; netmask: string; gateway: string; metric: number; interface: string }>
): { gateway: string; metric: number; interface: string } | null {
  let bestRoute: { gateway: string; metric: number; prefixLen: number; interface: string } | null = null;

  for (const route of routes) {
    const destNum = ipToNumber(destIP);
    const routeNet = ipToNumber(route.destination);
    const routeMask = ipToNumber(route.netmask);

    // Check if destination matches this route
    if ((destNum & routeMask) === (routeNet & routeMask)) {
      const prefixLen = getNetworkPrefix(route.netmask);

      // Prefer longer prefix (more specific) and lower metric
      if (!bestRoute || prefixLen > bestRoute.prefixLen ||
        (prefixLen === bestRoute.prefixLen && route.metric < bestRoute.metric)) {
        bestRoute = {
          gateway: route.gateway,
          metric: route.metric,
          interface: route.interface,
          prefixLen
        };
      }
    }
  }

  return bestRoute ? { gateway: bestRoute.gateway, metric: bestRoute.metric, interface: bestRoute.interface } : null;
}

// Default gateway device names by type
export const deviceDefaults = {
  pc: { prefix: 'PC', interfaces: 1, canRoute: false },
  laptop: { prefix: 'Laptop', interfaces: 2, canRoute: false }, // WiFi + Ethernet
  server: { prefix: 'Server', interfaces: 2, canRoute: false },
  router: { prefix: 'Router', interfaces: 4, canRoute: true },
  switch: { prefix: 'Switch', interfaces: 8, canRoute: false },
  hub: { prefix: 'Hub', interfaces: 8, canRoute: false },
  firewall: { prefix: 'Firewall', interfaces: 4, canRoute: true },
  cloud: { prefix: 'Cloud', interfaces: 1, canRoute: true },
};

// Get interface name based on device type
export function getInterfaceName(deviceType: string, index: number): string {
  switch (deviceType) {
    case 'router':
    case 'firewall':
      return `GigabitEthernet0/${index}`;
    case 'switch':
      return `FastEthernet0/${index}`;
    case 'hub':
      return `Port${index}`;
    case 'laptop':
      return index === 0 ? 'eth0' : 'wlan0';
    default:
      return `eth${index}`;
  }
}
