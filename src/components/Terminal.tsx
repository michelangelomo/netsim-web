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
  } = useNetworkStore();

  const [isMaximized, setIsMaximized] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [isExecuting, setIsExecuting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Get active device
  const activeDevice = activeTerminalDevice
    ? devices.find((d) => d.id === activeTerminalDevice)
    : null;

  // Load history when device changes
  useEffect(() => {
    if (activeTerminalDevice) {
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

      if (activeDevice) {
        newLines.push({
          type: 'output',
          content: `Connected to ${activeDevice.name} (${activeDevice.hostname})`,
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

      setLines(newLines);
    }
  }, [activeTerminalDevice, activeDevice]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input when terminal opens
  useEffect(() => {
    if (activeTerminalDevice && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeTerminalDevice, isMinimized]);

  // Handle command execution
  const executeCommand = useCallback(async () => {
    const cmd = inputValue.trim();
    if (!cmd || isExecuting) return;

    // Add to command history
    setCommandHistory((prev) => [...prev.filter((c) => c !== cmd), cmd]);
    setHistoryIndex(-1);

    // Add input line
    setLines((prev) => [...prev, { type: 'input', content: cmd, timestamp: Date.now() }]);
    setInputValue('');
    setIsExecuting(true);

    // Execute command
    const result = await executeNetworkCommand(cmd, activeTerminalDevice, useNetworkStore.getState());

    // Handle special signals
    if (result.output === 'EXIT_TERMINAL') {
      setIsExecuting(false);
      setActiveTerminal(null);
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
  }, [inputValue, activeTerminalDevice, addTerminalHistory, clearTerminalHistory, setActiveTerminal, isExecuting]);

  // Handle key events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        executeCommand();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (commandHistory.length > 0) {
          const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
          setHistoryIndex(newIndex);
          setInputValue(commandHistory[commandHistory.length - 1 - newIndex] || '');
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          setInputValue(commandHistory[commandHistory.length - 1 - newIndex] || '');
        } else {
          setHistoryIndex(-1);
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
      }
    },
    [executeCommand, commandHistory, historyIndex, inputValue, activeDevice]
  );

  // Clear terminal
  const handleClear = useCallback(() => {
    setLines([]);
    if (activeTerminalDevice) {
      clearTerminalHistory(activeTerminalDevice);
    }
  }, [activeTerminalDevice, clearTerminalHistory]);

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
          {/* Terminal Header */}
          <div className="flex items-center justify-between px-4 h-12 border-b border-dark-700 bg-dark-800/50">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <TerminalIcon className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-medium text-white">
                  {activeDevice?.name || 'Terminal'}
                </span>
              </div>
              {activeDevice && (
                <span className="px-2 py-0.5 text-xs bg-dark-700 rounded text-dark-300">
                  {activeDevice.type.toUpperCase()}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={handleClear}
                className="p-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded transition-colors"
                title="Clear Terminal"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded transition-colors"
                title={isMinimized ? 'Expand' : 'Minimize'}
              >
                {isMinimized ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => setIsMaximized(!isMaximized)}
                className="p-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded transition-colors"
                title="Maximize"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActiveTerminal(null)}
                className="p-1.5 text-dark-400 hover:text-rose-400 hover:bg-dark-700 rounded transition-colors"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Terminal Body */}
          {!isMinimized && (
            <div className="flex flex-col h-[calc(100%-3rem)]">
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
