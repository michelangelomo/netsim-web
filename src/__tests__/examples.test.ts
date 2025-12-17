import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const examplesDir = path.join(process.cwd(), 'examples');
const disallowedInterfaceKeys = ['switchportMode', 'trunkNativeVlan', 'trunkAllowedVlans'];

function readExample(file: string) {
    const raw = fs.readFileSync(path.join(examplesDir, file), 'utf-8');
    return JSON.parse(raw);
}

describe('example topologies align with store schema', () => {
    const files = fs.readdirSync(examplesDir).filter((f) => f.endsWith('.json'));

    files.forEach((file) => {
        it(`validates ${file}`, () => {
            const data = readExample(file);
            expect(Array.isArray(data.connections)).toBe(true);
            expect(Array.isArray(data.devices)).toBe(true);

            // Connections must include packetLoss and latency/bandwidth numbers
            data.connections.forEach((conn: any) => {
                expect(typeof conn.bandwidth).toBe('number');
                expect(typeof conn.latency).toBe('number');
                expect(typeof conn.packetLoss).toBe('number');
            });

            data.devices.forEach((device: any) => {
                (device.interfaces || []).forEach((iface: any) => {
                    // No deprecated keys from earlier schema versions
                    disallowedInterfaceKeys.forEach((key) => {
                        expect(iface[key]).toBeUndefined();
                    });

                    if (iface.vlanMode) {
                        expect(['access', 'trunk']).toContain(iface.vlanMode);
                    }
                });

                if (device.stpConfig) {
                    const cfg = device.stpConfig;
                    ['bridgePriority', 'bridgeId', 'rootBridgeId', 'rootPathCost', 'ports'].forEach((key) => {
                        expect(cfg[key]).not.toBeUndefined();
                    });
                    expect(Array.isArray(cfg.ports)).toBe(true);
                    cfg.ports.forEach((port: any) => {
                        ['interfaceId', 'interfaceName', 'state', 'role', 'pathCost', 'portPriority', 'portId'].forEach((key) => {
                            expect(port[key]).not.toBeUndefined();
                        });
                    });
                }
            });
        });
    });
});
