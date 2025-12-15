import { useState, useMemo } from 'react';
import { NetworkDevice, NetworkInterface } from '@/types/network';
import { X, Cable } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface InterfaceSelectionModalProps {
    sourceDevice: NetworkDevice;
    targetDevice: NetworkDevice;
    onConnect: (sourceInterfaceId: string, targetInterfaceId: string) => void;
    onClose: () => void;
}

export function InterfaceSelectionModal({
    sourceDevice,
    targetDevice,
    onConnect,
    onClose,
}: InterfaceSelectionModalProps) {
    const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
    const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

    const availableSourceInterfaces = useMemo(() =>
        sourceDevice.interfaces.filter(i => !i.connectedTo),
        [sourceDevice]);

    const availableTargetInterfaces = useMemo(() =>
        targetDevice.interfaces.filter(i => !i.connectedTo),
        [targetDevice]);

    const handleConnect = () => {
        if (selectedSourceId && selectedTargetId) {
            onConnect(selectedSourceId, selectedTargetId);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-2xl bg-dark-900 border border-dark-700 rounded-xl shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-dark-700 bg-dark-800/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/20 rounded-lg">
                            <Cable className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-white">Connect Devices</h2>
                            <p className="text-sm text-dark-400">Select interfaces to create a link</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 grid grid-cols-2 gap-8">
                    {/* Source Device */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 pb-2 border-b border-dark-700">
                            <div className="w-2 h-2 rounded-full bg-emerald-500" />
                            <span className="font-medium text-white">{sourceDevice.name}</span>
                            <span className="text-xs text-dark-400 uppercase ml-auto">{sourceDevice.type}</span>
                        </div>

                        <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                            {availableSourceInterfaces.length === 0 ? (
                                <div className="text-center py-8 text-dark-500 italic">
                                    No available interfaces
                                </div>
                            ) : (
                                availableSourceInterfaces.map((iface) => (
                                    <InterfaceOption
                                        key={iface.id}
                                        iface={iface}
                                        selected={selectedSourceId === iface.id}
                                        onClick={() => setSelectedSourceId(iface.id)}
                                    />
                                ))
                            )}
                        </div>
                    </div>

                    {/* Target Device */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 pb-2 border-b border-dark-700">
                            <div className="w-2 h-2 rounded-full bg-blue-500" />
                            <span className="font-medium text-white">{targetDevice.name}</span>
                            <span className="text-xs text-dark-400 uppercase ml-auto">{targetDevice.type}</span>
                        </div>

                        <div className="space-y-2 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                            {availableTargetInterfaces.length === 0 ? (
                                <div className="text-center py-8 text-dark-500 italic">
                                    No available interfaces
                                </div>
                            ) : (
                                availableTargetInterfaces.map((iface) => (
                                    <InterfaceOption
                                        key={iface.id}
                                        iface={iface}
                                        selected={selectedTargetId === iface.id}
                                        onClick={() => setSelectedTargetId(iface.id)}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-dark-700 bg-dark-800/30">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-dark-300 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConnect}
                        disabled={!selectedSourceId || !selectedTargetId}
                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors shadow-lg shadow-blue-500/20"
                    >
                        Connect Interfaces
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

function InterfaceOption({
    iface,
    selected,
    onClick
}: {
    iface: NetworkInterface;
    selected: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            className={`
        w-full flex items-center justify-between p-3 rounded-lg border transition-all duration-200
        ${selected
                    ? 'bg-blue-500/10 border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.1)]'
                    : 'bg-dark-800 border-dark-700 hover:border-dark-600 hover:bg-dark-750'
                }
      `}
        >
            <div className="flex flex-col items-start">
                <span className={`text-sm font-medium ${selected ? 'text-blue-400' : 'text-dark-200'}`}>
                    {iface.name}
                </span>
                <span className="text-xs text-dark-500 font-mono">
                    {iface.macAddress}
                </span>
            </div>
            {iface.ipAddress && (
                <span className="text-xs px-2 py-1 rounded bg-dark-900 text-dark-400 font-mono border border-dark-700">
                    {iface.ipAddress}
                </span>
            )}
        </button>
    );
}
