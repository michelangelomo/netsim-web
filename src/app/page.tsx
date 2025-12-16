'use client';

import { useEffect, useCallback } from 'react';
import { Header } from '@/components/Header';
import { Sidebar } from '@/components/Sidebar';
import { NetworkCanvas } from '@/components/NetworkCanvas';
import { PropertiesPanel } from '@/components/PropertiesPanel';
import { Terminal } from '@/components/Terminal';
import { Notifications } from '@/components/Notifications';
import { useNetworkStore } from '@/store/network-store';

export default function Home() {
  const {
    setCurrentTool,
    removeDevice,
    selectedDeviceId,
    activeTerminalDevice,
    setActiveTerminal,
  } = useNetworkStore();

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Tool shortcuts
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setCurrentTool('select');
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setCurrentTool('connect');
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        setCurrentTool('delete');
      }

      // Delete selected device
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDeviceId) {
        e.preventDefault();
        removeDevice(selectedDeviceId);
      }

      // Escape to close terminal
      if (e.key === 'Escape' && activeTerminalDevice) {
        e.preventDefault();
        setActiveTerminal(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCurrentTool, removeDevice, selectedDeviceId, activeTerminalDevice, setActiveTerminal]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-dark-950">
      {/* Header */}
      <Header />

      {/* Main content */}
      <div className={`flex-1 flex overflow-hidden transition-all duration-300 ${activeTerminalDevice ? 'pb-80' : ''}`}>
        {/* Left sidebar - Device palette */}
        <Sidebar />

        {/* Canvas area */}
        <main className="flex-1 relative overflow-hidden">
          <NetworkCanvas />
        </main>

        {/* Right sidebar - Properties panel */}
        <PropertiesPanel />
      </div>

      {/* Terminal (slides up from bottom) */}
      <Terminal />

      {/* Notifications */}
      <Notifications />
    </div>
  );
}
