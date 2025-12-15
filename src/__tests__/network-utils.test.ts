import { describe, it, expect } from 'vitest';
import {
  generateMacAddress,
  parseIP,
  ipToString,
  ipToNumber,
  numberToIP,
  getNetworkPrefix,
  getNetworkAddress,
  getBroadcastAddress,
  isSameNetwork,
  isValidIP,
  isValidSubnetMask,
  getHostRange,
  cidrToSubnetMask,
  subnetMaskToCidr,
  isPrivateIP,
  isLoopbackIP,
  isBroadcastMAC,
  isMulticastMAC,
  generatePrivateIP,
  findBestRoute,
  calculateChecksum,
} from '@/lib/network-utils';

describe('Network Utilities', () => {
  // ============================================
  // MAC Address Tests
  // ============================================
  describe('MAC Address Functions', () => {
    describe('generateMacAddress', () => {
      it('should generate a valid MAC address format', () => {
        const mac = generateMacAddress();
        expect(mac).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
      });

      it('should set the locally administered bit (bit 1 of first octet)', () => {
        const mac = generateMacAddress();
        const firstOctet = parseInt(mac.split(':')[0], 16);
        expect(firstOctet & 0x02).toBe(0x02); // Locally administered bit set
      });

      it('should clear the multicast bit (bit 0 of first octet)', () => {
        const mac = generateMacAddress();
        const firstOctet = parseInt(mac.split(':')[0], 16);
        expect(firstOctet & 0x01).toBe(0x00); // Multicast bit cleared
      });

      it('should generate unique MAC addresses', () => {
        const macs = new Set<string>();
        for (let i = 0; i < 100; i++) {
          macs.add(generateMacAddress());
        }
        expect(macs.size).toBe(100);
      });
    });

    describe('isBroadcastMAC', () => {
      it('should return true for broadcast MAC', () => {
        expect(isBroadcastMAC('FF:FF:FF:FF:FF:FF')).toBe(true);
        expect(isBroadcastMAC('ff:ff:ff:ff:ff:ff')).toBe(true);
      });

      it('should return false for unicast MAC', () => {
        expect(isBroadcastMAC('00:11:22:33:44:55')).toBe(false);
        expect(isBroadcastMAC('02:00:00:00:00:01')).toBe(false);
      });
    });

    describe('isMulticastMAC', () => {
      it('should return true for multicast MAC (bit 0 set)', () => {
        expect(isMulticastMAC('01:00:5E:00:00:01')).toBe(true); // IPv4 multicast
        expect(isMulticastMAC('33:33:00:00:00:01')).toBe(true); // IPv6 multicast
        expect(isMulticastMAC('FF:FF:FF:FF:FF:FF')).toBe(true); // Broadcast is also multicast
      });

      it('should return false for unicast MAC', () => {
        expect(isMulticastMAC('00:11:22:33:44:55')).toBe(false);
        expect(isMulticastMAC('02:00:00:00:00:01')).toBe(false); // Locally administered but unicast
      });
    });
  });

  // ============================================
  // IP Address Parsing Tests
  // ============================================
  describe('IP Address Parsing', () => {
    describe('parseIP', () => {
      it('should parse valid IP addresses', () => {
        expect(parseIP('192.168.1.1')).toEqual([192, 168, 1, 1]);
        expect(parseIP('10.0.0.0')).toEqual([10, 0, 0, 0]);
        expect(parseIP('255.255.255.255')).toEqual([255, 255, 255, 255]);
        expect(parseIP('0.0.0.0')).toEqual([0, 0, 0, 0]);
      });

      it('should return null for invalid IP addresses', () => {
        expect(parseIP('192.168.1')).toBeNull(); // Missing octet
        expect(parseIP('192.168.1.1.1')).toBeNull(); // Extra octet
        expect(parseIP('192.168.1.256')).toBeNull(); // Octet > 255
        expect(parseIP('192.168.1.-1')).toBeNull(); // Negative octet
        expect(parseIP('192.168.1.abc')).toBeNull(); // Non-numeric
        expect(parseIP('')).toBeNull(); // Empty string
        expect(parseIP('invalid')).toBeNull();
      });
    });

    describe('ipToString', () => {
      it('should convert octets to IP string', () => {
        expect(ipToString([192, 168, 1, 1])).toBe('192.168.1.1');
        expect(ipToString([0, 0, 0, 0])).toBe('0.0.0.0');
        expect(ipToString([255, 255, 255, 255])).toBe('255.255.255.255');
      });
    });

    describe('ipToNumber', () => {
      it('should convert IP to 32-bit number', () => {
        expect(ipToNumber('192.168.1.1')).toBe(0xC0A80101);
        expect(ipToNumber('10.0.0.1')).toBe(0x0A000001);
        expect(ipToNumber('255.255.255.255')).toBe(0xFFFFFFFF);
        expect(ipToNumber('0.0.0.0')).toBe(0);
      });

      it('should return 0 for invalid IP', () => {
        expect(ipToNumber('invalid')).toBe(0);
      });
    });

    describe('numberToIP', () => {
      it('should convert 32-bit number to IP', () => {
        expect(numberToIP(0xC0A80101)).toBe('192.168.1.1');
        expect(numberToIP(0x0A000001)).toBe('10.0.0.1');
        expect(numberToIP(0xFFFFFFFF)).toBe('255.255.255.255');
        expect(numberToIP(0)).toBe('0.0.0.0');
      });

      it('should handle edge cases', () => {
        expect(numberToIP(0x7F000001)).toBe('127.0.0.1'); // Loopback
      });
    });

    describe('isValidIP', () => {
      it('should validate correct IP addresses', () => {
        expect(isValidIP('192.168.1.1')).toBe(true);
        expect(isValidIP('10.0.0.0')).toBe(true);
        expect(isValidIP('0.0.0.0')).toBe(true);
        expect(isValidIP('255.255.255.255')).toBe(true);
      });

      it('should reject invalid IP addresses', () => {
        expect(isValidIP('256.1.1.1')).toBe(false);
        expect(isValidIP('1.1.1')).toBe(false);
        expect(isValidIP('1.1.1.1.1')).toBe(false);
        expect(isValidIP('abc.def.ghi.jkl')).toBe(false);
      });
    });
  });

  // ============================================
  // Subnet Mask Tests
  // ============================================
  describe('Subnet Mask Functions', () => {
    describe('isValidSubnetMask', () => {
      it('should validate correct subnet masks', () => {
        expect(isValidSubnetMask('255.255.255.0')).toBe(true);   // /24
        expect(isValidSubnetMask('255.255.0.0')).toBe(true);     // /16
        expect(isValidSubnetMask('255.0.0.0')).toBe(true);       // /8
        expect(isValidSubnetMask('255.255.255.255')).toBe(true); // /32
        expect(isValidSubnetMask('0.0.0.0')).toBe(true);         // /0
        expect(isValidSubnetMask('255.255.255.128')).toBe(true); // /25
        expect(isValidSubnetMask('255.255.255.192')).toBe(true); // /26
        expect(isValidSubnetMask('255.255.255.224')).toBe(true); // /27
        expect(isValidSubnetMask('255.255.255.240')).toBe(true); // /28
        expect(isValidSubnetMask('255.255.255.248')).toBe(true); // /29
        expect(isValidSubnetMask('255.255.255.252')).toBe(true); // /30
      });

      it('should reject invalid subnet masks (non-contiguous)', () => {
        expect(isValidSubnetMask('255.0.255.0')).toBe(false);   // Non-contiguous
        expect(isValidSubnetMask('255.255.0.255')).toBe(false); // Non-contiguous
        expect(isValidSubnetMask('255.255.255.1')).toBe(false); // Non-contiguous
        expect(isValidSubnetMask('128.0.0.0')).toBe(true);      // /1 is valid
      });
    });

    describe('getNetworkPrefix', () => {
      it('should calculate correct CIDR prefix length', () => {
        expect(getNetworkPrefix('255.255.255.0')).toBe(24);
        expect(getNetworkPrefix('255.255.0.0')).toBe(16);
        expect(getNetworkPrefix('255.0.0.0')).toBe(8);
        expect(getNetworkPrefix('255.255.255.255')).toBe(32);
        expect(getNetworkPrefix('0.0.0.0')).toBe(0);
        expect(getNetworkPrefix('255.255.255.128')).toBe(25);
        expect(getNetworkPrefix('255.255.255.252')).toBe(30);
      });
    });

    describe('cidrToSubnetMask', () => {
      it('should convert CIDR to subnet mask', () => {
        expect(cidrToSubnetMask(24)).toBe('255.255.255.0');
        expect(cidrToSubnetMask(16)).toBe('255.255.0.0');
        expect(cidrToSubnetMask(8)).toBe('255.0.0.0');
        expect(cidrToSubnetMask(32)).toBe('255.255.255.255');
        expect(cidrToSubnetMask(0)).toBe('0.0.0.0');
        expect(cidrToSubnetMask(25)).toBe('255.255.255.128');
        expect(cidrToSubnetMask(30)).toBe('255.255.255.252');
      });

      it('should handle invalid CIDR values', () => {
        expect(cidrToSubnetMask(-1)).toBe('0.0.0.0');
        expect(cidrToSubnetMask(33)).toBe('0.0.0.0');
      });
    });

    describe('subnetMaskToCidr', () => {
      it('should convert subnet mask to CIDR', () => {
        expect(subnetMaskToCidr('255.255.255.0')).toBe(24);
        expect(subnetMaskToCidr('255.255.0.0')).toBe(16);
        expect(subnetMaskToCidr('255.0.0.0')).toBe(8);
      });
    });
  });

  // ============================================
  // Network Calculation Tests
  // ============================================
  describe('Network Calculations', () => {
    describe('getNetworkAddress', () => {
      it('should calculate network address correctly', () => {
        expect(getNetworkAddress('192.168.1.100', '255.255.255.0')).toBe('192.168.1.0');
        expect(getNetworkAddress('192.168.1.255', '255.255.255.0')).toBe('192.168.1.0');
        expect(getNetworkAddress('10.20.30.40', '255.255.0.0')).toBe('10.20.0.0');
        expect(getNetworkAddress('172.16.50.100', '255.255.255.128')).toBe('172.16.50.0');
        expect(getNetworkAddress('172.16.50.200', '255.255.255.128')).toBe('172.16.50.128');
      });
    });

    describe('getBroadcastAddress', () => {
      it('should calculate broadcast address correctly', () => {
        expect(getBroadcastAddress('192.168.1.100', '255.255.255.0')).toBe('192.168.1.255');
        expect(getBroadcastAddress('10.20.30.40', '255.255.0.0')).toBe('10.20.255.255');
        expect(getBroadcastAddress('172.16.50.100', '255.255.255.128')).toBe('172.16.50.127');
        expect(getBroadcastAddress('172.16.50.200', '255.255.255.128')).toBe('172.16.50.255');
      });
    });

    describe('isSameNetwork', () => {
      it('should return true for IPs in same network', () => {
        expect(isSameNetwork('192.168.1.1', '192.168.1.254', '255.255.255.0')).toBe(true);
        expect(isSameNetwork('10.0.0.1', '10.0.255.254', '255.255.0.0')).toBe(true);
        expect(isSameNetwork('172.16.0.1', '172.16.0.1', '255.255.255.255')).toBe(true);
      });

      it('should return false for IPs in different networks', () => {
        expect(isSameNetwork('192.168.1.1', '192.168.2.1', '255.255.255.0')).toBe(false);
        expect(isSameNetwork('10.0.0.1', '10.1.0.1', '255.255.0.0')).toBe(false);
        expect(isSameNetwork('192.168.1.1', '192.168.1.2', '255.255.255.254')).toBe(false);
      });
    });

    describe('getHostRange', () => {
      it('should calculate host range correctly', () => {
        const range24 = getHostRange('192.168.1.100', '255.255.255.0');
        expect(range24.first).toBe('192.168.1.1');
        expect(range24.last).toBe('192.168.1.254');
        expect(range24.count).toBe(254);

        const range30 = getHostRange('10.0.0.5', '255.255.255.252');
        expect(range30.first).toBe('10.0.0.5');
        expect(range30.last).toBe('10.0.0.6');
        expect(range30.count).toBe(2);
      });

      it('should handle /31 and /32 networks', () => {
        // /31 - RFC 3021 point-to-point link, both addresses usable
        const range31 = getHostRange('10.0.0.0', '255.255.255.254');
        expect(range31.count).toBe(2);
        expect(range31.first).toBe('10.0.0.0');
        expect(range31.last).toBe('10.0.0.1');

        // /32 - single host route, no usable range
        const range32 = getHostRange('10.0.0.1', '255.255.255.255');
        expect(range32.count).toBe(0);
      });
    });
  });

  // ============================================
  // IP Classification Tests
  // ============================================
  describe('IP Classification', () => {
    describe('isPrivateIP', () => {
      it('should identify Class A private IPs (10.0.0.0/8)', () => {
        expect(isPrivateIP('10.0.0.1')).toBe(true);
        expect(isPrivateIP('10.255.255.255')).toBe(true);
        expect(isPrivateIP('10.100.50.25')).toBe(true);
      });

      it('should identify Class B private IPs (172.16.0.0/12)', () => {
        expect(isPrivateIP('172.16.0.1')).toBe(true);
        expect(isPrivateIP('172.31.255.255')).toBe(true);
        expect(isPrivateIP('172.20.100.50')).toBe(true);
      });

      it('should identify Class C private IPs (192.168.0.0/16)', () => {
        expect(isPrivateIP('192.168.0.1')).toBe(true);
        expect(isPrivateIP('192.168.255.255')).toBe(true);
        expect(isPrivateIP('192.168.100.50')).toBe(true);
      });

      it('should return false for public IPs', () => {
        expect(isPrivateIP('8.8.8.8')).toBe(false);
        expect(isPrivateIP('1.1.1.1')).toBe(false);
        expect(isPrivateIP('172.32.0.1')).toBe(false); // Just outside 172.16/12
        expect(isPrivateIP('172.15.255.255')).toBe(false); // Just below 172.16/12
        expect(isPrivateIP('192.167.1.1')).toBe(false);
      });
    });

    describe('isLoopbackIP', () => {
      it('should identify loopback IPs (127.0.0.0/8)', () => {
        expect(isLoopbackIP('127.0.0.1')).toBe(true);
        expect(isLoopbackIP('127.255.255.255')).toBe(true);
        expect(isLoopbackIP('127.0.0.0')).toBe(true);
      });

      it('should return false for non-loopback IPs', () => {
        expect(isLoopbackIP('128.0.0.1')).toBe(false);
        expect(isLoopbackIP('126.255.255.255')).toBe(false);
        expect(isLoopbackIP('192.168.1.1')).toBe(false);
      });
    });

    describe('generatePrivateIP', () => {
      it('should generate IPs in the 10.x.x.x range', () => {
        const ip = generatePrivateIP('10');
        expect(ip).toMatch(/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
        expect(isPrivateIP(ip)).toBe(true);
      });

      it('should generate IPs in the 172.16-31.x.x range', () => {
        const ip = generatePrivateIP('172');
        expect(ip).toMatch(/^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/);
        expect(isPrivateIP(ip)).toBe(true);
      });

      it('should generate IPs in the 192.168.x.x range by default', () => {
        const ip = generatePrivateIP();
        expect(ip).toMatch(/^192\.168\.\d{1,3}\.\d{1,3}$/);
        expect(isPrivateIP(ip)).toBe(true);
      });

      it('should not generate .0 as last octet (network address)', () => {
        // Run multiple times to increase confidence
        for (let i = 0; i < 50; i++) {
          const ip = generatePrivateIP();
          const lastOctet = parseInt(ip.split('.')[3]);
          expect(lastOctet).toBeGreaterThanOrEqual(1);
          expect(lastOctet).toBeLessThanOrEqual(254);
        }
      });
    });
  });

  // ============================================
  // Routing Tests
  // ============================================
  describe('Routing', () => {
    describe('findBestRoute', () => {
      const routes = [
        { destination: '0.0.0.0', netmask: '0.0.0.0', gateway: '192.168.1.1', metric: 100, interface: 'eth0' },
        { destination: '192.168.1.0', netmask: '255.255.255.0', gateway: '0.0.0.0', metric: 0, interface: 'eth0' },
        { destination: '10.0.0.0', netmask: '255.0.0.0', gateway: '192.168.1.254', metric: 10, interface: 'eth0' },
        { destination: '10.1.1.0', netmask: '255.255.255.0', gateway: '192.168.1.253', metric: 5, interface: 'eth1' },
      ];

      it('should find directly connected route', () => {
        const result = findBestRoute('192.168.1.100', routes);
        expect(result).not.toBeNull();
        expect(result!.gateway).toBe('0.0.0.0');
        expect(result!.interface).toBe('eth0');
      });

      it('should use longest prefix match', () => {
        // 10.1.1.50 matches both 10.0.0.0/8 and 10.1.1.0/24
        // Should prefer 10.1.1.0/24 (longer prefix)
        const result = findBestRoute('10.1.1.50', routes);
        expect(result).not.toBeNull();
        expect(result!.gateway).toBe('192.168.1.253');
        expect(result!.interface).toBe('eth1');
      });

      it('should use default route for unknown destinations', () => {
        const result = findBestRoute('8.8.8.8', routes);
        expect(result).not.toBeNull();
        expect(result!.gateway).toBe('192.168.1.1');
        expect(result!.metric).toBe(100);
      });

      it('should prefer lower metric for same prefix length', () => {
        const routesWithSamePrefix = [
          { destination: '10.0.0.0', netmask: '255.0.0.0', gateway: '192.168.1.1', metric: 20, interface: 'eth0' },
          { destination: '10.0.0.0', netmask: '255.0.0.0', gateway: '192.168.1.2', metric: 10, interface: 'eth1' },
        ];
        const result = findBestRoute('10.50.50.50', routesWithSamePrefix);
        expect(result).not.toBeNull();
        expect(result!.gateway).toBe('192.168.1.2');
        expect(result!.metric).toBe(10);
      });

      it('should return null when no route matches and no default', () => {
        const routesNoDefault = [
          { destination: '192.168.1.0', netmask: '255.255.255.0', gateway: '0.0.0.0', metric: 0, interface: 'eth0' },
        ];
        const result = findBestRoute('10.0.0.1', routesNoDefault);
        expect(result).toBeNull();
      });

      it('should handle empty routing table', () => {
        const result = findBestRoute('192.168.1.1', []);
        expect(result).toBeNull();
      });
    });
  });

  // ============================================
  // Checksum Tests
  // ============================================
  describe('Checksum', () => {
    describe('calculateChecksum', () => {
      it('should calculate IP-style checksum', () => {
        // Simple test case
        const data = [0x45, 0x00, 0x00, 0x73, 0x00, 0x00, 0x40, 0x00, 0x40, 0x11];
        const checksum = calculateChecksum(data);
        expect(typeof checksum).toBe('number');
        expect(checksum).toBeGreaterThanOrEqual(0);
        expect(checksum).toBeLessThanOrEqual(0xFFFF);
      });

      it('should handle odd-length data', () => {
        const data = [0x45, 0x00, 0x00];
        const checksum = calculateChecksum(data);
        expect(typeof checksum).toBe('number');
      });

      it('should return consistent results', () => {
        const data = [0x01, 0x02, 0x03, 0x04];
        const checksum1 = calculateChecksum(data);
        const checksum2 = calculateChecksum(data);
        expect(checksum1).toBe(checksum2);
      });
    });
  });
});
