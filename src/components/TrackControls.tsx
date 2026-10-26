/**
 * Uuda Pro - Track Row Controls (Adobe Audition Inspired Style)
 * Width reduced by 20% (from 340px to 272px).
 * Clean, decluttered track header with distinct Mute/Solo buttons,
 * tame color-coded Vol & Pan sliders with dB readouts and double-click resets,
 * and high-precision slim peak/RMS meter.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX, Trash2, ChevronUp, ChevronDown, Sparkles } from 'lucide-react';
import { Track } from '../types';
import { audioEngine } from '../audio/engine';
import { pluginManager } from '../plugins/pluginManager';
import { formatVolumeDb, formatPan } from '../utils/formatters';
import { getTrackLabel, renameUpdate } from '../utils/tracks';

interface TrackControlsProps {
  track: Track;
  index: number;
  totalTracks: number;
  isSelected: boolean;
  onSelectTrack: (trackId: string) => void;
  onUpdateTrack: (trackId: string, updates: Partial<Track>) => void;
  onDeleteTrack: (trackId: string) => void;
  onMoveTrack: (trackId: string, direction: 'up' | 'down') => void;
  isCollapsed?: boolean;
}

export const TrackControls: React.FC<TrackControlsProps> = ({
  track,
  index,
  totalTracks,
  isSelected,
  onSelectTrack,
  onUpdateTrack,
  onDeleteTrack,
  onMoveTrack,
  isCollapsed = false,
}) => {
  const label = getTrackLabel(track, index);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(label);
  const meterCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Live count of active plugins on this track
  const [pluginCount, setPluginCount] = useState<number>(() => {
    return pluginManager.getPluginsForTrack(track.id).length;
  });

  useEffect(() => {
    const update = () => {
      setPluginCount(pluginManager.getPluginsForTrack(track.id).length);
    };
    update();
    const unsub = pluginManager.subscribe(update);
    return unsub;
  }, [track.id]);

  // Keep the input in step when the label changes (undo/redo, or the track moved and "Track N" renumbered)
  useEffect(() => {
    setNameValue(label);
  }, [label]);

  // Live VU meter drawing loop
  useEffect(() => {
    let animId: number;
    let peakHold = 0;
    const peakDecay = 0.95;

    const renderMeter = () => {
      const canvas = meterCanvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);

          // Background meter trough
          ctx.fillStyle = '#08080C';
          ctx.fillRect(0, 0, w, h);

          if (audioEngine.getIsPlaying() && !track.muted) {
            const meter = audioEngine.getTrackMeter(track.id);
            const peak = Math.min(1.2, meter.peak);
            const rms = Math.min(1.0, meter.rms);

            if (peak > peakHold) {
              peakHold = peak;
            } else {
              peakHold = Math.max(0, peakHold * peakDecay);
            }

            // Draw RMS bar
            const rmsWidth = Math.min(w, rms * w);
            const grad = ctx.createLinearGradient(0, 0, w, 0);
            grad.addColorStop(0, '#10b981'); // emerald
            grad.addColorStop(0.7, '#f59e0b'); // amber
            grad.addColorStop(0.9, '#ef4444'); // rose
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, rmsWidth, h);

            // Draw Peak Line
            const peakX = Math.min(w - 2, peakHold * w);
            ctx.fillStyle = peakHold >= 0.98 ? '#ef4444' : '#ffffff';
            ctx.fillRect(peakX, 0, 2, h);
          } else {
            peakHold = 0;
          }
        }
      }
      animId = requestAnimationFrame(renderMeter);
    };

    animId = requestAnimationFrame(renderMeter);
    return () => cancelAnimationFrame(animId);
  }, [track.id, track.muted]);

  const handleNameSubmit = () => {
    setIsEditingName(false);
    const typed = nameValue.trim();
    // Unchanged keeps an automatic label automatic; blank returns to the automatic "Track N" label
    if (typed === label) {
      setNameValue(label);
      return;
    }
    onUpdateTrack(track.id, renameUpdate(typed));
  };

  if (isCollapsed) {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          onSelectTrack(track.id);
        }}
        className={`h-[80px] w-[32px] shrink-0 sticky left-0 z-10 border-r border-b border-zinc-700/80 py-1.5 flex flex-col items-center justify-between transition-colors select-none ${
          isSelected
            ? 'bg-[#181824] shadow-[inset_3px_0_0_#00F0FF]'
            : 'bg-[#121216] hover:bg-[#15151c]'
        }`}
        title={`${label} (click to select)`}
      >
        <span className="w-5 h-4 rounded-xs bg-zinc-800 text-[9px] font-mono font-bold text-zinc-300 flex items-center justify-center">
          {index + 1}
        </span>

        <div className="flex flex-col gap-1 items-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateTrack(track.id, { muted: !track.muted });
            }}
            title={track.muted ? 'Unmute Track' : 'Mute Track'}
            className={`w-5 h-3.5 text-[8px] font-bold rounded flex items-center justify-center transition-colors ${
              track.muted
                ? 'bg-rose-500 text-white'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            M
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateTrack(track.id, { solo: !track.solo });
            }}
            title={track.solo ? 'Unsolo Track' : 'Solo Track'}
            className={`w-5 h-3.5 text-[8px] font-bold rounded flex items-center justify-center transition-colors ${
              track.solo
                ? 'bg-amber-400 text-black'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            S
          </button>
        </div>

        <div className="w-1.5 h-3.5 bg-black rounded-xs overflow-hidden border border-zinc-800">
          <canvas ref={meterCanvasRef} width={6} height={14} className="w-full h-full block" />
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelectTrack(track.id);
      }}
      className={`h-[80px] w-[272px] shrink-0 sticky left-0 z-10 border-r border-b border-zinc-700/80 px-2.5 py-1.5 flex flex-col justify-between transition-colors select-none ${
        isSelected
          ? 'bg-[#181824] shadow-[inset_3px_0_0_#00F0FF]'
          : 'bg-[#121216] hover:bg-[#15151c]'
      }`}
    >
      {/* Top Header: Track Badge, Name, M/S, Delete */}
      <div className="flex items-center justify-between gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* Audition-style Track Number Badge */}
          <div className="flex items-center gap-0.5 shrink-0">
            <span className="w-4 h-4 rounded-xs bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-300 font-bold flex items-center justify-center">
              {index + 1}
            </span>

            {/* Reorder Arrows */}
            <div className="flex flex-col -space-y-0.5">
              <button
                type="button"
                disabled={index === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveTrack(track.id, 'up');
                }}
                title="Move Track Up"
                className="text-zinc-500 hover:text-cyan-300 disabled:opacity-20 p-0.5 transition-colors"
              >
                <ChevronUp className="w-2.5 h-2.5" />
              </button>
              <button
                type="button"
                disabled={index >= totalTracks - 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onMoveTrack(track.id, 'down');
                }}
                title="Move Track Down"
                className="text-zinc-500 hover:text-cyan-300 disabled:opacity-20 p-0.5 transition-colors"
              >
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
            </div>
          </div>

          {/* Editable Track Name */}
          {isEditingName ? (
            <input
              type="text"
              value={nameValue}
              autoFocus
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSubmit();
                if (e.key === 'Escape') {
                  setNameValue(label);
                  setIsEditingName(false);
                }
              }}
              className="bg-black/80 border border-cyan-500 rounded px-1.5 py-0.5 text-xs text-zinc-100 font-semibold w-full focus:outline-none"
            />
          ) : (
            <span
              onDoubleClick={() => setIsEditingName(true)}
              title="Double-click to rename"
              className="text-xs font-semibold text-zinc-200 truncate cursor-text hover:text-cyan-300 transition-colors"
            >
              {label}
            </span>
          )}
        </div>

        {/* Audition-style Mute, Solo, Delete */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateTrack(track.id, { muted: !track.muted });
            }}
            title={track.muted ? 'Unmute Track (M)' : 'Mute Track (M)'}
            className={`w-5 h-5 rounded-xs text-[10px] font-bold tracking-tight transition-all flex items-center justify-center cursor-pointer ${
              track.muted
                ? 'bg-rose-500 text-white font-extrabold shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 border border-zinc-700/60'
            }`}
          >
            M
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdateTrack(track.id, { solo: !track.solo });
            }}
            title={track.solo ? 'Unsolo Track (S)' : 'Solo Track (S)'}
            className={`w-5 h-5 rounded-xs text-[10px] font-bold tracking-tight transition-all flex items-center justify-center cursor-pointer ${
              track.solo
                ? 'bg-amber-400 text-black font-extrabold shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 border border-zinc-700/60'
            }`}
          >
            S
          </button>
          {/* Modular Audio Plugins Rack button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectTrack(track.id);
              window.dispatchEvent(new CustomEvent('uuda:open-plugins-modal', { detail: { trackId: track.id } }));
            }}
            title={pluginCount > 0 ? `${pluginCount} Plugin(s) Loaded — Click to open FX Rack` : "Add Audio Plugins / Effects to this track (WAM 2.0 & Native)"}
            className={`px-1.5 h-5 rounded-xs text-[9px] font-bold tracking-tight transition-all flex items-center gap-0.5 justify-center cursor-pointer ${
              pluginCount > 0
                ? 'bg-purple-600 hover:bg-purple-500 text-white font-extrabold shadow-[0_0_8px_rgba(168,85,247,0.7)] border border-purple-400'
                : 'bg-zinc-800 text-purple-300 hover:text-white hover:bg-purple-900/40 border border-purple-500/40'
            }`}
          >
            <span>FX</span>
            {pluginCount > 0 && <span className="text-[8px] bg-purple-950 px-1 rounded-full font-mono">{pluginCount}</span>}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteTrack(track.id);
            }}
            title="Delete Track"
            className="w-5 h-5 rounded-xs text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 flex items-center justify-center transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Middle: Audition-style Compact Vol & Pan Sliders with tame color-coding */}
      <div className="grid grid-cols-2 gap-2 text-[10px] my-auto">
        {/* Volume: subtle cyan/teal highlight */}
        <div className="flex flex-col gap-0.5">
          <div className="flex justify-between items-center text-zinc-400">
            <span
              onDoubleClick={() => onUpdateTrack(track.id, { volume: 1.0 })}
              title="Double-click to reset volume to 0.0 dB"
              className="flex items-center gap-0.5 text-cyan-400/90 font-semibold cursor-pointer hover:text-cyan-300"
            >
              <span>Vol</span>
            </span>
            <span
              onDoubleClick={() => onUpdateTrack(track.id, { volume: 1.0 })}
              title="Double-click to reset"
              className="mono-nums text-zinc-300 font-mono text-[9px] cursor-pointer"
            >
              {formatVolumeDb(track.volume)}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.01"
            value={track.volume}
            onChange={(e) => onUpdateTrack(track.id, { volume: parseFloat(e.target.value) })}
            className="w-full h-1 bg-zinc-800 accent-cyan-400 rounded-none appearance-none cursor-pointer"
          />
        </div>

        {/* Pan: subtle amber/gold highlight */}
        <div className="flex flex-col gap-0.5">
          <div className="flex justify-between items-center text-zinc-400">
            <span
              onDoubleClick={() => onUpdateTrack(track.id, { pan: 0.0 })}
              title="Double-click to center pan (C)"
              className="text-amber-400/90 font-semibold cursor-pointer hover:text-amber-300"
            >
              Pan
            </span>
            <span
              onDoubleClick={() => onUpdateTrack(track.id, { pan: 0.0 })}
              title="Double-click to center pan"
              className="mono-nums text-zinc-300 font-mono text-[9px] cursor-pointer"
            >
              {formatPan(track.pan)}
            </span>
          </div>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.05"
            value={track.pan}
            onChange={(e) => onUpdateTrack(track.id, { pan: parseFloat(e.target.value) })}
            className="w-full h-1 bg-zinc-800 accent-amber-400 rounded-none appearance-none cursor-pointer"
          />
        </div>
      </div>

      {/* Bottom: Slim High-Definition VU Level Meter */}
      <div className="h-1.5 w-full bg-black rounded-xs overflow-hidden border border-zinc-800">
        <canvas ref={meterCanvasRef} width={250} height={6} className="w-full h-full block" />
      </div>
    </div>
  );
};
