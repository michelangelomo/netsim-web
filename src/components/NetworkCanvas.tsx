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
} from 'lucide-react';
import { useNetworkStore } from '@/store/network-store';
import { DeviceNode } from './DeviceNode';
import { PacketAnimation } from './PacketAnimation';
import { InterfaceSelectionModal } from './InterfaceSelectionModal';
import type { NetworkDevice, DeviceType } from '@/types/network';

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
    currentTool,
    setCurrentTool,
    addDevice,
    removeDevice,
    updateDevicePosition,
    selectDevice,
    addConnection,
    removeConnection,
    connectionStart,
    startConnection,
    cancelConnection,
    packets,
    simulation,
  } = useNetworkStore();

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

      // Get interface names for labels
      const sourceDevice = devices.find((d) => d.id === conn.sourceDeviceId);
      const targetDevice = devices.find((d) => d.id === conn.targetDeviceId);
      const sourceIface = sourceDevice?.interfaces.find((i) => i.id === conn.sourceInterfaceId);
      const targetIface = targetDevice?.interfaces.find((i) => i.id === conn.targetInterfaceId);

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
          stroke: conn.isUp ? (hasTraffic ? '#3b82f6' : '#565869') : '#f43f5e',
        },
      };
    });
  }, [connections, devices, packets, simulation.isRunning]);

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
      }
    },
    [currentTool, removeConnection]
  );

  // Handle pane click
  const onPaneClick = useCallback(() => {
    selectDevice(null);
    cancelConnection();
  }, [selectDevice, cancelConnection]);

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

      </ReactFlow>

      {/* Packet Animations */}
      <PacketAnimation />

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
