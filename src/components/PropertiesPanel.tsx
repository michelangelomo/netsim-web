'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Settings,
  Network,
  Wifi,
  WifiOff,
  ChevronDown,
  ChevronRight,
  Save,
  RotateCcw,
  Terminal,
  Trash2,
  Copy,
  Edit3,
  Server,
  RefreshCw,
  Power,
  PowerOff,
} from 'lucide-react';
import { useNetworkStore } from '@/store/network-store';
import { isValidIP, isValidSubnetMask, cidrToSubnetMask, subnetMaskToCidr } from '@/lib/network-utils';

export function PropertiesPanel() {
  const {
    selectedDeviceId,
    selectDevice,
    devices,
    updateDevice,
    configureInterface,
    removeDevice,
    duplicateDevice,
    setActiveTerminal,
    upsertRoute,
    removeRoute,
    configureDhcpServer,
    requestDhcp,
    releaseDhcp,
  } = useNetworkStore();

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['general', 'interfaces'])
  );
  const [editingInterface, setEditingInterface] = useState<string | null>(null);
  const [interfaceForm, setInterfaceForm] = useState({
    ipAddress: '',
    subnetMask: '',
    gateway: '',
  });
  const [editingDhcp, setEditingDhcp] = useState(false);
  const [editingDhcpInterfaceId, setEditingDhcpInterfaceId] = useState<string | null>(null);
  const [dhcpForm, setDhcpForm] = useState({
    poolStart: '',
    poolEnd: '',
    subnetMask: '',
    defaultGateway: '',
    dnsServers: '',
    leaseTime: '',
  });
  const [dhcpLoading, setDhcpLoading] = useState<string | null>(null);

  const [editingRoute, setEditingRoute] = useState<{ destination: string; netmask: string } | null>(null);
  const [addingRoute, setAddingRoute] = useState(false);
  const [routeForm, setRouteForm] = useState({
    destination: '0.0.0.0',
    cidr: '0',
    gateway: '',
    iface: '',
    metric: '1',
  });

  const device = selectedDeviceId ? devices.find((d) => d.id === selectedDeviceId) : null;

  const toggleSection = useCallback((section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  const handleInterfaceEdit = useCallback(
    (interfaceId: string) => {
      if (!device) return;
      const iface = device.interfaces.find((i) => i.id === interfaceId);
      if (iface) {
        setInterfaceForm({
          ipAddress: iface.ipAddress || '',
          subnetMask: iface.subnetMask || '255.255.255.0',
          gateway: iface.gateway || '',
        });
        setEditingInterface(interfaceId);
      }
    },
    [device]
  );

  const handleInterfaceSave = useCallback(() => {
    if (!device || !editingInterface) return;

    const ip = interfaceForm.ipAddress.trim();
    const mask = interfaceForm.subnetMask.trim();
    const gateway = interfaceForm.gateway.trim();

    if (ip && !isValidIP(ip)) {
      alert('Invalid IP address');
      return;
    }

    if (mask && !isValidSubnetMask(mask)) {
      alert('Invalid subnet mask');
      return;
    }

    if (gateway && !isValidIP(gateway)) {
      alert('Invalid gateway');
      return;
    }

    configureInterface(device.id, editingInterface, {
      ipAddress: ip || null,
      subnetMask: mask || null,
      gateway: gateway || null,
    });

    setEditingInterface(null);
  }, [device, editingInterface, interfaceForm, configureInterface]);

  const handleToggleInterface = useCallback(
    (interfaceId: string, isUp: boolean) => {
      if (!device) return;
      configureInterface(device.id, interfaceId, { isUp: !isUp });
    },
    [device, configureInterface]
  );

  // DHCP Server handlers
  const handleDhcpEdit = useCallback(
    (interfaceId: string) => {
      if (!device) return;
      const iface = device.interfaces.find((i) => i.id === interfaceId);
      if (!iface) return;

      const config = device.dhcpServers?.find((s) => s.interfaceId === interfaceId);
      setDhcpForm({
        poolStart: config?.poolStart || '192.168.1.100',
        poolEnd: config?.poolEnd || '192.168.1.200',
        subnetMask: config?.subnetMask || iface.subnetMask || '255.255.255.0',
        defaultGateway: config?.defaultGateway || iface.gateway || iface.ipAddress || '192.168.1.1',
        dnsServers: config?.dnsServers?.join(', ') || '8.8.8.8, 8.8.4.4',
        leaseTime: String(config?.leaseTime || 86400),
      });
      setEditingDhcpInterfaceId(interfaceId);
      setEditingDhcp(true);
    },
    [device]
  );

  const handleDhcpSave = useCallback(() => {
    if (!device) return;

    if (!editingDhcpInterfaceId) {
      alert('Please select an interface for the DHCP server');
      return;
    }

    const selectedIface = device.interfaces.find((i) => i.id === editingDhcpInterfaceId);
    if (!selectedIface?.ipAddress) {
      alert('Selected interface must have an IP address configured');
      return;
    }

    // Validate IPs
    if (!isValidIP(dhcpForm.poolStart)) {
      alert('Invalid pool start IP');
      return;
    }
    if (!isValidIP(dhcpForm.poolEnd)) {
      alert('Invalid pool end IP');
      return;
    }
    if (!isValidSubnetMask(dhcpForm.subnetMask)) {
      alert('Invalid subnet mask');
      return;
    }
    if (!isValidIP(dhcpForm.defaultGateway)) {
      alert('Invalid default gateway');
      return;
    }

    const dnsServers = dhcpForm.dnsServers
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s);

    for (const dns of dnsServers) {
      if (!isValidIP(dns)) {
        alert(`Invalid DNS server: ${dns}`);
        return;
      }
    }

    const leaseTime = parseInt(dhcpForm.leaseTime, 10);
    if (isNaN(leaseTime) || leaseTime < 60) {
      alert('Lease time must be at least 60 seconds');
      return;
    }

    configureDhcpServer(device.id, editingDhcpInterfaceId, {
      poolStart: dhcpForm.poolStart,
      poolEnd: dhcpForm.poolEnd,
      subnetMask: dhcpForm.subnetMask,
      defaultGateway: dhcpForm.defaultGateway,
      dnsServers,
      leaseTime,
    });

    setEditingDhcp(false);
    setEditingDhcpInterfaceId(null);
  }, [device, dhcpForm, configureDhcpServer, editingDhcpInterfaceId]);

  const handleToggleDhcpServer = useCallback(
    (interfaceId: string) => {
      if (!device) return;
      const config = device.dhcpServers?.find((s) => s.interfaceId === interfaceId);
      const isEnabled = config?.enabled ?? false;
      configureDhcpServer(device.id, interfaceId, { enabled: !isEnabled });
    },
    [device, configureDhcpServer]
  );

  // DHCP Client handlers
  const handleRequestDhcp = useCallback(
    async (interfaceId: string) => {
      if (!device) return;
      setDhcpLoading(interfaceId);
      try {
        await requestDhcp(device.id, interfaceId);
      } finally {
        setDhcpLoading(null);
      }
    },
    [device, requestDhcp]
  );

  const handleReleaseDhcp = useCallback(
    (interfaceId: string) => {
      if (!device) return;
      releaseDhcp(device.id, interfaceId);
    },
    [device, releaseDhcp]
  );

  // Routing table handlers
  const startAddRoute = useCallback(() => {
    if (!device || !device.routingTable) return;
    const defaultIface = device.interfaces[0]?.name || '';
    setRouteForm({
      destination: '0.0.0.0',
      cidr: '0',
      gateway: '',
      iface: defaultIface,
      metric: '1',
    });
    setEditingRoute(null);
    setAddingRoute(true);
  }, [device]);

  const startEditRoute = useCallback(
    (destination: string, netmask: string, gateway: string, iface: string, metric: number, type: string) => {
      if (!device || !device.routingTable) return;
      if (type === 'connected') return;
      setRouteForm({
        destination,
        cidr: String(subnetMaskToCidr(netmask)),
        gateway,
        iface,
        metric: String(metric),
      });
      setAddingRoute(false);
      setEditingRoute({ destination, netmask });
    },
    [device]
  );

  const cancelRouteEdit = useCallback(() => {
    setAddingRoute(false);
    setEditingRoute(null);
  }, []);

  const saveRoute = useCallback(() => {
    if (!device || !device.routingTable) return;

    const destination = routeForm.destination.trim();
    const cidr = parseInt(routeForm.cidr, 10);
    const gateway = routeForm.gateway.trim();
    const iface = routeForm.iface;
    const metric = parseInt(routeForm.metric, 10);

    if (!isValidIP(destination)) {
      alert('Invalid destination IP');
      return;
    }
    if (isNaN(cidr) || cidr < 0 || cidr > 32) {
      alert('CIDR must be between 0 and 32');
      return;
    }
    if (!gateway || !isValidIP(gateway)) {
      alert('Invalid gateway IP');
      return;
    }
    if (!iface || !device.interfaces.some((i) => i.name === iface)) {
      alert('Invalid interface');
      return;
    }
    if (isNaN(metric) || metric < 0) {
      alert('Metric must be a non-negative number');
      return;
    }

    const netmask = cidrToSubnetMask(cidr);

    // If editing, remove the old route key if destination/netmask changed
    if (editingRoute && (editingRoute.destination !== destination || editingRoute.netmask !== netmask)) {
      removeRoute(device.id, editingRoute.destination, editingRoute.netmask);
    }

    upsertRoute(device.id, {
      destination,
      netmask,
      gateway,
      interface: iface,
      metric,
      type: 'static',
    });

    cancelRouteEdit();
  }, [device, routeForm, upsertRoute, removeRoute, editingRoute, cancelRouteEdit]);

  if (!device) {
    return (
      <aside className="w-80 bg-dark-900 border-l border-dark-700 flex flex-col">
        <div className="p-4 border-b border-dark-700">
          <h2 className="text-sm font-semibold text-white">Properties</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <Settings className="w-12 h-12 text-dark-600 mx-auto mb-3" />
            <p className="text-dark-400 text-sm">
              Select a device to view its properties
            </p>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-80 bg-dark-900 border-l border-dark-700 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-dark-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-lg bg-gradient-to-br flex items-center justify-center
              ${device.type === 'pc' ? 'from-blue-500 to-blue-600' : ''}
              ${device.type === 'laptop' ? 'from-indigo-500 to-indigo-600' : ''}
              ${device.type === 'server' ? 'from-violet-500 to-violet-600' : ''}
              ${device.type === 'router' ? 'from-emerald-500 to-emerald-600' : ''}
              ${device.type === 'switch' ? 'from-cyan-500 to-cyan-600' : ''}
              ${device.type === 'hub' ? 'from-amber-500 to-amber-600' : ''}
              ${device.type === 'firewall' ? 'from-rose-500 to-rose-600' : ''}
              ${device.type === 'cloud' ? 'from-slate-500 to-slate-600' : ''}
            `}
          >
            <Network className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">{device.name}</h2>
            <p className="text-xs text-dark-400 capitalize">{device.type}</p>
          </div>
        </div>
        <button
          onClick={() => selectDevice(null)}
          className="p-1.5 hover:bg-dark-700 rounded-lg transition-colors"
        >
          <X className="w-4 h-4 text-dark-400" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Quick Actions */}
        <div className="p-4 border-b border-dark-800">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTerminal(device.id)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-dark-800 hover:bg-dark-700 rounded-lg text-sm text-dark-200 hover:text-white transition-colors"
            >
              <Terminal className="w-4 h-4" />
              Terminal
            </button>
            <button
              onClick={() => duplicateDevice(device.id)}
              className="p-2 bg-dark-800 hover:bg-dark-700 rounded-lg text-dark-400 hover:text-white transition-colors"
              title="Duplicate"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (confirm('Delete this device?')) {
                  removeDevice(device.id);
                }
              }}
              className="p-2 bg-dark-800 hover:bg-rose-500/20 rounded-lg text-dark-400 hover:text-rose-400 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* General Section */}
        <Section
          title="General"
          id="general"
          expanded={expandedSections.has('general')}
          onToggle={() => toggleSection('general')}
        >
          <div className="space-y-3">
            <PropertyRow label="Hostname">
              <input
                type="text"
                value={device.hostname}
                onChange={(e) => updateDevice(device.id, { hostname: e.target.value, name: e.target.value })}
                className="w-full bg-dark-800 border border-dark-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </PropertyRow>
            <PropertyRow label="Type">
              <span className="text-dark-200 capitalize">{device.type}</span>
            </PropertyRow>
            <PropertyRow label="Status">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${device.isRunning ? 'bg-emerald-500' : 'bg-dark-500'
                    }`}
                />
                <span className={device.isRunning ? 'text-emerald-400' : 'text-dark-400'}>
                  {device.isRunning ? 'Running' : 'Stopped'}
                </span>
              </div>
            </PropertyRow>
          </div>
        </Section>

        {/* Interfaces Section */}
        <Section
          title="Interfaces"
          id="interfaces"
          expanded={expandedSections.has('interfaces')}
          onToggle={() => toggleSection('interfaces')}
          badge={device.interfaces.length.toString()}
        >
          <div className="space-y-2">
            {device.interfaces.map((iface) => (
              <div
                key={iface.id}
                className="bg-dark-800 rounded-lg p-3 border border-dark-700"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {iface.isUp ? (
                      <Wifi className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <WifiOff className="w-4 h-4 text-dark-500" />
                    )}
                    <span className="text-sm font-medium text-white">{iface.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggleInterface(iface.id, iface.isUp)}
                      className={`px-2 py-0.5 text-xs rounded ${iface.isUp
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-dark-700 text-dark-400'
                        }`}
                    >
                      {iface.isUp ? 'UP' : 'DOWN'}
                    </button>
                    <button
                      onClick={() => handleInterfaceEdit(iface.id)}
                      className="p-1 hover:bg-dark-600 rounded transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-dark-400" />
                    </button>
                  </div>
                </div>

                {editingInterface === iface.id ? (
                  <div className="space-y-2 mt-3 pt-3 border-t border-dark-700">
                    <div>
                      <label className="text-xs text-dark-400 mb-1 block">IP Address</label>
                      <input
                        type="text"
                        value={interfaceForm.ipAddress}
                        onChange={(e) =>
                          setInterfaceForm((prev) => ({ ...prev, ipAddress: e.target.value }))
                        }
                        placeholder="192.168.1.1"
                        className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-dark-400 mb-1 block">Subnet Mask</label>
                      <input
                        type="text"
                        value={interfaceForm.subnetMask}
                        onChange={(e) =>
                          setInterfaceForm((prev) => ({ ...prev, subnetMask: e.target.value }))
                        }
                        placeholder="255.255.255.0"
                        className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-dark-400 mb-1 block">Gateway</label>
                      <input
                        type="text"
                        value={interfaceForm.gateway}
                        onChange={(e) =>
                          setInterfaceForm((prev) => ({ ...prev, gateway: e.target.value }))
                        }
                        placeholder="192.168.1.254"
                        className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={handleInterfaceSave}
                        className="flex-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingInterface(null)}
                        className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 text-xs font-medium rounded transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-dark-400">IP:</span>
                      <span className="text-dark-200 font-mono">
                        {iface.ipAddress || 'Not configured'}
                        {iface.dhcpEnabled && (
                          <span className="ml-1 text-cyan-400">(DHCP)</span>
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-dark-400">MAC:</span>
                      <span className="text-dark-200 font-mono text-[10px]">
                        {iface.macAddress.toLowerCase()}
                      </span>
                    </div>
                    {iface.connectedTo && (
                      <div className="flex justify-between">
                        <span className="text-dark-400">Status:</span>
                        <span className="text-emerald-400">Connected</span>
                      </div>
                    )}
                    {/* DHCP Client controls for PCs/laptops */}
                    {(device.type === 'pc' || device.type === 'laptop') && (
                      <div className="flex gap-2 mt-2 pt-2 border-t border-dark-700">
                        {iface.dhcpEnabled ? (
                          <button
                            onClick={() => handleReleaseDhcp(iface.id)}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs font-medium rounded transition-colors"
                          >
                            <PowerOff className="w-3 h-3" />
                            Release DHCP
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRequestDhcp(iface.id)}
                            disabled={dhcpLoading === iface.id}
                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 text-xs font-medium rounded transition-colors disabled:opacity-50"
                          >
                            {dhcpLoading === iface.id ? (
                              <>
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                Requesting...
                              </>
                            ) : (
                              <>
                                <RefreshCw className="w-3 h-3" />
                                Request DHCP
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* Routing Table (for routers) */}
        {device.routingTable && (
          <Section
            title="Routing Table"
            id="routing"
            expanded={expandedSections.has('routing')}
            onToggle={() => toggleSection('routing')}
            badge={device.routingTable.length.toString()}
          >
            <div className="space-y-2">
              {(addingRoute || editingRoute) && (
                <div className="bg-dark-800 rounded-lg p-3 border border-dark-700 space-y-2">
                  <div className="text-xs text-dark-400">
                    {editingRoute ? 'Edit static route' : 'Add static route'}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-dark-400 mb-1 block">Destination</label>
                      <input
                        type="text"
                        value={routeForm.destination}
                        onChange={(e) => setRouteForm((p) => ({ ...p, destination: e.target.value }))}
                        placeholder="0.0.0.0"
                        className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-dark-400 mb-1 block">CIDR</label>
                      <input
                        type="number"
                        min={0}
                        max={32}
                        value={routeForm.cidr}
                        onChange={(e) => setRouteForm((p) => ({ ...p, cidr: e.target.value }))}
                        className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Gateway</label>
                    <input
                      type="text"
                      value={routeForm.gateway}
                      onChange={(e) => setRouteForm((p) => ({ ...p, gateway: e.target.value }))}
                      placeholder="192.168.1.1"
                      className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-dark-400 mb-1 block">Interface</label>
                      <select
                        value={routeForm.iface}
                        onChange={(e) => setRouteForm((p) => ({ ...p, iface: e.target.value }))}
                        className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                      >
                        {device.interfaces.map((iface) => (
                          <option key={iface.id} value={iface.name}>
                            {iface.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-dark-400 mb-1 block">Metric</label>
                      <input
                        type="number"
                        min={0}
                        value={routeForm.metric}
                        onChange={(e) => setRouteForm((p) => ({ ...p, metric: e.target.value }))}
                        className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={saveRoute}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg text-sm font-medium text-white transition-colors"
                    >
                      <Save className="w-4 h-4" />
                      Save
                    </button>
                    <button
                      onClick={cancelRouteEdit}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg text-sm font-medium text-dark-200 transition-colors"
                    >
                      <X className="w-4 h-4" />
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {!addingRoute && !editingRoute && (
                <button
                  onClick={startAddRoute}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-dark-800 hover:bg-dark-700 rounded-lg text-sm text-dark-200 hover:text-white transition-colors"
                >
                  <Network className="w-4 h-4" />
                  Add Route
                </button>
              )}

              {device.routingTable.length === 0 ? (
                <p className="text-xs text-dark-400 text-center py-2">No routes configured</p>
              ) : (
                device.routingTable.map((route, index) => (
                  <div
                    key={index}
                    className="bg-dark-800 rounded-lg p-2 text-xs border border-dark-700"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-dark-200">
                        {route.destination === '0.0.0.0' ? 'default' : `${route.destination}/${subnetMaskToCidr(route.netmask)}`}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditRoute(route.destination, route.netmask, route.gateway, route.interface, route.metric, route.type)}
                          disabled={route.type === 'connected'}
                          className="p-1 hover:bg-dark-600 rounded text-dark-500 hover:text-dark-200 disabled:opacity-40"
                          title={route.type === 'connected' ? 'Connected routes are read-only' : 'Edit'}
                        >
                          <Edit3 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => removeRoute(device.id, route.destination, route.netmask)}
                          disabled={route.type === 'connected'}
                          className="p-1 hover:bg-dark-600 rounded text-dark-500 hover:text-rose-400 disabled:opacity-40"
                          title={route.type === 'connected' ? 'Connected routes are managed by interfaces' : 'Delete'}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-dark-400 mt-1">
                      via {route.gateway === '0.0.0.0' ? 'direct' : route.gateway} ({route.type})
                    </div>
                  </div>
                ))
              )}
            </div>
          </Section>
        )}

        {/* DHCP Server (for routers/servers) */}
        {(device.type === 'router' || device.type === 'server') && (
          <Section
            title="DHCP Server"
            id="dhcp"
            expanded={expandedSections.has('dhcp')}
            onToggle={() => toggleSection('dhcp')}
            badge={(device.dhcpServers?.some((s) => s.enabled) ?? false) ? 'ON' : 'OFF'}
          >
            <div className="space-y-3">
              <p className="text-xs text-dark-400">
                Enable/disable DHCP per interface.
              </p>

              <div className="space-y-2">
                {device.interfaces.map((iface) => {
                  const cfg = device.dhcpServers?.find((s) => s.interfaceId === iface.id);
                  const enabled = cfg?.enabled ?? false;
                  const canRun = Boolean(iface.ipAddress);
                  const leaseCount = cfg?.leases?.length ?? 0;

                  return (
                    <div
                      key={iface.id}
                      className="bg-dark-800 rounded-lg p-3 border border-dark-700"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-white">{iface.name}</div>
                          <div className="text-xs text-dark-400">
                            {iface.ipAddress ? `IP ${iface.ipAddress}` : 'No IP configured'}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleDhcpServer(iface.id)}
                            disabled={!canRun}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${enabled
                              ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                              : 'bg-dark-700 text-dark-400 hover:bg-dark-600'
                              }`}
                          >
                            {enabled ? (
                              <>
                                <Power className="w-3.5 h-3.5" />
                                Enabled
                              </>
                            ) : (
                              <>
                                <PowerOff className="w-3.5 h-3.5" />
                                Disabled
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => handleDhcpEdit(iface.id)}
                            disabled={!canRun}
                            className="p-2 bg-dark-900 hover:bg-dark-700 rounded-lg text-dark-400 hover:text-white transition-colors disabled:opacity-50"
                            title="Configure"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {cfg && (
                        <div className="mt-3 pt-3 border-t border-dark-700 text-xs space-y-1">
                          <div className="flex justify-between">
                            <span className="text-dark-400">Pool:</span>
                            <span className="text-dark-200 font-mono">{cfg.poolStart} - {cfg.poolEnd}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-dark-400">Subnet:</span>
                            <span className="text-dark-200 font-mono">{cfg.subnetMask}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-dark-400">Gateway:</span>
                            <span className="text-dark-200 font-mono">{cfg.defaultGateway}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-dark-400">DNS:</span>
                            <span className="text-dark-200 font-mono text-[10px]">{cfg.dnsServers.join(', ')}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-dark-400">Leases:</span>
                            <span className="text-dark-200">{leaseCount} active</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {editingDhcp && (
                <div className="space-y-2 bg-dark-800 rounded-lg p-3 border border-dark-700">
                  <div className="text-xs text-dark-400">
                    Editing interface:{' '}
                    <span className="text-dark-200 font-mono">
                      {device.interfaces.find((i) => i.id === editingDhcpInterfaceId)?.name || 'unknown'}
                    </span>
                  </div>
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Pool Start</label>
                    <input
                      type="text"
                      value={dhcpForm.poolStart}
                      onChange={(e) => setDhcpForm((prev) => ({ ...prev, poolStart: e.target.value }))}
                      placeholder="192.168.1.100"
                      className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Pool End</label>
                    <input
                      type="text"
                      value={dhcpForm.poolEnd}
                      onChange={(e) => setDhcpForm((prev) => ({ ...prev, poolEnd: e.target.value }))}
                      placeholder="192.168.1.200"
                      className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Subnet Mask</label>
                    <input
                      type="text"
                      value={dhcpForm.subnetMask}
                      onChange={(e) => setDhcpForm((prev) => ({ ...prev, subnetMask: e.target.value }))}
                      placeholder="255.255.255.0"
                      className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Default Gateway</label>
                    <input
                      type="text"
                      value={dhcpForm.defaultGateway}
                      onChange={(e) => setDhcpForm((prev) => ({ ...prev, defaultGateway: e.target.value }))}
                      placeholder="192.168.1.1"
                      className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">DNS Servers (comma-separated)</label>
                    <input
                      type="text"
                      value={dhcpForm.dnsServers}
                      onChange={(e) => setDhcpForm((prev) => ({ ...prev, dnsServers: e.target.value }))}
                      placeholder="8.8.8.8, 8.8.4.4"
                      className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-dark-400 mb-1 block">Lease Time (seconds)</label>
                    <input
                      type="text"
                      value={dhcpForm.leaseTime}
                      onChange={(e) => setDhcpForm((prev) => ({ ...prev, leaseTime: e.target.value }))}
                      placeholder="86400"
                      className="w-full bg-dark-900 border border-dark-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleDhcpSave}
                      className="flex-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium rounded transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingDhcp(false);
                        setEditingDhcpInterfaceId(null);
                      }}
                      className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-dark-300 text-xs font-medium rounded transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ARP Table */}
        {device.arpTable && device.arpTable.length > 0 && (
          <Section
            title="ARP Table"
            id="arp"
            expanded={expandedSections.has('arp')}
            onToggle={() => toggleSection('arp')}
            badge={device.arpTable.length.toString()}
          >
            <div className="space-y-1">
              {device.arpTable.map((entry, index) => (
                <div
                  key={index}
                  className="flex justify-between text-xs py-1 border-b border-dark-800 last:border-0"
                >
                  <span className="font-mono text-dark-200">{entry.ipAddress}</span>
                  <span className="font-mono text-dark-400 text-[10px]">
                    {entry.macAddress.toLowerCase()}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* MAC Table (for switches) */}
        {device.macTable && device.macTable.length > 0 && (
          <Section
            title="MAC Address Table"
            id="mac"
            expanded={expandedSections.has('mac')}
            onToggle={() => toggleSection('mac')}
            badge={device.macTable.length.toString()}
          >
            <div className="space-y-1">
              {device.macTable.map((entry, index) => (
                <div
                  key={index}
                  className="flex justify-between text-xs py-1 border-b border-dark-800 last:border-0"
                >
                  <span className="font-mono text-dark-400 text-[10px]">
                    {entry.macAddress.toLowerCase()}
                  </span>
                  <span className="text-dark-200">{entry.port}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({
  title,
  id,
  expanded,
  onToggle,
  badge,
  children,
}: {
  title: string;
  id: string;
  expanded: boolean;
  onToggle: () => void;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-dark-800">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-dark-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-dark-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-dark-400" />
          )}
          <span className="text-sm font-medium text-white">{title}</span>
        </div>
        {badge && (
          <span className="px-1.5 py-0.5 text-[10px] bg-dark-700 rounded text-dark-400">
            {badge}
          </span>
        )}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-dark-400">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}
