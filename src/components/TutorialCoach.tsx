'use client';

import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, ChevronLeft, ChevronRight, Flag, Target, X, RotateCcw } from 'lucide-react';
import type { TutorialTarget } from '@/types/network';
import { useNetworkStore } from '@/store/network-store';

export function TutorialCoach() {
    const {
        tutorials,
        tutorial,
        startTutorial,
        nextTutorialStep,
        prevTutorialStep,
        endTutorial,
        dismissTutorials,
        activeTerminalDevice,
        terminalMinimized,
    } = useNetworkStore();

    const activeDefinition = tutorials.find((t) => t.id === tutorial.activeId);
    const activeStep = activeDefinition?.steps[tutorial.activeStepIndex];
    const progress = activeDefinition ? (tutorial.activeStepIndex + 1) / activeDefinition.steps.length : 0;
    const hasTutorials = tutorials.length > 0;
    const coachBottom = activeTerminalDevice && !terminalMinimized ? '22rem' : '1rem';

    const getPosition = (target: TutorialTarget | undefined): { style: CSSProperties } => {
        const base: CSSProperties = { left: '50%', top: '5rem', transform: 'translateX(-50%)' };
        const positions: Record<TutorialTarget, CSSProperties> = {
            sidebar: { left: '1rem', top: '5rem' },
            canvas: { left: '50%', top: '5rem', transform: 'translateX(-50%)' },
            properties: { right: '1rem', top: '5rem' },
            terminal: { right: '1rem', top: '5rem' },
            'event-feed': { left: '1rem', top: '5rem' },
            header: { left: '50%', transform: 'translateX(-50%)', top: '4.5rem' },
        };

        if (target && positions[target]) return { style: positions[target] };
        return { style: base };
    };

    const { style: coachStyle } = getPosition(activeStep?.target);

    if (!hasTutorials) return null;

    const handleStart = (id: string) => {
        startTutorial(id);
    };

    return (
        <div className="fixed z-40 space-y-3" style={coachStyle}>
            {!activeDefinition && !tutorial.dismissed && (
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="w-80 bg-dark-900 border border-dark-700 rounded-xl shadow-2xl overflow-hidden"
                >
                    <div className="px-4 py-3 border-b border-dark-800 flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-blue-300" />
                        <div>
                            <p className="text-xs uppercase text-dark-400">Guided walkthroughs</p>
                            <p className="text-sm text-white font-semibold">Pick a tutorial to begin</p>
                        </div>
                    </div>
                    <div className="p-4 space-y-3">
                        {tutorials.map((tut) => (
                            <div key={tut.id} className="bg-dark-800 border border-dark-700 rounded-lg p-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-semibold text-white">{tut.title}</p>
                                        <p className="text-xs text-dark-300">{tut.summary}</p>
                                    </div>
                                    <button
                                        onClick={() => handleStart(tut.id)}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors"
                                    >
                                        Start
                                    </button>
                                </div>
                            </div>
                        ))}
                        <button
                            onClick={dismissTutorials}
                            className="text-xs text-dark-400 hover:text-white transition-colors"
                        >
                            Dismiss tutorials
                        </button>
                    </div>
                </motion.div>
            )}

            {activeDefinition && activeStep && (
                <motion.div
                    key={activeStep.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                    className="w-96 max-w-[90vw] max-h-[70vh] overflow-y-auto bg-dark-900 border border-dark-700 rounded-2xl shadow-2xl"
                >
                    <div className="px-4 py-3 border-b border-dark-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4 text-blue-300" />
                            <div>
                                <p className="text-[11px] uppercase text-dark-400">{activeDefinition.title}</p>
                                <p className="text-sm text-white font-semibold">Step {tutorial.activeStepIndex + 1} of {activeDefinition.steps.length}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={endTutorial}
                                className="text-xs text-dark-400 hover:text-white transition-colors"
                            >
                                End
                            </button>
                            <button
                                onClick={dismissTutorials}
                                className="p-2 hover:bg-dark-800 rounded-lg text-dark-400 hover:text-white transition-colors"
                                title="Dismiss tutorials"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div className="p-4 space-y-3">
                        <div>
                            <p className="text-sm font-semibold text-white">{activeStep.title}</p>
                            <p className="text-sm text-dark-100 leading-relaxed">{activeStep.body}</p>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-dark-300">
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-dark-800 border border-dark-700 rounded-full">
                                <Target className="w-3 h-3" />
                                {activeStep.target}
                            </span>
                            {activeStep.completeOnEventType && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-dark-800 border border-dark-700 rounded-full">
                                    <Flag className="w-3 h-3" />
                                    waits for {activeStep.completeOnEventType}
                                </span>
                            )}
                        </div>

                        <div className="h-1.5 bg-dark-800 rounded-full overflow-hidden border border-dark-700/70">
                            <div
                                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400"
                                style={{ width: `${progress * 100}%` }}
                            />
                        </div>
                    </div>

                    <div className="px-4 py-3 border-t border-dark-800 flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={prevTutorialStep}
                                disabled={tutorial.activeStepIndex === 0}
                                className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-dark-700 text-dark-200 hover:text-white hover:border-dark-500 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <ChevronLeft className="w-4 h-4" />
                                Back
                            </button>
                            <button
                                onClick={nextTutorialStep}
                                className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
                            >
                                {tutorial.activeStepIndex === activeDefinition.steps.length - 1 ? 'Finish' : 'Next'}
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => startTutorial(activeDefinition.id)}
                                className="flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-dark-700 text-dark-200 hover:text-white hover:border-dark-500"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Restart
                            </button>
                            <button
                                onClick={endTutorial}
                                className="text-xs text-dark-400 hover:text-white transition-colors"
                            >
                                Skip tutorial
                            </button>
                        </div>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
