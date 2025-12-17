'use client';

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  FilePlus,
  Save,
  FolderOpen,
  Play,
  Square,
  Download,
  Upload,
  BookOpen,
  Keyboard,
  ChevronDown,
} from 'lucide-react';
import { useNetworkStore } from '@/store/network-store';

export function Header() {
  const {
    simulation,
    startSimulation,
    stopSimulation,
    clearProject,
    exportProject,
    loadProject,
    addNotification,
    tutorial,
    tutorials,
    startTutorial,
    endTutorial,
    dismissTutorials,
  } = useNetworkStore();

  const [showHelp, setShowHelp] = useState(false);
  const [showTutorialMenu, setShowTutorialMenu] = useState(false);

  const handleNew = useCallback(() => {
    if (confirm('Create a new project? All unsaved changes will be lost.')) {
      clearProject();
      addNotification({
        type: 'info',
        title: 'New Project',
        message: 'Created a new empty project',
      });
    }
  }, [clearProject, addNotification]);

  const handleSave = useCallback(() => {
    const data = exportProject();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'network-topology.json';
    a.click();
    URL.revokeObjectURL(url);

    addNotification({
      type: 'success',
      title: 'Project Saved',
      message: 'Network topology exported successfully',
    });
  }, [exportProject, addNotification]);

  const handleLoad = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          loadProject(data);
          addNotification({
            type: 'success',
            title: 'Project Loaded',
            message: `Loaded ${data.devices?.length || 0} devices`,
          });
        } catch (err) {
          addNotification({
            type: 'error',
            title: 'Load Failed',
            message: 'Invalid project file',
          });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [loadProject, addNotification]);

  return (
    <>
      <header className="h-14 bg-dark-900 border-b border-dark-700 flex items-center justify-between px-4">
        {/* Left - File actions */}
        <div className="flex items-center gap-1">
          <HeaderButton icon={FilePlus} tooltip="New Project" onClick={handleNew} />
          <HeaderButton icon={Save} tooltip="Save Project" onClick={handleSave} />
          <HeaderButton icon={FolderOpen} tooltip="Load Project" onClick={handleLoad} />

          <div className="w-px h-6 bg-dark-700 mx-2" />

          {/* Simulation controls */}
          {!simulation.isRunning ? (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={startSimulation}
              className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white text-sm font-medium rounded-lg shadow-lg shadow-emerald-500/20 transition-all"
            >
              <Play className="w-4 h-4" />
              Simulate
            </motion.button>
          ) : (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={stopSimulation}
              className="flex items-center gap-2 px-4 py-1.5 bg-gradient-to-r from-rose-500 to-rose-600 hover:from-rose-400 hover:to-rose-500 text-white text-sm font-medium rounded-lg shadow-lg shadow-rose-500/20 transition-all"
            >
              <Square className="w-4 h-4" />
              Stop
            </motion.button>
          )}
        </div>

        {/* Center - Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-dark-800 rounded-lg">
            <div
              className={`w-2 h-2 rounded-full ${simulation.isRunning
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-dark-500'
                }`}
              style={{
                boxShadow: simulation.isRunning
                  ? '0 0 10px rgba(16, 185, 129, 0.5)'
                  : 'none',
              }}
            />
            <span className={`text-sm ${simulation.isRunning ? 'text-emerald-400' : 'text-dark-400'}`}>
              {simulation.isRunning ? 'Simulation Running' : 'Ready'}
            </span>
          </div>
        </div>

        {/* Right - Help */}
        <div className="flex items-center gap-1">
          <div className="relative">
            <button
              onClick={() => setShowTutorialMenu((v) => !v)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-dark-700 text-sm transition-colors ${tutorial.activeId ? 'text-blue-200 border-blue-600/60 bg-blue-600/10' : 'text-dark-200 hover:text-white hover:border-dark-500'}`}
            >
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Tutorials</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            {showTutorialMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-dark-900 border border-dark-700 rounded-lg shadow-2xl z-50 overflow-hidden">
                <div className="py-2">
                  <div className="px-3 pb-2 text-[11px] uppercase tracking-wide text-dark-500">Guided tutorials</div>
                  {tutorials.map((tut) => {
                    const isActive = tutorial.activeId === tut.id;
                    return (
                      <button
                        key={tut.id}
                        onClick={() => {
                          startTutorial(tut.id);
                          setShowTutorialMenu(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${isActive ? 'bg-blue-600/15 text-white' : 'text-dark-100 hover:bg-dark-800'}`}
                      >
                        <div className="font-semibold leading-tight flex items-center gap-2">
                          {tut.title}
                          {isActive && <span className="text-[11px] text-blue-300">active</span>}
                        </div>
                        <div className="text-[12px] text-dark-400 leading-tight line-clamp-2">{tut.summary}</div>
                      </button>
                    );
                  })}
                  <div className="border-t border-dark-800 mt-1 pt-1 space-y-1">
                    <button
                      onClick={() => {
                        endTutorial();
                        setShowTutorialMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-dark-200 hover:bg-dark-800"
                    >
                      End tutorial
                    </button>
                    <button
                      onClick={() => {
                        dismissTutorials();
                        setShowTutorialMenu(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm text-dark-200 hover:bg-dark-800"
                    >
                      Dismiss tutorials
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          <HeaderButton
            icon={Keyboard}
            tooltip="Keyboard Shortcuts"
            onClick={() => setShowHelp(true)}
          />
        </div>
      </header>

      {/* Help Modal */}
      {showHelp && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
          onClick={() => setShowHelp(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-dark-800 border border-dark-600 rounded-2xl shadow-2xl max-w-lg w-full mx-4 overflow-hidden"
          >
            <div className="p-6 border-b border-dark-700">
              <h2 className="text-xl font-bold text-white">Keyboard Shortcuts</h2>
            </div>
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              <ShortcutGroup title="Tools">
                <Shortcut keys={['V']} description="Select tool" />
                <Shortcut keys={['C']} description="Connect tool" />
                <Shortcut keys={['D']} description="Delete tool" />
              </ShortcutGroup>
              <ShortcutGroup title="View">
                <Shortcut keys={['+']} description="Zoom in" />
                <Shortcut keys={['-']} description="Zoom out" />
                <Shortcut keys={['F']} description="Fit view" />
              </ShortcutGroup>
              <ShortcutGroup title="Actions">
                <Shortcut keys={['Delete']} description="Delete selected" />
                <Shortcut keys={['Ctrl', 'S']} description="Save project" />
                <Shortcut keys={['Ctrl', 'O']} description="Load project" />
              </ShortcutGroup>
              <ShortcutGroup title="Terminal">
                <Shortcut keys={['Enter']} description="Execute command" />
                <Shortcut keys={['↑', '↓']} description="Command history" />
                <Shortcut keys={['Ctrl', 'L']} description="Clear terminal" />
                <Shortcut keys={['Ctrl', 'C']} description="Cancel command" />
              </ShortcutGroup>
            </div>
            <div className="p-4 border-t border-dark-700 flex justify-end">
              <button
                onClick={() => setShowHelp(false)}
                className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}

function HeaderButton({
  icon: Icon,
  tooltip,
  onClick,
}: {
  icon: typeof FilePlus;
  tooltip: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="relative p-2 text-dark-400 hover:text-white hover:bg-dark-800 rounded-lg transition-colors group"
      title={tooltip}
    >
      <Icon className="w-5 h-5" />
      <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-dark-700 text-xs text-white rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
        {tooltip}
      </span>
    </button>
  );
}

function ShortcutGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-dark-400 mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Shortcut({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-dark-200">{description}</span>
      <div className="flex items-center gap-1">
        {keys.map((key, index) => (
          <span key={index}>
            <kbd className="px-2 py-1 text-xs font-mono bg-dark-700 border border-dark-600 rounded text-dark-300">
              {key}
            </kbd>
            {index < keys.length - 1 && <span className="text-dark-500 mx-1">+</span>}
          </span>
        ))}
      </div>
    </div>
  );
}
