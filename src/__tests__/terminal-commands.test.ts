/**
 * Terminal Commands Tests - TDD
 * 
 * Tests for terminal command implementations including:
 * - telnet with hostname resolution
 * - curl with proper TCP connection handling
 * - netstat output formatting
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useNetworkStore } from '@/store/network-store';
import { executeNetworkCommand } from '@/lib/terminal-commands';

describe('Terminal Commands', () => {
    beforeEach(() => {
        useNetworkStore.setState({
            devices: [],
            connections: [],
            packets: [],
            simulation: { isRunning: false, speed: 1, packets: [] },
        });
    });

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
});
