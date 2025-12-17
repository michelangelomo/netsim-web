"use client";

import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal as TerminalIcon,
  X,
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

interface TabState {
  lines: TerminalLine[];
  commandHistory: string[];
  historyIndex: number;
}

const emptyTabState: TabState = { lines: [], commandHistory: [], historyIndex: -1 };

export function Terminal() {
  const {
    devices,
    activeTerminalDevice,
    setActiveTerminal,
    terminalMinimized,
    setTerminalMinimized,
    terminalTabs,
    activeTerminalTabIndex,
    setActiveTerminalTab,
    removeTerminalTab,
    addTerminalHistory,
    clearTerminalHistory,
  } = useNetworkStore();

  const [tabStates, setTabStates] = useState<Map<string, TabState>>(new Map());
  const [inputValue, setInputValue] = useState('');
  const [isExecuting, setIsExecuting] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const outputRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const activeTab = terminalTabs[activeTerminalTabIndex];
  const activeTabId = activeTab?.id;
  const activeDeviceId = activeTab?.deviceId ?? activeTerminalDevice;
  const activeDevice = devices.find((d) => d.id === activeDeviceId);
  const isMinimized = terminalMinimized;

  const getTabState = useCallback(
    (tabId: string | undefined | null): TabState => {
      if (!tabId) return emptyTabState;
      return tabStates.get(tabId) ?? emptyTabState;
    },
    [tabStates]
  );

  const updateTabState = useCallback((tabId: string, updates: Partial<TabState>) => {
    setTabStates((prev) => {
      const current = prev.get(tabId) ?? emptyTabState;
      const next = new Map(prev);
      next.set(tabId, { ...current, ...updates });
      return next;
    });
  }, []);

  const setLines = useCallback(
    (updater: TabState['lines'] | ((prev: TabState['lines']) => TabState['lines'])) => {
      if (!activeTabId) return;
      setTabStates((prev) => {
        const current = prev.get(activeTabId) ?? emptyTabState;
        const nextLines = typeof updater === 'function' ? updater(current.lines) : updater;
        const next = new Map(prev);
        next.set(activeTabId, { ...current, lines: nextLines });
        return next;
      });
    },
    [activeTabId]
  );

  const { lines, commandHistory, historyIndex } = getTabState(activeTabId);

  // Ensure new tabs start with an empty state
  useEffect(() => {
    terminalTabs.forEach((tab) => {
      setTabStates((prev) => {
        if (prev.has(tab.id)) return prev;
        const next = new Map(prev);
        next.set(tab.id, emptyTabState);
        return next;
      });
    });
  }, [terminalTabs]);

  // Focus input when terminal becomes active or changes tabs
  useEffect(() => {
    if (!isMinimized && activeTerminalDevice) {
      inputRef.current?.focus();
    }
  }, [isMinimized, activeTerminalDevice, activeTabId]);

  // Scroll to bottom on new output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  const executeCommand = useCallback(async () => {
    if (!activeTabId || !activeDeviceId) return;
    const cmd = inputValue.trim();
    if (!cmd || isExecuting) return;

    const currentState = getTabState(activeTabId);
    const newCommandHistory = [...currentState.commandHistory.filter((c) => c !== cmd), cmd];
    updateTabState(activeTabId, { commandHistory: newCommandHistory, historyIndex: -1 });

    setLines((prev) => [...prev, { type: 'input', content: cmd, timestamp: Date.now() }]);
    setInputValue('');
    setIsExecuting(true);

    const result = await executeNetworkCommand(cmd, activeDeviceId, useNetworkStore.getState());

    if (result.output === 'EXIT_TERMINAL') {
      setIsExecuting(false);
      removeTerminalTab(activeTabId);
      return;
    }

    if (result.output === 'CLEAR_TERMINAL') {
      setLines([]);
      clearTerminalHistory(activeDeviceId);
      setIsExecuting(false);
      return;
    }

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

    addTerminalHistory(activeDeviceId, cmd, result.output);
    setIsExecuting(false);
  }, [activeTabId, activeDeviceId, inputValue, isExecuting, getTabState, updateTabState, setLines, clearTerminalHistory, removeTerminalTab, addTerminalHistory]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
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
        const completions = getCompletions(inputValue, activeDevice?.type);

        if (completions.length === 1) {
          const parts = inputValue.trim().split(/\s+/);
          parts[parts.length - 1] = completions[0];
          setInputValue(parts.join(' ') + ' ');
        } else if (completions.length > 1) {
          setLines((prev) => [
            ...prev,
            { type: 'input', content: `${getPrompt()}${inputValue}`, timestamp: Date.now() },
            { type: 'output', content: completions.join('  '), timestamp: Date.now() },
          ]);

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
        e.preventDefault();
        if (activeTabId) {
          removeTerminalTab(activeTabId);
        }
      }
    },
    [executeCommand, commandHistory, historyIndex, inputValue, activeDevice, activeTabId, updateTabState, setLines, terminalTabs, setActiveTerminalTab, removeTerminalTab]
  );

  const handleClear = useCallback(() => {
    setLines([]);
    if (activeDeviceId) {
      clearTerminalHistory(activeDeviceId);
    }
  }, [activeDeviceId, clearTerminalHistory, setLines]);

  const getPrompt = () => {
    if (!activeDevice) return 'netsim$ ';
    if (activeDevice.type === 'router' || activeDevice.type === 'firewall') {
      return `${activeDevice.hostname}# `;
    }
    return `${activeDevice.hostname}$ `;
  };

  if (!activeTerminalDevice || !activeTab) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 100, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={`fixed bottom-0 left-0 right-0 z-50 ${isMaximized ? 'top-0' : ''}`}
      >
        <div
          className={`
            bg-dark-900/95 backdrop-blur-xl border-t border-dark-700
            shadow-2xl shadow-black/50
            ${isMaximized ? 'h-full' : isMinimized ? 'h-12' : 'h-80'}
            transition-all duration-300 ease-out
          `}
        >
          <div className="border-b border-dark-700 bg-dark-800/50">
            <div className="flex items-center justify-between gap-2 px-2 h-10">
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin flex-1">
                {terminalTabs.map((tab, index) => {
                  const tabDevice = devices.find((d) => d.id === tab.deviceId);
                  const isActive = index === activeTerminalTabIndex;
                  return (
                    <div
                      key={tab.id}
                      className={`
                        flex items-center gap-2 px-3 py-1.5 rounded text-sm cursor-pointer
                        transition-colors min-w-[120px] max-w-[220px] group
                        ${isActive
                          ? 'bg-dark-900 text-white border border-dark-600'
                          : 'bg-dark-700/50 text-dark-300 hover:bg-dark-700 hover:text-white'}
                      `}
                      onClick={() => {
                        if (isMinimized) {
                          setTerminalMinimized(false);
                        }
                        setActiveTerminalTab(index);
                      }}
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

              <div className="flex items-center gap-1">
                <button
                  onClick={handleClear}
                  className="p-1 text-dark-400 hover:text-white hover:bg-dark-700 rounded transition-colors"
                  title="Clear Terminal"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setTerminalMinimized(!isMinimized)}
                  className="p-1 text-dark-400 hover:text-white hover:bg-dark-700 rounded transition-colors"
                  title={isMinimized ? 'Expand' : 'Minimize'}
                >
                  {isMinimized ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
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

          {!isMinimized && (
            <div className="flex flex-col h-[calc(100%-2.5rem)]">
              <div
                ref={outputRef}
                className="flex-1 overflow-y-auto p-4 font-mono text-sm"
                onClick={() => inputRef.current?.focus()}
              >
                {lines.map((line, index) => (
                  <div
                    key={`${line.timestamp}-${index}`}
                    className={`
                      whitespace-pre-wrap break-all
                      ${line.type === 'input' ? 'text-emerald-400' : ''}
                      ${line.type === 'output' ? 'text-dark-200' : ''}
                      ${line.type === 'error' ? 'text-rose-400' : ''}
                      ${line.type === 'success' ? 'text-emerald-400' : ''}
                    `}
                  >
                    {line.type === 'input' && <span className="text-blue-400">{getPrompt()}</span>}
                    {line.content}
                  </div>
                ))}
              </div>

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
