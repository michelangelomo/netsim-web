'use client';

import { memo, useCallback } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { motion } from 'framer-motion';
import {
  Monitor,
  Laptop,
  Server,
  Router,
  Network,
  Box,
  Shield,
  Cloud,
  Wifi,
  Settings,
  Terminal,
  MoreVertical,
} from 'lucide-react';
import type { NetworkDevice } from '@/types/network';
import { useNetworkStore } from '@/store/network-store';

interface DeviceNodeData {
  device: NetworkDevice;
}

const deviceIcons: Record<string, typeof Monitor> = {
  pc: Monitor,
  laptop: Laptop,
  server: Server,
  router: Router,
  switch: Network,
  hub: Box,
  firewall: Shield,
  cloud: Cloud,
};

const deviceColors: Record<string, string> = {
  pc: 'from-blue-500 to-blue-600',
  laptop: 'from-indigo-500 to-indigo-600',
  server: 'from-violet-500 to-violet-600',
  router: 'from-emerald-500 to-emerald-600',
  switch: 'from-cyan-500 to-cyan-600',
  hub: 'from-amber-500 to-amber-600',
  firewall: 'from-rose-500 to-rose-600',
  cloud: 'from-slate-500 to-slate-600',
};

const deviceGlows: Record<string, string> = {
  pc: 'shadow-blue-500/30',
  laptop: 'shadow-indigo-500/30',
  server: 'shadow-violet-500/30',
  router: 'shadow-emerald-500/30',
  switch: 'shadow-cyan-500/30',
  hub: 'shadow-amber-500/30',
  firewall: 'shadow-rose-500/30',
  cloud: 'shadow-slate-500/30',
};

function DeviceNodeComponent({ data, selected }: NodeProps & { data: DeviceNodeData }) {
  const { device } = data;
  const Icon = deviceIcons[device.type] || Monitor;
  const gradientClass = deviceColors[device.type] || 'from-gray-500 to-gray-600';
  const glowClass = deviceGlows[device.type] || 'shadow-gray-500/30';

  const { setActiveTerminal, selectDevice, simulation } = useNetworkStore();

  const handleDoubleClick = useCallback(() => {
    setActiveTerminal(device.id);
  }, [device.id, setActiveTerminal]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    selectDevice(device.id);
  }, [device.id, selectDevice]);

  // Get first IP address for display
  const primaryIP = device.interfaces.find((i) => i.ipAddress)?.ipAddress || 'No IP';
  const hasConnections = device.interfaces.some((i) => i.connectedTo);

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      className={`
        relative group cursor-pointer
        ${selected ? 'z-10' : 'z-0'}
      `}
    >
      {/* Glow effect on hover/selection */}
      <div
        className={`
          absolute -inset-2 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300
          bg-gradient-to-r ${gradientClass} blur-xl
          ${selected ? 'opacity-60' : ''}
        `}
      />

      {/* Main container */}
      <div
        className={`
          relative bg-dark-800 rounded-xl p-4 min-w-[140px]
          border border-dark-600 shadow-xl
          transition-all duration-200
          ${selected ? `ring-2 ring-offset-2 ring-offset-dark-900 ring-blue-500 shadow-2xl ${glowClass}` : ''}
          hover:border-dark-500 hover:shadow-2xl
        `}
      >
        {/* Status indicator */}
        <div
          className={`
            absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-dark-800
            ${device.isRunning ? 'bg-emerald-500 shadow-emerald-500/50' : 'bg-gray-500'}
            ${device.isRunning && simulation.isRunning ? 'animate-pulse' : ''}
          `}
          style={{ boxShadow: device.isRunning ? '0 0 8px rgba(16, 185, 129, 0.5)' : 'none' }}
        />

        {/* Icon */}
        <div
          className={`
            w-12 h-12 rounded-xl bg-gradient-to-br ${gradientClass}
            flex items-center justify-center mx-auto mb-2
            shadow-lg ${glowClass}
          `}
        >
          <Icon className="w-6 h-6 text-white" strokeWidth={1.5} />
        </div>

        {/* Device name */}
        <div className="text-center">
          <h3 className="text-sm font-semibold text-white truncate max-w-[120px]">
            {device.name}
          </h3>
          <p className="text-xs text-dark-400 font-mono mt-0.5">
            {primaryIP}
          </p>
        </div>

        {/* Quick actions (visible on hover) */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200 transform translate-y-2 group-hover:translate-y-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActiveTerminal(device.id);
            }}
            className="p-1.5 bg-dark-700 hover:bg-dark-600 rounded-lg border border-dark-500 transition-colors"
            title="Open Terminal"
          >
            <Terminal className="w-3.5 h-3.5 text-dark-300" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              selectDevice(device.id);
            }}
            className="p-1.5 bg-dark-700 hover:bg-dark-600 rounded-lg border border-dark-500 transition-colors"
            title="Configure"
          >
            <Settings className="w-3.5 h-3.5 text-dark-300" />
          </button>
        </div>

        {/* Connection handles - each position has both source and target */}
        {/* Top handles */}
        <Handle
          type="target"
          position={Position.Top}
          id="top-target"
          className="!w-3 !h-3 !bg-dark-500 !border-2 !border-dark-400 hover:!bg-blue-500 hover:!border-blue-400 transition-colors"
          style={{ top: -6 }}
        />
        <Handle
          type="source"
          position={Position.Top}
          id="top-source"
          className="!w-3 !h-3 !bg-dark-500 !border-2 !border-dark-400 hover:!bg-blue-500 hover:!border-blue-400 transition-colors"
          style={{ top: -6 }}
        />
        {/* Bottom handles */}
        <Handle
          type="target"
          position={Position.Bottom}
          id="bottom-target"
          className="!w-3 !h-3 !bg-dark-500 !border-2 !border-dark-400 hover:!bg-blue-500 hover:!border-blue-400 transition-colors"
          style={{ bottom: -6 }}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom-source"
          className="!w-3 !h-3 !bg-dark-500 !border-2 !border-dark-400 hover:!bg-blue-500 hover:!border-blue-400 transition-colors"
          style={{ bottom: -6 }}
        />
        {/* Left handles */}
        <Handle
          type="target"
          position={Position.Left}
          id="left-target"
          className="!w-3 !h-3 !bg-dark-500 !border-2 !border-dark-400 hover:!bg-blue-500 hover:!border-blue-400 transition-colors"
          style={{ left: -6 }}
        />
        <Handle
          type="source"
          position={Position.Left}
          id="left-source"
          className="!w-3 !h-3 !bg-dark-500 !border-2 !border-dark-400 hover:!bg-blue-500 hover:!border-blue-400 transition-colors"
          style={{ left: -6 }}
        />
        {/* Right handles */}
        <Handle
          type="target"
          position={Position.Right}
          id="right-target"
          className="!w-3 !h-3 !bg-dark-500 !border-2 !border-dark-400 hover:!bg-blue-500 hover:!border-blue-400 transition-colors"
          style={{ right: -6 }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="right-source"
          className="!w-3 !h-3 !bg-dark-500 !border-2 !border-dark-400 hover:!bg-blue-500 hover:!border-blue-400 transition-colors"
          style={{ right: -6 }}
        />
      </div>
    </motion.div>
  );
}

export const DeviceNode = memo(DeviceNodeComponent);
