/**
 * Uuda Studio - plugin pop-out window.
 * A compact dialog for one plugin in the chain: preset menu, bypass, dry/wet and every control.
 * On the app's shared dialog frame, like the rack it opens from.
 */

import React, { useState } from 'react';
import { Power, RotateCcw } from 'lucide-react';
import { PluginInstance } from '../../plugins/types';
import { pluginManager } from '../../plugins/pluginManager';
import { getPluginPresets } from '../../plugins/presets';
import { PluginPanel } from './PluginPanel';
import { PreviewButton } from './PreviewButton';
import { Project } from '../../types';
import { Button, ModalShell, cn } from '../ui';

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

  React.useEffect(() => pluginManager.subscribe(() => setTick((t) => t + 1)), []);

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
    <ModalShell
      open
      onClose={onClose}
      title={descriptor.name}
      description={`${trackLabel} · ${isNative ? 'Native' : 'WAM 2.0'}`}
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={resetToDefault} leftIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}>
              Reset
            </Button>
            <PreviewButton project={project} targetId={trackId} above />
          </div>
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
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
            aria-pressed={!bypassed}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              bypassed ? 'border-line-strong bg-surface-3 text-ink-dim hover:text-ink' : 'border-accent/40 bg-accent-soft text-accent',
            )}
          >
            <Power className="h-3.5 w-3.5" aria-hidden="true" />
            {bypassed ? 'Bypassed' : 'Active'}
          </button>
        }
      />
    </ModalShell>
  );
};
