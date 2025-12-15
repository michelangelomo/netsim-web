import type { NetworkDevice, RouteEntry, DhcpServerConfig } from '@/types/network';
import {
  isValidIP,
  isValidSubnetMask,
  getNetworkAddress,
  getBroadcastAddress,
  subnetMaskToCidr,
  getHostRange,
  cidrToSubnetMask,
  formatBytes,
  formatSpeed,
  isSameNetwork,
  findBestRoute,
} from './network-utils';

interface CommandResult {
  output: string;
  success: boolean;
}

interface NetworkStoreState {
  devices: NetworkDevice[];
  connections: Array<{
    id: string;
    sourceDeviceId: string;
    targetDeviceId: string;
    sourceInterfaceId: string;
    targetInterfaceId: string;
    isUp: boolean;
    bandwidth: number;
    latency: number;
  }>;
  getDeviceById: (id: string) => NetworkDevice | undefined;
  getDeviceByIP: (ip: string) => NetworkDevice | undefined;
  getConnectedDevices: (deviceId: string) => NetworkDevice[];
  configureInterface: (deviceId: string, interfaceId: string, config: Partial<NetworkDevice['interfaces'][0]>) => void;
  addRoute: (deviceId: string, route: Omit<RouteEntry, 'type'> & { type?: RouteEntry['type'] }) => void;
  removeRoute: (deviceId: string, destination: string) => void;
  sendPing: (sourceDeviceId: string, destIP: string) => Promise<string>;
  updateDevice: (deviceId: string, updates: Partial<NetworkDevice>) => void;
  simulation: { isRunning: boolean; speed: number };
  startSimulation: () => void;
  stopSimulation: () => void;
  setSimulationSpeed: (speed: number) => void;
  // DHCP
  configureDhcpServer: (deviceId: string, interfaceId: string, config: Partial<DhcpServerConfig>) => void;
  requestDhcp: (deviceId: string, interfaceId: string) => Promise<string>;
  releaseDhcp: (deviceId: string, interfaceId: string) => void;
  // DNS
  resolveDNS: (deviceId: string, hostname: string) => Promise<string | null>;
  reverseDNS: (deviceId: string, ip: string) => Promise<string | null>;
  // ARP
  resolveARP: (deviceId: string, targetIP: string) => string | null;
}

// Command definitions
const commands: Record<string, {
  description: string;
  usage: string;
  execute: (args: string[], deviceId: string | null, store: NetworkStoreState) => Promise<CommandResult> | CommandResult;
}> = {
  help: {
    description: 'Display available commands',
    usage: 'help [command]',
    execute: (args) => {
      if (args[0] && commands[args[0]]) {
        const cmd = commands[args[0]];
        return {
          output: `${args[0]} - ${cmd.description}\nUsage: ${cmd.usage}`,
          success: true,
        };
      }

      const output = `
Available Commands:
═══════════════════════════════════════════════════════════════

  NETWORK INFORMATION
  ───────────────────
  ifconfig [interface]     - Display/configure network interfaces
  ip addr                  - Show IP addresses
  ip route                 - Show routing table
  arp -a                   - Display ARP table
  mac-address-table        - Show MAC address table (switches)
  hostname [name]          - Display/set hostname

  NETWORK TESTING
  ───────────────
  ping <host|ip>           - Send ICMP echo requests
  traceroute <host|ip>     - Trace packet route to host
  nslookup <hostname>      - Query DNS for hostname
  dig <hostname>           - DNS lookup utility
  netstat [-r|-i|-t]       - Display network statistics

  CONFIGURATION
  ─────────────
  ip addr add <ip/cidr> dev <interface>  - Add IP address
  ip route add <net> via <gateway>       - Add static route
  ip route del <net>                     - Delete route
  ip link set <interface> up/down        - Enable/disable interface

  DHCP
  ────
  dhclient <interface>     - Request IP via DHCP
  dhclient -r <interface>  - Release DHCP lease
  dhcp server enable       - Enable DHCP server (routers only)
  dhcp server disable      - Disable DHCP server
  dhcp pool <start> <end>  - Set DHCP address pool
  dhcp gateway <ip>        - Set default gateway for clients
  show dhcp leases         - Show DHCP leases
  show dhcp config         - Show DHCP server configuration

  SIMULATION
  ──────────
  start                    - Start network simulation
  stop                     - Stop network simulation

  SYSTEM
  ──────
  clear                    - Clear terminal screen
  exit                     - Close terminal
  whoami                   - Display current device info
  show running-config      - Display device configuration

Type 'help <command>' for detailed usage information.
`;
      return { output, success: true };
    },
  },

  ifconfig: {
    description: 'Configure or display network interface parameters',
    usage: 'ifconfig [interface] [ip address] [netmask mask]',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'Error: No device selected', success: false };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'Error: Device not found', success: false };
      }

      // If specific interface requested with configuration
      if (args.length >= 2) {
        const ifaceName = args[0];
        const iface = device.interfaces.find(
          (i) => i.name === ifaceName || i.name.toLowerCase() === ifaceName.toLowerCase()
        );

        if (!iface) {
          return { output: `ifconfig: interface ${ifaceName} does not exist`, success: false };
        }

        // Parse IP address (might be in CIDR notation)
        let ip = args[1];
        let mask = '255.255.255.0';

        if (ip.includes('/')) {
          const [addr, cidr] = ip.split('/');
          ip = addr;
          mask = cidrToSubnetMask(parseInt(cidr, 10));
        } else if (args[2] === 'netmask' && args[3]) {
          mask = args[3];
        }

        if (!isValidIP(ip)) {
          return { output: `ifconfig: invalid IP address: ${ip}`, success: false };
        }

        if (!isValidSubnetMask(mask)) {
          return { output: `ifconfig: invalid netmask: ${mask}`, success: false };
        }

        store.configureInterface(deviceId, iface.id, {
          ipAddress: ip,
          subnetMask: mask,
        });

        return {
          output: `Interface ${iface.name} configured:\n  inet ${ip}  netmask ${mask}`,
          success: true,
        };
      }

      // Display interface info
      let output = '';
      const ifaces = args[0]
        ? device.interfaces.filter((i) => i.name === args[0] || i.name.toLowerCase() === args[0].toLowerCase())
        : device.interfaces;

      if (args[0] && ifaces.length === 0) {
        return { output: `ifconfig: interface ${args[0]} does not exist`, success: false };
      }

      ifaces.forEach((iface) => {
        const status = iface.isUp ? 'UP' : 'DOWN';
        const flags = `<${status},BROADCAST,MULTICAST>`;

        output += `${iface.name}: flags=4163${flags}  mtu 1500\n`;

        if (iface.ipAddress) {
          const broadcast = iface.subnetMask
            ? getBroadcastAddress(iface.ipAddress, iface.subnetMask)
            : '0.0.0.0';
          output += `        inet ${iface.ipAddress}  netmask ${iface.subnetMask || '0.0.0.0'}  broadcast ${broadcast}\n`;
        }

        output += `        ether ${iface.macAddress.toLowerCase()}\n`;
        output += `        ${iface.isUp ? `${iface.speed} Mbps ${iface.duplex} duplex` : 'LINK DOWN'}\n`;

        if (iface.connectedTo) {
          output += `        CONNECTED\n`;
        }

        output += '\n';
      });

      return { output: output.trim(), success: true };
    },
  },

  ip: {
    description: 'Show/manipulate routing, devices, policy routing and tunnels',
    usage: 'ip [addr|route|link] ...',
    execute: async (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'Error: No device selected', success: false };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'Error: Device not found', success: false };
      }

      const subCommand = args[0];

      if (subCommand === 'addr' || subCommand === 'address' || subCommand === 'a') {
        // ip addr add
        if (args[1] === 'add' && args.length >= 4) {
          const ipCidr = args[2];
          const devIndex = args.indexOf('dev');
          if (devIndex === -1 || !args[devIndex + 1]) {
            return { output: 'Usage: ip addr add <ip/cidr> dev <interface>', success: false };
          }

          const ifaceName = args[devIndex + 1];
          const iface = device.interfaces.find(
            (i) => i.name === ifaceName || i.name.toLowerCase() === ifaceName.toLowerCase()
          );

          if (!iface) {
            return { output: `Cannot find device "${ifaceName}"`, success: false };
          }

          const [ip, cidrStr] = ipCidr.split('/');
          const cidr = parseInt(cidrStr || '24', 10);

          if (!isValidIP(ip)) {
            return { output: `Invalid IP address: ${ip}`, success: false };
          }

          const mask = cidrToSubnetMask(cidr);

          store.configureInterface(deviceId, iface.id, {
            ipAddress: ip,
            subnetMask: mask,
          });

          return { output: `Added ${ip}/${cidr} to ${iface.name}`, success: true };
        }

        // ip addr del
        if (args[1] === 'del' && args.length >= 4) {
          const devIndex = args.indexOf('dev');
          if (devIndex === -1 || !args[devIndex + 1]) {
            return { output: 'Usage: ip addr del <ip/cidr> dev <interface>', success: false };
          }

          const ifaceName = args[devIndex + 1];
          const iface = device.interfaces.find((i) => i.name === ifaceName);

          if (!iface) {
            return { output: `Cannot find device "${ifaceName}"`, success: false };
          }

          store.configureInterface(deviceId, iface.id, {
            ipAddress: null,
            subnetMask: null,
          });

          return { output: `Removed address from ${iface.name}`, success: true };
        }

        // ip addr show
        let output = '';
        device.interfaces.forEach((iface, index) => {
          const state = iface.isUp ? 'UP' : 'DOWN';
          output += `${index + 1}: ${iface.name}: <BROADCAST,MULTICAST,${state}> mtu 1500 state ${state}\n`;
          output += `    link/ether ${iface.macAddress.toLowerCase()} brd ff:ff:ff:ff:ff:ff\n`;
          if (iface.ipAddress && iface.subnetMask) {
            const cidr = subnetMaskToCidr(iface.subnetMask);
            const brd = getBroadcastAddress(iface.ipAddress, iface.subnetMask);
            output += `    inet ${iface.ipAddress}/${cidr} brd ${brd} scope global ${iface.name}\n`;
          }
        });

        return { output: output.trim(), success: true };
      }

      if (subCommand === 'route' || subCommand === 'r') {
        // ip route add
        if (args[1] === 'add' && args.length >= 4) {
          const dest = args[2];
          const viaIndex = args.indexOf('via');

          if (viaIndex === -1) {
            return { output: 'Usage: ip route add <network/cidr> via <gateway>', success: false };
          }

          const gateway = args[viaIndex + 1];
          let destNet: string;
          let mask: string;

          if (dest === 'default') {
            destNet = '0.0.0.0';
            mask = '0.0.0.0';
          } else {
            const [net, cidrStr] = dest.split('/');
            destNet = net;
            mask = cidrToSubnetMask(parseInt(cidrStr || '24', 10));
          }

          if (!isValidIP(destNet) || !isValidIP(gateway)) {
            return { output: 'Invalid IP address', success: false };
          }

          store.addRoute(deviceId, {
            destination: destNet,
            netmask: mask,
            gateway,
            interface: device.interfaces[0]?.name || 'eth0',
            metric: 100,
          });

          return { output: `Route added: ${dest} via ${gateway}`, success: true };
        }

        // ip route del
        if (args[1] === 'del' && args[2]) {
          const dest = args[2] === 'default' ? '0.0.0.0' : args[2].split('/')[0];
          store.removeRoute(deviceId, dest);
          return { output: `Route deleted: ${args[2]}`, success: true };
        }

        // ip route show
        if (!device.routingTable || device.routingTable.length === 0) {
          return { output: 'No routes configured', success: true };
        }

        let output = '';
        device.routingTable.forEach((route) => {
          if (route.destination === '0.0.0.0') {
            output += `default via ${route.gateway} dev ${route.interface} metric ${route.metric}\n`;
          } else {
            const cidr = subnetMaskToCidr(route.netmask);
            if (route.gateway === '0.0.0.0') {
              output += `${route.destination}/${cidr} dev ${route.interface} proto kernel scope link\n`;
            } else {
              output += `${route.destination}/${cidr} via ${route.gateway} dev ${route.interface} metric ${route.metric}\n`;
            }
          }
        });

        return { output: output.trim(), success: true };
      }

      if (subCommand === 'link') {
        // ip link set
        if (args[1] === 'set' && args.length >= 4) {
          const ifaceName = args[2];
          const action = args[3];

          const iface = device.interfaces.find((i) => i.name === ifaceName);
          if (!iface) {
            return { output: `Cannot find device "${ifaceName}"`, success: false };
          }

          if (action === 'up') {
            store.configureInterface(deviceId, iface.id, { isUp: true });
            return { output: `Interface ${ifaceName} is now UP`, success: true };
          } else if (action === 'down') {
            store.configureInterface(deviceId, iface.id, { isUp: false });
            return { output: `Interface ${ifaceName} is now DOWN`, success: true };
          }
        }

        // ip link show
        let output = '';
        device.interfaces.forEach((iface, index) => {
          const state = iface.isUp ? 'UP' : 'DOWN';
          output += `${index + 1}: ${iface.name}: <BROADCAST,MULTICAST,${state}> mtu 1500 state ${state}\n`;
          output += `    link/ether ${iface.macAddress.toLowerCase()} brd ff:ff:ff:ff:ff:ff\n`;
        });

        return { output: output.trim(), success: true };
      }

      return {
        output: 'Usage: ip [addr|route|link] [add|del|show] ...',
        success: false,
      };
    },
  },

  ping: {
    description: 'Send ICMP echo requests to network hosts',
    usage: 'ping [-c count] <destination>',
    execute: async (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'ping: No device selected', success: false };
      }

      if (args.length === 0) {
        return { output: 'Usage: ping [-c count] <destination>', success: false };
      }

      let dest = args[args.length - 1];
      let destIP = dest;

      // Try DNS resolution if not an IP address
      if (!isValidIP(dest)) {
        const resolved = await store.resolveDNS(deviceId, dest);
        if (!resolved) {
          return { output: `ping: ${dest}: Name or service not known`, success: false };
        }
        destIP = resolved;
      }

      const result = await store.sendPing(deviceId, destIP);

      // If we resolved DNS, show the hostname in output
      let output = result;
      if (dest !== destIP) {
        output = result.replace(`PING ${destIP}`, `PING ${dest} (${destIP})`);
      }

      return { output, success: !result.includes('unreachable') && !result.includes('timeout') };
    },
  },

  arp: {
    description: 'Manipulate the ARP cache',
    usage: 'arp [-a] [-d address]',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'Error: No device selected', success: false };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'Error: Device not found', success: false };
      }

      if (!device.arpTable || device.arpTable.length === 0) {
        return { output: 'ARP cache is empty', success: true };
      }

      let output = 'Address                  HWtype  HWaddress           Flags Mask            Iface\n';
      device.arpTable.forEach((entry) => {
        output += `${entry.ipAddress.padEnd(24)} ether   ${entry.macAddress.toLowerCase()}   C                     ${entry.interface}\n`;
      });

      return { output: output.trim(), success: true };
    },
  },

  'mac-address-table': {
    description: 'Display MAC address table (switches only)',
    usage: 'mac-address-table',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'Error: No device selected', success: false };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'Error: Device not found', success: false };
      }

      if (device.type !== 'switch') {
        return { output: 'Error: This command is only available on switches', success: false };
      }

      if (!device.macTable || device.macTable.length === 0) {
        return { output: 'MAC address table is empty', success: true };
      }

      let output = 'VLAN    MAC Address       Type      Ports\n';
      output += '----    -----------       ----      -----\n';
      device.macTable.forEach((entry) => {
        output += `${entry.vlan.toString().padEnd(8)}${entry.macAddress.toLowerCase().padEnd(18)}${entry.type.padEnd(10)}${entry.port}\n`;
      });

      return { output, success: true };
    },
  },

  dhclient: {
    description: 'DHCP client - request or release IP address',
    usage: 'dhclient [-r] <interface>',
    execute: async (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'dhclient: No device selected', success: false };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'dhclient: Device not found', success: false };
      }

      // Parse arguments
      const release = args[0] === '-r';
      const ifaceName = release ? args[1] : args[0];

      if (!ifaceName) {
        return { output: 'Usage: dhclient [-r] <interface>', success: false };
      }

      const iface = device.interfaces.find(
        (i) => i.name === ifaceName || i.name.toLowerCase() === ifaceName.toLowerCase()
      );

      if (!iface) {
        return { output: `dhclient: interface ${ifaceName} not found`, success: false };
      }

      if (release) {
        // Release DHCP lease
        if (!iface.dhcpEnabled) {
          return { output: `dhclient: ${ifaceName} does not have a DHCP lease`, success: false };
        }
        store.releaseDhcp(deviceId, iface.id);
        return { output: `DHCP lease released on ${ifaceName}`, success: true };
      } else {
        // Request DHCP
        const result = await store.requestDhcp(deviceId, iface.id);
        return { output: result, success: !result.includes('failed') };
      }
    },
  },

  dhcp: {
    description: 'Configure DHCP server',
    usage: 'dhcp [<interface>] [server enable|disable] [pool <start> <end>] [gateway <ip>]',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'dhcp: No device selected', success: false };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'dhcp: Device not found', success: false };
      }

      if (device.type !== 'router' && device.type !== 'server') {
        return { output: 'dhcp: DHCP server can only be configured on routers and servers', success: false };
      }

      // Optional interface selector: dhcp <iface> ...
      const maybeIfaceName = args[0];
      const selectedIface = maybeIfaceName
        ? device.interfaces.find((i) => i.name.toLowerCase() === maybeIfaceName.toLowerCase())
        : undefined;

      const targetIface = selectedIface || device.interfaces.find((i) => i.ipAddress) || device.interfaces[0];
      if (!targetIface) {
        return { output: 'dhcp: No interfaces available', success: false };
      }

      const rest = selectedIface ? args.slice(1) : args;
      const subCommand = rest[0];

      if (subCommand === 'server') {
        const action = rest[1];
        if (action === 'enable') {
          store.configureDhcpServer(deviceId, targetIface.id, { enabled: true });
          return { output: `DHCP server enabled on ${targetIface.name}`, success: true };
        } else if (action === 'disable') {
          store.configureDhcpServer(deviceId, targetIface.id, { enabled: false });
          return { output: `DHCP server disabled on ${targetIface.name}`, success: true };
        }
        return { output: 'Usage: dhcp [<interface>] server [enable|disable]', success: false };
      }

      if (subCommand === 'pool') {
        const start = rest[1];
        const end = rest[2];
        if (!start || !end) {
          return { output: 'Usage: dhcp [<interface>] pool <start-ip> <end-ip>', success: false };
        }
        if (!isValidIP(start) || !isValidIP(end)) {
          return { output: 'dhcp: Invalid IP address', success: false };
        }
        store.configureDhcpServer(deviceId, targetIface.id, { poolStart: start, poolEnd: end });
        return { output: `DHCP pool set on ${targetIface.name}: ${start} - ${end}`, success: true };
      }

      if (subCommand === 'gateway') {
        const gateway = rest[1];
        if (!gateway) {
          return { output: 'Usage: dhcp [<interface>] gateway <ip>', success: false };
        }
        if (!isValidIP(gateway)) {
          return { output: 'dhcp: Invalid IP address', success: false };
        }
        store.configureDhcpServer(deviceId, targetIface.id, { defaultGateway: gateway });
        return { output: `DHCP default gateway on ${targetIface.name} set to ${gateway}`, success: true };
      }

      if (subCommand === 'dns') {
        const dns = rest.slice(1).filter((ip) => isValidIP(ip));
        if (dns.length === 0) {
          return { output: 'Usage: dhcp [<interface>] dns <ip> [ip2] ...', success: false };
        }
        store.configureDhcpServer(deviceId, targetIface.id, { dnsServers: dns });
        return { output: `DHCP DNS servers on ${targetIface.name} set: ${dns.join(', ')}`, success: true };
      }

      if (subCommand === 'subnet' || subCommand === 'netmask') {
        const mask = rest[1];
        if (!mask || !isValidSubnetMask(mask)) {
          return { output: 'Usage: dhcp [<interface>] subnet <netmask>', success: false };
        }
        store.configureDhcpServer(deviceId, targetIface.id, { subnetMask: mask });
        return { output: `DHCP subnet mask on ${targetIface.name} set to ${mask}`, success: true };
      }

      return {
        output: `Usage: dhcp [<interface>] [server enable|disable] [pool <start> <end>] [gateway <ip>] [dns <ip>...] [subnet <mask>]`,
        success: false,
      };
    },
  },

  hostname: {
    description: 'Show or set system hostname',
    usage: 'hostname [name]',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'Error: No device selected', success: false };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'Error: Device not found', success: false };
      }

      if (args[0]) {
        store.updateDevice(deviceId, { hostname: args[0], name: args[0] });
        return { output: `Hostname set to ${args[0]}`, success: true };
      }

      return { output: device.hostname, success: true };
    },
  },

  deviceinfo: {
    description: 'Display information about the current device',
    usage: 'deviceinfo',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'netsim (main terminal)', success: true };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'Error: Device not found', success: false };
      }

      let output = `Device: ${device.name}\n`;
      output += `Type: ${device.type}\n`;
      output += `Hostname: ${device.hostname}\n`;
      output += `Status: ${device.isRunning ? 'Running' : 'Stopped'}\n`;
      output += `Interfaces: ${device.interfaces.length}\n`;

      const configuredIPs = device.interfaces.filter((i) => i.ipAddress).length;
      output += `Configured IPs: ${configuredIPs}`;

      return { output, success: true };
    },
  },

  'show': {
    description: 'Show various system information',
    usage: 'show [running-config|interfaces|ip route|arp]',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'Error: No device selected', success: false };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'Error: Device not found', success: false };
      }

      const subCmd = args.join(' ');

      if (subCmd === 'running-config' || subCmd === 'run') {
        let output = `!\n! ${device.name} Configuration\n!\n`;
        output += `hostname ${device.hostname}\n!\n`;

        device.interfaces.forEach((iface) => {
          output += `interface ${iface.name}\n`;
          if (iface.ipAddress && iface.subnetMask) {
            output += ` ip address ${iface.ipAddress} ${iface.subnetMask}\n`;
          }
          if (!iface.isUp) {
            output += ` shutdown\n`;
          }
          output += `!\n`;
        });

        if (device.routingTable && device.routingTable.length > 0) {
          device.routingTable.forEach((route) => {
            if (route.type === 'static') {
              if (route.destination === '0.0.0.0') {
                output += `ip route 0.0.0.0 0.0.0.0 ${route.gateway}\n`;
              } else {
                output += `ip route ${route.destination} ${route.netmask} ${route.gateway}\n`;
              }
            }
          });
          output += `!\n`;
        }

        output += `end`;
        return { output, success: true };
      }

      if (subCmd === 'interfaces' || subCmd === 'int') {
        return commands.ifconfig.execute([], deviceId, store);
      }

      if (subCmd === 'ip route') {
        return commands.ip.execute(['route'], deviceId, store);
      }

      if (subCmd === 'arp') {
        return commands.arp.execute(['-a'], deviceId, store);
      }

      if (subCmd === 'dhcp leases') {
        const servers = device.dhcpServers || [];
        const allLeases = servers.flatMap((s) => (s.leases || []).map((l) => ({ lease: l, iface: s.interfaceName || s.interfaceId })));
        if (allLeases.length === 0) {
          return { output: 'No active DHCP leases', success: true };
        }

        let output = 'IP Address       MAC Address        Hostname         Expires    Interface\n';
        output += '──────────────────────────────────────────────────────────────────────────\n';
        allLeases.forEach(({ lease, iface }) => {
          const expiresIn = Math.max(0, Math.floor((lease.leaseEnd - Date.now()) / 1000));
          const expiresStr = expiresIn > 3600
            ? `${Math.floor(expiresIn / 3600)}h ${Math.floor((expiresIn % 3600) / 60)}m`
            : `${Math.floor(expiresIn / 60)}m ${expiresIn % 60}s`;
          output += `${lease.ipAddress.padEnd(17)}${lease.macAddress.toLowerCase().padEnd(19)}${lease.hostname.padEnd(17)}${expiresStr.padEnd(10)}${iface}\n`;
        });
        return { output, success: true };
      }

      if (subCmd === 'dhcp config' || subCmd === 'dhcp') {
        const servers = device.dhcpServers || [];
        if (servers.length === 0) {
          return { output: 'DHCP server is not configured on this device', success: false };
        }

        let output = 'DHCP Server Configuration\n';
        output += '═════════════════════════\n';
        servers.forEach((config) => {
          output += `\nInterface:       ${config.interfaceName || config.interfaceId}\n`;
          output += `Status:          ${config.enabled ? 'Enabled' : 'Disabled'}\n`;
          output += `Pool Start:      ${config.poolStart}\n`;
          output += `Pool End:        ${config.poolEnd}\n`;
          output += `Subnet Mask:     ${config.subnetMask}\n`;
          output += `Default Gateway: ${config.defaultGateway}\n`;
          output += `DNS Servers:     ${config.dnsServers.join(', ')}\n`;
          output += `Lease Time:      ${config.leaseTime} seconds\n`;
          output += `Active Leases:   ${(config.leases || []).length}\n`;
        });
        return { output, success: true };
      }

      return {
        output: 'Usage: show [running-config|interfaces|ip route|arp|dhcp leases|dhcp config]',
        success: false,
      };
    },
  },

  netstat: {
    description: 'Print network connections and statistics',
    usage: 'netstat [-r|-i]',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'Error: No device selected', success: false };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'Error: Device not found', success: false };
      }

      if (args[0] === '-r') {
        return commands.ip.execute(['route'], deviceId, store);
      }

      if (args[0] === '-i') {
        let output = 'Kernel Interface table\n';
        output += 'Iface      MTU    RX-OK RX-ERR RX-DRP RX-OVR    TX-OK TX-ERR TX-DRP TX-OVR Flg\n';
        device.interfaces.forEach((iface) => {
          const flags = iface.isUp ? 'BMRU' : 'BMU';
          output += `${iface.name.padEnd(11)}1500   ${Math.floor(Math.random() * 10000).toString().padEnd(6)}0      0      0     ${Math.floor(Math.random() * 10000).toString().padEnd(6)}0      0      0     ${flags}\n`;
        });
        return { output, success: true };
      }

      let output = 'Active Internet connections\n';
      output += 'Proto Recv-Q Send-Q Local Address           Foreign Address         State\n';
      return { output, success: true };
    },
  },

  traceroute: {
    description: 'Print the route packets take to network host',
    usage: 'traceroute <destination>',
    execute: async (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'Error: No device selected', success: false };
      }

      if (!args[0]) {
        return { output: 'Usage: traceroute <destination>', success: false };
      }

      let dest = args[0];
      let destIP = dest;

      // Try DNS resolution if not an IP address
      if (!isValidIP(dest)) {
        const resolved = await store.resolveDNS(deviceId, dest);
        if (!resolved) {
          return { output: `traceroute: unknown host ${dest}`, success: false };
        }
        destIP = resolved;
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'Error: Device not found', success: false };
      }

      let output = `traceroute to ${dest}${dest !== destIP ? ` (${destIP})` : ''}, 30 hops max, 60 byte packets\n`;

      const destDevice = store.getDeviceByIP(destIP);

      const sourceIface = device.interfaces.find((i) => i.ipAddress && i.subnetMask && i.isUp);
      if (!sourceIface?.ipAddress || !sourceIface.subnetMask) {
        output += ` 1  * * *\n`;
        return { output, success: false };
      }

      const visited = new Set<string>();
      let currentDevice: NetworkDevice | undefined = device;
      let currentIface = sourceIface;
      let found = false;

      for (let hop = 1; hop <= 30; hop++) {
        if (!currentDevice) break;
        if (visited.has(currentDevice.id)) {
          output += ` ${hop}  * * *\n`;
          break;
        }
        visited.add(currentDevice.id);

        // If we're already at the destination device, print it and stop.
        if (destDevice && currentDevice.id === destDevice.id) {
          const ip = destIP;
          const hostname = (await store.reverseDNS(deviceId, ip)) || ip;
          const latency = (hop * 1.5 + Math.random() * 2).toFixed(3);
          output += ` ${hop}  ${hostname} (${ip})  ${latency} ms  ${latency} ms  ${latency} ms\n`;
          found = true;
          break;
        }

        // Determine next-hop IP from current device's perspective.
        // Hosts (no routing table) use their interface gateway for non-local destinations.
        let nextHopIP: string | null = null;

        const localIface = currentDevice.interfaces.find(
          (i) => i.ipAddress && i.subnetMask && i.isUp && isSameNetwork(i.ipAddress, destIP, i.subnetMask)
        );
        if (localIface) {
          nextHopIP = destIP;
          currentIface = localIface;
        } else {
          if (!currentDevice.routingTable) {
            nextHopIP = currentIface.gateway || null;
          } else {
            const route = findBestRoute(destIP, currentDevice.routingTable);
            if (route) {
              nextHopIP = route.gateway === '0.0.0.0' ? destIP : route.gateway;
              const outIface = currentDevice.interfaces.find((i) => i.name === route.interface);
              if (outIface) currentIface = outIface;
            }
          }
        }

        if (!nextHopIP) {
          output += ` ${hop}  * * *\n`;
          break;
        }

        const nextHopDevice = store.getDeviceByIP(nextHopIP);

        // Print hop: routers/firewalls (or gateway host), and the final destination.
        const hopIpToShow = nextHopDevice
          ? (nextHopDevice.interfaces.find((i) => i.ipAddress && (nextHopIP === i.ipAddress))?.ipAddress || nextHopIP)
          : nextHopIP;
        const hostname = (await store.reverseDNS(deviceId, hopIpToShow)) || hopIpToShow;
        const latency = (hop * 1.5 + Math.random() * 2).toFixed(3);
        output += ` ${hop}  ${hostname} (${hopIpToShow})  ${latency} ms  ${latency} ms  ${latency} ms\n`;

        if (destDevice && nextHopDevice && nextHopDevice.id === destDevice.id) {
          found = true;
          break;
        }
        if (!nextHopDevice) break;
        currentDevice = nextHopDevice;
      }

      return { output, success: found };
    },
  },

  nslookup: {
    description: 'Query DNS for hostname',
    usage: 'nslookup <hostname>',
    execute: async (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'nslookup: No device selected', success: false };
      }

      if (!args[0]) {
        return { output: 'Usage: nslookup <hostname>', success: false };
      }

      const hostname = args[0];
      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'nslookup: Device not found', success: false };
      }

      // Check if it's an IP (reverse lookup)
      if (isValidIP(hostname)) {
        const name = await store.reverseDNS(deviceId, hostname);
        if (name) {
          return {
            output: `Server:    local\nAddress:   127.0.0.1\n\nName:      ${name}\nAddress:   ${hostname}`,
            success: true,
          };
        }
        return {
          output: `Server:    local\nAddress:   127.0.0.1\n\n** server can't find ${hostname}: NXDOMAIN`,
          success: false,
        };
      }

      // Forward lookup
      const ip = await store.resolveDNS(deviceId, hostname);
      if (ip) {
        return {
          output: `Server:    local\nAddress:   127.0.0.1\n\nName:      ${hostname}\nAddress:   ${ip}`,
          success: true,
        };
      }

      return {
        output: `Server:    local\nAddress:   127.0.0.1\n\n** server can't find ${hostname}: NXDOMAIN`,
        success: false,
      };
    },
  },

  dig: {
    description: 'DNS lookup utility',
    usage: 'dig <hostname>',
    execute: async (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'dig: No device selected', success: false };
      }

      if (!args[0]) {
        return { output: 'Usage: dig <hostname>', success: false };
      }

      const hostname = args[0];
      const ip = await store.resolveDNS(deviceId, hostname);

      let output = '; <<>> DiG 9.18.0 <<>> ' + hostname + '\n';
      output += ';; global options: +cmd\n';
      output += ';; Got answer:\n';

      if (ip) {
        output += `;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: ${Math.floor(Math.random() * 65536)}\n`;
        output += ';; flags: qr rd ra; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 0\n\n';
        output += ';; QUESTION SECTION:\n';
        output += `;${hostname}.\t\t\tIN\tA\n\n`;
        output += ';; ANSWER SECTION:\n';
        output += `${hostname}.\t\t300\tIN\tA\t${ip}\n\n`;
        output += `;; Query time: ${Math.floor(Math.random() * 50) + 1} msec\n`;
        output += `;; SERVER: 127.0.0.1#53(127.0.0.1)\n`;
        output += `;; MSG SIZE  rcvd: ${64 + hostname.length}`;
      } else {
        output += `;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: ${Math.floor(Math.random() * 65536)}\n`;
        output += ';; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 0, ADDITIONAL: 0\n\n';
        output += ';; QUESTION SECTION:\n';
        output += `;${hostname}.\t\t\tIN\tA\n\n`;
        output += `;; Query time: ${Math.floor(Math.random() * 50) + 1} msec\n`;
        output += `;; SERVER: 127.0.0.1#53(127.0.0.1)`;
      }

      return { output, success: !!ip };
    },
  },

  start: {
    description: 'Start network simulation',
    usage: 'start',
    execute: (args, deviceId, store) => {
      if (store.simulation.isRunning) {
        return { output: 'Simulation is already running', success: true };
      }
      store.startSimulation();
      return { output: 'Network simulation started', success: true };
    },
  },

  stop: {
    description: 'Stop network simulation',
    usage: 'stop',
    execute: (args, deviceId, store) => {
      if (!store.simulation.isRunning) {
        return { output: 'Simulation is not running', success: true };
      }
      store.stopSimulation();
      return { output: 'Network simulation stopped', success: true };
    },
  },

  speed: {
    description: 'Get or set simulation speed',
    usage: 'speed [0.1-10]',
    execute: (args, deviceId, store) => {
      if (args.length === 0) {
        const currentSpeed = store.simulation.speed || 1;
        return {
          output: `Current simulation speed: ${currentSpeed}x\nUsage: speed <0.1-10> (e.g., speed 2 for 2x speed)`,
          success: true
        };
      }

      const newSpeed = parseFloat(args[0]);
      if (isNaN(newSpeed) || newSpeed < 0.1 || newSpeed > 10) {
        return { output: 'Speed must be a number between 0.1 and 10', success: false };
      }

      store.setSimulationSpeed(newSpeed);
      return { output: `Simulation speed set to ${newSpeed}x`, success: true };
    },
  },

  clear: {
    description: 'Clear terminal screen',
    usage: 'clear',
    execute: () => {
      return { output: '\x1Bc', success: true }; // ANSI clear screen
    },
  },

  exit: {
    description: 'Exit terminal',
    usage: 'exit',
    execute: () => {
      return { output: 'EXIT_TERMINAL', success: true };
    },
  },

  // ============ BASIC UNIX COMMANDS ============

  echo: {
    description: 'Display a line of text',
    usage: 'echo [string...]',
    execute: (args) => {
      // Handle variable expansion and escape sequences
      let output = args.join(' ');
      // Handle \n, \t escape sequences
      output = output.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      // Remove surrounding quotes if present
      if ((output.startsWith('"') && output.endsWith('"')) ||
        (output.startsWith("'") && output.endsWith("'"))) {
        output = output.slice(1, -1);
      }
      return { output, success: true };
    },
  },

  pwd: {
    description: 'Print working directory',
    usage: 'pwd',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: '/', success: true };
      }
      const device = store.getDeviceById(deviceId);
      return { output: `/devices/${device?.hostname || deviceId}`, success: true };
    },
  },

  cd: {
    description: 'Change directory (simulated)',
    usage: 'cd [directory]',
    execute: (args) => {
      // Simulated - always succeed
      return { output: '', success: true };
    },
  },

  ls: {
    description: 'List directory contents',
    usage: 'ls [-la] [path]',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'ls: No device selected', success: false };
      }
      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'ls: Device not found', success: false };
      }

      const showHidden = args.includes('-a') || args.includes('-la') || args.includes('-al');
      const longFormat = args.includes('-l') || args.includes('-la') || args.includes('-al');

      let output = '';
      if (longFormat) {
        output = `total 8\n`;
        output += `drwxr-xr-x 2 root root 4096 Dec 15 00:00 .\n`;
        output += `drwxr-xr-x 3 root root 4096 Dec 15 00:00 ..\n`;
        if (showHidden) {
          output += `-rw-r--r-- 1 root root  128 Dec 15 00:00 .config\n`;
        }
        output += `-rw-r--r-- 1 root root  256 Dec 15 00:00 interfaces.conf\n`;
        output += `-rw-r--r-- 1 root root  512 Dec 15 00:00 routes.conf\n`;
        if (device.type === 'router' || device.type === 'firewall') {
          output += `-rw-r--r-- 1 root root  128 Dec 15 00:00 firewall.rules\n`;
        }
      } else {
        const files = ['interfaces.conf', 'routes.conf'];
        if (device.type === 'router' || device.type === 'firewall') {
          files.push('firewall.rules');
        }
        if (showHidden) {
          files.unshift('.config');
        }
        output = files.join('  ');
      }
      return { output, success: true };
    },
  },

  cat: {
    description: 'Concatenate and print files',
    usage: 'cat <file>',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'cat: No device selected', success: false };
      }
      if (args.length === 0) {
        return { output: 'cat: missing operand', success: false };
      }

      const device = store.getDeviceById(deviceId);
      if (!device) {
        return { output: 'cat: Device not found', success: false };
      }

      const filename = args[0];

      if (filename === 'interfaces.conf' || filename === '/etc/network/interfaces') {
        let output = `# Network interface configuration for ${device.hostname}\n\n`;
        device.interfaces.forEach(iface => {
          output += `auto ${iface.name}\n`;
          output += `iface ${iface.name} inet ${iface.dhcpEnabled ? 'dhcp' : 'static'}\n`;
          if (iface.ipAddress && !iface.dhcpEnabled) {
            output += `    address ${iface.ipAddress}\n`;
            output += `    netmask ${iface.subnetMask || '255.255.255.0'}\n`;
            if (iface.gateway) {
              output += `    gateway ${iface.gateway}\n`;
            }
          }
          output += `    hwaddress ether ${iface.macAddress}\n\n`;
        });
        return { output, success: true };
      }

      if (filename === 'routes.conf' || filename === '/etc/routes') {
        let output = `# Routing table for ${device.hostname}\n`;
        if (device.routingTable && device.routingTable.length > 0) {
          device.routingTable.forEach(route => {
            output += `${route.destination}/${subnetMaskToCidr(route.netmask)} via ${route.gateway} dev ${route.interface}\n`;
          });
        } else {
          output += '# No static routes configured\n';
        }
        return { output, success: true };
      }

      if (filename === '.config') {
        return {
          output: `hostname=${device.hostname}\ntype=${device.type}\nrunning=${device.isRunning}`,
          success: true
        };
      }

      return { output: `cat: ${filename}: No such file or directory`, success: false };
    },
  },

  uname: {
    description: 'Print system information',
    usage: 'uname [-a]',
    execute: (args, deviceId, store) => {
      const showAll = args.includes('-a');
      const device = deviceId ? store.getDeviceById(deviceId) : null;
      const hostname = device?.hostname || 'netsim';

      if (showAll) {
        return {
          output: `NetSimOS 5.15.0-netsim ${hostname} ${new Date().toISOString().split('T')[0]} x86_64 GNU/Linux`,
          success: true
        };
      }
      return { output: 'NetSimOS', success: true };
    },
  },

  date: {
    description: 'Print or set the system date and time',
    usage: 'date [+format]',
    execute: (args) => {
      const now = new Date();
      if (args[0]?.startsWith('+')) {
        // Simple format string handling
        let format = args[0].slice(1);
        let output = format
          .replace(/%Y/g, now.getFullYear().toString())
          .replace(/%m/g, (now.getMonth() + 1).toString().padStart(2, '0'))
          .replace(/%d/g, now.getDate().toString().padStart(2, '0'))
          .replace(/%H/g, now.getHours().toString().padStart(2, '0'))
          .replace(/%M/g, now.getMinutes().toString().padStart(2, '0'))
          .replace(/%S/g, now.getSeconds().toString().padStart(2, '0'));
        return { output, success: true };
      }
      return { output: now.toString(), success: true };
    },
  },

  uptime: {
    description: 'Show how long the system has been running',
    usage: 'uptime',
    execute: (args, deviceId, store) => {
      const now = new Date();
      const hours = now.getHours();
      const mins = now.getMinutes();
      const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
      // Simulated uptime
      const uptimeMins = Math.floor(Math.random() * 60) + 1;
      const uptimeHours = Math.floor(Math.random() * 24);
      return {
        output: ` ${timeStr} up ${uptimeHours}:${uptimeMins.toString().padStart(2, '0')},  1 user,  load average: 0.00, 0.01, 0.05`,
        success: true
      };
    },
  },

  whoami: {
    description: 'Print effective user ID',
    usage: 'whoami',
    execute: (args, deviceId, store) => {
      const device = deviceId ? store.getDeviceById(deviceId) : null;
      if (device?.type === 'router' || device?.type === 'firewall') {
        return { output: 'root', success: true };
      }
      return { output: 'user', success: true };
    },
  },

  id: {
    description: 'Print user identity',
    usage: 'id',
    execute: (args, deviceId, store) => {
      const device = deviceId ? store.getDeviceById(deviceId) : null;
      if (device?.type === 'router' || device?.type === 'firewall') {
        return { output: 'uid=0(root) gid=0(root) groups=0(root)', success: true };
      }
      return { output: 'uid=1000(user) gid=1000(user) groups=1000(user),27(sudo)', success: true };
    },
  },

  env: {
    description: 'Print environment variables',
    usage: 'env',
    execute: (args, deviceId, store) => {
      const device = deviceId ? store.getDeviceById(deviceId) : null;
      const hostname = device?.hostname || 'netsim';
      const user = (device?.type === 'router' || device?.type === 'firewall') ? 'root' : 'user';
      return {
        output: `HOSTNAME=${hostname}
USER=${user}
HOME=/${user === 'root' ? 'root' : 'home/user'}
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
TERM=xterm-256color
LANG=en_US.UTF-8`,
        success: true
      };
    },
  },

  export: {
    description: 'Set environment variable',
    usage: 'export NAME=value',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'export: usage: export NAME=value', success: false };
      }
      // Simulated - just acknowledge
      return { output: '', success: true };
    },
  },

  true: {
    description: 'Do nothing, successfully',
    usage: 'true',
    execute: () => ({ output: '', success: true }),
  },

  false: {
    description: 'Do nothing, unsuccessfully',
    usage: 'false',
    execute: () => ({ output: '', success: false }),
  },

  test: {
    description: 'Check file types and compare values',
    usage: 'test expression',
    execute: (args) => {
      // Basic test implementation
      if (args.length === 0) return { output: '', success: false };

      if (args[0] === '-n' && args[1]) {
        return { output: '', success: args[1].length > 0 };
      }
      if (args[0] === '-z' && args[1] !== undefined) {
        return { output: '', success: args[1].length === 0 };
      }
      if (args[1] === '=' || args[1] === '==') {
        return { output: '', success: args[0] === args[2] };
      }
      if (args[1] === '!=') {
        return { output: '', success: args[0] !== args[2] };
      }

      return { output: '', success: !!args[0] };
    },
  },

  sleep: {
    description: 'Delay for a specified time',
    usage: 'sleep seconds',
    execute: async (args) => {
      const seconds = parseFloat(args[0]) || 1;
      await new Promise(resolve => setTimeout(resolve, Math.min(seconds, 5) * 1000)); // Max 5 seconds
      return { output: '', success: true };
    },
  },

  grep: {
    description: 'Search for patterns in text',
    usage: 'grep pattern',
    execute: (args) => {
      // grep needs piped input, for now return usage
      if (args.length === 0) {
        return { output: 'Usage: grep PATTERN (use with pipe, e.g., "ip addr | grep inet")', success: false };
      }
      return { output: 'grep: no input (use with pipe)', success: false };
    },
  },

  head: {
    description: 'Output the first part of files',
    usage: 'head [-n lines] [file]',
    execute: (args, deviceId, store) => {
      const nIndex = args.indexOf('-n');
      const lines = nIndex !== -1 ? parseInt(args[nIndex + 1]) || 10 : 10;
      return { output: `head: showing first ${lines} lines (use with pipe)`, success: true };
    },
  },

  tail: {
    description: 'Output the last part of files',
    usage: 'tail [-n lines] [file]',
    execute: (args) => {
      const nIndex = args.indexOf('-n');
      const lines = nIndex !== -1 ? parseInt(args[nIndex + 1]) || 10 : 10;
      return { output: `tail: showing last ${lines} lines (use with pipe)`, success: true };
    },
  },

  wc: {
    description: 'Print newline, word, and byte counts',
    usage: 'wc [-lwc]',
    execute: (args) => {
      return { output: 'wc: no input (use with pipe)', success: false };
    },
  },

  sort: {
    description: 'Sort lines of text',
    usage: 'sort',
    execute: () => {
      return { output: 'sort: no input (use with pipe)', success: true };
    },
  },

  uniq: {
    description: 'Report or omit repeated lines',
    usage: 'uniq',
    execute: () => {
      return { output: 'uniq: no input (use with pipe)', success: true };
    },
  },

  man: {
    description: 'Display manual page',
    usage: 'man command',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'What manual page do you want?', success: false };
      }
      const cmd = args[0];
      if (commands[cmd]) {
        return {
          output: `${cmd.toUpperCase()}(1)                    User Commands                    ${cmd.toUpperCase()}(1)

NAME
       ${cmd} - ${commands[cmd].description}

SYNOPSIS
       ${commands[cmd].usage}

DESCRIPTION
       ${commands[cmd].description}

SEE ALSO
       Type 'help' for a list of all commands.
`,
          success: true
        };
      }
      return { output: `No manual entry for ${cmd}`, success: false };
    },
  },

  which: {
    description: 'Locate a command',
    usage: 'which command',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'which: missing argument', success: false };
      }
      const cmd = args[0];
      if (commands[cmd]) {
        return { output: `/usr/bin/${cmd}`, success: true };
      }
      return { output: `${cmd} not found`, success: false };
    },
  },

  type: {
    description: 'Describe a command',
    usage: 'type command',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'type: missing argument', success: false };
      }
      const cmd = args[0];
      if (commands[cmd]) {
        return { output: `${cmd} is /usr/bin/${cmd}`, success: true };
      }
      return { output: `bash: type: ${cmd}: not found`, success: false };
    },
  },

  alias: {
    description: 'Create command aliases',
    usage: 'alias [name=value]',
    execute: (args) => {
      if (args.length === 0) {
        return {
          output: `alias ls='ls --color=auto'
alias ll='ls -la'
alias grep='grep --color=auto'`,
          success: true
        };
      }
      return { output: '', success: true };
    },
  },

  history: {
    description: 'Display command history',
    usage: 'history',
    execute: () => {
      // History is managed by the Terminal component
      return { output: 'History is displayed in terminal. Use arrow keys to navigate.', success: true };
    },
  },

  touch: {
    description: 'Change file timestamps or create empty files',
    usage: 'touch file',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'touch: missing file operand', success: false };
      }
      return { output: '', success: true }; // Simulated
    },
  },

  mkdir: {
    description: 'Make directories',
    usage: 'mkdir directory',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'mkdir: missing operand', success: false };
      }
      return { output: '', success: true }; // Simulated
    },
  },

  rm: {
    description: 'Remove files or directories',
    usage: 'rm [-rf] file',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'rm: missing operand', success: false };
      }
      return { output: '', success: true }; // Simulated
    },
  },

  cp: {
    description: 'Copy files and directories',
    usage: 'cp source dest',
    execute: (args) => {
      if (args.length < 2) {
        return { output: 'cp: missing file operand', success: false };
      }
      return { output: '', success: true }; // Simulated
    },
  },

  mv: {
    description: 'Move or rename files',
    usage: 'mv source dest',
    execute: (args) => {
      if (args.length < 2) {
        return { output: 'mv: missing file operand', success: false };
      }
      return { output: '', success: true }; // Simulated
    },
  },

  chmod: {
    description: 'Change file permissions',
    usage: 'chmod mode file',
    execute: (args) => {
      if (args.length < 2) {
        return { output: 'chmod: missing operand', success: false };
      }
      return { output: '', success: true }; // Simulated
    },
  },

  chown: {
    description: 'Change file owner',
    usage: 'chown owner[:group] file',
    execute: (args) => {
      if (args.length < 2) {
        return { output: 'chown: missing operand', success: false };
      }
      return { output: '', success: true }; // Simulated
    },
  },

  ps: {
    description: 'Report process status',
    usage: 'ps [aux]',
    execute: (args, deviceId, store) => {
      const device = deviceId ? store.getDeviceById(deviceId) : null;
      const showAll = args.includes('aux') || args.includes('-aux') || args.includes('-ef');

      let output = 'USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n';
      output += 'root         1  0.0  0.1   4500  1200 ?        Ss   00:00   0:01 /sbin/init\n';
      output += 'root        50  0.0  0.2   8000  2400 ?        Ss   00:00   0:00 /usr/sbin/sshd\n';

      if (device?.type === 'router' || device?.type === 'firewall') {
        output += 'root       100  0.0  0.5  12000  5000 ?        S    00:00   0:02 /usr/sbin/zebra\n';
        output += 'root       101  0.0  0.3   8000  3000 ?        S    00:00   0:01 /usr/sbin/ospfd\n';
      }
      if (device?.type === 'switch') {
        output += 'root       100  0.0  0.3   8000  3000 ?        S    00:00   0:00 /usr/sbin/switchd\n';
      }

      output += 'user      1000  0.0  0.1   5000  1000 pts/0    Ss   00:00   0:00 -bash\n';
      output += 'user      1001  0.0  0.0   3000   800 pts/0    R+   00:00   0:00 ps aux\n';

      return { output, success: true };
    },
  },

  top: {
    description: 'Display system tasks (snapshot)',
    usage: 'top',
    execute: (args, deviceId, store) => {
      const device = deviceId ? store.getDeviceById(deviceId) : null;
      const hostname = device?.hostname || 'netsim';

      return {
        output: `top - ${new Date().toTimeString().split(' ')[0]} up 1:23,  1 user,  load average: 0.00, 0.01, 0.05
Tasks:   5 total,   1 running,   4 sleeping,   0 stopped,   0 zombie
%Cpu(s):  0.3 us,  0.2 sy,  0.0 ni, 99.5 id,  0.0 wa,  0.0 hi,  0.0 si,  0.0 st
MiB Mem :   1024.0 total,    512.0 free,    256.0 used,    256.0 buff/cache
MiB Swap:    512.0 total,    512.0 free,      0.0 used.    640.0 avail Mem

  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND
    1 root      20   0    4500   1200   1100 S   0.0   0.1   0:01.00 init
   50 root      20   0    8000   2400   2000 S   0.0   0.2   0:00.50 sshd
 1000 user      20   0    5000   1000    900 S   0.0   0.1   0:00.20 bash
 1001 user      20   0    3000    800    700 R   0.0   0.1   0:00.00 top

(Press q to exit - this is a snapshot view)`,
        success: true
      };
    },
  },

  kill: {
    description: 'Send signal to process',
    usage: 'kill [-9] pid',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ...', success: false };
      }
      return { output: '', success: true }; // Simulated
    },
  },

  reboot: {
    description: 'Reboot the system',
    usage: 'reboot',
    execute: (args, deviceId, store) => {
      if (!deviceId) {
        return { output: 'reboot: No device selected', success: false };
      }
      return { output: 'System is rebooting... (simulated)', success: true };
    },
  },

  shutdown: {
    description: 'Shutdown the system',
    usage: 'shutdown [-h now]',
    execute: () => {
      return { output: 'Shutdown scheduled... (simulated)', success: true };
    },
  },

  dmesg: {
    description: 'Print kernel ring buffer',
    usage: 'dmesg',
    execute: (args, deviceId, store) => {
      const device = deviceId ? store.getDeviceById(deviceId) : null;
      let output = '[    0.000000] Linux version 5.15.0-netsim\n';
      output += '[    0.000001] Command line: BOOT_IMAGE=/boot/vmlinuz root=/dev/sda1\n';
      output += '[    0.000010] BIOS-e820: [mem 0x0000000000000000-0x000000000009ffff] usable\n';
      output += '[    0.100000] CPU: Intel NetSim Virtual CPU\n';
      output += '[    0.200000] Memory: 1024MB available\n';

      if (device) {
        device.interfaces.forEach((iface, i) => {
          output += `[    ${1 + i * 0.1}] ${iface.name}: link up, ${iface.speed}Mbps ${iface.duplex}-duplex\n`;
        });
      }

      output += '[    5.000000] systemd[1]: Started Network Simulator Service.\n';

      return { output, success: true };
    },
  },

  service: {
    description: 'Run a System V init script',
    usage: 'service name [start|stop|restart|status]',
    execute: (args) => {
      if (args.length < 1) {
        return { output: 'Usage: service <name> [start|stop|restart|status]', success: false };
      }
      const name = args[0];
      const action = args[1] || 'status';

      if (action === 'status') {
        return { output: `● ${name}.service - ${name} daemon\n   Active: active (running)`, success: true };
      }
      return { output: `${action}ing ${name}... done`, success: true };
    },
  },

  systemctl: {
    description: 'Control the systemd system and service manager',
    usage: 'systemctl [start|stop|status] service',
    execute: (args) => {
      if (args.length < 2) {
        return { output: 'Usage: systemctl [start|stop|restart|status] <service>', success: false };
      }
      const action = args[0];
      const name = args[1];

      if (action === 'status') {
        return {
          output: `● ${name}.service - ${name} daemon
     Loaded: loaded (/lib/systemd/system/${name}.service; enabled)
     Active: active (running) since Mon 2024-01-01 00:00:00 UTC
   Main PID: 100 (${name})
      Tasks: 1 (limit: 4096)
     Memory: 2.0M
        CPU: 10ms
     CGroup: /system.slice/${name}.service
             └─100 /usr/sbin/${name}`,
          success: true
        };
      }
      return { output: '', success: true };
    },
  },

  free: {
    description: 'Display amount of free and used memory',
    usage: 'free [-h]',
    execute: (args) => {
      const human = args.includes('-h');
      if (human) {
        return {
          output: `              total        used        free      shared  buff/cache   available
Mem:          1.0Gi       256Mi       512Mi       1.0Mi       256Mi       640Mi
Swap:         512Mi          0B       512Mi`,
          success: true
        };
      }
      return {
        output: `              total        used        free      shared  buff/cache   available
Mem:        1048576      262144      524288        1024      262144      655360
Swap:        524288           0      524288`,
        success: true
      };
    },
  },

  df: {
    description: 'Report file system disk space usage',
    usage: 'df [-h]',
    execute: (args) => {
      const human = args.includes('-h');
      if (human) {
        return {
          output: `Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        20G  2.5G   17G  13% /
tmpfs           512M     0  512M   0% /dev/shm
/dev/sda2       100G   10G   90G  10% /data`,
          success: true
        };
      }
      return {
        output: `Filesystem     1K-blocks    Used Available Use% Mounted on
/dev/sda1       20971520 2621440  17825792  13% /
tmpfs            524288       0    524288   0% /dev/shm
/dev/sda2      104857600 10485760  94371840  10% /data`,
        success: true
      };
    },
  },

  du: {
    description: 'Estimate file space usage',
    usage: 'du [-sh] [path]',
    execute: (args) => {
      const human = args.includes('-h') || args.includes('-sh');
      if (human) {
        return { output: '4.0K\t.', success: true };
      }
      return { output: '4\t.', success: true };
    },
  },

  find: {
    description: 'Search for files',
    usage: 'find [path] [expression]',
    execute: (args) => {
      const path = args[0] || '.';
      return {
        output: `${path}/interfaces.conf\n${path}/routes.conf`,
        success: true
      };
    },
  },

  locate: {
    description: 'Find files by name',
    usage: 'locate pattern',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'locate: no pattern to search for specified', success: false };
      }
      return { output: `/etc/${args[0]}\n/usr/share/${args[0]}`, success: true };
    },
  },

  wget: {
    description: 'Network downloader',
    usage: 'wget url',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'wget: missing URL', success: false };
      }
      return {
        output: `--${new Date().toISOString()}--  ${args[0]}
Connecting to ${args[0]}... connected.
HTTP request sent, awaiting response... 200 OK
Length: 1024 (1.0K)
Saving to: 'index.html'

index.html          100%[===================>]   1.00K  --.-KB/s    in 0s

'index.html' saved [1024/1024]`,
        success: true
      };
    },
  },

  curl: {
    description: 'Transfer data from or to a server',
    usage: 'curl [-I] url',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'curl: no URL specified', success: false };
      }
      const headOnly = args.includes('-I');
      const url = args.filter(a => !a.startsWith('-'))[0];

      if (headOnly) {
        return {
          output: `HTTP/1.1 200 OK
Date: ${new Date().toUTCString()}
Server: NetSim/1.0
Content-Type: text/html
Content-Length: 1024`,
          success: true
        };
      }
      return {
        output: `<!DOCTYPE html><html><body><h1>NetSim Response</h1><p>Simulated response from ${url}</p></body></html>`,
        success: true
      };
    },
  },

  ssh: {
    description: 'OpenSSH remote login client',
    usage: 'ssh [user@]host',
    execute: (args) => {
      if (args.length === 0) {
        return { output: 'usage: ssh [-l login_name] hostname', success: false };
      }
      return { output: `ssh: connect to host ${args[0]} port 22: Connection simulated`, success: true };
    },
  },

  scp: {
    description: 'Secure copy',
    usage: 'scp source dest',
    execute: (args) => {
      if (args.length < 2) {
        return { output: 'usage: scp source dest', success: false };
      }
      return { output: `${args[0]}                     100% 1024     1.0KB/s   00:00`, success: true };
    },
  },
};

// Remove duplicate whoami - it was already defined in the original

// Helper to execute a single command
async function executeSingleCommand(
  input: string,
  deviceId: string | null,
  store: NetworkStoreState,
  pipeInput?: string
): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { output: pipeInput || '', success: true };
  }

  // Parse command and arguments, respecting quotes
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
    } else if (char === ' ' && !inQuote) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    parts.push(current);
  }

  const cmdName = parts[0]?.toLowerCase() || '';
  const args = parts.slice(1);

  // Handle aliases
  const aliases: Record<string, string> = {
    '?': 'help',
    'route': 'ip',
    'ipconfig': 'ifconfig',
    'cls': 'clear',
    'quit': 'exit',
    'logout': 'exit',
    'll': 'ls',
  };

  const resolvedCmd = aliases[cmdName] || cmdName;

  // Find and execute command
  const command = commands[resolvedCmd];
  if (!command) {
    return {
      output: `${cmdName}: command not found`,
      success: false,
    };
  }

  try {
    // Handle special case for 'route' alias
    if (cmdName === 'route') {
      return await commands.ip.execute(['route', ...args], deviceId, store);
    }

    // Handle pipe input for certain commands
    if (pipeInput && (cmdName === 'grep' || cmdName === 'head' || cmdName === 'tail' || cmdName === 'wc' || cmdName === 'sort' || cmdName === 'uniq')) {
      const lines = pipeInput.split('\n');

      if (cmdName === 'grep') {
        const pattern = args[0] || '';
        const caseInsensitive = args.includes('-i');
        const regex = new RegExp(pattern, caseInsensitive ? 'i' : '');
        const filtered = lines.filter(line => regex.test(line));
        return { output: filtered.join('\n'), success: true };
      }

      if (cmdName === 'head') {
        const nIndex = args.indexOf('-n');
        const count = nIndex !== -1 ? parseInt(args[nIndex + 1]) || 10 : 10;
        return { output: lines.slice(0, count).join('\n'), success: true };
      }

      if (cmdName === 'tail') {
        const nIndex = args.indexOf('-n');
        const count = nIndex !== -1 ? parseInt(args[nIndex + 1]) || 10 : 10;
        return { output: lines.slice(-count).join('\n'), success: true };
      }

      if (cmdName === 'wc') {
        const lineCount = lines.length;
        const wordCount = lines.reduce((acc, line) => acc + line.split(/\s+/).filter(w => w).length, 0);
        const charCount = pipeInput.length;
        if (args.includes('-l')) {
          return { output: `${lineCount}`, success: true };
        }
        if (args.includes('-w')) {
          return { output: `${wordCount}`, success: true };
        }
        if (args.includes('-c')) {
          return { output: `${charCount}`, success: true };
        }
        return { output: `${lineCount} ${wordCount} ${charCount}`, success: true };
      }

      if (cmdName === 'sort') {
        const sorted = [...lines].sort((a, b) => {
          if (args.includes('-n')) {
            return parseFloat(a) - parseFloat(b);
          }
          if (args.includes('-r')) {
            return b.localeCompare(a);
          }
          return a.localeCompare(b);
        });
        return { output: sorted.join('\n'), success: true };
      }

      if (cmdName === 'uniq') {
        const unique = lines.filter((line, index) => index === 0 || line !== lines[index - 1]);
        return { output: unique.join('\n'), success: true };
      }
    }

    const result = await command.execute(args, deviceId, store);
    return result;
  } catch (error) {
    return {
      output: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      success: false,
    };
  }
}

// Main command executor with pipe and chaining support
export async function executeNetworkCommand(
  input: string,
  deviceId: string | null,
  store: NetworkStoreState
): Promise<CommandResult> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { output: '', success: true };
  }

  // Handle command chaining with ; && ||
  // First, split by ; (sequential execution)
  const sequentialCommands = trimmed.split(/(?<!\\);/).map(s => s.trim()).filter(s => s);

  if (sequentialCommands.length > 1) {
    let finalOutput = '';
    let lastSuccess = true;

    for (const cmd of sequentialCommands) {
      const result = await executeNetworkCommand(cmd, deviceId, store);
      if (finalOutput && result.output) {
        finalOutput += '\n';
      }
      finalOutput += result.output;
      lastSuccess = result.success;
    }

    return { output: finalOutput, success: lastSuccess };
  }

  // Handle && (execute next only if previous succeeded)
  if (trimmed.includes(' && ')) {
    const andCommands = trimmed.split(' && ').map(s => s.trim());
    let finalOutput = '';

    for (const cmd of andCommands) {
      const result = await executeNetworkCommand(cmd, deviceId, store);
      if (finalOutput && result.output) {
        finalOutput += '\n';
      }
      finalOutput += result.output;
      if (!result.success) {
        return { output: finalOutput, success: false };
      }
    }

    return { output: finalOutput, success: true };
  }

  // Handle || (execute next only if previous failed)
  if (trimmed.includes(' || ')) {
    const orCommands = trimmed.split(' || ').map(s => s.trim());

    for (const cmd of orCommands) {
      const result = await executeNetworkCommand(cmd, deviceId, store);
      if (result.success) {
        return result;
      }
    }

    return { output: '', success: false };
  }

  // Handle pipes
  if (trimmed.includes(' | ')) {
    const pipeCommands = trimmed.split(' | ').map(s => s.trim());
    let pipeOutput = '';

    for (const cmd of pipeCommands) {
      const result = await executeSingleCommand(cmd, deviceId, store, pipeOutput);
      if (!result.success && !pipeOutput) {
        return result; // First command failed
      }
      pipeOutput = result.output;
    }

    return { output: pipeOutput, success: true };
  }

  // Handle command substitution $(...)  - basic support
  let processedInput = trimmed;
  const subMatch = trimmed.match(/\$\(([^)]+)\)/);
  if (subMatch) {
    const subResult = await executeNetworkCommand(subMatch[1], deviceId, store);
    processedInput = trimmed.replace(subMatch[0], subResult.output.trim());
  }

  // Single command execution
  return executeSingleCommand(processedInput, deviceId, store);
}
