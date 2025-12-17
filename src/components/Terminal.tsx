'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal as TerminalIcon,
  X,
  Minus,
  Maximize2,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react';
import { useNetworkStore } from '@/store/network-store';
import { executeNetworkCommand, getCompletions } from '@/lib/terminal-commands';

interface TerminalLine {
  type: 'input' | 'output' | 'error' | 'success';
  content: string;
  timestamp: number;
}

// Per-tab state for lines and command history
interface TabState {
  lines: TerminalLine[];
  commandHistory: string[];
  historyIndex: number;
}

export function Terminal() {
  const {
    activeTerminalDevice,
    setActiveTerminal,
    devices,
    terminalHistory,
    addTerminalHistory,
    clearTerminalHistory,
    terminalMinimized: isMinimized,
    setTerminalMinimized: setIsMinimized,
    terminalTabs,
    activeTerminalTabIndex,
    removeTerminalTab,
    setActiveTerminalTab,
  } = useNetworkStore();

  const [isMaximized, setIsMaximized] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);

  // Per-tab state stored by tab ID
  const [tabStates, setTabStates] = useState<Map<string, TabState>>(new Map());

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Get active tab
  const activeTab = terminalTabs[activeTerminalTabIndex];
  const activeTabId = activeTab?.id;

  // Get active device
  const activeDevice = activeTerminalDevice
    ? devices.find((d) => d.id === activeTerminalDevice)
    : null;

  // Get or create tab state
  const getTabState = useCallback((tabId: string): TabState => {
    return tabStates.get(tabId) || { lines: [], commandHistory: [], historyIndex: -1 };
  }, [tabStates]);

  const updateTabState = useCallback((tabId: string, updates: Partial<TabState>) => {
    setTabStates(prev => {
      const newMap = new Map(prev);
      const currentState = prev.get(tabId) || { lines: [], commandHistory: [], historyIndex: -1 };
      newMap.set(tabId, { ...currentState, ...updates });
      return newMap;
    });
  }, []);

  // Current tab state
  const currentTabState = activeTabId ? getTabState(activeTabId) : { lines: [], commandHistory: [], historyIndex: -1 };
  const { lines, commandHistory, historyIndex } = currentTabState;

  // Helper to update lines for current tab
  const setLines = useCallback((updater: TerminalLine[] | ((prev: TerminalLine[]) => TerminalLine[])) => {
    if (!activeTabId) return;
    setTabStates(prev => {
      const newMap = new Map(prev);
      const currentState = prev.get(activeTabId) || { lines: [], commandHistory: [], historyIndex: -1 };
      const newLines = typeof updater === 'function' ? updater(currentState.lines) : updater;
      newMap.set(activeTabId, { ...currentState, lines: newLines });
      return newMap;
    });
  }, [activeTabId]);

  // Initialize tab state when a new tab is created
  useEffect(() => {
    if (!activeTabId || !activeTerminalDevice) return;

    // Check if this tab already has state
    if (tabStates.has(activeTabId)) return;

    const history = terminalHistory.get(activeTerminalDevice) || [];
    const newLines: TerminalLine[] = [];

    // Add welcome message
    newLines.push({
      type: 'output',
      content: `
╔══════════════════════════════════════════════════════════════╗
║  NetSim Web Terminal v1.0                                    ║
║  Type 'help' for available commands                          ║
╚══════════════════════════════════════════════════════════════╝
`,
      timestamp: Date.now(),
    });

    const device = devices.find(d => d.id === activeTerminalDevice);
    if (device) {
      newLines.push({
        type: 'output',
        content: `Connected to ${device.name} (${device.hostname})`,
        timestamp: Date.now(),
      });
    }

    // Add previous history
    history.forEach((entry) => {
      newLines.push({
        type: 'input',
        content: entry.command,
        timestamp: entry.timestamp,
      });
      newLines.push({
        type: 'output',
        content: entry.output,
        timestamp: entry.timestamp,
      });
    });

    updateTabState(activeTabId, { lines: newLines });
  }, [activeTabId, activeTerminalDevice, devices, terminalHistory, tabStates, updateTabState]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input when terminal opens or tab changes
  useEffect(() => {
    if (activeTerminalDevice && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeTerminalDevice, isMinimized, activeTabId]);

  // Global keyboard listener for Alt+Number tab switching
  useEffect(() => {
    if (!activeTerminalDevice) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Alt+Number for tab switching (1-9)
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const tabIndex = parseInt(e.key, 10) - 1;
        if (tabIndex < terminalTabs.length) {
          setActiveTerminalTab(tabIndex);
          inputRef.current?.focus();
        }
      }
      // Alt+W to close current tab
      if (e.altKey && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) {
          removeTerminalTab(activeTabId);
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeTerminalDevice, terminalTabs.length, setActiveTerminalTab, activeTabId, removeTerminalTab]);

  // Handle command execution
  const executeCommand = useCallback(async () => {
    if (!activeTabId) return;
    const cmd = inputValue.trim();
    if (!cmd || isExecuting) return;

    // Add to command history for this tab
    const currentState = tabStates.get(activeTabId) || { lines: [], commandHistory: [], historyIndex: -1 };
    const newCommandHistory = [...currentState.commandHistory.filter((c) => c !== cmd), cmd];
    updateTabState(activeTabId, { commandHistory: newCommandHistory, historyIndex: -1 });

    // Add input line
    setLines((prev) => [...prev, { type: 'input', content: cmd, timestamp: Date.now() }]);
    setInputValue('');
    setIsExecuting(true);

    // Execute command
    const result = await executeNetworkCommand(cmd, activeTerminalDevice, useNetworkStore.getState());

    // Handle special signals
    if (result.output === 'EXIT_TERMINAL') {
      setIsExecuting(false);
      // Close current tab instead of all tabs
      if (activeTabId) {
        removeTerminalTab(activeTabId);
      }
      return;
    }

    if (result.output === 'CLEAR_TERMINAL') {
      setLines([]);
      if (activeTerminalDevice) {
        clearTerminalHistory(activeTerminalDevice);
      }
      setIsExecuting(false);
      return;
    }

    // Add output line (skip empty outputs)
    if (result.output) {
      setLines((prev) => [
        ...prev,
        {
          type: result.success ? 'output' : 'error',
          content: result.output,
          timestamp: Date.now(),
        },
      ]);
    }

    // Save to history
    if (activeTerminalDevice) {
      addTerminalHistory(activeTerminalDevice, cmd, result.output);
    }

    setIsExecuting(false);
  }, [inputValue, activeTerminalDevice, activeTabId, activeTerminalTabIndex, addTerminalHistory, clearTerminalHistory, removeTerminalTab, isExecuting, setLines, tabStates, updateTabState]);

  // Handle key events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Alt+Number for tab switching (1-9)
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const tabIndex = parseInt(e.key, 10) - 1;
        if (tabIndex < terminalTabs.length) {
          setActiveTerminalTab(tabIndex);
        }
        return;
      }

      if (e.key === 'Enter') {
        executeCommand();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commandHistory.length > 0 && activeTabId) {
          const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
          updateTabState(activeTabId, { historyIndex: newIndex });
          setInputValue(commandHistory[commandHistory.length - 1 - newIndex] || '');
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex > 0 && activeTabId) {
          const newIndex = historyIndex - 1;
          updateTabState(activeTabId, { historyIndex: newIndex });
          setInputValue(commandHistory[commandHistory.length - 1 - newIndex] || '');
        } else if (activeTabId) {
          updateTabState(activeTabId, { historyIndex: -1 });
          setInputValue('');
        }
      } else if (e.key === 'Tab') {
        e.preventDefault();
        // Tab completion
        const completions = getCompletions(inputValue, activeDevice?.type);

        if (completions.length === 1) {
          // Single match - complete it
          const parts = inputValue.trim().split(/\s+/);
          parts[parts.length - 1] = completions[0];
          setInputValue(parts.join(' ') + ' ');
        } else if (completions.length > 1) {
          // Multiple matches - show options
          setLines((prev) => [
            ...prev,
            { type: 'input', content: `${getPrompt()}${inputValue}`, timestamp: Date.now() },
            { type: 'output', content: completions.join('  '), timestamp: Date.now() },
          ]);

          // Find common prefix and complete to it
          const commonPrefix = completions.reduce((prefix, word) => {
            while (!word.startsWith(prefix)) {
              prefix = prefix.slice(0, -1);
            }
            return prefix;
          }, completions[0]);

          if (commonPrefix.length > 0) {
            const parts = inputValue.trim().split(/\s+/);
            if (commonPrefix.length > parts[parts.length - 1].length) {
              parts[parts.length - 1] = commonPrefix;
              setInputValue(parts.join(' '));
            }
          }
        }
      } else if (e.key === 'c' && e.ctrlKey) {
        setInputValue('');
        setLines((prev) => [...prev, { type: 'output', content: '^C', timestamp: Date.now() }]);
      } else if (e.key === 'l' && e.ctrlKey) {
        e.preventDefault();
        setLines([]);
      } else if (e.key === 'w' && e.ctrlKey) {
        // Ctrl+W: Close current tab
        e.preventDefault();
        if (activeTabId) {
          removeTerminalTab(activeTabId);
        }
      }
    },
    [executeCommand, commandHistory, historyIndex, inputValue, activeDevice, activeTabId, updateTabState, setLines, terminalTabs, setActiveTerminalTab, removeTerminalTab]
  );

  // Clear terminal
  const handleClear = useCallback(() => {
    setLines([]);
    if (activeTerminalDevice) {
      clearTerminalHistory(activeTerminalDevice);
    }
  }, [activeTerminalDevice, clearTerminalHistory, setLines]);

  // Get prompt based on device
  const getPrompt = () => {
    if (!activeDevice) return 'netsim$ ';
    const type = activeDevice.type;
    if (type === 'router' || type === 'firewall') {
      return `${activeDevice.hostname}# `;
    }
    return `${activeDevice.hostname}$ `;
  };

  if (!activeTerminalDevice) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={`
          fixed bottom-0 left-0 right-0 z-50
          ${isMaximized ? 'top-0' : ''}
        `}
      >
        <div
          className={`
            bg-dark-900/95 backdrop-blur-xl border-t border-dark-700
            shadow-2xl shadow-black/50
            ${isMaximized ? 'h-full' : isMinimized ? 'h-12' : 'h-80'}
            transition-all duration-300 ease-out
          `}
        >
          {/* Terminal Header with Tabs */}
          <div className="flex flex-col border-b border-dark-700 bg-dark-800/50">
            {/* Tabs Row - hidden when minimized */}
            {!isMinimized && (
              <div className="flex items-center h-10 px-2 gap-1 overflow-x-auto scrollbar-thin">
                {terminalTabs.map((tab, index) => {
                  const tabDevice = devices.find(d => d.id === tab.deviceId);
                  const isActive = index === activeTerminalTabIndex;
                  return (
                    <div
                      key={tab.id}
                      className={`
                        flex items-center gap-2 px-3 py-1.5 rounded-t text-sm cursor-pointer
                        transition-colors min-w-[100px] max-w-[180px] group
                        ${isActive
                          ? 'bg-dark-900 text-white border-t border-l border-r border-dark-600'
                          : 'bg-dark-700/50 text-dark-300 hover:bg-dark-700 hover:text-white'}
                      `}
                      onClick={() => setActiveTerminalTab(index)}
                      title={`${tabDevice?.name || 'Terminal'} (Alt+${index + 1})`}
                    >
                      <TerminalIcon className={`w-3 h-3 flex-shrink-0 ${isActive ? 'text-emerald-500' : 'text-dark-400'}`} />
                      <span className="truncate flex-1">{tab.name}</span>
                      {terminalTabs.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeTerminalTab(tab.id);
                          }}
                          className="p-0.5 opacity-0 group-hover:opacity-100 hover:bg-dark-600 rounded transition-opacity"
                          title="Close tab (Alt+W)"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Controls Row */}
            <div className="flex items-center justify-between px-4 h-10 bg-dark-900/50">
              <div className="flex items-center gap-2">
                <TerminalIcon className="w-4 h-4 text-emerald-500" />
                {activeDevice && (
                  <>
                    <span className="text-sm text-white font-medium">{activeDevice.name}</span>
                    <span className="px-2 py-0.5 text-xs bg-dark-700 rounded text-dark-300">
                      {activeDevice.type.toUpperCase()}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={handleClear}
                  className="p-1 text-dark-400 hover:text-white hover:bg-dark-700 rounded transition-colors"
                  title="Clear Terminal"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setIsMinimized(!isMinimized)}
                  className="p-1 text-dark-400 hover:text-white hover:bg-dark-700 rounded transition-colors"
                  title={isMinimized ? 'Expand' : 'Minimize'}
                >
                  {isMinimized ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  onClick={() => setIsMaximized(!isMaximized)}
                  className="p-1 text-dark-400 hover:text-white hover:bg-dark-700 rounded transition-colors"
                  title="Maximize"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setActiveTerminal(null)}
                  className="p-1 text-dark-400 hover:text-rose-400 hover:bg-dark-700 rounded transition-colors"
                  title="Close Terminal"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Terminal Body */}
          {!isMinimized && (
            <div className="flex flex-col h-[calc(100%-4.5rem)]">
              {/* Output area */}
              <div
                ref={outputRef}
                className="flex-1 overflow-y-auto p-4 font-mono text-sm"
                onClick={() => inputRef.current?.focus()}
              >
                {lines.map((line, index) => (
                  <div
                    key={index}
                    className={`
                      whitespace-pre-wrap break-all
                      ${line.type === 'input' ? 'text-emerald-400' : ''}
                      ${line.type === 'output' ? 'text-dark-200' : ''}
                      ${line.type === 'error' ? 'text-rose-400' : ''}
                      ${line.type === 'success' ? 'text-emerald-400' : ''}
                    `}
                  >
                    {line.type === 'input' && (
                      <span className="text-blue-400">{getPrompt()}</span>
                    )}
                    {line.content}
                  </div>
                ))}
              </div>

              {/* Input area */}
              <div className="flex items-center px-4 py-2 border-t border-dark-800 bg-dark-900">
                <span className="text-blue-400 font-mono text-sm">{getPrompt()}</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="flex-1 bg-transparent border-none outline-none text-white font-mono text-sm ml-1"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={isExecuting}
                  placeholder={isExecuting ? 'Executing...' : ''}
                />
                {isExecuting ? (
                  <span className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin ml-1" />
                ) : (
                  <span className="w-2 h-4 bg-emerald-500 animate-pulse ml-1" />
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
