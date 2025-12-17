'use client';

import { useCallback, useRef, useMemo, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  OnConnect,
  BackgroundVariant,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MousePointer2,
  Cable,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3X3,
  Activity,
} from 'lucide-react';
import { useNetworkStore } from '@/store/network-store';
import { DeviceNode } from './DeviceNode';
import { PacketAnimation } from './PacketAnimation';
import { InterfaceSelectionModal } from './InterfaceSelectionModal';
import type { NetworkDevice, DeviceType } from '@/types/network';
import type { LinkStats } from '@/types/network';

// Custom node types
const nodeTypes = {
  device: DeviceNode,
};

// Custom edge style
const defaultEdgeOptions = {
  type: 'smoothstep',
  style: {
    strokeWidth: 2,
    stroke: '#565869',
  },
  animated: false,
};

function NetworkCanvasInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow();

  const {
    devices,
    connections,
    selectedDeviceId,
    selectedConnectionId,
    currentTool,
    setCurrentTool,
    addDevice,
    removeDevice,
    updateDevicePosition,
    selectDevice,
    selectConnection,
    addConnection,
    removeConnection,
    connectionStart,
    startConnection,
    cancelConnection,
    packets,
    simulation,
    connectionStats,
  } = useNetworkStore();

  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [overlayMode, setOverlayMode] = useState<'none' | 'vlan' | 'stp'>('none');

  // Convert devices to React Flow nodes
  const nodes: Node[] = useMemo(() => {
    return devices.map((device) => ({
      id: device.id,
      type: 'device',
      position: device.position,
      data: { device },
      selected: device.id === selectedDeviceId,
    }));
  }, [devices, selectedDeviceId]);

  // Convert connections to React Flow edges
  const edges: Edge[] = useMemo(() => {
    return connections.map((conn) => {
      const hasTraffic = packets.some(
        (p) => p.path.includes(conn.sourceDeviceId) && p.path.includes(conn.targetDeviceId)
      );

      const stats: LinkStats | undefined = connectionStats[conn.id];
      const recentLoss = stats?.lossHistory?.[stats.lossHistory.length - 1] ?? 0;
      const lossPulse = recentLoss > 0;

      // Get interface names for labels
      const sourceDevice = devices.find((d) => d.id === conn.sourceDeviceId);
      const targetDevice = devices.find((d) => d.id === conn.targetDeviceId);
      const sourceIface = sourceDevice?.interfaces.find((i) => i.id === conn.sourceInterfaceId);
      const targetIface = targetDevice?.interfaces.find((i) => i.id === conn.targetInterfaceId);

      // Overlay-driven styling
      const primaryVlan = sourceIface?.vlanMode === 'access' ? sourceIface.accessVlan : sourceIface?.nativeVlan;
      const vlanColors = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e'];
      const vlanStroke = primaryVlan ? vlanColors[primaryVlan % vlanColors.length] : '#565869';

      const sourceStpState = sourceDevice?.stpConfig?.ports.find((p) => p.interfaceId === sourceIface?.id)?.state;
      const targetStpState = targetDevice?.stpConfig?.ports.find((p) => p.interfaceId === targetIface?.id)?.state;
      const isBlocked = sourceStpState === 'blocking' || targetStpState === 'blocking';

      // Calculate best handles
      let sourceHandle = 'bottom-source';
      let targetHandle = 'top-target';

      if (sourceDevice && targetDevice) {
        const dx = targetDevice.position.x - sourceDevice.position.x;
        const dy = targetDevice.position.y - sourceDevice.position.y;

        if (Math.abs(dx) > Math.abs(dy)) {
          // Horizontal
          if (dx > 0) {
            sourceHandle = 'right-source';
            targetHandle = 'left-target';
          } else {
            sourceHandle = 'left-source';
            targetHandle = 'right-target';
          }
        } else {
          // Vertical
          if (dy > 0) {
            sourceHandle = 'bottom-source';
            targetHandle = 'top-target';
          } else {
            sourceHandle = 'top-source';
            targetHandle = 'bottom-target';
          }
        }
      }

      return {
        id: conn.id,
        source: conn.sourceDeviceId,
        target: conn.targetDeviceId,
        sourceHandle,
        targetHandle,
        type: 'smoothstep',
        animated: hasTraffic && simulation.isRunning,
        label: `${sourceIface?.name || '?'} ↔ ${targetIface?.name || '?'}`,
        labelStyle: {
          fill: '#8e8ea0',
          fontSize: 10,
          fontFamily: 'monospace',
        },
        labelBgStyle: {
          fill: '#202123',
          fillOpacity: 0.9,
        },
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        style: {
          strokeWidth: 2,
          stroke: overlayMode === 'vlan'
            ? vlanStroke
            : overlayMode === 'stp'
              ? isBlocked ? '#4b5563' : '#22d3ee'
              : conn.isUp ? (hasTraffic ? '#3b82f6' : '#565869') : '#f43f5e',
          strokeDasharray: overlayMode === 'stp' && isBlocked ? '6 4' : undefined,
          filter: lossPulse ? 'drop-shadow(0 0 6px #f43f5e)' : undefined,
        },
      };
    });
  }, [connections, devices, packets, simulation.isRunning, overlayMode, connectionStats]);

  const [localNodes, setLocalNodes, onNodesChange] = useNodesState(nodes);
  const [localEdges, setLocalEdges, onEdgesChange] = useEdgesState(edges);

  // Sync nodes when devices change
  useEffect(() => {
    setLocalNodes(nodes);
  }, [nodes, setLocalNodes]);

  // Sync edges when connections change
  useEffect(() => {
    setLocalEdges(edges);
  }, [edges, setLocalEdges]);

  const [connectionModal, setConnectionModal] = useState<{ sourceId: string; targetId: string } | null>(null);

  // Handle node position changes
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);

      // Update device positions in store
      changes.forEach((change) => {
        if (change.type === 'position' && change.position && change.id) {
          updateDevicePosition(change.id, change.position);
        }
      });
    },
    [onNodesChange, updateDevicePosition]
  );

  // Handle edge connection
  const onConnect: OnConnect = useCallback(
    (params) => {
      if (!params.source || !params.target) return;

      // Prevent self-connections
      if (params.source === params.target) return;

      setConnectionModal({ sourceId: params.source, targetId: params.target });
    },
    []
  );

  const handleModalConnect = (sourceInterfaceId: string, targetInterfaceId: string) => {
    if (connectionModal) {
      addConnection(
        connectionModal.sourceId,
        sourceInterfaceId,
        connectionModal.targetId,
        targetInterfaceId
      );
      setConnectionModal(null);
      setCurrentTool('select');
    }
  };

  // Handle node click
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (currentTool === 'delete') {
        removeDevice(node.id);
      } else {
        selectDevice(node.id);
      }
    },
    [currentTool, removeDevice, selectDevice]
  );

  // Handle edge click
  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (currentTool === 'delete') {
        removeConnection(edge.id);
      } else {
        selectConnection(edge.id);
      }
    },
    [currentTool, removeConnection, selectConnection]
  );

  // Handle pane click
  const onPaneClick = useCallback(() => {
    selectDevice(null);
    selectConnection(null);
    cancelConnection();
  }, [selectDevice, selectConnection, cancelConnection]);

  const onEdgeMouseEnter = useCallback((_, edge: Edge) => {
    setHoveredConnectionId(edge.id);
  }, []);

  const onEdgeMouseLeave = useCallback(() => {
    setHoveredConnectionId(null);
  }, []);

  // Handle drop for new devices
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/device-type') as DeviceType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addDevice(type, position);
    },
    [screenToFlowPosition, addDevice]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div className="relative w-full h-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={localNodes}
        edges={localEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        onPaneClick={onPaneClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        snapToGrid
        snapGrid={[20, 20]}
        minZoom={0.2}
        maxZoom={2}
        className="bg-dark-950"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#2a2b36"
          className="bg-dark-950"
        />

        <Controls
          className="!bg-dark-800 !border-dark-600 !rounded-lg !shadow-xl"
          showInteractive={false}
        />

        <MiniMap
          className="!bg-dark-800 !border-dark-600 !rounded-lg"
          nodeColor={(node) => {
            const device = devices.find((d) => d.id === node.id);
            if (!device) return '#565869';
            const colors: Record<string, string> = {
              pc: '#3b82f6',
              laptop: '#6366f1',
              server: '#8b5cf6',
              router: '#10b981',
              switch: '#06b6d4',
              hub: '#f59e0b',
              firewall: '#f43f5e',
              cloud: '#64748b',
            };
            return colors[device.type] || '#565869';
          }}
          maskColor="rgba(13, 13, 15, 0.8)"
        />

        {/* Tool Panel */}
        <Panel position="top-left" className="!m-4">
          <div className="flex gap-2 p-2 bg-dark-800/90 backdrop-blur-sm rounded-xl border border-dark-600 shadow-xl">
            <ToolButton
              icon={MousePointer2}
              active={currentTool === 'select'}
              onClick={() => setCurrentTool('select')}
              tooltip="Select (V)"
            />
            <ToolButton
              icon={Cable}
              active={currentTool === 'connect'}
              onClick={() => setCurrentTool('connect')}
              tooltip="Connect (C)"
            />
            <div className="w-px bg-dark-600 mx-1" />
            <ToolButton
              icon={Trash2}
              active={currentTool === 'delete'}
              onClick={() => setCurrentTool('delete')}
              tooltip="Delete (D)"
              danger
            />
          </div>
        </Panel>

        {/* Zoom Panel */}
        <Panel position="top-right" className="!m-4">
          <div className="flex gap-2 p-2 bg-dark-800/90 backdrop-blur-sm rounded-xl border border-dark-600 shadow-xl">
            <ToolButton
              icon={ZoomOut}
              onClick={() => zoomOut()}
              tooltip="Zoom Out (-)"
            />
            <ToolButton
              icon={ZoomIn}
              onClick={() => zoomIn()}
              tooltip="Zoom In (+)"
            />
            <ToolButton
              icon={Maximize2}
              onClick={() => fitView({ padding: 0.2 })}
              tooltip="Fit View (F)"
            />
          </div>
        </Panel>

        {/* Overlay toggles */}
        <Panel position="top-right" className="!m-4 !mt-24">
          <div className="flex gap-2 p-2 bg-dark-800/90 backdrop-blur-sm rounded-xl border border-dark-600 shadow-xl">
            <ToolButton
              icon={Grid3X3}
              active={overlayMode === 'none'}
              onClick={() => setOverlayMode('none')}
              tooltip="No Overlay"
            />
            <ToolButton
              icon={Cable}
              active={overlayMode === 'vlan'}
              onClick={() => setOverlayMode('vlan')}
              tooltip="VLAN Overlay"
            />
            <ToolButton
              icon={Activity}
              active={overlayMode === 'stp'}
              onClick={() => setOverlayMode('stp')}
              tooltip="STP Overlay"
            />
          </div>
        </Panel>

      </ReactFlow>

      {/* Packet Animations */}
      <PacketAnimation />

      {/* Link diagnostics panel */}
      <AnimatePresence>
        {(hoveredConnectionId || selectedConnectionId) && (
          <motion.div
            key={hoveredConnectionId || selectedConnectionId!}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[420px] max-w-[90%] p-4 rounded-xl border border-dark-600 bg-dark-900/90 backdrop-blur shadow-2xl"
          >
            {(() => {
              const connId = hoveredConnectionId || selectedConnectionId!;
              const conn = connections.find((c) => c.id === connId);
              if (!conn) return null;
              const stats: LinkStats | undefined = connectionStats[conn.id];
              const sourceDevice = devices.find((d) => d.id === conn.sourceDeviceId);
              const targetDevice = devices.find((d) => d.id === conn.targetDeviceId);
              const srcIface = sourceDevice?.interfaces.find((i) => i.id === conn.sourceInterfaceId);
              const dstIface = targetDevice?.interfaces.find((i) => i.id === conn.targetInterfaceId);

              const sparkline = (data: number[], color: string) => {
                if (!data || data.length === 0) return null;
                const max = Math.max(1, ...data);
                const points = data.map((v, i) => {
                  const x = (i / Math.max(1, data.length - 1)) * 100;
                  const y = 24 - (v / max) * 24;
                  return `${x},${y}`;
                }).join(' ');
                return (
                  <svg viewBox="0 0 100 24" className="w-full h-10">
                    <polyline
                      points={points}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </svg>
                );
              };

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm text-dark-200 font-semibold">
                      Link {sourceDevice?.name}:{srcIface?.name} ↔ {targetDevice?.name}:{dstIface?.name}
                    </div>
                    <div className="text-xs text-dark-400">bw {conn.bandwidth} Mbps · {conn.latency} ms · loss {conn.packetLoss}%</div>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs text-dark-200">
                    <div className="p-3 rounded-lg border border-dark-700 bg-dark-800/70">
                      <div className="text-[11px] uppercase text-dark-400 mb-1">Loss</div>
                      {sparkline(stats?.lossHistory ?? [], '#f43f5e')}
                      <div className="flex justify-between mt-1 text-[11px] text-dark-400">
                        <span>drops {stats?.drops ?? 0}</span>
                        <span>samples {stats?.lossHistory?.length ?? 0}</span>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-dark-700 bg-dark-800/70">
                      <div className="text-[11px] uppercase text-dark-400 mb-1">RTT</div>
                      {sparkline(stats?.rttHistory ?? [], '#10b981')}
                      <div className="flex justify-between mt-1 text-[11px] text-dark-400">
                        <span>min {Math.min(...(stats?.rttHistory ?? [0]))} ms</span>
                        <span>max {Math.max(...(stats?.rttHistory ?? [0]))} ms</span>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-dark-700 bg-dark-800/70">
                      <div className="text-[11px] uppercase text-dark-400 mb-1">Counts</div>
                      <div className="text-sm">delivered {stats?.delivered ?? 0}</div>
                      <div className="text-sm">dropped {stats?.drops ?? 0}</div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Connection Modal */}
      <AnimatePresence>
        {connectionModal && (
          <InterfaceSelectionModal
            sourceDevice={devices.find((d) => d.id === connectionModal.sourceId)!}
            targetDevice={devices.find((d) => d.id === connectionModal.targetId)!}
            onConnect={handleModalConnect}
            onClose={() => setConnectionModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Tool button component
function ToolButton({
  icon: Icon,
  active,
  onClick,
  tooltip,
  danger,
}: {
  icon: typeof MousePointer2;
  active?: boolean;
  onClick: () => void;
  tooltip: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        relative p-2 rounded-lg transition-all duration-200
        ${active
          ? danger
            ? 'bg-rose-500/20 text-rose-400'
            : 'bg-blue-500/20 text-blue-400'
          : 'text-dark-400 hover:text-white hover:bg-dark-700'
        }
        group
      `}
      title={tooltip}
    >
      <Icon className="w-5 h-5" />
      <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-dark-700 text-xs text-white rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {tooltip}
      </span>
    </button>
  );
}

// Wrapper with provider
export function NetworkCanvas() {
  return (
    <ReactFlowProvider>
      <NetworkCanvasInner />
    </ReactFlowProvider>
  );
}
