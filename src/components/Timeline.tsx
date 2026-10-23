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

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { ClipboardPaste, Clock, ChevronUp, ChevronDown } from 'lucide-react';
import { Project, Track, Clip, Asset } from '../types';
import { TrackControls } from './TrackControls';
import { TimelineRuler } from './TimelineRuler';
import { ClipActionStrip } from './ClipActionStrip';
import { waveformCache } from '../waveform/cache';
import { audioEngine } from '../audio/engine';
import { formatTimecode } from '../utils/formatters';

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
  onSeek: (seconds: number) => void;
  onSplitClip: (clipId: string) => void;
  onDeleteClip: (clipId: string) => void;
  onDuplicateClip: (clipId: string) => void;
  onCopyClip: (clipId: string) => void;
  onCutClip: (clipId: string) => void;
  onPasteClip: (targetTrackId?: string, targetTimeSeconds?: number) => void;
  canPaste: boolean;
  onToggleMuteClip: (clipId: string) => void;
  onOpenDspModal: (type: import('./DspModals').DspModalType) => void;
  onMoveClipTrack: (clipId: string, direction: 'up' | 'down') => void;
  onMoveTrack: (trackId: string, direction: 'up' | 'down') => void;
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

interface FadeDragState {
  clipId: string;
  type: 'in' | 'out';
  startX: number;
  initialFade: number;
  maxFade: number;
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
  onSeek,
  onSplitClip,
  onDeleteClip,
  onDuplicateClip,
  onCopyClip,
  onCutClip,
  onPasteClip,
  canPaste,
  onToggleMuteClip,
  onOpenDspModal,
  onMoveClipTrack,
  onMoveTrack,
  onUpdateClip,
  onFileDrop,
  isControlsCollapsed: propControlsCollapsed,
  onToggleCollapseControls: propToggleCollapseControls,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const laneScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [timelineWidth, setTimelineWidth] = useState<number>(1200);
  const [scrollLeft, setScrollLeft] = useState<number>(0);
  const [scrollTop, setScrollTop] = useState<number>(0);

  // Local controller collapse state if not driven by parent
  const [localControlsCollapsed, setLocalControlsCollapsed] = useState<boolean>(false);
  const isControlsCollapsed = propControlsCollapsed !== undefined ? propControlsCollapsed : localControlsCollapsed;
  const handleToggleControls = propToggleCollapseControls || (() => setLocalControlsCollapsed(prev => !prev));

  const currentHeaderWidth = isControlsCollapsed ? COLLAPSED_HEADER_WIDTH : FULL_HEADER_WIDTH;

  // Quick Action Strip state
  const [actionStrip, setActionStrip] = useState<{
    clip: Clip;
    position: { x: number; y: number };
  } | null>(null);

  // Dragging clips state
  const [draggingClips, setDraggingClips] = useState<DraggingClipsState | null>(null);

  // Edge trimming drag state (inward drag deletes/wipes out waveform)
  const [edgeTrimDrag, setEdgeTrimDrag] = useState<EdgeTrimDragState | null>(null);

  // Marquee selection state
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  // Fade handle drag state
  const [fadeDrag, setFadeDrag] = useState<FadeDragState | null>(null);

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

  // Synchronize horizontal & vertical scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
    setScrollTop(e.currentTarget.scrollTop);
  };

  // Keep the playhead in view during playback without forcing continuous scrolling.
  useEffect(() => {
    if (!audioEngine.getIsPlaying()) return;
    const viewport = laneScrollContainerRef.current;
    if (!viewport) return;
    const playheadX = currentHeaderWidth + playheadSeconds * pixelsPerSecond;
    const viewportRight = viewport.scrollLeft + viewport.clientWidth;
    const rightSafetyMargin = 64;
    if (playheadX > viewportRight - rightSafetyMargin) {
      viewport.scrollLeft = Math.max(0, playheadX - viewport.clientWidth + rightSafetyMargin * 2);
    }
  }, [playheadSeconds, pixelsPerSecond, currentHeaderWidth]);

  // Keyboard navigation & Shortcuts (S=split, Ctrl+C=copy, etc.)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.key === 's' || e.key === 'S') {
        if (!e.ctrlKey && !e.metaKey && selectedClipIds.size === 1) {
          e.preventDefault();
          const [clipId] = Array.from(selectedClipIds);
          onSplitClip(clipId);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipIds.size > 0) {
          e.preventDefault();
          for (const clipId of selectedClipIds) {
            onDeleteClip(clipId);
          }
        }
      } else if (e.key === 'Escape') {
        onSelectClips(new Set());
        setActionStrip(null);
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedClipIds, onSplitClip, onDeleteClip, onSelectClips]);

  /**
   * Render Track Waveforms onto canvas
   */
  const renderTrackWaveforms = useCallback(
    (canvas: HTMLCanvasElement | null, track: Track, trackIndex: number) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      // The canvas is positioned at scrollLeft inside the full-width lane. Translate
      // timeline-space drawing into this viewport-sized canvas.
      ctx.save();
      ctx.translate(-scrollLeft, 0);

      // Background lane color, in timeline coordinates.
      ctx.fillStyle = trackIndex % 2 === 0 ? '#0B0B10' : '#0E0E14';
      ctx.fillRect(scrollLeft, 0, width, height);

      // Subtle horizontal centerline
      ctx.strokeStyle = '#181822';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(scrollLeft, height / 2 + 0.5);
      ctx.lineTo(scrollLeft + width, height / 2 + 0.5);
      ctx.stroke();

      try {
        for (const clip of track.clips) {
          let renderStart = clip.startSeconds;
          let renderDuration = clip.durationSeconds;
          const isSelected = selectedClipIds.has(clip.id);
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

          const renderX = Math.round(renderStart * pixelsPerSecond);
          const renderW = Math.max(4, Math.round(renderDuration * pixelsPerSecond));
          const clipY = 4;
          const clipH = height - 8;

          // Clip Background Pill
          ctx.save();
          ctx.fillStyle = isSelected
            ? 'rgba(0, 240, 255, 0.16)'
            : isGhost
            ? 'rgba(56, 189, 248, 0.08)'
            : 'rgba(24, 27, 38, 0.9)';
          ctx.beginPath();
          ctx.roundRect(renderX, clipY, renderW, clipH, 4);
          ctx.fill();

          // Clip waveform clipping region
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(renderX, clipY, renderW, clipH, 4);
          ctx.clip();

          // Waveform bars
          try {
            const asset = audioEngine.getAsset(clip.assetId);
            const samplesPerPixel = Math.max(1, (asset?.sampleRate || 48000) / pixelsPerSecond);
            const peaks = asset?.buffer ? waveformCache.getPeaks(clip.assetId, asset.buffer, samplesPerPixel) : null;

            if (peaks && peaks.mins.length > 0) {
              const sampleRate = asset?.sampleRate || 48000;
              const durSec = clip.durationSeconds;
              const offsetSec = clip.offsetSeconds || 0;
              const fadeInSec = clip.fadeInSeconds || 0;
              const fadeOutSec = clip.fadeOutSeconds || 0;

              const midY = clipY + clipH / 2;
              const maxAmp = (clipH / 2 - 2) * Math.min(2.0, clip.gain);

              ctx.strokeStyle = isSelected
                ? '#00F0FF'
                : clip.muted
                ? '#52525b'
                : '#38bdf8';
              ctx.lineWidth = 1;
              ctx.beginPath();

              const startBucket = Math.floor((offsetSec * sampleRate) / peaks.samplesPerPixel);
              const startPx = Math.max(0, Math.floor(scrollLeft - renderX));
              const endPx = Math.min(renderW, Math.ceil(scrollLeft + timelineWidth - renderX));

              for (let px = startPx; px < endPx; px++) {
                const bucket = startBucket + Math.floor((px / renderW) * (durSec * sampleRate / peaks.samplesPerPixel));
                if (bucket >= 0 && bucket < peaks.mins.length) {
                  const minVal = peaks.mins[bucket];
                  const maxVal = peaks.maxs[bucket];

                  if (Number.isFinite(minVal) && Number.isFinite(maxVal)) {
                    const y1 = midY - maxVal * maxAmp;
                    const y2 = midY - minVal * maxAmp;

                    ctx.moveTo(renderX + px + 0.5, Math.min(midY - 0.5, y1));
                    ctx.lineTo(renderX + px + 0.5, Math.max(midY + 0.5, y2));
                  }
                }
              }
              ctx.stroke();

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
          ctx.roundRect(renderX, clipY, renderW, clipH, 4);

          if (isSelected) {
            ctx.strokeStyle = '#00F0FF';
            ctx.lineWidth = 1.8;
            ctx.shadowColor = '#00F0FF';
            ctx.shadowBlur = 8;
            ctx.stroke();
          } else if (isGhost) {
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.2;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
          } else {
            ctx.strokeStyle = '#2d3345';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.restore();

          // Clip Title bar text
          ctx.save();
          ctx.font = '10px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = isSelected ? '#e0faff' : '#cbd5e1';
          ctx.fillText(clip.name || 'Audio Clip', renderX + 6, clipY + 12);
          ctx.restore();

          // Draw Trimming Edge Grippers (Point 6: Left and right edge handles for inward waveform deletion)
          if (isSelected) {
            ctx.save();
            // Left edge trim handle (vertical bar + arrows)
            ctx.fillStyle = '#00F0FF';
            ctx.fillRect(renderX - 1, clipY + 12, 3, clipH - 24);

            // Right edge trim handle
            ctx.fillRect(renderX + renderW - 2, clipY + 12, 3, clipH - 24);

            // Fade handles (dots at top corners)
            ctx.beginPath();
            const inHandleX = renderX + Math.min(renderW / 2, (clip.fadeInSeconds || 0) * pixelsPerSecond);
            ctx.arc(inHandleX, clipY + 4, 3.5, 0, Math.PI * 2);
            ctx.fill();

            const outHandleX = renderX + renderW - Math.min(renderW / 2, (clip.fadeOutSeconds || 0) * pixelsPerSecond);
            ctx.beginPath();
            ctx.arc(outHandleX, clipY + 4, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      } catch (renderError) {
        console.error('Fatal render error in track waveform canvas:', renderError);
      } finally {
        ctx.restore();
      }
    },
    [project.tracks, selectedClipIds, draggingClips, pixelsPerSecond, scrollLeft, timelineWidth]
  );

  // Mouse hover over clip edges to show col-resize cursor
  const handleLanePointerMoveHover = (e: React.PointerEvent<HTMLDivElement>, track: Track) => {
    if (draggingClips || edgeTrimDrag || marquee || fadeDrag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const timeAtClick = clickX / pixelsPerSecond;

    let isNearEdge = false;
    for (const clip of track.clips) {
      if (timeAtClick >= clip.startSeconds - 0.2 && timeAtClick <= clip.startSeconds + clip.durationSeconds + 0.2) {
        const leftEdgePx = clip.startSeconds * pixelsPerSecond;
        const rightEdgePx = (clip.startSeconds + clip.durationSeconds) * pixelsPerSecond;
        if (Math.abs(clickX - leftEdgePx) <= 8 || Math.abs(clickX - rightEdgePx) <= 8) {
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

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const timeAtClick = clickX / pixelsPerSecond;

    // Check if clicked inside a clip or on clip edge
    let clickedClip: Clip | null = null;
    let clickedFadeType: 'in' | 'out' | null = null;
    let clickedEdge: 'left' | 'right' | null = null;

    for (const clip of track.clips) {
      const leftEdgePx = clip.startSeconds * pixelsPerSecond;
      const rightEdgePx = (clip.startSeconds + clip.durationSeconds) * pixelsPerSecond;

      // Check edge trimmer within 8px
      if (Math.abs(clickX - leftEdgePx) <= 8 && clickY > 16) {
        clickedClip = clip;
        clickedEdge = 'left';
        break;
      }
      if (Math.abs(clickX - rightEdgePx) <= 8 && clickY > 16) {
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

          if (Math.abs(clickX - fadeInPixel) <= 12) {
            clickedFadeType = 'in';
          } else if (Math.abs(clickX - fadeOutPixel) <= 12) {
            clickedFadeType = 'out';
          }
        }
        break;
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
          newSelected.delete(clickedClip.id);
        } else {
          newSelected.add(clickedClip.id);
        }
      } else {
        if (!newSelected.has(clickedClip.id)) {
          newSelected = new Set([clickedClip.id]);
        }
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
        startY: trackIndex * ROW_HEIGHT + clickY,
        currentX: clickX,
        currentY: trackIndex * ROW_HEIGHT + clickY,
      });
    }
  };

  // Global window pointer move and pointer up for drag, marquee, fade, and edge trimming
  useEffect(() => {
    const handleWindowPointerMove = (e: PointerEvent) => {
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
        const drow = Math.round(dy / ROW_HEIGHT);

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
        const startTrack = Math.floor(minY / ROW_HEIGHT);
        const endTrack = Math.floor(maxY / ROW_HEIGHT);

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

          onUpdateProject({ ...project, tracks: newTracks });
        }
        setDraggingClips(null);
      }

      if (marquee) {
        setMarquee(null);
      }

      if (fadeDrag) {
        setFadeDrag(null);
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
    marquee,
    fadeDrag,
    pixelsPerSecond,
    project,
    currentHeaderWidth,
    onSelectClips,
    onUpdateClip,
    onUpdateProject,
  ]);

  // Double click on lane: opens quick-action strip
  const handleLaneDoubleClick = (e: React.MouseEvent<HTMLDivElement>, track: Track) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const timeAtClick = clickX / pixelsPerSecond;

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

  return (
    <div
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={(e) => e.preventDefault()}
      className="flex-1 flex flex-col min-w-0 h-full bg-[#0A0A0C] relative select-none overflow-hidden"
    >
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
              New tracks are automatically inserted at index 0 on top
            </div>
          </div>
        ) : (
          <div
            style={{ width: `${currentHeaderWidth + lanePixelWidth}px` }}
            className="flex flex-col min-w-full relative"
          >
            {/* Playhead vertical line across all track rows */}
            <div
              style={{
                left: `${currentHeaderWidth + playheadSeconds * pixelsPerSecond}px`,
                height: `${project.tracks.length * ROW_HEIGHT}px`,
              }}
              className="absolute top-0 w-[1.5px] bg-[#00F0FF] shadow-[0_0_8px_#00F0FF] z-20 pointer-events-none transition-[left] duration-100 linear"
            />

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
            {project.tracks.map((track, trackIndex) => (
              <TrackRowContainer
                key={track.id}
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
                renderWaveforms={renderTrackWaveforms}
                onLanePointerDown={handleLanePointerDown}
                onLanePointerMoveHover={handleLanePointerMoveHover}
                onLaneDoubleClick={handleLaneDoubleClick}
                onLaneContextMenu={handleLaneContextMenu}
              />
            ))}
          </div>
        )}
      </div>

      {/* Quick Action Strip Popup */}
      {actionStrip && (
        <ClipActionStrip
          clip={actionStrip.clip}
          position={actionStrip.position}
          canPaste={canPaste}
          onClose={() => setActionStrip(null)}
          onSplit={onSplitClip}
          onCopy={onCopyClip}
          onCut={onCutClip}
          onPaste={onPasteClip}
          onDelete={onDeleteClip}
          onToggleMute={onToggleMuteClip}
          onMoveTrack={onMoveClipTrack}
          onUpdateClip={onUpdateClip}
          onOpenDsp={onOpenDspModal}
        />
      )}

      {/* Custom Context Menu on Lane */}
      {contextMenu && (
        <div
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          onClick={(e) => e.stopPropagation()}
          className="timeline-context-menu-container fixed z-40 bg-[#14141c]/95 border border-cyan-500/60 rounded-xl shadow-[0_12px_36px_rgba(0,0,0,0.85),0_0_16px_rgba(0,240,255,0.2)] py-1.5 px-1 text-xs text-zinc-200 min-w-[210px] animate-in fade-in zoom-in-95 duration-100 backdrop-blur-md select-none"
        >
          <div className="px-2.5 py-1 text-[10px] font-mono text-zinc-400 border-b border-zinc-800 mb-1 flex items-center justify-between">
            <span className="truncate max-w-[120px] text-zinc-300 font-semibold">{contextMenu.track.name}</span>
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
  renderWaveforms: (canvas: HTMLCanvasElement | null, track: Track, trackIndex: number) => void;
  onLanePointerDown: (e: React.PointerEvent<HTMLDivElement>, track: Track, trackIndex: number) => void;
  onLanePointerMoveHover: (e: React.PointerEvent<HTMLDivElement>, track: Track) => void;
  onLaneDoubleClick: (e: React.MouseEvent<HTMLDivElement>, track: Track) => void;
  onLaneContextMenu: (e: React.MouseEvent<HTMLDivElement>, track: Track) => void;
}

const TrackRowContainer = React.memo<TrackRowContainerProps>(({
  track,
  trackIndex,
  totalTracks,
  isSelected,
  laneWidth,
  timelineWidth,
  scrollLeft,
  isControlsCollapsed,
  onSelectTrack,
  onUpdateTrack,
  onDeleteTrack,
  onMoveTrack,
  renderWaveforms,
  onLanePointerDown,
  onLanePointerMoveHover,
  onLaneDoubleClick,
  onLaneContextMenu,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    renderWaveforms(canvasRef.current, track, trackIndex);
  }, [track, trackIndex, isSelected, laneWidth, timelineWidth, scrollLeft, renderWaveforms]);

  return (
    <div
      style={{ height: `${ROW_HEIGHT}px` }}
      className="flex w-full min-w-max border-b border-zinc-700 bg-[#121216] relative shadow-[0_1px_0_rgba(0,0,0,0.4)]"
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
      />

      {/* 1fr Waveform Lane */}
      <div
        style={{ width: `${laneWidth}px` }}
        onPointerDown={(e) => onLanePointerDown(e, track, trackIndex)}
        onPointerMove={(e) => onLanePointerMoveHover(e, track)}
        onDoubleClick={(e) => onLaneDoubleClick(e, track)}
        onContextMenu={(e) => onLaneContextMenu(e, track)}
        className="h-full relative overflow-hidden bg-[#0E0E14] hover:bg-[#101018] transition-colors border-b border-zinc-700/90"
      >
        <canvas
          ref={canvasRef}
          width={Math.max(100, timelineWidth)}
          height={ROW_HEIGHT}
          style={{
            position: 'absolute',
            left: `${scrollLeft}px`,
            top: 0,
            width: `${timelineWidth}px`,
            height: `${ROW_HEIGHT}px`,
            pointerEvents: 'none',
          }}
          className="block pointer-events-none"
        />
      </div>
    </div>
  );
});
