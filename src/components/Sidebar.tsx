'use client';

import { useCallback } from 'react';
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
  MousePointer2,
  Cable,
  Trash2,
  Play,
  Square,
  Activity,
  Table,
  Github,
  StepForward,
} from 'lucide-react';
import { useNetworkStore } from '@/store/network-store';
import type { DeviceType } from '@/types/network';

const deviceList: Array<{ type: DeviceType; name: string; icon: typeof Monitor; color: string }> = [
  { type: 'pc', name: 'PC', icon: Monitor, color: 'from-blue-500 to-blue-600' },
  { type: 'laptop', name: 'Laptop', icon: Laptop, color: 'from-indigo-500 to-indigo-600' },
  { type: 'server', name: 'Server', icon: Server, color: 'from-violet-500 to-violet-600' },
  { type: 'router', name: 'Router', icon: Router, color: 'from-emerald-500 to-emerald-600' },
  { type: 'switch', name: 'Switch', icon: Network, color: 'from-cyan-500 to-cyan-600' },
  { type: 'hub', name: 'Hub', icon: Box, color: 'from-amber-500 to-amber-600' },
  { type: 'firewall', name: 'Firewall', icon: Shield, color: 'from-rose-500 to-rose-600' },
  { type: 'cloud', name: 'Internet', icon: Cloud, color: 'from-slate-500 to-slate-600' },
];

export function Sidebar() {
  const {
    currentTool,
    setCurrentTool,
    simulation,
    startSimulation,
    stopSimulation,
    setSimulationPreset,
    setDeterministicLoss,
    stepSimulation,
    devices,
    eventLog,
  } = useNetworkStore();

  const handleDragStart = useCallback((e: React.DragEvent, type: DeviceType) => {
    e.dataTransfer.setData('application/device-type', type);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  return (
    <aside className="w-64 bg-dark-900 border-r border-dark-700 flex flex-col h-full overflow-hidden">
      {/* Logo */}
      <div className="p-4 border-b border-dark-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Network className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">
                NetSim<span className="text-blue-400">Web</span>
              </h1>
              <p className="text-xs text-dark-400">Network Simulator</p>
            </div>
          </div>
          <a
            href="https://github.com/michelangelomo/netsim-web"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg hover:bg-dark-700 text-dark-400 hover:text-white transition-colors"
            title="View on GitHub"
          >
            <Github className="w-5 h-5" />
          </a>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Simulation Controls */}
        <div className="p-4 border-b border-dark-800 space-y-3">
          <h2 className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-1">
            Simulation
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => (simulation.isRunning ? stopSimulation() : startSimulation())}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-all duration-150 ${simulation.isRunning ? 'border-amber-500/40 text-amber-300 bg-amber-500/10' : 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'}`}
            >
              {simulation.isRunning ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {simulation.isRunning ? 'Pause' : 'Start'}
            </button>
            <button
              onClick={() => stepSimulation()}
              className="px-3 py-2 rounded-lg border border-dark-600 text-dark-200 hover:border-cyan-500/50 hover:text-cyan-200 flex items-center gap-2"
              title="Step"
            >
              <StepForward className="w-4 h-4" />
              Step
            </button>
          </div>
          <div className="flex gap-2 text-xs">
            {(['slow', 'normal', 'fast'] as const).map((preset) => (
              <button
                key={preset}
                onClick={() => setSimulationPreset(preset)}
                className={`flex-1 px-2 py-1.5 rounded border text-center capitalize ${simulation.speed === (preset === 'slow' ? 0.5 : preset === 'normal' ? 1 : 2)
                  ? 'border-blue-500/50 text-blue-200 bg-blue-500/10'
                  : 'border-dark-700 text-dark-300 hover:border-blue-500/30'
                  }`}
              >
                {preset}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-dark-300">
            <input
              type="checkbox"
              checked={simulation.deterministicLoss ?? false}
              onChange={(e) => setDeterministicLoss(e.target.checked)}
              className="accent-blue-500"
            />
            Deterministic loss (reproducible)
          </label>
        </div>

        {/* Device Palette */}
        <div className="p-4">
          <h2 className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">
            Network Devices
          </h2>
          <div className="grid grid-cols-2 gap-2">
            {deviceList.map((device) => (
              <motion.div
                key={device.type}
                draggable
                onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, device.type)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="group relative bg-dark-800 hover:bg-dark-700 rounded-xl p-3 cursor-grab active:cursor-grabbing border border-dark-700 hover:border-dark-600 transition-all duration-200"
              >
                {/* Glow on hover */}
                <div
                  className={`absolute inset-0 rounded-xl bg-gradient-to-br ${device.color} opacity-0 group-hover:opacity-10 transition-opacity`}
                />

                <div className="relative flex flex-col items-center gap-2">
                  <div
                    className={`w-10 h-10 rounded-lg bg-gradient-to-br ${device.color} flex items-center justify-center shadow-lg`}
                  >
                    <device.icon className="w-5 h-5 text-white" strokeWidth={1.5} />
                  </div>
                  <span className="text-xs font-medium text-dark-200">{device.name}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="p-4 border-t border-dark-800">
          <h2 className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-3">
            Statistics
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              icon={Monitor}
              label="Devices"
              value={devices.length.toString()}
              color="blue"
            />
            <StatCard
              icon={Cable}
              label="Links"
              value={useNetworkStore.getState().connections.length.toString()}
              color="cyan"
            />
          </div>
        </div>

        {/* Event Log */}
        <div className="p-4 border-t border-dark-800 space-y-2">
          <h2 className="text-xs font-semibold text-dark-400 uppercase tracking-wider mb-1 flex items-center gap-2">
            <Activity className="w-4 h-4" /> Event Feed
          </h2>
          <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
            {eventLog.slice(-8).reverse().map((e) => (
              <div key={e.id} className="text-xs bg-dark-800/70 border border-dark-700 rounded-lg px-2 py-1.5 flex items-center gap-2">
                <span className="text-[10px] text-dark-500">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${e.type === 'tcp' ? 'bg-emerald-500/15 text-emerald-300' :
                  e.type === 'icmp' ? 'bg-blue-500/15 text-blue-300' :
                    e.type === 'arp' ? 'bg-violet-500/15 text-violet-300' :
                      e.type === 'stp' ? 'bg-cyan-500/15 text-cyan-300' :
                        e.type === 'link' ? 'bg-amber-500/15 text-amber-300' :
                          'bg-dark-600 text-dark-200'
                  }`}>
                  {e.type}
                </span>
                <span className="text-dark-200 truncate">{e.message}</span>
              </div>
            ))}
            {eventLog.length === 0 && <div className="text-[11px] text-dark-500">No events yet</div>}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-dark-700 bg-dark-900/50">
        <p className="text-xs text-dark-500 text-center">
          Drag devices onto the canvas
        </p>
      </div>
    </aside>
  );
}

function ToolButton({
  icon: Icon,
  label,
  shortcut,
  active,
  onClick,
  danger,
}: {
  icon: typeof MousePointer2;
  label: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200
        ${active
          ? danger
            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
            : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
          : 'hover:bg-dark-700 text-dark-300 hover:text-white border border-transparent'
        }
      `}
    >
      <Icon className="w-4 h-4" />
      <span className="flex-1 text-left text-sm font-medium">{label}</span>
      <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-dark-700 rounded text-dark-400">
        {shortcut}
      </kbd>
    </button>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Monitor;
  label: string;
  value: string;
  color: 'blue' | 'cyan' | 'emerald' | 'violet';
}) {
  const colors = {
    blue: 'from-blue-500/20 to-blue-600/10 text-blue-400',
    cyan: 'from-cyan-500/20 to-cyan-600/10 text-cyan-400',
    emerald: 'from-emerald-500/20 to-emerald-600/10 text-emerald-400',
    violet: 'from-violet-500/20 to-violet-600/10 text-violet-400',
  };

  return (
    <div className={`bg-gradient-to-br ${colors[color]} rounded-lg p-3 border border-white/5`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 opacity-70" />
        <span className="text-xs opacity-70">{label}</span>
      </div>
      <span className="text-xl font-bold">{value}</span>
    </div>
  );
}
