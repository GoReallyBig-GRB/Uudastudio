/**
 * Uuda Studio - Group channel strip for the Master Console
 * A group is a small channel of its own: pan, mute, fader and a live level meter. It stays in the console for as long as
 * the group exists and disappears with Ungroup. The meter reads the group's own output, so you can watch what the group
 * contributes to the mix while the tracks stay untouched.
 */

import React, { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../audio/engine';
import { DEFAULT_GROUP_SETTINGS } from '../audio/groupSettings';
import type { GroupSummary } from '../audio/groupInfo';
import type { GroupSettings } from '../types';
import { formatPan, formatVolumeDb } from '../utils/formatters';

interface GroupConsoleStripProps {
  group: GroupSummary;
  settings: GroupSettings | undefined;
  onUpdate: (patch: Partial<GroupSettings>) => void;
}

const LEDS = 14;

/** 0..1 position on a -48..0 dB scale for the meter */
const peakToLevel = (peak: number): number => {
  if (peak <= 0.00398) return 0; // below -48 dB
  return Math.min(1, Math.max(0, (20 * Math.log10(peak) + 48) / 48));
};

export const GroupConsoleStrip: React.FC<GroupConsoleStripProps> = ({ group, settings, onUpdate }) => {
  const s = { ...DEFAULT_GROUP_SETTINGS, ...(settings ?? {}) };
  const [level, setLevel] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 50) {
        last = now;
        const next = audioEngine.getIsPlaying() ? peakToLevel(audioEngine.getGroupMeter(group.id).peak) : 0;
        setLevel((prev) => (Math.abs(prev - next) < 0.01 ? prev : next));
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [group.id]);

  const lit = Math.round(level * LEDS);

  return (
    <div
      style={{ borderColor: group.color.border }}
      className="w-[68px] shrink-0 rounded-xl p-2.5 flex flex-col justify-between items-center text-center border bg-[#121218]"
    >
      <div className="w-full space-y-1">
        <div className="flex items-center justify-between text-[9px] font-mono">
          <span className="font-bold" style={{ color: group.color.border }}>GRP</span>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: group.color.border }} />
        </div>
        <div title={`${group.name}: ${group.clipCount} clips`} className="text-[10px] font-semibold truncate w-full text-zinc-200">
          {group.name}
        </div>
      </div>

      <div className="w-full py-1.5 border-y border-zinc-800/60 my-1">
        <div className="flex justify-between text-[8px] font-mono text-zinc-500 mb-0.5">
          <span>PAN</span>
          <span className="text-amber-400 font-bold">{formatPan(s.pan)}</span>
        </div>
        <input
          type="range" min="-1" max="1" step="0.05" value={s.pan}
          aria-label={`${group.name} pan`}
          onDoubleClick={() => onUpdate({ pan: 0 })}
          onChange={(e) => onUpdate({ pan: parseFloat(e.target.value) })}
          className="w-full h-1 bg-zinc-800 accent-amber-400 rounded-none cursor-pointer"
        />
      </div>

      <div className="w-full flex mb-2">
        <button
          type="button"
          aria-pressed={s.muted}
          onClick={() => onUpdate({ muted: !s.muted })}
          title={s.muted ? 'Unmute group' : 'Mute group'}
          className={`flex-1 py-1 rounded text-[9px] font-extrabold transition-all cursor-pointer ${
            s.muted ? 'bg-rose-500 text-white shadow-[0_0_8px_rgba(244,63,94,0.6)]' : 'bg-zinc-800/80 text-zinc-400 hover:text-white'
          }`}
        >
          M
        </button>
      </div>

      <div className="flex items-center justify-center gap-1.5 py-1 flex-1 h-[160px] relative w-full">
        <div className="h-full flex items-center justify-center relative w-6">
          <input
            type="range" min="0" max="1.5" step="0.01" value={s.muted ? 0 : s.volume}
            aria-label={`${group.name} volume`}
            onDoubleClick={() => onUpdate({ volume: 1 })}
            onChange={(e) => onUpdate({ volume: parseFloat(e.target.value), muted: false })}
            className="w-[140px] h-2 bg-zinc-900 border border-zinc-700 rounded-xs accent-cyan-400 cursor-pointer -rotate-90 origin-center"
          />
        </div>
        <div className="w-2 h-[140px] bg-black/90 rounded-xs border border-zinc-800 p-0.5 flex flex-col-reverse gap-0.5" aria-hidden>
          {Array.from({ length: LEDS }).map((_, i) => {
            const on = i < lit;
            const red = i >= 12;
            const yellow = i >= 9 && i < 12;
            return (
              <div
                key={i}
                className={`w-full h-1.5 rounded-2xs ${on ? (red ? 'bg-rose-500' : yellow ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-zinc-800/70'}`}
              />
            );
          })}
        </div>
      </div>

      <div className="text-[9px] font-mono text-zinc-400 mt-1">{s.muted ? 'MUTED' : formatVolumeDb(s.volume)}</div>
    </div>
  );
};
