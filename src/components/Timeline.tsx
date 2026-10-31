/**
 * X-PRO AUDIO - Central Timeline
 * Canvas 2D waveform rendering, continuous playhead, sub-pixel multi-clip drag,
 * vertical row dropping, marquee selection, and 80px CSS grid track rows.
 * Includes:
 * - Collapsible Timeline Track Controller (toggle between 272px and 32px to focus on waveforms & mixer)
 * - Inward waveform edge trimming/deletion on both left & right edges
 * - Decoupled clip dragging across tracks (split clips move completely independently)
 * - Horizontal collision & overlap prevention (clips cannot overlap or cover each other)
 */

import { colorFromHex, groupColor, summarizeGroups, withAlpha } from '../audio/groupInfo';
import React, { useRef, useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import { calculateZoomScrollLeft } from './timelineZoom';
import { getVisibleClipPixelRange } from './timelineViewport';
import { ClipboardPaste, Clock, ChevronUp, ChevronDown } from 'lucide-react';
import { Project, Track, Clip, Asset, GroupSettings } from '../types';
import { TrackControls } from './TrackControls';
import { rangeTrackIds, type RangeSelection, type TimelineTool } from './rangeDelete';
import { TITLE_PAD_X, displayTitle, fitTitle, formatClipLength, placeTip } from './clipTitle';
import { TimelineRuler } from './TimelineRuler';
import { ClipActionStrip } from './ClipActionStrip';
import { peakProvider } from '../waveform/peakProvider';
import { audioEngine } from '../audio/engine';
import { pluginManager } from '../plugins/pluginManager';
import { pruneEmptiedTracks, getTrackLabel } from '../utils/tracks';
import { formatTimecode } from '../utils/formatters';
import { gainToY, yToGain } from './clipGainLine';
import { chainIds, seamFlags, selectionUnitCount } from './spliceChains';

interface TimelineProps {
  project: Project;
  playheadSeconds: number;
  pixelsPerSecond: number;
  onViewportWidthChange?: (width: number) => void;
  selectedTrackId: string | null;
  selectedClipIds: Set<string>;
  onSelectTrack: (trackId: string) => void;
  onSelectClips: (clipIds: Set<string>) => void;
  onUpdateTrack: (trackId: string, updates: Partial<Track>) => void;
  onDeleteTrack: (trackId: string) => void;
  onUpdateProject: (newProject: Project) => void;
  /** Lanes that were emptied by a clip move and removed (untouched default lanes only) */
  onTracksAutoRemoved?: (trackIds: string[]) => void;
  onSeek: (seconds: number) => void;
  /** Single-track view: only this track is shown, large. null shows every track. */
  focusTrackId?: string | null;
  onToggleFocus?: () => void;
  focusSolo?: boolean;
  onToggleFocusSolo?: () => void;
  onSplitClip: (clipId: string) => void;
  onSilence?: () => void;
  onRangeGain?: (db: number) => void;
  onDeleteRange?: () => void;
  onDeleteClip: (clipId: string) => void;
  onDuplicateClip: (clipId: string) => void;
  onCopyClip: (clipId: string) => void;
  onCutClip: (clipId: string) => void;
  onPasteClip: (targetTrackId?: string, targetTimeSeconds?: number) => void;
  canPaste: boolean;
  onToggleMuteClip: (clipId: string) => void;
  onOpenDspModal: (type: import('./DspModals').DspModalType) => void;
  onOpenExport?: () => void;
  onOpenPlugins?: (groupId?: string) => void;
  onGroupSelected?: () => void;
  /** Same change to several clips as one undo step (Quick Actions: mute all) */
  onUpdateClips?: (clipIds: string[], updates: Partial<Clip>) => void;
  onUpdateGroup?: (groupId: string, patch: Partial<GroupSettings>) => void;
  soloGroupId?: string | null;
  onToggleSolo?: (groupId: string) => void;
  onUngroupSelected?: () => void;
  onMoveClipTrack: (clipId: string, direction: 'up' | 'down') => void;
  onMoveTrack: (trackId: string, direction: 'up' | 'down') => void;
  onRecordTrack: (trackId: string) => void;
  /** Select: pointer moves clips. Range: dragging on a track highlights a time span and never moves clips. */
  tool: TimelineTool;
  rangeSelection: RangeSelection | null;
  onRangeSelect: (selection: RangeSelection | null) => void;
  onUpdateClip: (clipId: string, updates: Partial<Clip>) => void;
  onFileDrop: (files: FileList) => void;
  isControlsCollapsed?: boolean;
  onToggleCollapseControls?: () => void;
}

interface DraggingClipsState {
  startX: number;
  startY: number;
  initialClips: Map<string, { startSeconds: number; trackIndex: number; clip: Clip }>;
  currentDt: number;
  currentDrow: number;
}

interface MarqueeState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

/** Open the outline of a clip piece: a side that touches another piece of the same clip is left open, so no seam shows. */
function traceOutline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, openL: boolean, openR: boolean) {
  const x0 = openL ? x : x + r;
  const x1 = openR ? x + w : x + w - r;
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.moveTo(x0, y + h);
  ctx.lineTo(x1, y + h);
  if (!openL) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x, y, x, y + r, r);
    ctx.lineTo(x, y + h - r);
    ctx.arcTo(x, y + h, x + r, y + h, r);
  }
  if (!openR) {
    ctx.moveTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  }
}

interface FadeDragState {
  clipId: string;
  type: 'in' | 'out';
  startX: number;
  initialFade: number;
  maxFade: number;
}

interface GainDragState {
  clipId: string;
  laneTop: number;
  clipH: number;
}

interface EdgeTrimDragState {
  clipId: string;
  trackId: string;
  edge: 'left' | 'right';
  startX: number;
  initialStartSeconds: number;
  initialOffsetSeconds: number;
  initialDurationSeconds: number;
}

const ROW_HEIGHT = 80;
/** Height of the one visible track in single-track view */
const FOCUS_ROW_HEIGHT = 320;

/** Device pixels per CSS pixel, so the waveform canvas is drawn at full sharpness on high-density screens. */
const getDpr = (): number => Math.min(3, Math.max(1, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));

/**
 * Border/fill/wave shades that alternate along a track. Two tints of the one cyan-grey hue, far enough apart to tell
 * adjacent clips apart at a glance without adding a new colour.
 */
const CLIP_SHADES = [
  { border: '#3f7385', fill: 'rgba(24, 30, 40, 0.92)', wave: '#38bdf8' },
  { border: '#9fc7d4', fill: 'rgba(32, 40, 52, 0.92)', wave: '#5fcdf5' },
] as const;
const FULL_HEADER_WIDTH = 272;
const COLLAPSED_HEADER_WIDTH = 32;

export const Timeline: React.FC<TimelineProps> = ({
  project,
  playheadSeconds,
  pixelsPerSecond,
  onViewportWidthChange,
  selectedTrackId,
  selectedClipIds,
  onSelectTrack,
  onSelectClips,
  onUpdateTrack,
  onDeleteTrack,
  onUpdateProject,
  onTracksAutoRemoved,
  onSeek,
  focusTrackId = null,
  onToggleFocus,
  focusSolo = true,
  onToggleFocusSolo,
  onSplitClip,
  onSilence,
  onRangeGain,
  onDeleteRange,
  onDeleteClip,
  onDuplicateClip,
  onCopyClip,
  onCutClip,
  onPasteClip,
  canPaste,
  onToggleMuteClip,
  onOpenDspModal,
  onOpenExport,
  onOpenPlugins,
  onGroupSelected,
  onUpdateClips,
  onUpdateGroup,
  soloGroupId = null,
  onToggleSolo,
  onUngroupSelected,
  onMoveClipTrack,
  onMoveTrack,
  onRecordTrack,
  tool,
  rangeSelection,
  onRangeSelect,
  onUpdateClip,
  onFileDrop,
  isControlsCollapsed: propControlsCollapsed,
  onToggleCollapseControls: propToggleCollapseControls,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const laneScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [timelineWidth, setTimelineWidth] = useState<number>(1200);
  const [scrollLeft, setScrollLeft] = useState<number>(0);
  const [waveformVersion, setWaveformVersion] = useState<number>(0);
  useEffect(() => peakProvider.subscribe(() => setWaveformVersion((v) => v + 1)), []);
  const [scrollTop, setScrollTop] = useState<number>(0);
  const autoCenterPendingRef = useRef<boolean>(false);
  const autoCenterTargetRef = useRef<number | null>(null);

  // Local controller collapse state if not driven by parent
  const [localControlsCollapsed, setLocalControlsCollapsed] = useState<boolean>(false);
  const isControlsCollapsed = propControlsCollapsed !== undefined ? propControlsCollapsed : localControlsCollapsed;
  const handleToggleControls = propToggleCollapseControls || (() => setLocalControlsCollapsed(prev => !prev));

  const currentHeaderWidth = isControlsCollapsed ? COLLAPSED_HEADER_WIDTH : FULL_HEADER_WIDTH;

  // Last pointer position over a lane, so the Q key can open Quick Actions where the user is looking.
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  // Quick Action Strip state
  const [actionStrip, setActionStrip] = useState<{
    clip: Clip;
    position: { x: number; y: number };
    /** Opened on a highlighted range, so Quick Actions edits the range */
    range?: boolean;
  } | null>(null);
  // A range strip lasts only as long as the range does
  useEffect(() => {
    if (actionStrip?.range && !rangeSelection) setActionStrip(null);
  }, [actionStrip, rangeSelection]);

  // The clip Quick Actions shows: follows the selection while it is open, and always the live copy (not a stale snapshot).
  const stripClip = actionStrip
    ? (() => {
        const all = project.tracks.flatMap((t) => t.clips);
        if (actionStrip.range) return all.find((c) => c.id === actionStrip.clip.id) ?? null;
        return all.find((c) => selectedClipIds.has(c.id)) ?? all.find((c) => c.id === actionStrip.clip.id) ?? null;
      })()
    : null;

  // Single-track view: just the focused track, tall. Playback and everything else is unchanged.
  const focusIndex = focusTrackId ? project.tracks.findIndex((t) => t.id === focusTrackId) : -1;
  const focused = focusIndex >= 0;
  const rowHeight = focused ? FOCUS_ROW_HEIGHT : ROW_HEIGHT;

  // Dragging clips state
  const [draggingClips, setDraggingClips] = useState<DraggingClipsState | null>(null);

  // Edge trimming drag state (inward drag deletes/wipes out waveform)
  const [edgeTrimDrag, setEdgeTrimDrag] = useState<EdgeTrimDragState | null>(null);

  // Marquee selection state
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  // Range tool drag: where it began (time and screen x) and whether the pointer has moved far enough to count as a drag.
  const [rangeDrag, setRangeDrag] = useState<{ trackId: string; trackIndex: number; anchorSeconds: number; startClientX: number; moved: boolean } | null>(null);

  // Fade handle drag state
  const [fadeDrag, setFadeDrag] = useState<FadeDragState | null>(null);

  // On-clip volume line drag
  const [gainDrag, setGainDrag] = useState<GainDragState | null>(null);

  // Drag-and-drop file overlay state
  const [isDragOverFiles, setIsDragOverFiles] = useState<boolean>(false);

  // Context menu state for right-click on track lane
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    timeSeconds: number;
    track: Track;
  } | null>(null);

  // Listen to global toggle controller event
  useEffect(() => {
    const handleToggle = () => handleToggleControls();
    window.addEventListener('xpro:toggle-controller', handleToggle);
    return () => window.removeEventListener('xpro:toggle-controller', handleToggle);
  }, [handleToggleControls]);

  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu(null);
    };
    if (contextMenu) {
      window.addEventListener('click', handleGlobalClick);
      return () => window.removeEventListener('click', handleGlobalClick);
    }
  }, [contextMenu]);

  // Compute maximum duration across all clips to size canvas
  const totalDurationSeconds = useMemo(() => {
    let maxTime = 60; // minimum 60 seconds
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const end = clip.startSeconds + clip.durationSeconds;
        if (end > maxTime) maxTime = end;
      }
    }
    return maxTime + 15; // 15 seconds padding
  }, [project.tracks]);

  const lanePixelWidth = Math.max(1200, Math.ceil(totalDurationSeconds * pixelsPerSecond));
  const previousZoomRef = useRef<number>(pixelsPerSecond);
  // Last scroll offset we know the user/app set. After a zoom-out the browser clamps the real scrollLeft to the
  // narrower lane before our layout effect runs, so reading it back would anchor to the wrong place.
  const lastScrollLeftRef = useRef<number>(0);

  // Keep the visible timeline's left edge anchored during zoom. This prevents
  // zoom-in from pulling time zero under the sticky controllers; the ruler,
  // waveform, and playhead all continue to share the same scroll offset.
  useLayoutEffect(() => {
    const previousZoom = previousZoomRef.current;
    previousZoomRef.current = pixelsPerSecond;
    if (previousZoom === pixelsPerSecond) return;
    const viewport = laneScrollContainerRef.current;
    if (!viewport) return;
    const nextScrollLeft = calculateZoomScrollLeft({
      scrollLeft: lastScrollLeftRef.current,
      viewportWidth: viewport.clientWidth,
      headerWidth: currentHeaderWidth,
      previousZoom,
      nextZoom: pixelsPerSecond,
      maxScrollLeft: viewport.scrollWidth - viewport.clientWidth,
      playheadSeconds,
    });
    // A smooth auto-center scroll that was under way belongs to the old zoom; drop it
    autoCenterPendingRef.current = false;
    autoCenterTargetRef.current = null;
    lastScrollLeftRef.current = nextScrollLeft;
    viewport.scrollLeft = nextScrollLeft;
    setScrollLeft(nextScrollLeft);
  }, [pixelsPerSecond, currentHeaderWidth, lanePixelWidth, playheadSeconds]);

  // ResizeObserver for canvas width
  useEffect(() => {
    const el = laneScrollContainerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        const viewportWidth = Math.max(100, Math.floor(w));
        setTimelineWidth(Math.max(100, viewportWidth - currentHeaderWidth));
        onViewportWidthChange?.(viewportWidth);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [lanePixelWidth, onViewportWidthChange, currentHeaderWidth]);

  // Synchronize horizontal & vertical scroll. Keep the auto-center lock until
  // the smooth-scroll destination is reached, not merely until the playhead
  // passes through the center band (which can happen before scrolling finishes).
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const nextScrollLeft = e.currentTarget.scrollLeft;
    lastScrollLeftRef.current = nextScrollLeft;
    setScrollLeft(nextScrollLeft);
    setScrollTop(e.currentTarget.scrollTop);

    const targetScrollLeft = autoCenterTargetRef.current;
    if (targetScrollLeft !== null && Math.abs(nextScrollLeft - targetScrollLeft) <= 2) {
      autoCenterPendingRef.current = false;
      autoCenterTargetRef.current = null;
    }
  };

  // Release the auto-center lock when the browser finishes its smooth scroll.
  // The scroll-position fallback in handleScroll also handles browsers/events that
  // reach the target without dispatching scrollend.
  useEffect(() => {
    const viewport = laneScrollContainerRef.current;
    if (!viewport) return;

    const handleScrollEnd = () => {
      autoCenterPendingRef.current = false;
      autoCenterTargetRef.current = null;
    };

    viewport.addEventListener('scrollend', handleScrollEnd);
    return () => viewport.removeEventListener('scrollend', handleScrollEnd);
  }, []);

  // Recenter the viewport smoothly when playback reaches either visible edge.
  // The audio playhead keeps advancing; only the viewport scrolls around it.
  const autoCenterZoomRef = useRef<number>(pixelsPerSecond);
  useEffect(() => {
    const viewport = laneScrollContainerRef.current;
    if (!viewport) return;
    const zoomJustChanged = autoCenterZoomRef.current !== pixelsPerSecond;
    autoCenterZoomRef.current = pixelsPerSecond;
    if (!audioEngine.getIsPlaying()) {
      autoCenterPendingRef.current = false;
      autoCenterTargetRef.current = null;
      return;
    }

    const playheadX = currentHeaderWidth + playheadSeconds * pixelsPerSecond;
    const playheadViewportX = playheadX - viewport.scrollLeft;
    const edgeMargin = 72;

    // Keep the lock for the entire scroll animation. Releasing it as soon as the
    // moving playhead enters the center band can interrupt the animation with a
    // second scrollTo request, producing the brief jerks before the smooth roll-back.
    if (autoCenterPendingRef.current) return;

    if (playheadViewportX <= edgeMargin || playheadViewportX >= viewport.clientWidth - edgeMargin) {
      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const targetScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, playheadX - viewport.clientWidth / 2),
      );
      if (Math.abs(targetScrollLeft - viewport.scrollLeft) > 1) {
        if (zoomJustChanged) {
          // Zooming moved the playhead to an edge: re-center at once rather than gliding there after a pause
          lastScrollLeftRef.current = targetScrollLeft;
          viewport.scrollLeft = targetScrollLeft;
          return;
        }
        autoCenterPendingRef.current = true;
        autoCenterTargetRef.current = targetScrollLeft;
        viewport.scrollTo({ left: targetScrollLeft, behavior: 'smooth' });
      }
    }
  }, [playheadSeconds, pixelsPerSecond, currentHeaderWidth, scrollLeft]);

  // Keyboard navigation & Shortcuts (S=split, Ctrl+C=copy, etc.)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.key === 's' || e.key === 'S') {
        if (!e.ctrlKey && !e.metaKey && selectionUnitCount(project.tracks, selectedClipIds) === 1) {
          e.preventDefault();
          const [clipId] = Array.from(selectedClipIds);
          onSplitClip(clipId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // A highlighted range owns Delete (the app removes just that span); never also delete whole clips.
        if (selectedClipIds.size > 0 && !rangeSelection) {
          e.preventDefault();
          for (const clipId of selectedClipIds) {
            onDeleteClip(clipId);
          }
        }
      } else if ((e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Q: open (or close) Quick Actions for the selected clip, or the highlighted range, near the pointer.
        if (rangeSelection) {
          e.preventDefault();
          const rep = rangeRepClip();
          if (!rep) return;
          const at = lastPointerRef.current ?? { x: window.innerWidth / 2 - 160, y: 200 };
          setActionStrip((open) => (open ? null : { clip: rep, range: true, position: { x: Math.min(window.innerWidth - 320, at.x + 8), y: at.y + 8 } }));
        } else if (selectedClipIds.size >= 1) {
          e.preventDefault();
          const [clipId] = Array.from(selectedClipIds);
          const target = project.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
          if (!target) return;
          const at = lastPointerRef.current ?? { x: window.innerWidth / 2 - 160, y: 200 };
          setActionStrip((open) => (open ? null : { clip: target, position: { x: Math.min(window.innerWidth - 320, at.x + 8), y: at.y + 8 } }));
        }
      } else if (e.key === 'Escape') {
        onSelectClips(new Set());
        setActionStrip(null);
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipIds, onSplitClip, onDeleteClip, onSelectClips, rangeSelection, project.tracks]);

  /**
   * Render Track Waveforms onto canvas
   */
  const renderTrackWaveforms = useCallback(
    (canvas: HTMLCanvasElement | null, track: Track, trackIndex: number) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // The canvas has dpr x more pixels than its on-screen size, so lines stay crisp on high-density screens.
      const dpr = getDpr();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      // Draw exclusively in viewport-local coordinates. The canvas itself is positioned
      // at scrollLeft inside the lane, so timeline x values are offset once here and nowhere else.
      ctx.save();

      // Background and centerline use the same viewport-local coordinate system as clips.
      ctx.fillStyle = trackIndex % 2 === 0 ? '#0a0a0b' : '#0e0e10';
      ctx.fillRect(0, 0, width, height);

      // Subtle horizontal centerline
      ctx.strokeStyle = '#1c1c20';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height / 2 + 0.5);
      ctx.lineTo(width, height / 2 + 0.5);
      ctx.stroke();

      try {
        // Neighbouring clips on a track alternate between two border shades so where one ends and the next begins is clear.
        // Pieces of one edited clip (touching end to end) are drawn as a single clip: no seam, one shade, one title.
        const seams = seamFlags(track.clips);
        const orderIndex = new Map<string, number>();
        let shadeStep = -1;
        [...track.clips].sort((a, b) => a.startSeconds - b.startSeconds).forEach((c) => {
          if (!seams.get(c.id)?.left) shadeStep += 1;
          orderIndex.set(c.id, Math.max(0, shadeStep));
        });
        const drawn: Array<{ x: number; w: number; seamR: boolean; name: string; selected: boolean }> = [];
        for (const clip of track.clips) {
          const sm = seams.get(clip.id);
          const seamL = !!sm?.left;
          const seamR = !!sm?.right;
          // Grouped clips take their group's colour; loose clips alternate between the two cyan-grey shades
          // Group colour (always on), else the track's own colour if it has one, else the alternating cyan-grey shades
          const tint = clip.groupId ? groupColor(project, clip.groupId) : track.color ? colorFromHex(track.color) : null;
          const shade = tint ?? CLIP_SHADES[(orderIndex.get(clip.id) ?? 0) % CLIP_SHADES.length];
          let renderStart = clip.startSeconds;
          let renderDuration = clip.durationSeconds;
          const isSelected = tool !== 'range' && selectedClipIds.has(clip.id);
          let isGhost = false;

          // Drag preview adjustments
          if (draggingClips && draggingClips.initialClips.has(clip.id)) {
            const dragInfo = draggingClips.initialClips.get(clip.id)!;
            const targetTrackIndex = Math.max(0, Math.min(project.tracks.length - 1, dragInfo.trackIndex + draggingClips.currentDrow));

            if (targetTrackIndex === trackIndex) {
              renderStart = Math.max(0, dragInfo.startSeconds + draggingClips.currentDt);
            } else {
              isGhost = true;
            }
          }

          const renderX = Math.round(renderStart * pixelsPerSecond) - scrollLeft;
          const renderW = Math.max(4, Math.round(renderDuration * pixelsPerSecond));
          const clipY = 4;
          const clipH = height - 8;
          const visiblePixels = getVisibleClipPixelRange(renderX, renderW, width);

          // Highlight colour: the clip's own hue, brighter (never a different colour)
          const hi = tint ? tint.border : shade.wave;

          // Clip Background Pill
          ctx.save();
          ctx.fillStyle = isGhost
            ? 'rgba(56, 189, 248, 0.08)'
            : shade.fill;
          ctx.beginPath();
          ctx.roundRect(renderX, clipY, renderW + (seamR ? 1 : 0), clipH, [seamL ? 0 : 4, seamR ? 0 : 4, seamR ? 0 : 4, seamL ? 0 : 4]);
          ctx.fill();

          // Clip waveform clipping region
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(renderX, clipY, renderW + (seamR ? 1 : 0), clipH, [seamL ? 0 : 4, seamR ? 0 : 4, seamR ? 0 : 4, seamL ? 0 : 4]);
          ctx.clip();

          // Waveform bars
          try {
            const asset = audioEngine.getAsset(clip.assetId);
            const samplesPerPixel = Math.max(1, (asset?.sampleRate || 48000) / pixelsPerSecond);
            const clipSampleRate = asset?.sampleRate || 48000;
            const visStartPx = visiblePixels.startPx;
            const visEndPx = visiblePixels.endPx;
            const visStartSample = ((clip.offsetSeconds || 0) + (visStartPx / pixelsPerSecond)) * clipSampleRate;
            const visEndSample = ((clip.offsetSeconds || 0) + (visEndPx / pixelsPerSecond)) * clipSampleRate;
            const peaks = asset ? peakProvider.getPeaksForRange(asset, visStartSample, visEndSample, samplesPerPixel) : null;

            if (peaks && peaks.mins.length > 0) {
              const sampleRate = asset?.sampleRate || 48000;
              const offsetSec = clip.offsetSeconds || 0;
              const fadeInSec = clip.fadeInSeconds || 0;
              const fadeOutSec = clip.fadeOutSeconds || 0;

              const midY = clipY + clipH / 2;
              const maxAmp = (clipH / 2 - 6) * Math.min(2.0, clip.gain);

              // Softer, slightly see-through strokes so dense audio reads as a clean outline, not a solid block.
              ctx.globalAlpha = isSelected ? 1 : 0.85;
              ctx.strokeStyle = clip.muted ? '#52525b' : shade.wave;
              if (isSelected && !clip.muted) {
                ctx.shadowColor = hi;
                ctx.shadowBlur = 4;
              }
              ctx.lineWidth = 1;
              ctx.beginPath();

              const startPx = visiblePixels.startPx;
              const endPx = visiblePixels.endPx;
              const step = peaks.samplesPerPixel;
              const firstBucket = peaks.firstBucket || 0;
              const samplesPerPx = sampleRate / pixelsPerSecond;

              // One column per screen pixel, aggregated over exactly the samples that pixel covers.
              for (let px = startPx; px < endPx; px++) {
                const s0 = offsetSec * sampleRate + px * samplesPerPx;
                const s1 = s0 + samplesPerPx;
                const b0 = Math.floor(s0 / step) - firstBucket;
                const b1 = Math.max(b0, Math.ceil(s1 / step) - 1 - firstBucket);
                if (b1 < 0 || b0 >= peaks.mins.length) continue;
                let minVal = Infinity;
                let maxVal = -Infinity;
                const lo = Math.max(0, b0);
                const hi = Math.min(peaks.mins.length - 1, b1);
                for (let b = lo; b <= hi; b++) {
                  if (peaks.mins[b] < minVal) minVal = peaks.mins[b];
                  if (peaks.maxs[b] > maxVal) maxVal = peaks.maxs[b];
                }

                if (Number.isFinite(minVal) && Number.isFinite(maxVal)) {
                  const y1 = midY - maxVal * maxAmp;
                  const y2 = midY - minVal * maxAmp;

                  ctx.moveTo(renderX + px + 0.5, Math.min(midY - 0.5, y1));
                  ctx.lineTo(renderX + px + 0.5, Math.max(midY + 0.5, y2));
                }
              }
              ctx.stroke();
              ctx.globalAlpha = 1;

              // Draw Fade In curve overlay
              if (fadeInSec > 0) {
                const fadeW = Math.min(renderW / 2, fadeInSec * pixelsPerSecond);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
                ctx.beginPath();
                ctx.moveTo(renderX, clipY);
                for (let fx = 0; fx <= fadeW; fx += 2) {
                  const t = fx / fadeW;
                  const factor = clip.fadeShape === 'exponential' ? Math.pow(t, 2) : t;
                  const fy = clipY + (1 - factor) * clipH;
                  ctx.lineTo(renderX + fx, fy);
                }
                ctx.lineTo(renderX, clipY + clipH);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#00F0FF';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(renderX, clipY + clipH);
                for (let fx = 0; fx <= fadeW; fx += 2) {
                  const t = fx / fadeW;
                  const factor = clip.fadeShape === 'exponential' ? Math.pow(t, 2) : t;
                  ctx.lineTo(renderX + fx, clipY + (1 - factor) * clipH);
                }
                ctx.stroke();
              }

              // Draw Fade Out curve overlay
              if (fadeOutSec > 0) {
                const fadeW = Math.min(renderW / 2, fadeOutSec * pixelsPerSecond);
                const fadeStartX = renderX + renderW - fadeW;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
                ctx.beginPath();
                ctx.moveTo(fadeStartX, clipY + clipH);
                for (let fx = 0; fx <= fadeW; fx += 2) {
                  const t = fx / fadeW;
                  const factor = clip.fadeShape === 'exponential' ? 1 - Math.pow(1 - t, 2) : t;
                  const fy = clipY + factor * clipH;
                  ctx.lineTo(fadeStartX + fx, fy);
                }
                ctx.lineTo(renderX + renderW, clipY);
                ctx.lineTo(renderX + renderW, clipY + clipH);
                ctx.closePath();
                ctx.fill();

                ctx.strokeStyle = '#00F0FF';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(fadeStartX, clipY);
                for (let fx = 0; fx <= fadeW; fx += 2) {
                  const t = fx / fadeW;
                  const factor = clip.fadeShape === 'exponential' ? 1 - Math.pow(1 - t, 2) : t;
                  ctx.lineTo(fadeStartX + fx, clipY + factor * clipH);
                }
                ctx.stroke();
              }
            }
          } catch (wfErr) {
            console.warn('Waveform draw warning for clip', clip.id, wfErr);
          }

          ctx.restore();

          // Clip Border and Selection Glow
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(renderX, clipY, renderW + (seamR ? 1 : 0), clipH, [seamL ? 0 : 4, seamR ? 0 : 4, seamR ? 0 : 4, seamL ? 0 : 4]);

          if (isSelected) {
            // Every clip glows in its own colour (a coloured clip stays that colour, only brighter and glowing)
            const glow = hi;
            ctx.fillStyle = withAlpha(glow, 0.14);
            ctx.fill();
            ctx.strokeStyle = glow;
            ctx.lineWidth = 2;
            ctx.shadowColor = glow;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            traceOutline(ctx, renderX, clipY, renderW, clipH, 4, seamL, seamR);
            ctx.stroke();
          } else if (isGhost) {
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            traceOutline(ctx, renderX, clipY, renderW, clipH, 4, seamL, seamR);
            ctx.stroke();
          } else {
            ctx.strokeStyle = shade.border;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            traceOutline(ctx, renderX, clipY, renderW, clipH, 4, seamL, seamR);
            ctx.stroke();
          }
          ctx.restore();

          // Volume line (single clips only; groups are levelled from the Master Console)
          if (!clip.groupId && !sm && !isGhost && renderW > 40 && clipH > 24 && (isSelected || clip.gain !== 1)) {
            const ly = gainToY(clip.gain, clipY, clipH);
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(renderX, clipY, renderW + (seamR ? 1 : 0), clipH, [seamL ? 0 : 4, seamR ? 0 : 4, seamR ? 0 : 4, seamL ? 0 : 4]);
            ctx.clip();
            ctx.strokeStyle = isSelected ? '#f5c451' : 'rgba(245, 196, 81, 0.45)';
            ctx.lineWidth = isSelected ? 1.5 : 1;
            ctx.setLineDash(isSelected ? [] : [3, 3]);
            ctx.beginPath();
            ctx.moveTo(renderX, ly);
            ctx.lineTo(renderX + renderW, ly);
            ctx.stroke();
            if (isSelected) {
              const db = clip.gain > 0 ? 20 * Math.log10(clip.gain) : -Infinity;
              const label = Number.isFinite(db) ? `${db > 0 ? '+' : ''}${db.toFixed(1)} dB` : '-∞ dB';
              ctx.font = '9px "JetBrains Mono", monospace';
              ctx.fillStyle = '#f5c451';
              ctx.textAlign = 'right';
              ctx.fillText(label, renderX + renderW - 6, Math.min(clipY + clipH - 3, Math.max(clipY + 10, ly - 3)));
            }
            ctx.restore();
          }

          // Titles are drawn once per clip, after every piece, across the whole clip
          drawn.push({ x: renderX, w: renderW, seamR, name: clip.name, selected: isSelected });

          // Draw Trimming Edge Grippers (left and right edge handles for inward waveform deletion), at the ends of the whole clip
          if (isSelected) {
            ctx.save();
            ctx.fillStyle = '#00F0FF';
            if (!seamL) ctx.fillRect(renderX - 1, clipY + 12, 3, clipH - 24);
            if (!seamR) ctx.fillRect(renderX + renderW - 2, clipY + 12, 3, clipH - 24);

            // Fade handles (dots at top corners)
            if (!seamL) {
              ctx.beginPath();
              const inHandleX = renderX + Math.min(renderW / 2, (clip.fadeInSeconds || 0) * pixelsPerSecond);
              ctx.arc(inHandleX, clipY + 4, 3.5, 0, Math.PI * 2);
              ctx.fill();
            }
            if (!seamR) {
              const outHandleX = renderX + renderW - Math.min(renderW / 2, (clip.fadeOutSeconds || 0) * pixelsPerSecond);
              ctx.beginPath();
              ctx.arc(outHandleX, clipY + 4, 3.5, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.restore();
          }
        }

        // Clip title bar text: one per clip, fitted to the clip's whole width so it never spills onto neighbours
        drawn.sort((p, q) => p.x - q.x);
        for (let i = 0; i < drawn.length; i++) {
          const head = drawn[i];
          let last = i;
          while (drawn[last].seamR && last + 1 < drawn.length) last += 1;
          const totalW = drawn[last].x + drawn[last].w - head.x;
          ctx.save();
          ctx.font = '10px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = head.selected ? '#f1f5f9' : '#cbd5e1';
          const titleText = fitTitle(displayTitle(head.name), totalW - TITLE_PAD_X * 2, (str) => ctx.measureText(str).width);
          if (titleText) ctx.fillText(titleText, head.x + TITLE_PAD_X, 16); // 4px lane padding + 12px baseline
          ctx.restore();
          i = last;
        }
      } catch (renderError) {
        console.error('Fatal render error in track waveform canvas:', renderError);
      } finally {
        ctx.restore();
      }
    },
    [project.tracks, project.groupSettings, selectedClipIds, draggingClips, pixelsPerSecond, scrollLeft, timelineWidth, waveformVersion, tool]
  );

  // Mouse hover over clip edges to show col-resize cursor
  // Hover popup with a clip's full title. Updated straight on its DOM node so pointer moves never re-render the timeline.
  const titleTipRef = useRef<HTMLDivElement | null>(null);
  const titleTipNameRef = useRef<HTMLSpanElement | null>(null);
  const titleTipMetaRef = useRef<HTMLSpanElement | null>(null);

  const hideTitleTip = () => {
    if (titleTipRef.current) titleTipRef.current.style.display = 'none';
  };

  const showTitleTip = (clientX: number, clientY: number, name: string, seconds: number) => {
    const tip = titleTipRef.current;
    if (!tip || !titleTipNameRef.current || !titleTipMetaRef.current) return;
    const meta = formatClipLength(seconds);
    const key = `${name}|${meta}`;
    if (tip.dataset.key !== key) {
      tip.dataset.key = key;
      titleTipNameRef.current.textContent = name;
      titleTipMetaRef.current.textContent = meta;
    }
    if (tip.style.display === 'none') tip.style.display = 'flex';
    // One line only: measured at its natural width, then placed left or right of the pointer so it never runs off screen.
    tip.style.maxWidth = `${window.innerWidth - 16}px`;
    const pos = placeTip(clientX, clientY, tip.offsetWidth, tip.offsetHeight, window.innerWidth, window.innerHeight);
    tip.style.left = `${pos.left}px`;
    tip.style.top = `${pos.top}px`;
  };

  const handleLanePointerMoveHover = (e: React.PointerEvent<HTMLDivElement>, track: Track) => {
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    if (draggingClips || edgeTrimDrag || marquee || fadeDrag || gainDrag || rangeDrag) {
      hideTitleTip();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const timeAtClick = clickX / pixelsPerSecond;

    // Pointer on a clip's title strip (and clear of the trim edges): show the full title.
    let tipClip: Clip | null = null;
    if (clickY >= 4 && clickY <= 20) {
      for (const clip of track.clips) {
        const leftPx = clip.startSeconds * pixelsPerSecond;
        const rightPx = (clip.startSeconds + clip.durationSeconds) * pixelsPerSecond;
        if (clickX > leftPx + 8 && clickX < rightPx - 8) {
          tipClip = clip;
          break;
        }
      }
    }
    if (tipClip) showTitleTip(e.clientX, e.clientY, displayTitle(tipClip.name), tipClip.durationSeconds);
    else hideTitleTip();

    let isNearEdge = false;
    const hoverSeams = seamFlags(track.clips);
    for (const clip of track.clips) {
      if (timeAtClick >= clip.startSeconds - 0.2 && timeAtClick <= clip.startSeconds + clip.durationSeconds + 0.2) {
        const leftEdgePx = clip.startSeconds * pixelsPerSecond;
        const rightEdgePx = (clip.startSeconds + clip.durationSeconds) * pixelsPerSecond;
        const hs = hoverSeams.get(clip.id);
        if ((!hs?.left && Math.abs(clickX - leftEdgePx) <= 8) || (!hs?.right && Math.abs(clickX - rightEdgePx) <= 8)) {
          isNearEdge = true;
          break;
        }
      }
    }

    if (isNearEdge) {
      e.currentTarget.style.cursor = 'col-resize';
    } else {
      e.currentTarget.style.cursor = 'crosshair';
    }
  };

  /**
   * Pointer down on track lane: handles edge trimming, fades, selection, dragging, and marquee
   */
  const handleLanePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    track: Track,
    trackIndex: number
  ) => {
    if (e.button === 2) return; // ignore right click for drag (let context menu handle)
    hideTitleTip();

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const timeAtClick = clickX / pixelsPerSecond;

    // Range tool (or Alt held): dragging highlights a span of this track. It never moves, trims or fades a clip.
    if (tool === 'range' || e.altKey) {
      onSelectTrack(track.id);
      // Clicking inside the range that is already highlighted keeps it (so double-click opens Quick Actions for it)
      if (
        rangeSelection &&
        rangeTrackIds(rangeSelection).includes(track.id) &&
        timeAtClick >= rangeSelection.startSeconds &&
        timeAtClick <= rangeSelection.endSeconds
      ) {
        return;
      }
      onRangeSelect(null);
      if (selectedClipIds.size > 0) onSelectClips(new Set());
      setRangeDrag({ trackId: track.id, trackIndex, anchorSeconds: Math.max(0, timeAtClick), startClientX: e.clientX, moved: false });
      return;
    }

    // Check if clicked inside a clip or on clip edge
    let clickedClip: Clip | null = null;
    let clickedFadeType: 'in' | 'out' | null = null;
    let clickedEdge: 'left' | 'right' | null = null;

    // Where pieces of one edited clip touch, there is no edge to trim and no fade handle: it is one clip
    const seams = seamFlags(track.clips);
    for (const clip of track.clips) {
      const leftEdgePx = clip.startSeconds * pixelsPerSecond;
      const rightEdgePx = (clip.startSeconds + clip.durationSeconds) * pixelsPerSecond;
      const sm = seams.get(clip.id);

      // Check edge trimmer within 8px
      if (!sm?.left && Math.abs(clickX - leftEdgePx) <= 8 && clickY > 16) {
        clickedClip = clip;
        clickedEdge = 'left';
        break;
      }
      if (!sm?.right && Math.abs(clickX - rightEdgePx) <= 8 && clickY > 16) {
        clickedClip = clip;
        clickedEdge = 'right';
        break;
      }

      if (timeAtClick >= clip.startSeconds && timeAtClick <= clip.startSeconds + clip.durationSeconds) {
        clickedClip = clip;

        // Check if clicked near fade handle (top area)
        if (clickY <= 16) {
          const fadeInPixel = clip.startSeconds * pixelsPerSecond + (clip.fadeInSeconds || 0) * pixelsPerSecond;
          const fadeOutPixel = (clip.startSeconds + clip.durationSeconds) * pixelsPerSecond - (clip.fadeOutSeconds || 0) * pixelsPerSecond;

          if (!sm?.left && Math.abs(clickX - fadeInPixel) <= 12) {
            clickedFadeType = 'in';
          } else if (!sm?.right && Math.abs(clickX - fadeOutPixel) <= 12) {
            clickedFadeType = 'out';
          }
        }
        break;
      }
    }

    // The on-clip volume line: grab it on a selected single clip and pull up or down (Ctrl+click resets to 0 dB).
    if (clickedClip && !clickedEdge && !clickedFadeType && !clickedClip.groupId && !seams.has(clickedClip.id) && selectedClipIds.has(clickedClip.id)) {
      const laneH = rect.height - 8;
      const lineY = gainToY(clickedClip.gain, 4, laneH);
      if (laneH > 24 && clickY > 16 && Math.abs(clickY - lineY) <= 5) {
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) {
          onUpdateClip(clickedClip.id, { gain: 1 });
        } else {
          setGainDrag({ clipId: clickedClip.id, laneTop: rect.top, clipH: laneH });
        }
        return;
      }
    }

    if (clickedClip) {
      // 1. Edge Trim Drag initiated (Inward drag wipes out/deletes that part of waveform)
      if (clickedEdge) {
        e.stopPropagation();
        onSelectClips(new Set([clickedClip.id]));
        onSelectTrack(track.id);

        setEdgeTrimDrag({
          clipId: clickedClip.id,
          trackId: track.id,
          edge: clickedEdge,
          startX: e.clientX,
          initialStartSeconds: clickedClip.startSeconds,
          initialOffsetSeconds: clickedClip.offsetSeconds || 0,
          initialDurationSeconds: clickedClip.durationSeconds,
        });
        return;
      }

      // 2. Fade handle drag initiated
      if (clickedFadeType) {
        setFadeDrag({
          clipId: clickedClip.id,
          type: clickedFadeType,
          startX: e.clientX,
          initialFade: clickedFadeType === 'in' ? clickedClip.fadeInSeconds : clickedClip.fadeOutSeconds,
          maxFade: clickedClip.durationSeconds / 2,
        });
        return;
      }

      // 3. Handle clip selection & floating drag
      let newSelected = new Set(selectedClipIds);
      if (e.shiftKey) {
        if (newSelected.has(clickedClip.id)) {
          for (const cid of chainIds(project.tracks, clickedClip.id)) newSelected.delete(cid);
        } else {
          newSelected.add(clickedClip.id);
        }
      } else {
        if (!newSelected.has(clickedClip.id)) {
          newSelected = new Set([clickedClip.id]);
        }
      }
      // Clips in a group are picked as one unit.
      const groupIds = new Set<string>();
      for (const t of project.tracks) for (const c of t.clips) if (newSelected.has(c.id) && c.groupId) groupIds.add(c.groupId);
      if (groupIds.size > 0) {
        for (const t of project.tracks) for (const c of t.clips) if (c.groupId && groupIds.has(c.groupId)) newSelected.add(c.id);
      }
      onSelectClips(newSelected);
      onSelectTrack(track.id);

      // Start sub-pixel floating drag
      const initialMap = new Map<string, { startSeconds: number; trackIndex: number; clip: Clip }>();

      for (let tIdx = 0; tIdx < project.tracks.length; tIdx++) {
        const trk = project.tracks[tIdx];
        for (const c of trk.clips) {
          if (newSelected.has(c.id)) {
            initialMap.set(c.id, {
              startSeconds: c.startSeconds,
              trackIndex: tIdx,
              clip: c,
            });
          }
        }
      }

      setDraggingClips({
        startX: e.clientX,
        startY: e.clientY,
        initialClips: initialMap,
        currentDt: 0,
        currentDrow: 0,
      });
    } else {
      // Clicked on empty space: select track, seek playhead, begin marquee
      onSelectTrack(track.id);
      onSeek(Math.max(0, timeAtClick));

      if (!e.shiftKey) {
        onSelectClips(new Set());
      }
      setMarquee({
        startX: clickX,
        startY: (focused ? 0 : trackIndex) * rowHeight + clickY,
        currentX: clickX,
        currentY: (focused ? 0 : trackIndex) * rowHeight + clickY,
      });
    }
  };

  // Global window pointer move and pointer up for drag, marquee, fade, and edge trimming
  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
      // 0. Range tool drag: highlight a span of one track
      if (rangeDrag && laneScrollContainerRef.current) {
        if (!rangeDrag.moved && Math.abs(e.clientX - rangeDrag.startClientX) < 3) return;
        const rect = laneScrollContainerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + laneScrollContainerRef.current.scrollLeft - currentHeaderWidth;
        const here = Math.max(0, x / pixelsPerSecond);
        if (!rangeDrag.moved) setRangeDrag({ ...rangeDrag, moved: true });
        // Dragging up or down across lanes widens the range to every track between where it began and the pointer
        const y = e.clientY - rect.top + laneScrollContainerRef.current.scrollTop;
        const overIndex = focused ? focusIndex : Math.max(0, Math.min(project.tracks.length - 1, Math.floor(y / rowHeight)));
        const lo = Math.min(rangeDrag.trackIndex, overIndex);
        const hi = Math.max(rangeDrag.trackIndex, overIndex);
        onRangeSelect({
          trackId: rangeDrag.trackId,
          trackIds: project.tracks.slice(lo, hi + 1).map((t) => t.id),
          startSeconds: Math.min(rangeDrag.anchorSeconds, here),
          endSeconds: Math.max(rangeDrag.anchorSeconds, here),
        });
        return;
      }

      // 1. Edge Trim Drag (Inward drag wipes out / deletes waveform)
      if (edgeTrimDrag) {
        const dx = e.clientX - edgeTrimDrag.startX;
        const dt = dx / pixelsPerSecond;

        if (edgeTrimDrag.edge === 'left') {
          // Dragging inward to the right (dt > 0) deletes left portion of waveform
          const trimAmount = Math.max(0, Math.min(edgeTrimDrag.initialDurationSeconds - 0.05, dt));
          const newStart = edgeTrimDrag.initialStartSeconds + trimAmount;
          const newOffset = edgeTrimDrag.initialOffsetSeconds + trimAmount;
          const newDuration = edgeTrimDrag.initialDurationSeconds - trimAmount;

          onUpdateClip(edgeTrimDrag.clipId, {
            startSeconds: newStart,
            offsetSeconds: newOffset,
            durationSeconds: newDuration,
          });
        } else {
          // Dragging inward to the left (dt < 0) deletes right portion of waveform
          const trimAmount = Math.max(0, Math.min(edgeTrimDrag.initialDurationSeconds - 0.05, -dt));
          const newDuration = edgeTrimDrag.initialDurationSeconds - trimAmount;

          onUpdateClip(edgeTrimDrag.clipId, {
            durationSeconds: newDuration,
          });
        }
        return;
      }

      // 2. Clips drag
      if (draggingClips) {
        const dx = e.clientX - draggingClips.startX;
        const dy = e.clientY - draggingClips.startY;
        const dt = dx / pixelsPerSecond;
        const drow = focused ? 0 : Math.round(dy / rowHeight);

        setDraggingClips(prev => (prev ? { ...prev, currentDt: dt, currentDrow: drow } : null));
      }

      // 3. Marquee drag
      if (marquee && laneScrollContainerRef.current) {
        const rect = laneScrollContainerRef.current.getBoundingClientRect();
        const currentX = e.clientX - rect.left + laneScrollContainerRef.current.scrollLeft - currentHeaderWidth;
        const currentY = e.clientY - rect.top + laneScrollContainerRef.current.scrollTop;
        setMarquee(prev => (prev ? { ...prev, currentX, currentY } : null));

        const minX = Math.min(marquee.startX, currentX);
        const maxX = Math.max(marquee.startX, currentX);
        const minY = Math.min(marquee.startY, currentY);
        const maxY = Math.max(marquee.startY, currentY);

        const startTime = minX / pixelsPerSecond;
        const endTime = maxX / pixelsPerSecond;
        const startTrack = focused ? focusIndex : Math.floor(minY / rowHeight);
        const endTrack = focused ? focusIndex : Math.floor(maxY / rowHeight);

        const selected = new Set<string>();
        for (let tIdx = 0; tIdx < project.tracks.length; tIdx++) {
          if (tIdx >= startTrack && tIdx <= endTrack) {
            for (const clip of project.tracks[tIdx].clips) {
              const clipEnd = clip.startSeconds + clip.durationSeconds;
              if (clip.startSeconds <= endTime && clipEnd >= startTime) {
                selected.add(clip.id);
              }
            }
          }
        }
        onSelectClips(selected);
      }

      // 3b. Volume line drag
      if (gainDrag) {
        onUpdateClip(gainDrag.clipId, { gain: yToGain(e.clientY - gainDrag.laneTop, 4, gainDrag.clipH) });
      }

      // 4. Fade drag
      if (fadeDrag) {
        const dx = e.clientX - fadeDrag.startX;
        const dt = (fadeDrag.type === 'in' ? dx : -dx) / pixelsPerSecond;
        const newFade = Math.max(0, Math.min(fadeDrag.maxFade, fadeDrag.initialFade + dt));

        if (fadeDrag.type === 'in') {
          onUpdateClip(fadeDrag.clipId, { fadeInSeconds: newFade });
        } else {
          onUpdateClip(fadeDrag.clipId, { fadeOutSeconds: newFade });
        }
      }
    };

    const handleWindowPointerUp = () => {
      // 1. Commit Edge Trim
      if (edgeTrimDrag) {
        setEdgeTrimDrag(null);
      }

      // 2. Commit Clip Drag with DECOUPLED TRACK MOVEMENT & OVERLAP PREVENTION
      if (draggingClips) {
        const { initialClips, currentDt, currentDrow } = draggingClips;
        if (currentDt !== 0 || currentDrow !== 0) {
          // Clone all tracks so other clips (including the other half of a split) remain completely untouched!
          const newTracks = project.tracks.map(t => ({
            ...t,
            clips: [...t.clips],
          }));

          const draggedClipIds = new Set(initialClips.keys());

          // Remove dragged clips from their source tracks
          for (const [clipId, info] of initialClips.entries()) {
            const srcIdx = info.trackIndex;
            if (srcIdx >= 0 && srcIdx < newTracks.length) {
              newTracks[srcIdx].clips = newTracks[srcIdx].clips.filter(c => c.id !== clipId);
            }
          }

          // Insert each dragged clip into its target track with overlap prevention
          for (const [clipId, info] of initialClips.entries()) {
            const srcIdx = info.trackIndex;
            const targetIdx = Math.max(0, Math.min(newTracks.length - 1, srcIdx + currentDrow));
            const targetTrack = newTracks[targetIdx];

            let candidateStart = Math.max(0, info.startSeconds + currentDt);
            const clipDuration = info.clip.durationSeconds;

            // COLLISION & OVERLAP PREVENTION (Point 8)
            // Once edges touch, clips cannot move across, overlap, or cover each other.
            const otherClips = targetTrack.clips.filter(c => c.id !== clipId);
            otherClips.sort((a, b) => a.startSeconds - b.startSeconds);

            // Left obstacle boundary (clips that finish before or at candidate start)
            let minAllowedStart = 0;
            for (const other of otherClips) {
              const otherEnd = other.startSeconds + other.durationSeconds;
              if (other.startSeconds < candidateStart || (srcIdx === targetIdx && other.startSeconds < info.startSeconds)) {
                minAllowedStart = Math.max(minAllowedStart, otherEnd);
              }
            }

            // Right obstacle boundary (clips that start after candidate start)
            let maxAllowedStart = Infinity;
            for (const other of otherClips) {
              if (other.startSeconds > candidateStart || (srcIdx === targetIdx && other.startSeconds > info.startSeconds)) {
                maxAllowedStart = Math.min(maxAllowedStart, other.startSeconds - clipDuration);
                break;
              }
            }

            candidateStart = Math.max(minAllowedStart, candidateStart);
            if (maxAllowedStart !== Infinity) {
              candidateStart = Math.min(maxAllowedStart, candidateStart);
            }
            candidateStart = Math.max(0, candidateStart);

            const movedClip: Clip = {
              ...info.clip,
              trackId: targetTrack.id,
              startSeconds: candidateStart,
            };

            targetTrack.clips.push(movedClip);
            targetTrack.clips.sort((a, b) => a.startSeconds - b.startSeconds);
          }

          // A lane emptied by this move that was never renamed, mixed or given effects would be left as an orphan
          const { tracks: tidyTracks, removedIds } = pruneEmptiedTracks(
            project.tracks,
            newTracks,
            (id) => pluginManager.getPluginsForTrack(id).length > 0
          );
          onUpdateProject({ ...project, tracks: tidyTracks });
          if (removedIds.length > 0) onTracksAutoRemoved?.(removedIds);
        }
        setDraggingClips(null);
      }

      if (marquee) {
        setMarquee(null);
      }

      if (rangeDrag) {
        // A click without a drag just moves the playhead, like a click on an empty lane.
        if (!rangeDrag.moved) onSeek(rangeDrag.anchorSeconds);
        setRangeDrag(null);
      }

      if (fadeDrag) {
        setFadeDrag(null);
      }
      if (gainDrag) {
        setGainDrag(null);
      }
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
    };
  }, [
    edgeTrimDrag,
    draggingClips,
    focused,
    focusIndex,
    rowHeight,
    marquee,
    rangeDrag,
    fadeDrag,
    gainDrag,
    pixelsPerSecond,
    onRangeSelect,
    onSeek,
    project,
    currentHeaderWidth,
    onSelectClips,
    onUpdateClip,
    onUpdateProject,
    onTracksAutoRemoved,
  ]);

  /** A clip the highlighted range touches (Quick Actions needs one to anchor to). Prefers the given track. */
  const rangeRepClip = (preferTrackId?: string): Clip | null => {
    if (!rangeSelection) return null;
    const ids = rangeTrackIds(rangeSelection);
    const ordered = [...project.tracks].filter((t) => ids.includes(t.id)).sort((a, b) => (a.id === preferTrackId ? -1 : b.id === preferTrackId ? 1 : 0));
    for (const t of ordered) {
      const hit = t.clips.find((c) => c.startSeconds < rangeSelection.endSeconds && c.startSeconds + c.durationSeconds > rangeSelection.startSeconds);
      if (hit) return hit;
    }
    return null;
  };

  // Double click on lane: opens quick-action strip
  const handleLaneDoubleClick = (e: React.MouseEvent<HTMLDivElement>, track: Track) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const timeAtClick = clickX / pixelsPerSecond;

    // Inside a highlighted range: Quick Actions works on the range
    if (rangeSelection && rangeTrackIds(rangeSelection).includes(track.id) && timeAtClick >= rangeSelection.startSeconds && timeAtClick <= rangeSelection.endSeconds) {
      const rep = rangeRepClip(track.id);
      if (rep) {
        setActionStrip({ clip: rep, range: true, position: { x: Math.min(window.innerWidth - 320, e.clientX + 8), y: e.clientY + 8 } });
        return;
      }
    }

    for (const clip of track.clips) {
      if (timeAtClick >= clip.startSeconds && timeAtClick <= clip.startSeconds + clip.durationSeconds) {
        setActionStrip({
          clip,
          position: { x: Math.min(window.innerWidth - 320, e.clientX + 8), y: e.clientY + 8 },
        });
        onSelectClips(new Set([clip.id]));
        onSelectTrack(track.id);
        break;
      }
    }
  };

  // Right-click on lane: opens custom context menu
  const handleLaneContextMenu = (e: React.MouseEvent<HTMLDivElement>, track: Track) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const timeAtClick = Math.max(0, clickX / pixelsPerSecond);

    onSelectTrack(track.id);
    setContextMenu({
      x: Math.min(window.innerWidth - 240, e.clientX),
      y: Math.min(window.innerHeight - 200, e.clientY),
      timeSeconds: timeAtClick,
      track,
    });
  };

  // Drag and Drop Audio File Import
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragOverFiles) setIsDragOverFiles(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverFiles(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOverFiles(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileDrop(e.dataTransfer.files);
    }
  };

  // Drag scrub directly from the playhead head marker on the time ruler
  const handlePlayheadPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startClientX = e.clientX;
    const startPlayhead = playheadSeconds;

    const onPointerMove = (moveEv: PointerEvent) => {
      const deltaPx = moveEv.clientX - startClientX;
      const newTime = Math.max(0, startPlayhead + deltaPx / pixelsPerSecond);
      onSeek(newTime);
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={(e) => e.preventDefault()}
      className="flex-1 flex flex-col min-w-0 h-full bg-[#0A0A0C] relative select-none overflow-hidden"
    >
      {/* Hover popup: a clip's full title (positioned and filled directly by the hover handler) */}
      <div
        ref={titleTipRef}
        role="tooltip"
        style={{ display: 'none' }}
        className="uuda-pop-in pointer-events-none fixed z-[70] items-baseline gap-2 whitespace-nowrap rounded-control border border-line-strong bg-surface-2/95 px-2.5 py-1.5 text-[11px] leading-snug text-ink shadow-float backdrop-blur-sm"
      >
        <span ref={titleTipNameRef} className="min-w-0 truncate font-medium" />
        <span ref={titleTipMetaRef} className="font-num shrink-0 text-[10px] text-ink-faint" />
      </div>

      {/* Top Timeline Ruler with collapsible controller toggle */}
      <TimelineRuler
        pixelsPerSecond={pixelsPerSecond}
        totalDurationSeconds={totalDurationSeconds}
        playheadSeconds={playheadSeconds}
        scrollLeft={scrollLeft}
        onSeek={onSeek}
        timelineWidth={timelineWidth}
        isControlsCollapsed={isControlsCollapsed}
        onToggleCollapseControls={handleToggleControls}
      />

      {/* Unified Playhead: Head on the time ruler + Body Line across all tracks (always perfectly synchronized) */}
      {(() => {
        const playheadX = currentHeaderWidth + playheadSeconds * pixelsPerSecond - scrollLeft;
        if (playheadX < currentHeaderWidth - 8 || playheadX > currentHeaderWidth + timelineWidth + 8) {
          return null;
        }
        return (
          <div
            aria-label={`Playhead: ${formatTimecode(playheadSeconds)}`}
            style={{
              left: `${playheadX}px`,
            }}
            className="absolute top-0 bottom-0 z-30 pointer-events-none select-none"
          >
            {/* Playhead Head directly on the Time Ruler (28px height) */}
            <div
              className="absolute top-0 -translate-x-1/2 pointer-events-auto cursor-ew-resize flex flex-col items-center group"
              onPointerDown={handlePlayheadPointerDown}
              title={`Playhead: ${formatTimecode(playheadSeconds)} (Drag to scrub)`}
            >
              <svg
                width="16"
                height="22"
                viewBox="0 0 16 22"
                fill="none"
                className="filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] drop-shadow-[0_0_6px_rgba(0,240,255,0.7)] text-cyan-400 group-hover:text-cyan-300 transition-colors"
              >
                <path
                  d="M1 0H15C15.5523 0 16 0.447715 16 1V13.5C16 13.8441 15.8236 14.1634 15.5348 14.3503L8.53484 18.8796C8.20935 19.09 7.79065 19.09 7.46516 18.8796L0.465164 14.3503C0.176412 14.1634 0 13.8441 0 13.5V1C0 0.447715 0.447715 0 1 0Z"
                  fill="#00F0FF"
                />
                <line x1="8" y1="3" x2="8" y2="12" stroke="#0A0A0E" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>

            {/* Playhead Body Line seamlessly connecting from the tip of the head down through all track rows */}
            <div className="absolute top-[18px] bottom-0 -translate-x-[0.75px] w-[1.5px] bg-[#00F0FF] shadow-[0_0_8px_#00F0FF]" />
          </div>
        );
      })()}

      {/* Main Track Rows Scroll Container */}
      <div
        ref={laneScrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-auto relative"
      >
        {project.tracks.length === 0 ? (
          /* Empty Timeline State */
          <div className="flex flex-col items-center justify-center h-full min-h-[360px] text-zinc-500 p-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center justify-center mb-4 text-cyan-400/80">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-zinc-200 mb-1">Timeline is empty</h3>
            <p className="text-xs text-zinc-500 max-w-sm mb-4">
              Drop audio files (.wav, .mp3, .m4a) anywhere or click <strong className="text-zinc-300">Import Audio</strong> in the top bar.
            </p>
            <div className="text-[11px] font-mono text-zinc-600 bg-zinc-900/60 px-3 py-1.5 rounded border border-zinc-800/80">
              New tracks are added below the existing ones
            </div>
          </div>
        ) : (
          <div
            style={{ width: `${currentHeaderWidth + lanePixelWidth}px` }}
            className="flex flex-col min-w-full relative"
          >
            {/* Marquee Selection Rectangle Box */}
            {marquee && (
              <div
                style={{
                  left: `${currentHeaderWidth + Math.min(marquee.startX, marquee.currentX)}px`,
                  top: `${Math.min(marquee.startY, marquee.currentY)}px`,
                  width: `${Math.abs(marquee.currentX - marquee.startX)}px`,
                  height: `${Math.abs(marquee.currentY - marquee.startY)}px`,
                }}
                className="absolute border border-cyan-400 bg-cyan-500/15 pointer-events-none z-30 rounded-xs"
              />
            )}

            {/* Track rows (Controls + Waveform in ONE grid container) */}
            {(focused ? [project.tracks[focusIndex]] : project.tracks).map((track, visibleIndex) => {
              const trackIndex = focused ? focusIndex : visibleIndex;
              return (
              <TrackRowContainer
                key={track.id}
                rowHeight={rowHeight}
                track={track}
                trackIndex={trackIndex}
                totalTracks={project.tracks.length}
                isSelected={track.id === selectedTrackId}
                laneWidth={lanePixelWidth}
                timelineWidth={timelineWidth}
                scrollLeft={scrollLeft}
                pixelsPerSecond={pixelsPerSecond}
                isControlsCollapsed={isControlsCollapsed}
                onSelectTrack={onSelectTrack}
                onUpdateTrack={onUpdateTrack}
                onDeleteTrack={onDeleteTrack}
                onMoveTrack={onMoveTrack}
                onRecordTrack={onRecordTrack}
                rangeTool={tool === 'range'}
                rangeHighlight={rangeSelection && rangeTrackIds(rangeSelection).includes(track.id) ? rangeSelection : null}
                renderWaveforms={renderTrackWaveforms}
                onLanePointerDown={handleLanePointerDown}
                onLanePointerMoveHover={handleLanePointerMoveHover}
                onLanePointerLeave={hideTitleTip}
                onLaneDoubleClick={handleLaneDoubleClick}
                onLaneContextMenu={handleLaneContextMenu}
              />
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Action Strip Popup */}
      {actionStrip && stripClip && (
        <ClipActionStrip
          clip={stripClip}
          range={actionStrip.range && rangeSelection ? { seconds: rangeSelection.endSeconds - rangeSelection.startSeconds } : null}
          focusActive={focused}
          onToggleFocus={onToggleFocus}
          focusSolo={focusSolo}
          onToggleFocusSolo={onToggleFocusSolo}
          onSilence={onSilence}
          onRangeGain={onRangeGain}
          onDeleteRange={onDeleteRange}
          selectedCount={selectionUnitCount(project.tracks, selectedClipIds)}
          selectedIds={Array.from(selectedClipIds)}
          onUpdateClips={onUpdateClips}
          group={(() => {
            // exactly one group selected: its own level, pan and mute show in Quick Actions
            const gids = new Set<string | undefined>();
            for (const t of project.tracks) for (const c of t.clips) if (selectedClipIds.has(c.id)) gids.add(c.groupId);
            if (gids.size !== 1) return null;
            const [gid] = [...gids];
            if (!gid) return null;
            const summary = summarizeGroups(project).find((g) => g.id === gid);
            return summary ? { id: gid, name: summary.name, color: summary.color.border, settings: project.groupSettings?.[gid] } : null;
          })()}
          onUpdateGroup={onUpdateGroup}
          soloGroupId={soloGroupId}
          onToggleSolo={onToggleSolo}
          isGrouped={project.tracks.some((t) => t.clips.some((c) => selectedClipIds.has(c.id) && !!c.groupId))}
          position={actionStrip.position}
          canPaste={canPaste}
          onClose={() => setActionStrip(null)}
          onSplit={onSplitClip}
          onCopy={onCopyClip}
          onCut={onCutClip}
          onPaste={onPasteClip}
          onDelete={(id) => {
            if (selectedClipIds.size > 1) Array.from(selectedClipIds).forEach((cid) => onDeleteClip(cid));
            else onDeleteClip(id);
          }}
          onToggleMute={onToggleMuteClip}
          onMoveTrack={onMoveClipTrack}
          onUpdateClip={onUpdateClip}
          onOpenDsp={onOpenDspModal}
          onOpenExport={onOpenExport}
          onOpenPlugins={() => {
            let groupId: string | undefined;
            for (const t of project.tracks) for (const c of t.clips) if (!groupId && selectedClipIds.has(c.id) && c.groupId) groupId = c.groupId;
            onOpenPlugins?.(groupId);
          }}
          onGroup={onGroupSelected}
          onUngroup={onUngroupSelected}
        />
      )}

      {/* Custom Context Menu on Lane */}
      {contextMenu && (
        <div
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
          className="timeline-context-menu-container fixed z-40 bg-surface-2 border border-line-strong rounded-card shadow-float py-1.5 px-1 text-xs text-ink-dim w-64 uuda-pop-in select-none"
        >
          <div className="px-2.5 py-1 text-[10px] font-mono text-zinc-400 border-b border-zinc-800 mb-1 flex items-center justify-between">
            <span className="truncate max-w-[120px] text-zinc-300 font-semibold">{getTrackLabel(contextMenu.track, Math.max(0, project.tracks.findIndex((t) => t.id === contextMenu.track.id)))}</span>
            <span className="text-cyan-400 font-bold">{contextMenu.timeSeconds.toFixed(3)}s</span>
          </div>

          <button
            disabled={!canPaste}
            onClick={() => {
              onPasteClip(contextMenu.track.id, contextMenu.timeSeconds);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 hover:bg-cyan-500/20 hover:text-cyan-300 disabled:opacity-30 disabled:pointer-events-none transition-colors"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-cyan-400" />
            <span>Paste Clip Here ({contextMenu.timeSeconds.toFixed(2)}s)</span>
          </button>

          <button
            onClick={() => {
              onSeek(contextMenu.timeSeconds);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 hover:bg-zinc-800 transition-colors"
          >
            <Clock className="w-3.5 h-3.5 text-zinc-400" />
            <span>Set Playhead Here</span>
          </button>

          <button
            onClick={() => {
              onMoveTrack(contextMenu.track.id, 'up');
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 hover:bg-zinc-800 transition-colors"
          >
            <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
            <span>Move Track Row Up (▲)</span>
          </button>

          <button
            onClick={() => {
              onMoveTrack(contextMenu.track.id, 'down');
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded flex items-center gap-2 hover:bg-zinc-800 transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            <span>Move Track Row Down (▼)</span>
          </button>
        </div>
      )}

      {/* File Drop Overlay */}
      {isDragOverFiles && (
        <div className="absolute inset-0 bg-[#0A0A0C]/90 border-2 border-dashed border-cyan-400 z-50 flex flex-col items-center justify-center backdrop-blur-xs pointer-events-none">
          <div className="p-4 rounded-xl bg-[#121218] border border-cyan-500/50 shadow-[0_0_30px_rgba(0,240,255,0.2)] text-center">
            <svg className="w-10 h-10 text-cyan-400 mx-auto mb-2 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <div className="text-sm font-bold text-zinc-100">Drop Audio Files to Import</div>
            <div className="text-xs text-zinc-400 mt-1">.wav, .mp3, .m4a will be decoded onto a new top track</div>
          </div>
        </div>
      )}
    </div>
  );
};

interface TrackRowContainerProps {
  track: Track;
  trackIndex: number;
  totalTracks: number;
  isSelected: boolean;
  laneWidth: number;
  timelineWidth: number;
  scrollLeft: number;
  pixelsPerSecond: number;
  isControlsCollapsed: boolean;
  onSelectTrack: (trackId: string) => void;
  onUpdateTrack: (trackId: string, updates: Partial<Track>) => void;
  onDeleteTrack: (trackId: string) => void;
  onMoveTrack: (trackId: string, direction: 'up' | 'down') => void;
  onRecordTrack: (trackId: string) => void;
  rangeTool: boolean;
  rangeHighlight: RangeSelection | null;
  renderWaveforms: (canvas: HTMLCanvasElement | null, track: Track, trackIndex: number) => void;
  onLanePointerDown: (e: React.PointerEvent<HTMLDivElement>, track: Track, trackIndex: number) => void;
  onLanePointerMoveHover: (e: React.PointerEvent<HTMLDivElement>, track: Track) => void;
  onLanePointerLeave: () => void;
  onLaneDoubleClick: (e: React.MouseEvent<HTMLDivElement>, track: Track) => void;
  onLaneContextMenu: (e: React.MouseEvent<HTMLDivElement>, track: Track) => void;
  rowHeight: number;
}

const TrackRowContainer = React.memo<TrackRowContainerProps>(({
  rowHeight,
  track,
  trackIndex,
  totalTracks,
  isSelected,
  laneWidth,
  timelineWidth,
  scrollLeft,
  pixelsPerSecond,
  isControlsCollapsed,
  rangeTool,
  rangeHighlight,
  onSelectTrack,
  onUpdateTrack,
  onDeleteTrack,
  onMoveTrack,
  onRecordTrack,
  renderWaveforms,
  onLanePointerDown,
  onLanePointerMoveHover,
  onLanePointerLeave,
  onLaneDoubleClick,
  onLaneContextMenu,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    renderWaveforms(canvasRef.current, track, trackIndex);
  }, [track, trackIndex, isSelected, laneWidth, timelineWidth, scrollLeft, renderWaveforms, rowHeight]);

  return (
    <div
      style={{ height: `${rowHeight}px` }}
      className="flex w-full min-w-max border-b border-line bg-surface-1 relative shadow-[0_1px_0_rgba(0,0,0,0.4)]"
    >
      {/* Sticky Track Controls Column (272px or 32px collapsed) */}
      <TrackControls
        track={track}
        index={trackIndex}
        totalTracks={totalTracks}
        isSelected={isSelected}
        isCollapsed={isControlsCollapsed}
        onSelectTrack={onSelectTrack}
        onUpdateTrack={onUpdateTrack}
        onDeleteTrack={onDeleteTrack}
        onMoveTrack={onMoveTrack}
        onRecordTrack={onRecordTrack}
      />

      {/* 1fr Waveform Lane */}
      <div
        style={{ width: `${laneWidth}px` }}
        onPointerDown={(e) => onLanePointerDown(e, track, trackIndex)}
        onPointerMove={(e) => onLanePointerMoveHover(e, track)}
        onPointerLeave={onLanePointerLeave}
        onDoubleClick={(e) => onLaneDoubleClick(e, track)}
        onContextMenu={(e) => onLaneContextMenu(e, track)}
        className={`h-full relative overflow-hidden bg-surface-0 hover:bg-surface-1 transition-colors border-b border-line ${rangeTool ? 'cursor-crosshair' : ''}`}
      >
        <canvas
          ref={canvasRef}
          width={Math.round(Math.max(100, timelineWidth) * getDpr())}
          height={Math.round(rowHeight * getDpr())}
          style={{
            position: 'absolute',
            left: `${scrollLeft}px`,
            top: 0,
            width: `${timelineWidth}px`,
            height: `${rowHeight}px`,
            pointerEvents: 'none',
          }}
          className="block pointer-events-none"
        />
        {rangeHighlight && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 border-x border-accent/60 bg-accent/15"
            style={{
              left: `${rangeHighlight.startSeconds * pixelsPerSecond}px`,
              width: `${Math.max(1, (rangeHighlight.endSeconds - rangeHighlight.startSeconds) * pixelsPerSecond)}px`,
            }}
          />
        )}
      </div>
    </div>
  );
});
