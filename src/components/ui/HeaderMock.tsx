/**
 * Static mock of the app header and toolbar, built from the design-system pieces, for the gallery.
 * Nothing here is wired to the real app; it exists so the capsule layout can be judged before the shell is rebuilt.
 */
import React, { useState } from 'react';
import {
  ChevronDown, ClipboardPaste, Copy, Download, FolderOpen, Gauge, Mic, Music, Play, Pause, Scissors,
  ScissorsLineDashed, Settings, SkipBack, Sliders, Sparkles, Square, Volume2, Wand2,
} from 'lucide-react';
import { Button } from './Button';
import { Capsule, CapsuleButton, type CapsuleVariant } from './Capsule';

const I = 'h-3.5 w-3.5';

export const HeaderMock: React.FC<{ variant: CapsuleVariant }> = ({ variant }) => {
  const [playing, setPlaying] = useState(false);
  const [tool, setTool] = useState<'select' | 'range'>('range');

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-surface-0">
      <div className="min-w-[1180px]">
        {/* Row 1: brand, project, transport, main actions */}
        <div className="flex h-14 items-center gap-3 border-b border-line px-4">
          {/* Brand: gold is the one brand moment in the header. The "U" tile is a placeholder for the real logo. */}
          <div className="flex items-center gap-2.5 pr-1">
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-control bg-gold-soft text-sm font-bold text-gold">U</span>
            <span className="text-sm font-bold tracking-tight text-ink">UUDA <span className="font-semibold text-gold">STUDIO</span></span>
          </div>

          <Capsule label="Project" variant={variant}>
            <CapsuleButton title="File menu" icon={<FolderOpen className={I} />}>File<ChevronDown className="h-3 w-3 text-ink-faint" /></CapsuleButton>
          </Capsule>
          <span className="truncate text-sm font-medium text-ink">Broadcast Spot Session 1</span>
          <Capsule label="Edit and effects" variant={variant}>
            <CapsuleButton title="Edit menu">Edit<ChevronDown className="h-3 w-3 text-ink-faint" /></CapsuleButton>
            <CapsuleButton title="Effects menu" icon={<Sparkles className={I} />}>Effects<ChevronDown className="h-3 w-3 text-ink-faint" /></CapsuleButton>
          </Capsule>

          <div className="flex-1" />

          {/* Transport: one capsule */}
          <Capsule label="Transport" variant={variant}>
            <CapsuleButton title="Back to start" iconOnly icon={<SkipBack className={I} />} />
            <CapsuleButton title={playing ? 'Pause' : 'Play'} iconOnly active={playing} onClick={() => setPlaying((p) => !p)} icon={playing ? <Pause className={I} /> : <Play className={I} />} />
            <CapsuleButton title="Stop" iconOnly onClick={() => setPlaying(false)} icon={<Square className={I} />} />
          </Capsule>
          <Capsule label="Record" variant={variant}>
            <CapsuleButton title="Record" icon={<span aria-hidden="true" className="h-2 w-2 rounded-full bg-danger" />}>Record</CapsuleButton>
          </Capsule>

          <div className="flex-1" />

          {/* Unrelated actions stay separate pills; only Export carries colour (gold) */}
          <Capsule label="Voiceover" variant={variant}><CapsuleButton title="Voiceover" icon={<Mic className={I} />}>Voiceover</CapsuleButton></Capsule>
          <Capsule label="Sound Library" variant={variant}><CapsuleButton title="Sound Library" icon={<Music className={I} />}>Sound Library</CapsuleButton></Capsule>
          <Capsule label="Plugins" variant={variant}><CapsuleButton title="Plugins" icon={<Sparkles className={I} />}>Plugins</CapsuleButton></Capsule>
          <Button variant="brand" size="sm" leftIcon={<Download className={I} />}>Export</Button>
          <Capsule label="Settings" variant={variant}><CapsuleButton title="Settings" iconOnly icon={<Settings className={I} />} /></Capsule>
        </div>

        {/* Row 2: editing toolbar, grouped by relation */}
        <div className="flex h-12 items-center gap-3 px-4">
          <span className="text-[11px] text-ink-faint">Editing panel: <span className="italic">select a clip to edit</span></span>

          <Capsule label="Timeline tool" variant={variant}>
            <CapsuleButton title="Select tool" active={tool === 'select'} onClick={() => setTool('select')}>Select</CapsuleButton>
            <CapsuleButton title="Range tool" active={tool === 'range'} onClick={() => setTool('range')}>Range</CapsuleButton>
          </Capsule>

          <Capsule label="Clip edit" variant={variant}>
            <CapsuleButton title="Split at playhead" icon={<Scissors className={I} />}>Split</CapsuleButton>
            <CapsuleButton title="Cut" icon={<ScissorsLineDashed className={I} />}>Cut</CapsuleButton>
            <CapsuleButton title="Copy" icon={<Copy className={I} />}>Copy</CapsuleButton>
            <CapsuleButton title="Paste" icon={<ClipboardPaste className={I} />}>Paste</CapsuleButton>
          </Capsule>

          <Capsule label="Processing" variant={variant}>
            <CapsuleButton title="Amplify" icon={<Volume2 className={I} />}>Amplify</CapsuleButton>
            <CapsuleButton title="Compress" icon={<Sliders className={I} />}>Compress</CapsuleButton>
            <CapsuleButton title="Denoise" icon={<Wand2 className={I} />}>Denoise</CapsuleButton>
            <CapsuleButton title="Pitch" icon={<Music className={I} />}>Pitch</CapsuleButton>
            <CapsuleButton title="Speed" icon={<Gauge className={I} />}>Speed</CapsuleButton>
          </Capsule>

          <Capsule label="Effects rack" variant={variant}>
            <CapsuleButton title="Effects rack" active icon={<Sparkles className={I} />}>Effects Rack</CapsuleButton>
          </Capsule>

          <div className="flex-1" />
          <Capsule label="Panel layout" variant={variant}>
            <CapsuleButton title="Editing and mixing panel only" icon={<Sliders className={I} />}>Editing &amp; Mixing Panel Only</CapsuleButton>
          </Capsule>
        </div>
      </div>
    </div>
  );
};
