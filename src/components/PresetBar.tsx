import React, { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { cn } from './ui';

interface PresetBarProps {
  presets: { name: string; hint?: string }[];
  /** Index of the factory preset the current settings match, or -1 */
  activeIndex: number;
  onPick: (index: number) => void;
  custom: { name: string }[];
  /** Index of the custom preset the current settings match, or -1 */
  activeCustomIndex: number;
  onPickCustom: (index: number) => void;
  onRemoveCustom: (name: string) => void;
  /** Save the current settings under this name */
  onSave: (name: string) => void;
}

const pill = (on: boolean) =>
  cn(
    'inline-flex h-7 items-center rounded-full border px-3 text-[11px] cursor-pointer transition-colors',
    on ? 'border-accent bg-accent-soft text-accent' : 'border-line-strong bg-surface-2 text-ink-dim hover:text-ink hover:bg-surface-3',
  );

/** Preset pills (factory, then the user's own), a "Custom" marker when nothing matches, and a small save box. */
export const PresetBar: React.FC<PresetBarProps> = ({ presets, activeIndex, onPick, custom, activeCustomIndex, onPickCustom, onRemoveCustom, onSave }) => {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const nothingMatches = activeIndex < 0 && activeCustomIndex < 0;
  const commit = () => {
    if (name.trim()) onSave(name);
    setName('');
    setNaming(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {presets.map((p, i) => (
        <button key={p.name} type="button" title={p.hint} onClick={() => onPick(i)} className={pill(i === activeIndex)}>{p.name}</button>
      ))}
      {custom.map((p, i) => (
        <span key={p.name} className={cn(pill(i === activeCustomIndex), 'gap-1.5 pr-1.5')}>
          <button type="button" onClick={() => onPickCustom(i)} className="cursor-pointer">{p.name}</button>
          <button type="button" aria-label={`Delete preset ${p.name}`} onClick={() => onRemoveCustom(p.name)} className="rounded-full p-0.5 hover:bg-surface-3 cursor-pointer"><X className="h-3 w-3" /></button>
        </span>
      ))}
      {nothingMatches && <span className="inline-flex h-7 items-center rounded-full border border-dashed border-line-strong px-3 text-[11px] text-ink-faint">Custom</span>}
      {naming ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={name}
            maxLength={40}
            placeholder="Preset name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setNaming(false); setName(''); } }}
            className="h-7 w-32 rounded-full border border-line-strong bg-surface-1 px-3 text-[11px] text-ink outline-none focus:border-accent"
          />
          <button type="button" aria-label="Save preset" onClick={commit} className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-ok hover:bg-surface-3 cursor-pointer"><Check className="h-3.5 w-3.5" /></button>
        </span>
      ) : (
        <button type="button" onClick={() => setNaming(true)} className={cn(pill(false), 'gap-1')}><Plus className="h-3 w-3" />Save as preset</button>
      )}
    </div>
  );
};
