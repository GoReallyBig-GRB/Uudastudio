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
import { GroupClipLevels, type LevelClip } from './GroupClipLevels';
import type { TempClipLevels } from '../audio/tempClipLevels';
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
  soloGroupId?: string | null;
  onToggleSolo?: (groupId: string) => void;
  /** The group being mastered (soloed): its clips get temporary level sliders in the Mastering tab */
  levelGroup?: { name: string; color: string; clips: LevelClip[] } | null;
  tempClipLevels?: TempClipLevels;
  onTempClipLevel?: (clipId: string, db: number) => void;
  onResetTempLevels?: () => void;
  onAddTrack?: () => void;
  selectedTrackId?: string | null;
  onSelectTrack?: (trackId: string) => void;
}

/** Meters are drawn on canvases, which cannot use CSS classes, so read the design tokens once per mount. */
function readMeterColors() {
  const css = getComputedStyle(document.documentElement);
  const t = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    bg: t('--color-surface-0', '#0a0a0b'),
    ok: t('--color-ok', '#5fbf94'),
    warn: t('--color-warn', '#d9a441'),
    danger: t('--color-danger', '#e0707a'),
    peak: t('--color-ink', '#f2f2f0'),
  };
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
  soloGroupId = null,
  onToggleSolo,
  levelGroup = null,
  tempClipLevels = {},
  onTempClipLevel,
  onResetTempLevels,
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
    const mc = readMeterColors();
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
          ctx.fillStyle = mc.bg;
          ctx.fillRect(0, 0, w, h);

          const rmsH = Math.min(h, metering.rmsL * h * 1.5);
          peakHoldL = Math.max(metering.peakL, peakHoldL * 0.95);

          const grad = ctx.createLinearGradient(0, h, 0, 0);
          grad.addColorStop(0, mc.ok);
          grad.addColorStop(0.7, mc.warn);
          grad.addColorStop(0.9, mc.danger);
          ctx.fillStyle = grad;
          ctx.fillRect(0, h - rmsH, w, rmsH);

          // Peak bar
          const peakY = Math.max(2, h - peakHoldL * h);
          ctx.fillStyle = peakHoldL >= 0.99 ? mc.danger : mc.peak;
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
          ctx.fillStyle = mc.bg;
          ctx.fillRect(0, 0, w, h);

          const rmsH = Math.min(h, metering.rmsR * h * 1.5);
          peakHoldR = Math.max(metering.peakR, peakHoldR * 0.95);

          const grad = ctx.createLinearGradient(0, h, 0, 0);
          grad.addColorStop(0, mc.ok);
          grad.addColorStop(0.7, mc.warn);
          grad.addColorStop(0.9, mc.danger);
          ctx.fillStyle = grad;
          ctx.fillRect(0, h - rmsH, w, rmsH);

          const peakY = Math.max(2, h - peakHoldR * h);
          ctx.fillStyle = peakHoldR >= 0.99 ? mc.danger : mc.peak;
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
          ctx.fillStyle = mc.bg;
          ctx.fillRect(0, 0, w, h);

          // Gain reduction is 0 to -12 dB
          const grDb = Math.abs(metering.gainReductionDb);
          const grW = Math.min(w, (grDb / 12) * w);
          ctx.fillStyle = mc.warn;
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
      className={`flex flex-col h-full bg-surface-1 border-l border-line-strong text-ink select-none relative ${
        isSidebarMode
          ? 'shrink-0 max-w-[95vw]'
          : 'w-full max-w-5xl mx-auto rounded-xl border border-line-strong shadow-2xl'
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
          <div className="w-1.5 h-16 rounded-full bg-ink-faint/60 group-hover:bg-accent group-focus:bg-accent transition-all shadow-md flex flex-col items-center justify-center gap-1">
            <span className="w-0.5 h-0.5 rounded-full bg-ink-dim" />
            <span className="w-0.5 h-0.5 rounded-full bg-ink-dim" />
            <span className="w-0.5 h-0.5 rounded-full bg-ink-dim" />
          </div>
        </div>
      )}

      {/* Header and tabs */}
      <div className="shrink-0 border-b border-line bg-surface-1">
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <h2 className="text-base font-semibold tracking-tight text-ink">Master</h2>
          <div className="flex items-center gap-1">
            {isSidebarMode && (
              <button
                onClick={handleToggleExpand}
                title={isFullyExpanded ? 'Narrow the panel' : 'Widen the panel'}
                aria-label={isFullyExpanded ? 'Narrow the panel' : 'Widen the panel'}
                className="rounded-full p-2 text-ink-faint transition-colors hover:bg-surface-3 hover:text-ink cursor-pointer"
              >
                {isFullyExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
            )}
            {onClose && (
              <button
                onClick={onClose}
                aria-label="Close panel"
                title="Close"
                className="rounded-full p-2 text-ink-faint transition-colors hover:bg-surface-3 hover:text-ink cursor-pointer"
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
              className={`-mb-px border-b-2 pb-2.5 pt-2 text-sm font-medium transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                activeTab === id ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink'
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
            <div className="flex items-center justify-between bg-surface-0 p-3 rounded-xl border border-line">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-ok" />
                <span className="text-xs font-bold text-ink uppercase tracking-wider">
                  Pro Multi-Track Mixing Desk
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-3 text-ink-dim font-mono">
                  {project.tracks.length} / {Math.max(10, project.tracks.length)} Active Channels
                </span>
              </div>

              <div className="flex items-center gap-2">
                {onAddTrack && (
                  <button
                    onClick={onAddTrack}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-3 hover:bg-line-strong text-accent text-[11px] font-semibold border border-line-strong transition-colors cursor-pointer"
                  >
                    <span>+ Add Track</span>
                  </button>
                )}
              </div>
            </div>

            {/* The Console Chassis: 10+ Channel Strips + Master Out */}
            <div className="bg-surface-0 border border-line rounded-2xl p-4 shadow-2xl overflow-x-auto">
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
                            ? 'bg-surface-2 border-2 border-accent'
                            : 'bg-surface-1 border border-line hover:border-line-strong hover:bg-surface-2'
                          : 'bg-surface-0/60 border border-dashed border-line opacity-40 select-none'
                      }`}
                    >
                      {/* Channel Header */}
                      <div className="w-full space-y-1">
                        <div className="flex items-center justify-between text-[9px] font-mono">
                          <span className={`font-bold ${isActive ? 'text-accent' : 'text-ink-faint'}`}>
                            CH {String(chIdx + 1).padStart(2, '0')}
                          </span>
                          {isActive ? (
                            <span className="w-1.5 h-1.5 rounded-full bg-ok" />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-line-strong" />
                          )}
                        </div>

                        <div
                          title={isActive ? getTrackLabel(track, chIdx) : 'Empty Channel'}
                          className="text-[10px] font-semibold truncate w-full text-ink"
                        >
                          {isActive ? getTrackLabel(track, chIdx) : 'Empty'}
                        </div>
                      </div>

                      {/* Pan Mini Slider */}
                      <div className="w-full py-1.5 border-y border-line my-1">
                        <div className="flex justify-between text-[8px] font-mono text-ink-faint mb-0.5">
                          <span>PAN</span>
                          <span className="text-ink-dim font-bold">
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
                          className="w-full h-1 bg-surface-3 accent-ink-dim rounded-none cursor-pointer disabled:opacity-20"
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
                              ? 'bg-danger text-surface-0'
                              : 'bg-surface-3 text-ink-dim hover:text-ink disabled:opacity-20'
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
                              ? 'bg-gold text-gold-ink'
                              : 'bg-surface-3 text-ink-dim hover:text-ink disabled:opacity-20'
                          }`}
                        >
                          S
                        </button>
                      </div>

                      {/* Fader Well + LED Meter Section */}
                      <div className="flex items-center justify-center gap-1.5 py-1 flex-1 h-[160px] relative w-full">
                        {/* dB scale */}
                        <div className="flex flex-col justify-between text-[7px] font-mono text-ink-faint h-full py-1 text-right select-none pr-0.5">
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
                            className="w-[140px] h-2 bg-surface-2 border border-line-strong rounded-xs accent-accent cursor-pointer -rotate-90 origin-center disabled:opacity-20"
                          />
                        </div>

                        {/* Responsive LED Peak Meter */}
                        <div className="w-2 h-[140px] bg-black/90 rounded-xs border border-line p-0.5 flex flex-col-reverse gap-0.5">
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
                                      ? 'bg-danger'
                                      : isYellow
                                      ? 'bg-warn'
                                      : 'bg-ok'
                                    : 'bg-surface-2'
                                }`}
                              />
                            );
                          })}
                        </div>
                      </div>

                      {/* Numerical dB Readout Box */}
                      <div className="w-full mt-2 pt-1 border-t border-line">
                        {isActive ? (
                          <button
                            type="button"
                            onDoubleClick={() => onUpdateTrack?.(track.id, { volume: 1.0 })}
                            title="Double click to reset to 0 dB"
                            className="w-full px-1 py-0.5 rounded bg-black/80 font-mono text-[9px] font-bold text-accent border border-line hover:border-accent/50"
                          >
                            {track.muted ? '-inf' : formatVolumeDb(track.volume)}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={onAddTrack}
                            title="Click to add a track for this channel"
                            className="w-full px-1 py-0.5 rounded bg-surface-2 font-mono text-[8px] text-ink-faint hover:text-accent border border-line"
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Group channels: one strip per clip group, until it is ungrouped */}
                {groups.length > 0 && <div className="w-px bg-line-strong my-2 mx-1" />}
                {groups.map((g) => (
                  <GroupConsoleStrip
                    key={g.id}
                    group={g}
                    settings={project.groupSettings?.[g.id]}
                    onUpdate={(patch) => onUpdateGroup?.(g.id, patch)}
                    solo={soloGroupId === g.id}
                    dimmed={!!soloGroupId && soloGroupId !== g.id}
                    onToggleSolo={() => onToggleSolo?.(g.id)}
                  />
                ))}

                {/* Master Channel Divider */}
                <div className="w-px bg-line-strong my-2 mx-1" />

                {/* Real Master Out Channel (Dominant Pro Strip) */}
                <div className="w-[88px] shrink-0 rounded-2xl p-3 bg-gradient-to-b from-surface-2 to-surface-1 border-2 border-ok/60 flex flex-col justify-between items-center text-center relative">
                  {/* Master Out Header */}
                  <div className="w-full space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="font-extrabold text-ok tracking-wider">MASTER</span>
                      <span className={`w-2 h-2 rounded-full ${audioEngine.getIsPlaying() ? 'bg-ok animate-pulse' : 'bg-ink-faint'}`} />
                    </div>
                    <div className="text-[9px] font-mono text-ink-dim font-semibold uppercase">
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
                          ? 'bg-danger text-surface-0'
                          : 'bg-surface-3 text-ink-dim hover:text-ink border border-line-strong'
                      }`}
                    >
                      {isMasterMuted ? 'MUTED' : 'MUTE'}
                    </button>
                  </div>

                  {/* Master Fader Well + Dual Stereo Meters */}
                  <div className="flex items-center justify-center gap-1.5 py-1 flex-1 h-[160px] relative w-full">
                    {/* dB scale */}
                    <div className="flex flex-col justify-between text-[7px] font-mono text-ink-faint h-full py-1 text-right select-none pr-0.5">
                      <span className="text-ok font-bold">+3.5</span>
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
                        className="w-[140px] h-2.5 bg-surface-0 border border-ok/40 rounded-xs accent-ok cursor-pointer -rotate-90 origin-center"
                      />
                    </div>

                    {/* Dual Stereo Meters (L and R) */}
                    <div className="flex gap-0.5 h-[140px] bg-black/95 rounded-xs border border-line p-0.5">
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
                                    ? 'bg-danger'
                                    : idx >= 9
                                    ? 'bg-warn'
                                    : 'bg-ok'
                                  : 'bg-surface-2'
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
                                    ? 'bg-danger'
                                    : idx >= 9
                                    ? 'bg-warn'
                                    : 'bg-ok'
                                  : 'bg-surface-2'
                              }`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Master dB Digital Readout + 0 dB Reset */}
                  <div className="w-full mt-2 pt-1 border-t border-line space-y-1">
                    <button
                      type="button"
                      onClick={() => handleMasterVolumeChange(1.0)}
                      title="Reset Master to 0 dB"
                      className="w-full px-1.5 py-0.5 rounded bg-black/90 font-mono text-[9px] font-bold text-ok border border-ok/40 hover:bg-ok/10"
                    >
                      {isMasterMuted ? '-inf dB' : formatVolumeDb(masterVolume)}
                    </button>
                    <div className="text-[8px] font-mono text-ink-faint text-center">
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
            <div className="bg-surface-0 border border-line rounded-lg p-3">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-line">
                <span className="text-[10px] uppercase font-bold text-ink-dim tracking-wider flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-ok" />
                  <span>BS.1770 / EBU R128 Live Loudness</span>
                </span>
                <span className="text-[9px] font-mono text-ink-faint">
                  {audioEngine.getIsPlaying() ? 'LIVE STREAMING' : 'IDLE'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-surface-2 p-2 rounded border border-line">
                  <div className="text-[9px] font-mono uppercase text-ink-dim">Momentary (M)</div>
                  <div className="text-sm font-bold text-accent font-mono mt-0.5">
                    {liveMetering.momentaryLUFS > -69 ? `${liveMetering.momentaryLUFS.toFixed(1)}` : '--'}
                    <span className="text-[9px] text-ink-faint ml-0.5">LUFS</span>
                  </div>
                </div>

                <div className="bg-surface-2 p-2 rounded border border-line">
                  <div className="text-[9px] font-mono uppercase text-ink-dim">Short-Term (S)</div>
                  <div className="text-sm font-bold text-ok font-mono mt-0.5">
                    {liveMetering.shortTermLUFS > -69 ? `${liveMetering.shortTermLUFS.toFixed(1)}` : '--'}
                    <span className="text-[9px] text-ink-faint ml-0.5">LUFS</span>
                  </div>
                </div>

                <div className="bg-surface-2 p-2 rounded border border-line">
                  <div className="text-[9px] font-mono uppercase text-ink-dim">Integrated (I)</div>
                  <div className="text-sm font-bold text-ink font-mono mt-0.5">
                    {liveMetering.integratedLUFS > -69 ? `${liveMetering.integratedLUFS.toFixed(1)}` : '--'}
                    <span className="text-[9px] text-ink-faint ml-0.5">LUFS</span>
                  </div>
                </div>

                <div className="bg-surface-2 p-2 rounded border border-line">
                  <div className="text-[9px] font-mono uppercase text-ink-dim">True Peak</div>
                  <div className={`text-sm font-bold font-mono mt-0.5 ${
                    liveMetering.truePeakDbTP > -1.0 ? 'text-danger' : 'text-warn'
                  }`}>
                    {liveMetering.truePeakDbTP > -69 ? `${liveMetering.truePeakDbTP.toFixed(1)}` : '--'}
                    <span className="text-[9px] text-ink-faint ml-0.5">dBTP</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Master Fader & Stereo Output Mixing Deck */}
            <div className="bg-surface-2 border border-line rounded-lg p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-ink uppercase tracking-wider flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4 text-ok" />
                  <span>Master Output Channel</span>
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleToggleMasterMute}
                    title={isMasterMuted ? 'Unmute Master Output' : 'Mute Master Output'}
                    className={`px-2.5 py-1 rounded text-[10px] font-extrabold transition-all cursor-pointer ${
                      isMasterMuted
                        ? 'bg-danger text-surface-0'
                        : 'bg-surface-3 text-ink-dim hover:text-ink border border-line-strong'
                    }`}
                  >
                    MUTE
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMasterVolumeChange(1.0)}
                    title="Reset Master Fader to 0.0 dB"
                    className="px-2 py-1 rounded bg-surface-3 text-ink-dim hover:text-accent text-[10px] font-mono border border-line-strong transition-colors"
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
                    <span className="text-ink-dim">Master Fader Gain:</span>
                    <span className="mono-nums text-ok font-bold font-mono">
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
                    className="w-full h-2 bg-surface-3 accent-ok rounded cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] font-mono text-ink-faint pt-0.5">
                    <span>-inf</span>
                    <span>-12dB</span>
                    <span className="text-ink-dim font-bold">0dB</span>
                    <span>+3.5dB</span>
                  </div>
                </div>

                {/* Dual Vertical Stereo Meters: Left and Right */}
                <div className="flex items-center gap-1.5 shrink-0 bg-black/80 p-2 rounded border border-line">
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] font-mono text-ink-dim mb-0.5">L</span>
                    <canvas ref={meterLRef} width={8} height={54} className="rounded-xs" />
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[8px] font-mono text-ink-dim mb-0.5">R</span>
                    <canvas ref={meterRRef} width={8} height={54} className="rounded-xs" />
                  </div>
                </div>
              </div>

              {/* Compressor Gain Reduction Bar */}
              <div className="pt-2 border-t border-line space-y-1">
                <div className="flex justify-between items-center text-[10px] text-ink-dim">
                  <span>Compressor Gain Reduction (GR):</span>
                  <span className="font-mono text-warn font-bold">
                    {liveMetering.gainReductionDb.toFixed(1)} dB
                  </span>
                </div>
                <div className="h-2 w-full bg-black rounded overflow-hidden border border-line">
                  <canvas ref={grMeterRef} width={360} height={8} className="w-full h-full block" />
                </div>
              </div>
            </div>

            {/* Next steps */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setActiveTab('mastering')}
                className="h-11 rounded-full border border-line-strong text-ink font-semibold text-sm flex items-center justify-center gap-2 transition-colors hover:bg-surface-3 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-accent" />
                <span>Master the mix</span>
              </button>
              <button
                type="button"
                onClick={onOpenExport}
                className="h-11 rounded-full bg-gold text-gold-ink font-semibold text-sm flex items-center justify-center gap-2 transition-colors hover:brightness-110 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Export</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'mastering' && (
          <div className="flex h-full min-h-0 flex-col">
            {levelGroup && onTempClipLevel && onResetTempLevels && (
              <GroupClipLevels
                groupName={levelGroup.name}
                color={levelGroup.color}
                clips={levelGroup.clips}
                levels={tempClipLevels}
                onChange={onTempClipLevel}
                onReset={onResetTempLevels}
              />
            )}
            <div className="min-h-0 flex-1">
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
