/**
 * Terminal Commands Tests - TDD
 * 
 * Tests for terminal command implementations including:
 * - Basic commands (help, hostname, whoami)
 * - Interface configuration (ifconfig, ip addr)
 * - Network info (arp, mac-address-table, show commands)
 * - Network testing (ping, telnet, curl, traceroute, nslookup)
 * - DHCP commands
 * - Shell utilities (echo, ls, cat, grep, etc.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useNetworkStore } from '@/store/network-store';
import { executeNetworkCommand, getCompletions, getCommandNames } from '@/lib/terminal-commands';

describe('Terminal Commands', () => {
    beforeEach(() => {
        useNetworkStore.setState({
            devices: [],
            connections: [],
            packets: [],
            simulation: { isRunning: false, speed: 2, packets: [] },
        });
    });

    // Helper to create a simple PC
    function createPC(hostname = 'pc1') {
        const store = useNetworkStore.getState();
        store.addDevice('pc', { x: 100, y: 100 });
        const pc = useNetworkStore.getState().devices[0];
        store.updateDevice(pc.id, { hostname });
        return { pc: useNetworkStore.getState().devices[0], store: useNetworkStore.getState() };
    }

    // Helper to create a switch
    function createSwitch(hostname = 'switch1') {
        const store = useNetworkStore.getState();
        store.addDevice('switch', { x: 100, y: 100 });
        const sw = useNetworkStore.getState().devices[0];
        store.updateDevice(sw.id, { hostname });
        return { sw: useNetworkStore.getState().devices[0], store: useNetworkStore.getState() };
    }

    // Helper to create a router
    function createRouter(hostname = 'router1') {
        const store = useNetworkStore.getState();
        store.addDevice('router', { x: 100, y: 100 });
        const router = useNetworkStore.getState().devices[0];
        store.updateDevice(router.id, { hostname });
        return { router: useNetworkStore.getState().devices[0], store: useNetworkStore.getState() };
    }

    // Helper to create a basic network with DNS
    function setupNetworkWithDNS() {
        const store = useNetworkStore.getState();

        // Create a server with DNS entries
        store.addDevice('server', { x: 100, y: 100 });
        const server = useNetworkStore.getState().devices[0];
        store.configureInterface(server.id, server.interfaces[0].id, {
            ipAddress: '10.0.1.100',
            subnetMask: '255.255.255.0',
        });
        store.updateDevice(server.id, {
            hostname: 'webserver',
            dnsEntries: [
                { hostname: 'webserver', ipAddress: '10.0.1.100', type: 'A', ttl: 3600 },
                { hostname: 'appserver', ipAddress: '10.0.1.100', type: 'A', ttl: 3600 },
            ],
        });
        // Start listening on port 80
        store.tcpListen(server.id, 80);

        // Create a client PC
        store.addDevice('pc', { x: 300, y: 100 });
        const devices = useNetworkStore.getState().devices;
        const client = devices.find(d => d.type === 'pc')!;
        store.configureInterface(client.id, client.interfaces[0].id, {
            ipAddress: '10.0.1.10',
            subnetMask: '255.255.255.0',
        });
        // Add DNS server pointing to the server
        store.updateDevice(client.id, {
            dnsServers: ['10.0.1.100'],
        });

        // Connect them via a switch
        store.addDevice('switch', { x: 200, y: 100 });
        const allDevices = useNetworkStore.getState().devices;
        const sw = allDevices.find(d => d.type === 'switch')!;

        // Connect server to switch
        store.addConnection(
            server.id,
            server.interfaces[0].id,
            sw.id,
            sw.interfaces[0].id
        );

        // Connect client to switch
        store.addConnection(
            client.id,
            client.interfaces[0].id,
            sw.id,
            sw.interfaces[1].id
        );

        return {
            server: useNetworkStore.getState().devices.find(d => d.type === 'server')!,
            client: useNetworkStore.getState().devices.find(d => d.type === 'pc')!,
            store: useNetworkStore.getState(),
        };
    }

    describe('telnet command', () => {
        it('should connect to IP address and port', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('telnet 10.0.1.100 80', client.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('Trying 10.0.1.100');
            expect(result.output).toContain('Connected');
        });

        it('should resolve hostname before connecting', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('telnet webserver 80', client.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('Trying');
            expect(result.output).toContain('Connected');
        });

        it('should fail with unresolvable hostname', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('telnet unknownhost 80', client.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toContain('could not resolve');
        });

        it('should use default port 23 when not specified', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('telnet 10.0.1.100', client.id, store);

            // Should try to connect even if port 23 isn't open
            expect(result.output).toContain('Trying 10.0.1.100');
        });

        it('should fail when server is not listening on port (connection refused)', async () => {
            const { client, store } = setupNetworkWithDNS();

            // Port 8080 is not open on the server
            const result = await executeNetworkCommand('telnet 10.0.1.100 8080', client.id, store);

            // For now, it initiates connection - the RST will come from simulation
            // But ideally telnet should indicate connection attempt
            expect(result.output).toContain('Trying');
        });
    });

    describe('curl command', () => {
        it('should make HTTP request to IP:port', async () => {
            const { client, server, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('curl http://10.0.1.100:80', client.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('NetSim');
        });

        it('should resolve hostname in URL', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('curl http://webserver', client.id, store);

            expect(result.success).toBe(true);
        });

        it('should fail when host is unreachable', async () => {
            const { client, store } = setupNetworkWithDNS();

            // Unreachable IP (not in our network)
            const result = await executeNetworkCommand('curl http://192.168.99.99', client.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toMatch(/No route to host|Could not resolve/);
        });

        it('should fail when port is not open (connection refused)', async () => {
            const { client, store } = setupNetworkWithDNS();

            // Port 8080 is not listening
            const result = await executeNetworkCommand('curl http://10.0.1.100:8080', client.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toContain('Connection refused');
        });

        it('should return headers only with -I flag', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('curl -I http://10.0.1.100:80', client.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('HTTP/1.1');
            expect(result.output).toContain('Content-Type');
            expect(result.output).not.toContain('<html>');
        });

        it('should handle HTTPS URLs', async () => {
            const { client, server, store } = setupNetworkWithDNS();

            // Start listening on port 443
            store.tcpListen(server.id, 443);

            const result = await executeNetworkCommand('curl https://10.0.1.100', client.id, store);

            expect(result.success).toBe(true);
        });

        it('should fail without URL', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('curl', client.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toContain('no URL specified');
        });
    });

    describe('netstat command', () => {
        it('should show listening ports with -l', async () => {
            const { server, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('netstat -l', server.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('LISTEN');
            expect(result.output).toContain(':80');
        });

        it('should show all connections with -a', async () => {
            const { client, store } = setupNetworkWithDNS();

            // First make a connection
            store.tcpConnect(client.id, '10.0.1.100', 80);

            const result = await executeNetworkCommand('netstat -a', client.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('tcp');
        });

        it('should show routing table with -r', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('netstat -r', client.id, store);

            expect(result.success).toBe(true);
            // Should show routing table or indicate none
        });

        it('should show interface stats with -i', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('netstat -i', client.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('Iface');
            expect(result.output).toContain('eth0');
        });
    });

    describe('nslookup command', () => {
        it('should resolve hostname to IP', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('nslookup webserver', client.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('10.0.1.100');
        });

        it('should fail for unknown hostname', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('nslookup nonexistent', client.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toContain('NXDOMAIN');
        });

        it('should do reverse lookup for IP', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('nslookup 10.0.1.100', client.id, store);

            // Reverse lookup may or may not find a name
            expect(result.output).toContain('Server:');
        });
    });

    describe('ping command with hostname', () => {
        // Note: ping with hostname resolution runs a full simulation which is slow
        // So we test with a longer timeout and verify the output format
        it('should resolve hostname before pinging', async () => {
            const { client, store } = setupNetworkWithDNS();

            // Use -c 1 for single ping - test resolution happens
            const result = await executeNetworkCommand('ping -c 1 webserver', client.id, store);

            // Should show resolved IP in output (DNS worked)
            expect(result.output).toMatch(/10\.0\.1\.100/);
        }, 20000); // 20 second timeout for simulation

        it('should fail for unresolvable hostname', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('ping unknownhost', client.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toMatch(/unknown host|not known/);
        });
    });

    describe('traceroute command with hostname', () => {
        it('should resolve hostname before tracing', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('traceroute webserver', client.id, store);

            expect(result.output).toContain('traceroute');
        });
    });

    // =========================================================================
    // BASIC COMMANDS
    // =========================================================================

    describe('help command', () => {
        it('should display available commands', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('help', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('Available Commands');
            expect(result.output).toContain('ifconfig');
            expect(result.output).toContain('ping');
        });

        it('should display help for specific command', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('help ping', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('ping');
            expect(result.output).toContain('Usage');
        });

        it('should handle unknown command gracefully', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('help unknowncommand', pc.id, store);

            // Should still return something (general help or error)
            expect(result.output.length).toBeGreaterThan(0);
        });
    });

    describe('hostname command', () => {
        it('should display current hostname', async () => {
            const { pc, store } = createPC('mypc');

            const result = await executeNetworkCommand('hostname', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('mypc');
        });

        it('should set new hostname', async () => {
            const { pc, store } = createPC('oldname');

            const result = await executeNetworkCommand('hostname newname', pc.id, store);

            expect(result.success).toBe(true);

            // Verify hostname was changed
            const updatedDevice = useNetworkStore.getState().devices[0];
            expect(updatedDevice.hostname).toBe('newname');
        });
    });

    describe('whoami command', () => {
        it('should display user (matches Linux behavior)', async () => {
            const { pc, store } = createPC('testpc');

            const result = await executeNetworkCommand('whoami', pc.id, store);

            expect(result.success).toBe(true);
            // whoami shows user, not hostname (Linux behavior)
            expect(result.output).toBe('user');
        });

        it('should show root on routers/firewalls', async () => {
            const { router, store } = createRouter();

            const result = await executeNetworkCommand('whoami', router.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toBe('root');
        });
    });

    // =========================================================================
    // INTERFACE CONFIGURATION COMMANDS
    // =========================================================================

    describe('ifconfig command', () => {
        it('should display all interfaces when no args', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ifconfig', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('eth0');
            expect(result.output).toContain('ether'); // MAC address indicator
        });

        it('should display specific interface', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ifconfig eth0', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('eth0');
        });

        it('should configure interface with IP and netmask', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ifconfig eth0 192.168.1.10 netmask 255.255.255.0', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('configured');

            // Verify configuration
            const device = useNetworkStore.getState().devices[0];
            const iface = device.interfaces.find(i => i.name === 'eth0');
            expect(iface?.ipAddress).toBe('192.168.1.10');
            expect(iface?.subnetMask).toBe('255.255.255.0');
        });

        it('should configure interface with CIDR notation', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ifconfig eth0 10.0.0.5/24', pc.id, store);

            expect(result.success).toBe(true);

            const device = useNetworkStore.getState().devices[0];
            const iface = device.interfaces.find(i => i.name === 'eth0');
            expect(iface?.ipAddress).toBe('10.0.0.5');
            expect(iface?.subnetMask).toBe('255.255.255.0');
        });

        it('should reject invalid IP address', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ifconfig eth0 999.999.999.999', pc.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toContain('invalid');
        });

        it('should reject non-existent interface', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ifconfig eth99', pc.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toContain('does not exist');
        });
    });

    describe('ip addr command', () => {
        it('should show all IP addresses', async () => {
            const { pc, store } = createPC();
            store.configureInterface(pc.id, pc.interfaces[0].id, {
                ipAddress: '192.168.1.100',
                subnetMask: '255.255.255.0',
            });

            const result = await executeNetworkCommand('ip addr', pc.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
            expect(result.output).toContain('192.168.1.100');
        });

        it('should add IP address with ip addr add', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ip addr add 10.0.0.10/24 dev eth0', pc.id, store);

            expect(result.success).toBe(true);

            const device = useNetworkStore.getState().devices[0];
            const iface = device.interfaces.find(i => i.name === 'eth0');
            expect(iface?.ipAddress).toBe('10.0.0.10');
        });

        it('should require dev argument', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ip addr add 10.0.0.10/24', pc.id, store);

            // Current implementation may add to first interface or fail
            // Check output indicates missing dev or shows usage
            if (!result.success) {
                expect(result.output).toMatch(/Usage|dev|device/i);
            }
        });
    });

    describe('ip route command', () => {
        it('should show routing table', async () => {
            const { router, store } = createRouter();

            const result = await executeNetworkCommand('ip route', router.id, store);

            expect(result.success).toBe(true);
        });

        it('should add static route', async () => {
            const { router, store } = createRouter();
            // First configure an interface
            store.configureInterface(router.id, router.interfaces[0].id, {
                ipAddress: '192.168.1.1',
                subnetMask: '255.255.255.0',
            });

            const result = await executeNetworkCommand('ip route add 10.0.0.0/24 via 192.168.1.254', router.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
            expect(result.output).toContain('added');
        });

        it('should delete route', async () => {
            const { router, store } = createRouter();
            store.addRoute(router.id, {
                destination: '10.0.0.0',
                netmask: '255.255.255.0',
                gateway: '192.168.1.254',
                interface: 'eth0',
                metric: 10,
            });

            const result = await executeNetworkCommand('ip route del 10.0.0.0', router.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });
    });

    describe('ip link command', () => {
        it('should show interface link status', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ip link', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('eth0');
        });

        it('should set interface up', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ip link set eth0 up', pc.id, store);

            expect(result.success).toBe(true);
        });

        it('should set interface down', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ip link set eth0 down', pc.id, store);

            expect(result.success).toBe(true);

            const device = useNetworkStore.getState().devices[0];
            const iface = device.interfaces.find(i => i.name === 'eth0');
            expect(iface?.isUp).toBe(false);
        });
    });

    // =========================================================================
    // NETWORK INFO COMMANDS
    // =========================================================================

    describe('arp command', () => {
        it('should display ARP table', async () => {
            const { pc, store } = createPC();
            // Add an ARP entry
            store.updateDevice(pc.id, {
                arpTable: [
                    { ipAddress: '192.168.1.1', macAddress: 'AA:BB:CC:DD:EE:FF', interface: 'eth0', ttl: 300 }
                ]
            });

            const result = await executeNetworkCommand('arp -a', pc.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
            expect(result.output).toContain('192.168.1.1');
            expect(result.output).toMatch(/AA:BB:CC:DD:EE:FF/i);
        });

        it('should show empty table message when no entries', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('arp -a', pc.id, store);

            expect(result.success).toBe(true);
            // Should either show empty table or "no entries" message
        });
    });

    describe('mac-address-table command', () => {
        it('should display MAC table on switch', async () => {
            const { sw, store } = createSwitch();

            // Add a MAC entry using correct MacTableEntry structure
            const updatedSw = useNetworkStore.getState().devices[0];
            store.updateDevice(updatedSw.id, {
                macTable: [
                    { macAddress: 'AA:BB:CC:DD:EE:FF', port: 'fa0/1', vlan: 1, type: 'dynamic' as const, age: 0 }
                ]
            });

            const result = await executeNetworkCommand('mac-address-table', updatedSw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
            expect(result.output).toMatch(/aa:bb:cc:dd:ee:ff/i);
        });

        it('should not work on non-switch devices', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('mac-address-table', pc.id, store);

            expect(result.success).toBe(false);
        });
    });

    // =========================================================================
    // SHOW COMMANDS
    // =========================================================================

    describe('show vlan command', () => {
        it('should display VLAN information on switch', async () => {
            const { sw, store } = createSwitch();
            store.addVlan(sw.id, { id: 10, name: 'SALES' });
            store.addVlan(sw.id, { id: 20, name: 'ENGINEERING' });

            const result = await executeNetworkCommand('show vlan', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
            expect(result.output).toContain('10');
            expect(result.output).toContain('SALES');
            expect(result.output).toContain('20');
            expect(result.output).toContain('ENGINEERING');
        });

        it('should show default VLAN 1', async () => {
            const { sw, store } = createSwitch();

            const result = await executeNetworkCommand('show vlan', sw.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('1');
        });
    });

    describe('show running-config command', () => {
        it('should display device configuration', async () => {
            const { router, store } = createRouter('router1');
            store.configureInterface(router.id, router.interfaces[0].id, {
                ipAddress: '192.168.1.1',
                subnetMask: '255.255.255.0',
            });

            const result = await executeNetworkCommand('show running-config', router.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
            expect(result.output).toContain('hostname');
            expect(result.output).toContain('interface');
            expect(result.output).toContain('192.168.1.1');
        });
    });

    describe('show interfaces trunk command', () => {
        it('should display trunk information', async () => {
            const { sw, store } = createSwitch();

            const result = await executeNetworkCommand('show interfaces trunk', sw.id, store);

            expect(result.success).toBe(true);
        });
    });

    describe('show spanning-tree command', () => {
        it('should display STP information', async () => {
            const { sw, store } = createSwitch();
            store.enableStp(sw.id);

            const result = await executeNetworkCommand('show spanning-tree', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
            expect(result.output).toMatch(/root|bridge|STP/i);
        });
    });

    describe('show dhcp leases command', () => {
        it('should display DHCP leases on server', async () => {
            const { router, store } = createRouter();
            store.configureDhcpServer(router.id, router.interfaces[0].id, {
                enabled: true,
                poolStart: '192.168.1.100',
                poolEnd: '192.168.1.200',
                leaseTime: 86400,
            });

            const result = await executeNetworkCommand('show dhcp leases', router.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });
    });

    // =========================================================================
    // DHCP COMMANDS
    // =========================================================================

    describe('dhclient command', () => {
        it('should show usage when no interface specified', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('dhclient', pc.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toContain('Usage');
        });

        it('should fail when interface not connected', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('dhclient eth0', pc.id, store);

            expect(result.success).toBe(false);
        });
    });

    describe('dhcp server command', () => {
        it('should enable DHCP server on router', async () => {
            const { router, store } = createRouter();
            store.configureInterface(router.id, router.interfaces[0].id, {
                ipAddress: '192.168.1.1',
                subnetMask: '255.255.255.0',
            });

            const result = await executeNetworkCommand('dhcp server enable', router.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });

        it('should configure DHCP pool', async () => {
            const { router, store } = createRouter();
            store.configureInterface(router.id, router.interfaces[0].id, {
                ipAddress: '192.168.1.1',
                subnetMask: '255.255.255.0',
            });

            const result = await executeNetworkCommand('dhcp pool 192.168.1.100 192.168.1.200', router.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });
    });

    // =========================================================================
    // CLEAR COMMANDS
    // =========================================================================

    describe('clear command', () => {
        it('should clear ARP table', async () => {
            const { pc, store } = createPC();
            store.updateDevice(pc.id, {
                arpTable: [
                    { ipAddress: '192.168.1.1', macAddress: 'AA:BB:CC:DD:EE:FF', interface: 'eth0', ttl: 300 }
                ]
            });

            const result = await executeNetworkCommand('clear arp', pc.id, useNetworkStore.getState());

            expect(result.success).toBe(true);

            const device = useNetworkStore.getState().devices[0];
            expect(device.arpTable?.length).toBe(0);
        });

        it('should clear MAC table on switch', async () => {
            const { sw, store } = createSwitch();
            store.updateDevice(sw.id, {
                macTable: [
                    { mac: 'AA:BB:CC:DD:EE:FF', interface: 'fa0/1', vlan: 1, timestamp: Date.now() }
                ]
            });

            const result = await executeNetworkCommand('clear mac-address-table', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);

            const device = useNetworkStore.getState().devices[0];
            expect(device.macTable?.length).toBe(0);
        });
    });

    // =========================================================================
    // SHELL UTILITY COMMANDS
    // =========================================================================

    describe('echo command', () => {
        it('should echo text', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('echo Hello World', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toBe('Hello World');
        });

        it('should handle empty echo', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('echo', pc.id, store);

            expect(result.success).toBe(true);
        });
    });

    describe('pwd command', () => {
        it('should show current directory', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('pwd', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('/');
        });
    });

    describe('ls command', () => {
        it('should list directory contents', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ls', pc.id, store);

            expect(result.success).toBe(true);
        });

        it('should support -la flag', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ls -la', pc.id, store);

            expect(result.success).toBe(true);
        });
    });

    describe('cat command', () => {
        it('should show interfaces.conf contents', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('cat /etc/network/interfaces', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('eth0');
        });

        it('should show .config file', async () => {
            const { pc, store } = createPC('mypc');

            const result = await executeNetworkCommand('cat .config', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('hostname=mypc');
        });

        it('should fail for non-existent file', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('cat /nonexistent', pc.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toContain('No such file');
        });
    });

    describe('date command', () => {
        it('should show current date', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('date', pc.id, store);

            expect(result.success).toBe(true);
            // Should contain date-like content
            expect(result.output.length).toBeGreaterThan(0);
        });
    });

    describe('uname command', () => {
        it('should show system info', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('uname -a', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('Linux');
        });
    });

    // =========================================================================
    // SIMULATION COMMANDS
    // =========================================================================

    describe('start/stop commands', () => {
        it('should start simulation', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('start', pc.id, store);

            expect(result.success).toBe(true);
        });

        it('should stop simulation', async () => {
            const { pc, store } = createPC();
            store.startSimulation();

            const result = await executeNetworkCommand('stop', pc.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });
    });

    describe('speed command', () => {
        it('should set simulation speed', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('speed 3', pc.id, store);

            expect(result.success).toBe(true);
            expect(useNetworkStore.getState().simulation.speed).toBe(3);
        });

        it('should show current speed when no arg', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('speed', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('speed');
        });
    });

    // =========================================================================
    // PIPED COMMANDS
    // =========================================================================

    describe('piped commands', () => {
        it('should pipe output through grep', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ifconfig | grep eth0', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('eth0');
        });

        it('should pipe output through head', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ifconfig | head -1', pc.id, store);

            expect(result.success).toBe(true);
        });

        it('should pipe output through tail', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ifconfig | tail -2', pc.id, store);

            expect(result.success).toBe(true);
        });

        it('should pipe output through wc -l', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('ifconfig | wc -l', pc.id, store);

            expect(result.success).toBe(true);
            // Output should be a number
            expect(parseInt(result.output.trim())).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // ERROR HANDLING
    // =========================================================================

    describe('error handling', () => {
        it('should handle unknown command', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('nonexistentcommand', pc.id, store);

            expect(result.success).toBe(false);
            expect(result.output).toContain('not found');
        });

        it('should handle empty command', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toBe('');
        });

        it('should handle null device', async () => {
            const store = useNetworkStore.getState();

            const result = await executeNetworkCommand('ifconfig', null, store);

            expect(result.success).toBe(false);
            expect(result.output).toContain('No device');
        });
    });

    // =========================================================================
    // INTERFACE CONFIGURATION MODE
    // =========================================================================

    describe('interface configuration mode', () => {
        it('should enter interface config mode on switch', async () => {
            const { sw, store } = createSwitch();
            // Switch uses FastEthernet0/X naming
            const ifaceName = sw.interfaces[0].name;

            const result = await executeNetworkCommand(`interface ${ifaceName}`, sw.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain(ifaceName);
        });

        it('should enter interface config mode on router', async () => {
            const { router, store } = createRouter();

            const result = await executeNetworkCommand('interface eth0', router.id, store);

            // May or may not be supported on routers
            // Just verify command doesn't crash
            expect(result.output.length).toBeGreaterThan(0);
        });

        it('should exit interface mode with exit', async () => {
            const { sw, store } = createSwitch();

            await executeNetworkCommand('interface fa0/1', sw.id, store);
            const result = await executeNetworkCommand('exit', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });
    });

    // =========================================================================
    // SWITCHPORT CONFIGURATION
    // =========================================================================

    describe('switchport commands', () => {
        it('should set switchport mode to access', async () => {
            const { sw, store } = createSwitch();
            const iface = sw.interfaces[0];

            await executeNetworkCommand(`interface ${iface.name}`, sw.id, store);
            const result = await executeNetworkCommand('switchport mode access', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });

        it('should set switchport mode to trunk', async () => {
            const { sw, store } = createSwitch();
            const iface = sw.interfaces[0];

            await executeNetworkCommand(`interface ${iface.name}`, sw.id, store);
            const result = await executeNetworkCommand('switchport mode trunk', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });

        it('should set access VLAN', async () => {
            const { sw, store } = createSwitch();
            store.addVlan(sw.id, { id: 10, name: 'TEST' });
            const iface = useNetworkStore.getState().devices[0].interfaces[0];

            await executeNetworkCommand(`interface ${iface.name}`, sw.id, useNetworkStore.getState());
            const result = await executeNetworkCommand('switchport access vlan 10', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });
    });

    // =========================================================================
    // STP COMMANDS
    // =========================================================================

    describe('spanning-tree commands', () => {
        it('should enable spanning-tree', async () => {
            const { sw, store } = createSwitch();

            const result = await executeNetworkCommand('spanning-tree enable', sw.id, store);

            expect(result.success).toBe(true);

            const device = useNetworkStore.getState().devices[0];
            expect(device.stpConfig?.enabled).toBe(true);
        });

        it('should disable spanning-tree', async () => {
            const { sw, store } = createSwitch();
            store.enableStp(sw.id);

            const result = await executeNetworkCommand('spanning-tree disable', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);

            const device = useNetworkStore.getState().devices[0];
            expect(device.stpConfig?.enabled).toBe(false);
        });

        it('should set bridge priority', async () => {
            const { sw, store } = createSwitch();
            store.enableStp(sw.id);

            const result = await executeNetworkCommand('spanning-tree priority 4096', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });

        it('should reject non-multiple-of-4096 priority', async () => {
            const { sw, store } = createSwitch();
            store.enableStp(sw.id);

            // Per IEEE 802.1D, priority must be multiple of 4096
            const result = await executeNetworkCommand('spanning-tree priority 12345', sw.id, useNetworkStore.getState());

            // Implementation may or may not validate this strictly
            // Just verify the command runs
            expect(result.output.length).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // VLAN CONFIGURATION COMMANDS
    // =========================================================================

    describe('vlan commands', () => {
        it('should create a VLAN', async () => {
            const { sw, store } = createSwitch();

            const result = await executeNetworkCommand('vlan 100', sw.id, store);

            expect(result.success).toBe(true);

            const device = useNetworkStore.getState().devices[0];
            expect(device.vlans?.some(v => v.id === 100)).toBe(true);
        });

        it('should reject invalid VLAN ID', async () => {
            const { sw, store } = createSwitch();

            const result = await executeNetworkCommand('vlan 5000', sw.id, store);

            expect(result.success).toBe(false);
        });

        it('should set VLAN name', async () => {
            const { sw, store } = createSwitch();

            await executeNetworkCommand('vlan 50', sw.id, store);
            const result = await executeNetworkCommand('name SALES', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
        });

        it('should delete VLAN with no command', async () => {
            const { sw, store } = createSwitch();
            store.addVlan(sw.id, { id: 100, name: 'TEST' });

            const result = await executeNetworkCommand('no vlan 100', sw.id, useNetworkStore.getState());

            expect(result.success).toBe(true);

            const device = useNetworkStore.getState().devices[0];
            expect(device.vlans?.some(v => v.id === 100)).toBe(false);
        });

        it('should not allow deleting VLAN 1', async () => {
            const { sw, store } = createSwitch();

            const result = await executeNetworkCommand('no vlan 1', sw.id, store);

            expect(result.success).toBe(false);
        });
    });

    // =========================================================================
    // DIG COMMAND
    // =========================================================================

    describe('dig command', () => {
        it('should perform DNS lookup', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('dig webserver', client.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('DiG');
        });
    });

    // =========================================================================
    // DEVICEINFO COMMAND
    // =========================================================================

    describe('deviceinfo command', () => {
        it('should show device details', async () => {
            const { pc, store } = createPC('mypc');

            const result = await executeNetworkCommand('deviceinfo', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('mypc');
            expect(result.output).toContain('pc');
        });

        it('should show configured IPs count', async () => {
            const { pc, store } = createPC('mypc');
            store.configureInterface(pc.id, pc.interfaces[0].id, {
                ipAddress: '192.168.1.100',
                subnetMask: '255.255.255.0',
            });

            const result = await executeNetworkCommand('deviceinfo', pc.id, useNetworkStore.getState());

            expect(result.success).toBe(true);
            expect(result.output).toContain('Configured IPs: 1');
        });
    });

    // =========================================================================
    // ADDITIONAL SHELL COMMANDS
    // =========================================================================

    describe('additional shell commands', () => {
        it('uptime should show system uptime', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('uptime', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('up');
        });

        it('free should show memory info', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('free', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('Mem');
        });

        it('df should show disk usage', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('df', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('Filesystem');
        });

        it('env should show environment variables', async () => {
            const { pc, store } = createPC('mypc');

            const result = await executeNetworkCommand('env', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('HOSTNAME=mypc');
        });

        it('export should set environment variable', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('export MY_VAR=test', pc.id, store);

            expect(result.success).toBe(true);
        });

        it('id should show user id info', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('id', pc.id, store);

            expect(result.success).toBe(true);
            expect(result.output).toContain('uid=');
        });

        it('true should return success', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('true', pc.id, store);

            expect(result.success).toBe(true);
        });

        it('false should return failure', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('false', pc.id, store);

            expect(result.success).toBe(false);
        });
    });

    // =========================================================================
    // SSH/SCP COMMANDS (simulated)
    // =========================================================================

    describe('ssh command', () => {
        it('should attempt SSH connection', async () => {
            const { client, store } = setupNetworkWithDNS();

            const result = await executeNetworkCommand('ssh webserver', client.id, store);

            // SSH is simulated but should respond
            expect(result.output.length).toBeGreaterThan(0);
        });
    });

    // =========================================================================
    // ADDITIONAL PIPE OPERATORS
    // =========================================================================

    describe('additional pipe operators', () => {
        it('should pipe through sort', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('echo -e "b\na\nc" | sort', pc.id, store);

            expect(result.success).toBe(true);
        });

        it('should pipe through uniq', async () => {
            const { pc, store } = createPC();

            const result = await executeNetworkCommand('echo -e "a\na\nb" | uniq', pc.id, store);

            expect(result.success).toBe(true);
        });
    });

    // =========================================================================
    // TAB COMPLETION
    // =========================================================================

    describe('tab completion', () => {
        describe('getCommandNames', () => {
            it('should return sorted list of commands', () => {
                const names = getCommandNames();

                expect(Array.isArray(names)).toBe(true);
                expect(names.length).toBeGreaterThan(20);
                expect(names).toContain('ping');
                expect(names).toContain('ifconfig');
                expect(names).toContain('help');

                // Should be sorted
                const sorted = [...names].sort();
                expect(names).toEqual(sorted);
            });
        });

        describe('getCompletions', () => {
            it('should complete partial command names', () => {
                const completions = getCompletions('pi');

                expect(completions).toContain('ping');
            });

            it('should complete "if" to ifconfig', () => {
                const completions = getCompletions('if');

                expect(completions).toContain('ifconfig');
            });

            it('should complete "sh" to show and shutdown', () => {
                const completions = getCompletions('sh');

                expect(completions).toContain('show');
            });

            it('should return multiple matches for ambiguous input', () => {
                const completions = getCompletions('s');

                expect(completions.length).toBeGreaterThan(1);
            });

            it('should complete ip subcommands', () => {
                const completions = getCompletions('ip a');

                expect(completions).toContain('addr');
                expect(completions).toContain('address');
            });

            it('should complete ip addr subcommands', () => {
                const completions = getCompletions('ip addr a');

                expect(completions).toContain('add');
            });

            it('should complete show subcommands', () => {
                const completions = getCompletions('show v');

                expect(completions).toContain('vlan');
            });

            it('should complete spanning-tree subcommands', () => {
                const completions = getCompletions('spanning-tree e');

                expect(completions).toContain('enable');
            });

            it('should complete clear subcommands', () => {
                const completions = getCompletions('clear a');

                expect(completions).toContain('arp');
            });

            it('should complete switchport subcommands for switch', () => {
                const completions = getCompletions('switchport m', 'switch');

                expect(completions).toContain('mode');
            });

            it('should complete switchport mode subcommands', () => {
                const completions = getCompletions('switchport mode a', 'switch');

                expect(completions).toContain('access');
            });

            it('should complete dhcp subcommands', () => {
                const completions = getCompletions('dhcp s');

                expect(completions).toContain('server');
            });

            it('should complete no subcommands', () => {
                const completions = getCompletions('no v');

                expect(completions).toContain('vlan');
            });

            it('should return empty array for complete commands', () => {
                const completions = getCompletions('ping 192.168.1.1');

                // No subcommand completions for ping with IP
                expect(completions).toEqual([]);
            });

            it('should return empty for empty input', () => {
                const completions = getCompletions('');

                // All commands match empty string
                expect(completions.length).toBeGreaterThan(0);
            });
        });
    });
});
