'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useViewport } from '@xyflow/react';
import { useNetworkStore } from '@/store/network-store';

interface AnimatedPacket {
  id: string;
  progress: number; // 0 to 1 along the path
  pathIndex: number; // Current segment in the path
  path: string[]; // Device IDs in order
  type: string;
  color: string;
  startTime: number;
}

const packetColors: Record<string, string> = {
  icmp: '#3b82f6', // blue
  tcp: '#10b981', // emerald
  udp: '#f59e0b', // amber
  arp: '#8b5cf6', // violet
  dhcp: '#06b6d4', // cyan
  dns: '#ec4899', // pink
  http: '#ef4444', // red
  https: '#22c55e', // green
  stp: '#64748b', // slate
  cdp: '#f97316', // orange
};

// Calculate path between two connected devices using BFS
function calculatePath(
  sourceId: string,
  targetId: string,
  connections: { sourceDeviceId: string; targetDeviceId: string; isUp: boolean }[]
): string[] {
  if (sourceId === targetId) return [sourceId];

  const visited = new Set<string>();
  const queue: { id: string; path: string[] }[] = [{ id: sourceId, path: [sourceId] }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);

    const connectedIds = connections
      .filter((c) => (c.sourceDeviceId === current.id || c.targetDeviceId === current.id) && c.isUp)
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

export function PacketAnimation() {
  const { packets, devices, simulation, tick } = useNetworkStore();
  const viewport = useViewport();
  const animationRef = useRef<number | null>(null);

  // Simulation Loop
  useEffect(() => {
    if (!simulation.isRunning) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const loop = () => {
      tick();
      animationRef.current = requestAnimationFrame(loop);
    };

    animationRef.current = requestAnimationFrame(loop);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [simulation.isRunning, tick]);

  if (!simulation.isRunning && packets.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'visible',
      }}
    >
      <g
        transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}
      >
        <AnimatePresence>
          {packets.map((packet) => {
            // Only animate packets on link or at device
            if (packet.processingStage === 'dropped' || packet.processingStage === 'buffered') return null;

            let x = 0;
            let y = 0;

            if (packet.processingStage === 'at-device') {
              const device = devices.find((d) => d.id === packet.currentDeviceId);
              if (!device) return null;
              x = device.position.x + 70; // Center of node
              y = device.position.y + 50;
            } else if (packet.processingStage === 'on-link' && packet.targetDeviceId) {
              const fromDevice = devices.find((d) => d.id === packet.currentDeviceId);
              const toDevice = devices.find((d) => d.id === packet.targetDeviceId);

              if (!fromDevice || !toDevice) return null;

              const fromX = fromDevice.position.x + 70;
              const fromY = fromDevice.position.y + 50;
              const toX = toDevice.position.x + 70;
              const toY = toDevice.position.y + 50;

              // Interpolate
              const progress = packet.progress / 100;
              x = fromX + (toX - fromX) * progress;
              y = fromY + (toY - fromY) * progress;
            } else {
              return null;
            }

            const color = packetColors[packet.type] || '#3b82f6';

            return (
              <g key={packet.id}>
                {/* Glow effect */}
                <circle
                  cx={x}
                  cy={y}
                  r={12}
                  fill={color}
                  opacity={0.3}
                  filter="blur(4px)"
                />
                {/* Main packet dot */}
                <motion.circle
                  cx={x}
                  cy={y}
                  r={6}
                  fill={color}
                  layoutId={packet.id} // smooth transitions
                  style={{
                    filter: `drop-shadow(0 0 6px ${color})`,
                  }}
                />
                {/* Type label */}
                <text
                  x={x}
                  y={y - 15}
                  textAnchor="middle"
                  fill={color}
                  fontSize={10}
                  fontFamily="monospace"
                  fontWeight="bold"
                  style={{ textTransform: 'uppercase' }}
                >
                  {packet.type}
                </text>
              </g>
            );
          })}
        </AnimatePresence>
      </g>
    </svg>
  );
}
