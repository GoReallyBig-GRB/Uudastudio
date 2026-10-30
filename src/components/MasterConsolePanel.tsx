/**
 * Master output dock: mixing console, master bus meters and mastering.
 * Mastering lives here as a processor you audition; exporting is a separate screen (ExportPanel).
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Sliders,
  Download,
  Gauge,
  Radio,
  CheckCircle2,
  AlertCircle,
  Volume2,
  VolumeX,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  X,
  Loader2,
  Layers,
  ArrowRight,
  ShieldCheck,
  Check,
  Zap,
  Info,
  FileAudio,
  Activity,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { Project, Track, GroupSettings } from '../types';
import type { GroupSummary } from '../audio/groupInfo';
import { GroupConsoleStrip } from './GroupConsoleStrip';
import { audioEngine, MasterLiveMetering } from '../audio/engine';
import { formatVolumeDb, formatPan } from '../utils/formatters';
import { getTrackLabel } from '../utils/tracks';
import { MasteringPanel } from './MasteringPanel';
import type { MasteringSettings } from '../audio/masteringSettings';

interface MasterConsolePanelProps {
  project: Project;
  onClose?: () => void;
  mastering: MasteringSettings;
  mixKey: string;
  isPlaying: boolean;
  onMasteringChange: (patch: Partial<MasteringSettings>) => void;
  onMeasureMastering: () => void;
  onTogglePlay: () => void;
  onOpenExport: () => void;
  /** Master fader or mute changed (they are part of what mastering measures) */
  onMasterFaderChange?: () => void;
  tab: 'console' | 'meters' | 'mastering';
  onTabChange: (tab: 'console' | 'meters' | 'mastering') => void;
  isSidebarMode?: boolean;
  onUpdateTrack?: (trackId: string, updates: Partial<Track>) => void;
  /** Clip groups; each gets its own channel strip next to the tracks until it is ungrouped. */
  groups?: GroupSummary[];
  onUpdateGroup?: (groupId: string, patch: Partial<GroupSettings>) => void;
  onAddTrack?: () => void;
  selectedTrackId?: string | null;
  onSelectTrack?: (trackId: string) => void;
}

export const MasterConsolePanel: React.FC<MasterConsolePanelProps> = ({
  project,
  onClose,
  mastering,
  mixKey,
  isPlaying,
  onMasteringChange,
  onMeasureMastering,
  onTogglePlay,
  onOpenExport,
  onMasterFaderChange,
  tab: activeTab,
  onTabChange: setActiveTab,
  isSidebarMode = true,
  onUpdateTrack,
  groups = [],
  onUpdateGroup,
  onAddTrack,
  selectedTrackId,
  onSelectTrack,
}) => {
  // Navigation sub-tabs inside Master panel

  // Master Fader & Mute State
  const [masterVolume, setMasterVolume] = useState<number>(() => audioEngine.getMasterVolume());
  const [isMasterMuted, setIsMasterMuted] = useState<boolean>(() => audioEngine.getMasterMute());

  // Live Metering Animation State
  const [liveMetering, setLiveMetering] = useState<MasterLiveMetering>({
    peakL: 0,
    peakR: 0,
    rmsL: 0,
    rmsR: 0,
    truePeakDbTP: -70,
    momentaryLUFS: -70,
    shortTermLUFS: -70,
    integratedLUFS: -70,
    gainReductionDb: 0,
    clip: false,
  });

  // Drawer-style Resizing for Sidesheet Mode:
  // MIN_WIDTH: 380px (minimum boundary)
  // UNEXPANDED_WIDTH: 420px (DEFAULT position when active - compact, non-intrusive)
  // MAX_EXPANDED_WIDTH: 840px (full expansion for deep mixing desk & detailed meter inspection)
  const MIN_WIDTH = 380;
  const UNEXPANDED_WIDTH = 420;
  const MAX_EXPANDED_WIDTH = 840;

  // The Master output Console & Mixing Desk default position when active must be the un-expanded view (420px).
  // If a user needs more details, they can draw the panel out to its full expansion (840px).
  const [panelWidth, setPanelWidth] = useState<number>(UNEXPANDED_WIDTH);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  const isFullyExpanded = panelWidth >= (UNEXPANDED_WIDTH + MAX_EXPANDED_WIDTH) / 2;

  const handleToggleExpand = () => {
    const nextWidth = isFullyExpanded ? UNEXPANDED_WIDTH : MAX_EXPANDED_WIDTH;
    setPanelWidth(nextWidth);
    try {
      localStorage.setItem('uuda_sidesheet_width', String(nextWidth));
    } catch {}
  };

  const handlePointerDownResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = panelWidth;

    const onPointerMove = (moveEv: PointerEvent) => {
      const deltaX = startX - moveEv.clientX;
      const nextWidth = Math.max(MIN_WIDTH, Math.min(MAX_EXPANDED_WIDTH, startWidth + deltaX));
      setPanelWidth(nextWidth);
      try {
        localStorage.setItem('uuda_sidesheet_width', String(nextWidth));
      } catch {}
    };

    const onPointerUp = () => {
      setIsResizing(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const handleDoubleClickResize = () => {
    handleToggleExpand();
  };

  const handleKeyDownResize = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const nextWidth = Math.min(MAX_EXPANDED_WIDTH, panelWidth + 20);
      setPanelWidth(nextWidth);
      try { localStorage.setItem('uuda_sidesheet_width', String(nextWidth)); } catch {}
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextWidth = Math.max(MIN_WIDTH, panelWidth - 20);
      setPanelWidth(nextWidth);
      try { localStorage.setItem('uuda_sidesheet_width', String(nextWidth)); } catch {}
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggleExpand();
    }
  };

  const meterLRef = useRef<HTMLCanvasElement | null>(null);
  const meterRRef = useRef<HTMLCanvasElement | null>(null);
  const grMeterRef = useRef<HTMLCanvasElement | null>(null);

  // Live Metering Loop
  useEffect(() => {
    let animId: number;
    let peakHoldL = 0;
    let peakHoldR = 0;

    const renderMeters = () => {
      const metering = audioEngine.getMasterLiveMetering();
      setLiveMetering(metering);

      // Render Left Canvas
      if (meterLRef.current) {
        const ctx = meterLRef.current.getContext('2d');
        if (ctx) {
          const w = meterLRef.current.width;
          const h = meterLRef.current.height;
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#08080c';
          ctx.fillRect(0, 0, w, h);

          const rmsH = Math.min(h, metering.rmsL * h * 1.5);
          peakHoldL = Math.max(metering.peakL, peakHoldL * 0.95);

          const grad = ctx.createLinearGradient(0, h, 0, 0);
          grad.addColorStop(0, '#10b981'); // emerald
          grad.addColorStop(0.7, '#f59e0b'); // amber
          grad.addColorStop(0.9, '#ef4444'); // red
          ctx.fillStyle = grad;
          ctx.fillRect(0, h - rmsH, w, rmsH);

          // Peak bar
          const peakY = Math.max(2, h - peakHoldL * h);
          ctx.fillStyle = peakHoldL >= 0.99 ? '#ef4444' : '#ffffff';
          ctx.fillRect(0, peakY, w, 2);
        }
      }

      // Render Right Canvas
      if (meterRRef.current) {
        const ctx = meterRRef.current.getContext('2d');
        if (ctx) {
          const w = meterRRef.current.width;
          const h = meterRRef.current.height;
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#08080c';
          ctx.fillRect(0, 0, w, h);

          const rmsH = Math.min(h, metering.rmsR * h * 1.5);
          peakHoldR = Math.max(metering.peakR, peakHoldR * 0.95);

          const grad = ctx.createLinearGradient(0, h, 0, 0);
          grad.addColorStop(0, '#10b981');
          grad.addColorStop(0.7, '#f59e0b');
          grad.addColorStop(0.9, '#ef4444');
          ctx.fillStyle = grad;
          ctx.fillRect(0, h - rmsH, w, rmsH);

          const peakY = Math.max(2, h - peakHoldR * h);
          ctx.fillStyle = peakHoldR >= 0.99 ? '#ef4444' : '#ffffff';
          ctx.fillRect(0, peakY, w, 2);
        }
      }

      // Render Gain Reduction Canvas
      if (grMeterRef.current) {
        const ctx = grMeterRef.current.getContext('2d');
        if (ctx) {
          const w = grMeterRef.current.width;
          const h = grMeterRef.current.height;
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#0a0a0f';
          ctx.fillRect(0, 0, w, h);

          // Gain reduction is 0 to -12 dB
          const grDb = Math.abs(metering.gainReductionDb);
          const grW = Math.min(w, (grDb / 12) * w);
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(w - grW, 0, grW, h);
        }
      }

      animId = requestAnimationFrame(renderMeters);
    };

    animId = requestAnimationFrame(renderMeters);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Handle Master Volume Fader
  const handleMasterVolumeChange = (newVol: number) => {
    setMasterVolume(newVol);
    audioEngine.setMasterVolume(newVol);
    onMasterFaderChange?.();
  };

  const handleToggleMasterMute = () => {
    const next = !isMasterMuted;
    setIsMasterMuted(next);
    audioEngine.setMasterMute(next);
    onMasterFaderChange?.();
  };

  return (
    <div
      style={isSidebarMode ? { width: `${panelWidth}px` } : undefined}
      className={`flex flex-col h-full bg-[#111116] border-l border-zinc-700 text-zinc-200 select-none relative ${
        isSidebarMode
          ? 'shrink-0 max-w-[95vw]'
          : 'w-full max-w-5xl mx-auto rounded-xl border border-zinc-700 shadow-2xl'
      } ${isResizing ? 'select-none transition-none' : 'transition-[width] duration-75'}`}
    >
      {/* Drawer Resize Handle on Inner Edge (Left edge of right panel) */}
      {isSidebarMode && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-valuenow={panelWidth}
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_EXPANDED_WIDTH}
          aria-label="Resize Sidesheet"
          title={`Drag to resize (${MIN_WIDTH}px - ${MAX_EXPANDED_WIDTH}px). Double-click to toggle between un-expanded (${UNEXPANDED_WIDTH}px) and full expansion (${MAX_EXPANDED_WIDTH}px).`}
          onPointerDown={handlePointerDownResize}
          onDoubleClick={handleDoubleClickResize}
          onKeyDown={handleKeyDownResize}
          className="absolute left-0 top-0 bottom-0 w-3 -translate-x-1.5 cursor-ew-resize z-40 group flex items-center justify-center focus:outline-none"
        >
          <div className="w-1.5 h-16 rounded-full bg-zinc-600/80 group-hover:bg-cyan-400 group-focus:bg-cyan-400 group-hover:shadow-[0_0_8px_#00f0ff] transition-all shadow-md flex flex-col items-center justify-center gap-1">
            <span className="w-0.5 h-0.5 rounded-full bg-zinc-300" />
            <span className="w-0.5 h-0.5 rounded-full bg-zinc-300" />
            <span className="w-0.5 h-0.5 rounded-full bg-zinc-300" />
          </div>
        </div>
      )}

      {/* Header and tabs */}
      <div className="shrink-0 border-b border-zinc-800 bg-[#101015]">
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <h2 className="text-base font-semibold tracking-tight text-zinc-100">Master</h2>
          <div className="flex items-center gap-1">
            {isSidebarMode && (
              <button
                onClick={handleToggleExpand}
                title={isFullyExpanded ? 'Narrow the panel' : 'Widen the panel'}
                aria-label={isFullyExpanded ? 'Narrow the panel' : 'Widen the panel'}
                className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
              >
                {isFullyExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                aria-label="Close panel"
                title="Close"
                className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div role="tablist" aria-label="Master sections" className="flex gap-6 px-5">
          {([['console', 'Mixer'], ['meters', 'Meters'], ['mastering', 'Mastering']] as const).map(([id, label]) => (
            <button
              key={id} role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)}
              className={`-mb-px border-b-2 pb-2.5 pt-2 text-sm font-medium transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${
                activeTab === id ? 'border-cyan-300 text-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Panel Body */}
      <div className={activeTab === 'mastering' ? 'flex-1 min-h-0' : 'flex-1 overflow-y-auto p-4 space-y-4'}>

        {/* =========================================================================
            TAB 1: MULTI-CHANNEL MIXING CONSOLE (10+ Channel Strips + Master Out)
           ========================================================================= */}
        {activeTab === 'console' && (
          <div className="space-y-4">
            {/* Console Toolbar */}
            <div className="flex items-center justify-between bg-[#0a0a0f] p-3 rounded-xl border border-zinc-800">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                  Pro Multi-Track Mixing Desk
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 font-mono">
                  {project.tracks.length} / {Math.max(10, project.tracks.length)} Active Channels
                </span>
              </div>

              <div className="flex items-center gap-2">
                {onAddTrack && (
                  <button
                    onClick={onAddTrack}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-cyan-300 text-[11px] font-semibold border border-zinc-700 transition-colors cursor-pointer"
                  >
                    <span>+ Add Track</span>
                  </button>
                )}
              </div>
            </div>

            {/* The Console Chassis: 10+ Channel Strips + Master Out */}
            <div className="bg-[#0b0b10] border border-zinc-800 rounded-2xl p-4 shadow-2xl overflow-x-auto">
              <div className="flex gap-2.5 min-w-max items-stretch">
                {/* 10+ Channel Strips mapped directly to timeline tracks */}
                {Array.from({ length: Math.max(10, project.tracks.length) }).map((_, chIdx) => {
                  const track = project.tracks[chIdx];
                  const isActive = !!track;
                  const isSelected = isActive && track.id === selectedTrackId;

                  return (
                    <div
                      key={track ? track.id : `empty-ch-${chIdx}`}
                      onClick={() => isActive && onSelectTrack?.(track.id)}
                      className={`w-[68px] shrink-0 rounded-xl p-2.5 flex flex-col justify-between items-center text-center transition-all relative ${
                        isActive
                          ? isSelected
                            ? 'bg-[#161622] border-2 border-cyan-400 shadow-[0_0_15px_rgba(0,240,255,0.25)]'
                            : 'bg-[#121218] border border-zinc-800 hover:border-zinc-700 hover:bg-[#14141e]'
                          : 'bg-[#0d0d12]/60 border border-dashed border-zinc-800/80 opacity-40 select-none'
                      }`}
                    >
                      {/* Channel Header */}
                      <div className="w-full space-y-1">
                        <div className="flex items-center justify-between text-[9px] font-mono">
                          <span className={`font-bold ${isActive ? 'text-cyan-400' : 'text-zinc-600'}`}>
                            CH {String(chIdx + 1).padStart(2, '0')}
                          </span>
                          {isActive ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
                          )}
                        </div>

                        <div
                          title={isActive ? getTrackLabel(track, chIdx) : 'Empty Channel'}
                          className="text-[10px] font-semibold truncate w-full text-zinc-200"
                        >
                          {isActive ? getTrackLabel(track, chIdx) : 'Empty'}
                        </div>
                      </div>

                      {/* Pan Mini Slider */}
                      <div className="w-full py-1.5 border-y border-zinc-800/60 my-1">
                        <div className="flex justify-between text-[8px] font-mono text-zinc-500 mb-0.5">
                          <span>PAN</span>
                          <span className="text-amber-400 font-bold">
                            {isActive ? formatPan(track.pan) : 'C'}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="-1"
                          max="1"
                          step="0.05"
                          disabled={!isActive}
                          value={isActive ? track.pan : 0}
                          onDoubleClick={() => isActive && onUpdateTrack?.(track.id, { pan: 0 })}
                          onChange={(e) => isActive && onUpdateTrack?.(track.id, { pan: parseFloat(e.target.value) })}
                          className="w-full h-1 bg-zinc-800 accent-amber-400 rounded-none cursor-pointer disabled:opacity-20"
                        />
                      </div>

                      {/* Solo & Mute Buttons */}
                      <div className="w-full flex gap-1 mb-2">
                        <button
                          type="button"
                          disabled={!isActive}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isActive) onUpdateTrack?.(track.id, { muted: !track.muted });
                          }}
                          title={isActive && track.muted ? 'Unmute Track' : 'Mute Track'}
                          className={`flex-1 py-1 rounded text-[9px] font-extrabold transition-all cursor-pointer ${
                            isActive && track.muted
                              ? 'bg-rose-500 text-white shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                              : 'bg-zinc-800/80 text-zinc-400 hover:text-white disabled:opacity-20'
                          }`}
                        >
                          M
                        </button>
                        <button
                          type="button"
                          disabled={!isActive}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isActive) onUpdateTrack?.(track.id, { solo: !track.solo });
                          }}
                          title={isActive && track.solo ? 'Unsolo Track' : 'Solo Track'}
                          className={`flex-1 py-1 rounded text-[9px] font-extrabold transition-all cursor-pointer ${
                            isActive && track.solo
                              ? 'bg-amber-400 text-black shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                              : 'bg-zinc-800/80 text-zinc-400 hover:text-white disabled:opacity-20'
                          }`}
                        >
                          S
                        </button>
                      </div>

                      {/* Fader Well + LED Meter Section */}
                      <div className="flex items-center justify-center gap-1.5 py-1 flex-1 h-[160px] relative w-full">
                        {/* dB scale */}
                        <div className="flex flex-col justify-between text-[7px] font-mono text-zinc-600 h-full py-1 text-right select-none pr-0.5">
                          <span>+6</span>
                          <span>0</span>
                          <span>-6</span>
                          <span>-12</span>
                          <span>-24</span>
                          <span>-inf</span>
                        </div>

                        {/* Channel Pro Vertical Fader */}
                        <div className="h-full flex items-center justify-center relative w-6">
                          <input
                            type="range"
                            min="0"
                            max="1.5"
                            step="0.01"
                            disabled={!isActive}
                            value={isActive ? (track.muted ? 0 : track.volume) : 0}
                            onChange={(e) => isActive && onUpdateTrack?.(track.id, { volume: parseFloat(e.target.value) })}
                            className="w-[140px] h-2 bg-zinc-900 border border-zinc-700 rounded-xs accent-cyan-400 cursor-pointer -rotate-90 origin-center disabled:opacity-20"
                          />
                        </div>

                        {/* Responsive LED Peak Meter */}
                        <div className="w-2 h-[140px] bg-black/90 rounded-xs border border-zinc-800 p-0.5 flex flex-col-reverse gap-0.5">
                          {Array.from({ length: 14 }).map((_, ledIdx) => {
                            const threshold = (ledIdx + 1) / 14;
                            const isLit = isActive && audioEngine.getIsPlaying() && !track.muted && (track.volume * 0.8 >= threshold);
                            const isRed = ledIdx >= 12;
                            const isYellow = ledIdx >= 9 && ledIdx < 12;

                            return (
                              <div
                                key={ledIdx}
                                className={`w-full h-1.5 rounded-2xs transition-colors duration-75 ${
                                  isLit
                                    ? isRed
                                      ? 'bg-rose-500 shadow-[0_0_4px_#f43f5e]'
                                      : isYellow
                                      ? 'bg-amber-400 shadow-[0_0_4px_#fbbf24]'
                                      : 'bg-emerald-400 shadow-[0_0_4px_#10b981]'
                                    : 'bg-zinc-900'
                                }`}
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Numerical dB Readout Box */}
                      <div className="w-full mt-2 pt-1 border-t border-zinc-800/80">
                        {isActive ? (
                          <button
                            type="button"
                            onDoubleClick={() => onUpdateTrack?.(track.id, { volume: 1.0 })}
                            title="Double click to reset to 0 dB"
                            className="w-full px-1 py-0.5 rounded bg-black/80 font-mono text-[9px] font-bold text-cyan-300 border border-zinc-800 hover:border-cyan-500/50"
                          >
                            {track.muted ? '-inf' : formatVolumeDb(track.volume)}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={onAddTrack}
                            title="Click to add a track for this channel"
                            className="w-full px-1 py-0.5 rounded bg-zinc-900 font-mono text-[8px] text-zinc-500 hover:text-cyan-400 border border-zinc-800"
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Group channels: one strip per clip group, until it is ungrouped */}
                {groups.length > 0 && <div className="w-px bg-zinc-700/80 my-2 mx-1" />}
                {groups.map((g) => (
                  <GroupConsoleStrip
                    key={g.id}
                    group={g}
                    settings={project.groupSettings?.[g.id]}
                    onUpdate={(patch) => onUpdateGroup?.(g.id, patch)}
                  />
                ))}

                {/* Master Channel Divider */}
                <div className="w-px bg-zinc-700/80 my-2 mx-1" />

                {/* Real Master Out Channel (Dominant Pro Strip) */}
                <div className="w-[88px] shrink-0 rounded-2xl p-3 bg-gradient-to-b from-[#181a24] to-[#12131b] border-2 border-emerald-500/60 shadow-[0_0_24px_rgba(16,185,129,0.25)] flex flex-col justify-between items-center text-center relative">
                  {/* Master Out Header */}
                  <div className="w-full space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="font-extrabold text-emerald-400 tracking-wider">MASTER</span>
                      <span className={`w-2 h-2 rounded-full ${audioEngine.getIsPlaying() ? 'bg-emerald-400 animate-pulse shadow-[0_0_8px_#10b981]' : 'bg-zinc-600'}`} />
                    </div>
                    <div className="text-[9px] font-mono text-zinc-400 font-semibold uppercase">
                      Main Mix Bus
                    </div>
                  </div>

                  {/* Master MUTE Button */}
                  <div className="w-full my-2">
                    <button
                      type="button"
                      onClick={handleToggleMasterMute}
                      title={isMasterMuted ? 'Unmute Master Output' : 'Mute Master Output'}
                      className={`w-full py-1.5 rounded-lg text-[10px] font-extrabold transition-all cursor-pointer ${
                        isMasterMuted
                          ? 'bg-rose-500 text-white shadow-[0_0_12px_rgba(244,63,94,0.7)]'
                          : 'bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-700'
                      }`}
                    >
                      {isMasterMuted ? 'MUTED' : 'MUTE'}
                    </button>
                  </div>

                  {/* Master Fader Well + Dual Stereo Meters */}
                  <div className="flex items-center justify-center gap-1.5 py-1 flex-1 h-[160px] relative w-full">
                    {/* dB scale */}
                    <div className="flex flex-col justify-between text-[7px] font-mono text-zinc-500 h-full py-1 text-right select-none pr-0.5">
                      <span className="text-emerald-400 font-bold">+3.5</span>
                      <span>0</span>
                      <span>-6</span>
                      <span>-12</span>
                      <span>-24</span>
                      <span>-inf</span>
                    </div>

                    {/* Master Fader Slider */}
                    <div className="h-full flex items-center justify-center relative w-6">
                      <input
                        type="range"
                        min="0"
                        max="1.5"
                        step="0.01"
                        value={isMasterMuted ? 0 : masterVolume}
                        onChange={(e) => handleMasterVolumeChange(parseFloat(e.target.value))}
                        className="w-[140px] h-2.5 bg-zinc-950 border border-emerald-500/40 rounded-xs accent-emerald-400 cursor-pointer -rotate-90 origin-center"
                      />
                    </div>

                    {/* Dual Stereo Meters (L and R) */}
                    <div className="flex gap-0.5 h-[140px] bg-black/95 rounded-xs border border-zinc-800 p-0.5">
                      {/* Left Channel */}
                      <div className="w-1.5 h-full flex flex-col-reverse gap-0.5">
                        {Array.from({ length: 14 }).map((_, idx) => {
                          const threshold = (idx + 1) / 14;
                          const isLit = audioEngine.getIsPlaying() && !isMasterMuted && (liveMetering.peakL >= threshold);
                          return (
                            <div
                              key={idx}
                              className={`w-full h-1.5 rounded-2xs ${
                                isLit
                                  ? idx >= 12
                                    ? 'bg-rose-500 shadow-[0_0_4px_#f43f5e]'
                                    : idx >= 9
                                    ? 'bg-amber-400 shadow-[0_0_4px_#fbbf24]'
                                    : 'bg-emerald-400 shadow-[0_0_4px_#10b981]'
                                  : 'bg-zinc-900'
                              }`}
                            />
                          );
                        })}
                      </div>

                      {/* Right Channel */}
                      <div className="w-1.5 h-full flex flex-col-reverse gap-0.5">
                        {Array.from({ length: 14 }).map((_, idx) => {
                          const threshold = (idx + 1) / 14;
                          const isLit = audioEngine.getIsPlaying() && !isMasterMuted && (liveMetering.peakR >= threshold);
                          return (
                            <div
                              key={idx}
                              className={`w-full h-1.5 rounded-2xs ${
                                isLit
                                  ? idx >= 12
                                    ? 'bg-rose-500 shadow-[0_0_4px_#f43f5e]'
                                    : idx >= 9
                                    ? 'bg-amber-400 shadow-[0_0_4px_#fbbf24]'
                                    : 'bg-emerald-400 shadow-[0_0_4px_#10b981]'
                                  : 'bg-zinc-900'
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Master dB Digital Readout + 0 dB Reset */}
                  <div className="w-full mt-2 pt-1 border-t border-zinc-800/80 space-y-1">
                    <button
                      type="button"
                      onClick={() => handleMasterVolumeChange(1.0)}
                      title="Reset Master to 0 dB"
                      className="w-full px-1.5 py-0.5 rounded bg-black/90 font-mono text-[9px] font-bold text-emerald-400 border border-emerald-500/40 hover:bg-emerald-950/40"
                    >
                      {isMasterMuted ? '-inf dB' : formatVolumeDb(masterVolume)}
                    </button>
                    <div className="text-[8px] font-mono text-zinc-500 text-center">
                      Click for 0dB
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 2: MASTER BUS & LIVE METERS (Loudness Radar & Dynamics)
           ========================================================================= */}
        {activeTab === 'meters' && (
          <div className="space-y-4">
            {/* Live Loudness Radar Cards */}
            <div className="bg-[#0A0A0E] border border-zinc-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-zinc-800/80">
                <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  <span>BS.1770 / EBU R128 Live Loudness</span>
                </span>
                <span className="text-[9px] font-mono text-zinc-500">
                  {audioEngine.getIsPlaying() ? 'LIVE STREAMING' : 'IDLE'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-[#14141c] p-2 rounded border border-zinc-800">
                  <div className="text-[9px] font-mono uppercase text-zinc-400">Momentary (M)</div>
                  <div className="text-sm font-bold text-cyan-400 font-mono mt-0.5">
                    {liveMetering.momentaryLUFS > -69 ? `${liveMetering.momentaryLUFS.toFixed(1)}` : '--'}
                    <span className="text-[9px] text-zinc-500 ml-0.5">LUFS</span>
                  </div>
                </div>

                <div className="bg-[#14141c] p-2 rounded border border-zinc-800">
                  <div className="text-[9px] font-mono uppercase text-zinc-400">Short-Term (S)</div>
                  <div className="text-sm font-bold text-emerald-400 font-mono mt-0.5">
                    {liveMetering.shortTermLUFS > -69 ? `${liveMetering.shortTermLUFS.toFixed(1)}` : '--'}
                    <span className="text-[9px] text-zinc-500 ml-0.5">LUFS</span>
                  </div>
                </div>

                <div className="bg-[#14141c] p-2 rounded border border-zinc-800">
                  <div className="text-[9px] font-mono uppercase text-zinc-400">Integrated (I)</div>
                  <div className="text-sm font-bold text-indigo-400 font-mono mt-0.5">
                    {liveMetering.integratedLUFS > -69 ? `${liveMetering.integratedLUFS.toFixed(1)}` : '--'}
                    <span className="text-[9px] text-zinc-500 ml-0.5">LUFS</span>
                  </div>
                </div>

                <div className="bg-[#14141c] p-2 rounded border border-zinc-800">
                  <div className="text-[9px] font-mono uppercase text-zinc-400">True Peak</div>
                  <div className={`text-sm font-bold font-mono mt-0.5 ${
                    liveMetering.truePeakDbTP > -1.0 ? 'text-rose-400' : 'text-amber-400'
                  }`}>
                    {liveMetering.truePeakDbTP > -69 ? `${liveMetering.truePeakDbTP.toFixed(1)}` : '--'}
                    <span className="text-[9px] text-zinc-500 ml-0.5">dBTP</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Master Fader & Stereo Output Mixing Deck */}
            <div className="bg-[#15151c] border border-zinc-800 rounded-lg p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  <span>Master Output Channel</span>
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleToggleMasterMute}
                    title={isMasterMuted ? 'Unmute Master Output' : 'Mute Master Output'}
                    className={`px-2.5 py-1 rounded text-[10px] font-extrabold transition-all cursor-pointer ${
                      isMasterMuted
                        ? 'bg-rose-500 text-white shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                        : 'bg-zinc-800 text-zinc-400 hover:text-white border border-zinc-700'
                    }`}
                  >
                    MUTE
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMasterVolumeChange(1.0)}
                    title="Reset Master Fader to 0.0 dB"
                    className="px-2 py-1 rounded bg-zinc-800 text-zinc-400 hover:text-cyan-300 text-[10px] font-mono border border-zinc-700 transition-colors"
                  >
                    0 dB
                  </button>
                </div>
              </div>

              {/* Master Fader Slider + Stereo Dual VU Meters (L and R) */}
              <div className="flex items-center gap-4 py-2">
                {/* Master Volume Fader */}
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-400">Master Fader Gain:</span>
                    <span className="mono-nums text-emerald-400 font-bold font-mono">
                      {isMasterMuted ? '-inf dB' : formatVolumeDb(masterVolume)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1.5"
                    step="0.01"
                    value={isMasterMuted ? 0 : masterVolume}
                    onChange={(e) => handleMasterVolumeChange(parseFloat(e.target.value))}
                    className="w-full h-2 bg-zinc-800 accent-emerald-400 rounded cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] font-mono text-zinc-500 pt-0.5">
                    <span>-inf</span>
                    <span>-12dB</span>
                    <span className="text-zinc-300 font-bold">0dB</span>
                    <span>+3.5dB</span>
                  </div>
                </div>

                {/* Dual Vertical Stereo Meters: Left and Right */}
                <div className="flex items-center gap-1.5 shrink-0 bg-black/80 p-2 rounded border border-zinc-800">
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] font-mono text-zinc-400 mb-0.5">L</span>
                    <canvas ref={meterLRef} width={8} height={54} className="rounded-xs" />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] font-mono text-zinc-400 mb-0.5">R</span>
                    <canvas ref={meterRRef} width={8} height={54} className="rounded-xs" />
                  </div>
                </div>
              </div>

              {/* Compressor Gain Reduction Bar */}
              <div className="pt-2 border-t border-zinc-800 space-y-1">
                <div className="flex justify-between items-center text-[10px] text-zinc-400">
                  <span>Compressor Gain Reduction (GR):</span>
                  <span className="font-mono text-amber-400 font-bold">
                    {liveMetering.gainReductionDb.toFixed(1)} dB
                  </span>
                </div>
                <div className="h-2 w-full bg-black rounded overflow-hidden border border-zinc-800">
                  <canvas ref={grMeterRef} width={360} height={8} className="w-full h-full block" />
                </div>
              </div>
            </div>

            {/* Next steps */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setActiveTab('mastering')}
                className="h-11 rounded-full border border-zinc-700 text-zinc-100 font-semibold text-sm flex items-center justify-center gap-2 transition-colors hover:bg-zinc-800 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-cyan-300" />
                <span>Master the mix</span>
              </button>
              <button
                type="button"
                onClick={onOpenExport}
                className="h-11 rounded-full bg-zinc-50 text-zinc-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors hover:bg-white cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Export</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'mastering' && (
          <MasteringPanel
            settings={mastering}
            mixKey={mixKey}
            hasAudio={project.tracks.some((t) => t.clips.length > 0)}
            isPlaying={isPlaying}
            onChange={onMasteringChange}
            onMeasureNow={onMeasureMastering}
            onTogglePlay={onTogglePlay}
            onExport={onOpenExport}
          />
        )}
      </div>
    </div>
  );
};
