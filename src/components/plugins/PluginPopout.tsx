/**
 * Uuda Studio - plugin pop-out window.
 * A compact, sharp modal for one plugin in the chain: preset menu, bypass, dry/wet and every control.
 * Same look as the Effects rack modal (solid surfaces, 1px borders, small radii, no blur).
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, Power, RotateCcw, Sparkles } from 'lucide-react';
import { PluginInstance } from '../../plugins/types';
import { pluginManager } from '../../plugins/pluginManager';
import { getPluginPresets } from '../../plugins/presets';
import { PluginPanel } from './PluginPanel';
import { PreviewButton } from './PreviewButton';
import { Project } from '../../types';

interface PluginPopoutProps {
  instance: PluginInstance;
  trackId: string;
  /** Name of the track (or "Master Bus") the plugin sits on */
  trackLabel: string;
  project: Project;
  onClose: () => void;
}

export const PluginPopout: React.FC<PluginPopoutProps> = ({ instance, trackId, trackLabel, project, onClose }) => {
  const descriptor = instance.descriptor;
  const isNative = descriptor.type === 'native';
  const [, setTick] = useState(0);
  // Changing this key remounts the panel so every slider re-reads the plugin after a reset
  const [resetKey, setResetKey] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => pluginManager.subscribe(() => setTick((t) => t + 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const bypassed = instance.isBypassed;

  const resetToDefault = () => {
    const def = getPluginPresets(descriptor)[0];
    for (const [key, value] of Object.entries(def.params)) {
      if (key === 'dryWet') pluginManager.setPluginDryWet(trackId, instance.instanceId, value);
      else pluginManager.setParameterDirect(trackId, instance.instanceId, key, value);
    }
    setResetKey((k) => k + 1);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3 select-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${descriptor.name} settings`}
        className="w-full max-w-xl max-h-[calc(100dvh-1.5rem)] flex flex-col bg-[#101016] border border-cyan-500/40 rounded-lg overflow-hidden text-zinc-200 outline-none"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="w-8 h-8 rounded-sm bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="text-sm font-black uppercase tracking-wide text-white truncate">{descriptor.name}</h2>
              <span className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded-sm bg-cyan-500/15 text-cyan-300 font-mono font-bold shrink-0">
                {isNative ? 'Native' : 'WAM 2.0'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 truncate">{trackLabel}</p>
          </div>
          <PreviewButton project={project} targetId={trackId} />
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="p-1.5 rounded-sm text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          <PluginPanel
            key={resetKey}
            instance={instance}
            trackId={trackId}
            showPresets
            showMix
            presetRowExtra={
              <button
                type="button"
                onClick={() => pluginManager.setPluginBypass(trackId, instance.instanceId, !bypassed)}
                aria-pressed={bypassed}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[11px] font-bold border cursor-pointer ${
                  bypassed
                    ? 'bg-zinc-800 text-zinc-300 border-zinc-600'
                    : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/50'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                {bypassed ? 'Bypassed' : 'Active'}
              </button>
            }
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-zinc-800 shrink-0">
          <button
            type="button"
            onClick={resetToDefault}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-1.5 rounded-sm bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
