/**
 * X-PRO AUDIO - Main Application Root
 * Professional Browser Audio Studio for Broadcast & Podcast Producers.
 * Phase 1: Foundation (Multi-track timeline, Canvas 2D waveforms, Sub-pixel drag,
 * IndexedDB persistence, Undo/Redo history, Web Audio playback engine).
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Project,
  Track,
  Clip,
  Asset,
  AmplifyParams,
  CompressorParams,
  DenoiseParams,
  PitchParams,
  SpeedParams,
  VoiceMetadata,
  EffectType,
  TrackEffect,
} from './types';
import { audioEngine } from './audio/engine';
import { HistoryManager } from './history/historyManager';
import {
  saveProjectToDB,
  loadProjectFromDB,
  saveAssetToDB,
  loadAllAssetsFromDB,
  clearAllProjectData,
} from './storage/db';
import { Header } from './components/Header';
import { LeftSidebar, SidebarTab } from './components/LeftSidebar';
import { MasterExportPanel } from './components/MasterExportPanel';
import { Timeline } from './components/Timeline';
import { StatusBar } from './components/StatusBar';
import { RecordingModal } from './components/RecordingModal';
import { ClipToolbar } from './components/ClipToolbar';
import { DspModals, DspModalType } from './components/DspModals';
import { EffectsModal } from './components/EffectsModal';
import { NewProjectModal } from './components/NewProjectModal';
import { ResetSessionModal } from './components/ResetSessionModal';
import { ToastProvider, useToast } from './components/Toast';
import { ChevronLeft, Eye, SlidersHorizontal } from 'lucide-react';
import { processCompression } from './audio/dsp/compressor';
import { processBasicDenoise } from './audio/dsp/denoiser';
import { processPitchShift, processTimeStretch } from './audio/dsp/wsola';
import { waveformCache } from './waveform/cache';
import { formatVolumeDb } from './utils/formatters';
import { useAuth } from './hooks/useAuth';
import { SignInPage } from './components/auth/SignInPage';
import { UserDashboard, TabType } from './components/dashboard/UserDashboard';
import { AdminPanel } from './components/admin/AdminPanel';
import { PluginsRackModal } from './components/PluginsRackModal';
import { VoiceoverModal } from './components/VoiceoverModal';
import { voiceJob } from './voice/voiceJob';
import { SoundLibraryModal } from './components/SoundLibraryModal';

const DEFAULT_PROJECT: Project = {
  id: 'project-default',
  name: 'Broadcast Spot Session 1',
  tracks: [], // Starts EMPTY as per non-negotiable requirement
  sampleRate: 48000,
  settings: {
    autoRefresh: true,
    sampleRate: 48000,
    timeFormat: 'time',
    duckPlayingTracks: true,
    duckingAmountDb: -12,
  },
};

const MainStudio: React.FC = () => {
  const { addToast } = useToast();
  const { user, isAdmin, unreadTicketsCount } = useAuth();

  const [currentView, setCurrentView] = useState<'studio' | 'auth' | 'dashboard' | 'admin'>(() => {
    // If user has not signed in and has not dismissed guest mode in this session, start at auth
    if (typeof window !== 'undefined') {
      const hasToken = localStorage.getItem('uuda_session_token');
      const isGuest = sessionStorage.getItem('uuda_guest_mode') === 'true';
      if (!hasToken && !isGuest) return 'auth';
    }
    return 'studio';
  });

  const [project, setProject] = useState<Project>(DEFAULT_PROJECT);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playheadSeconds, setPlayheadSeconds] = useState<number>(0);
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(60);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [clipboardClip, setClipboardClip] = useState<Clip | null>(null);
  const [activeDspModal, setActiveDspModal] = useState<DspModalType>(null);
  const [dspTargetClipId, setDspTargetClipId] = useState<string | null>(null);
  const [isAutosaving, setIsAutosaving] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isRecordModalOpen, setIsRecordModalOpen] = useState<boolean>(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('tracks');
  const [dashboardTab, setDashboardTab] = useState<TabType | undefined>(undefined);
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState<boolean>(false);
  const [isTimelineControlsCollapsed, setIsTimelineControlsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('uuda_track_header_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleTimelineControls = useCallback(() => {
    setIsTimelineControlsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('uuda_track_header_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  const [isTimelineViewCollapsed, setIsTimelineViewCollapsed] = useState<boolean>(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState<boolean>(true);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);
  const [isResetSessionModalOpen, setIsResetSessionModalOpen] = useState<boolean>(false);
  const [isEffectsModalOpen, setIsEffectsModalOpen] = useState<boolean>(false);
  const [activeEffectType, setActiveEffectType] = useState<EffectType>('reverb');

  // Modular Audio Plugins, Expanded Voiceover Studio & Sound Library Modal States
  const [isPluginsRackModalOpen, setIsPluginsRackModalOpen] = useState<boolean>(false);
  const [isVoiceoverModalOpen, setIsVoiceoverModalOpen] = useState<boolean>(false);
  const [isSoundLibraryModalOpen, setIsSoundLibraryModalOpen] = useState<boolean>(false);

  // Total project duration calculated across all clips in tracks
  const totalDurationSeconds = useMemo(() => {
    let max = 0;
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        max = Math.max(max, clip.startSeconds + clip.durationSeconds);
      }
    }
    return max;
  }, [project.tracks]);

  // Listen for global modal navigation events (e.g. from buttons, sidebars, hotkeys)
  useEffect(() => {
    const handleOpenSignIn = () => setCurrentView('auth');
    const handleOpenPlugins = (e?: Event) => {
      const customEvt = e as CustomEvent<{ trackId?: string }>;
      if (customEvt?.detail?.trackId) {
        setSelectedTrackId(customEvt.detail.trackId);
      }
      setIsPluginsRackModalOpen(true);
    };
    const handleOpenVoiceover = () => setIsVoiceoverModalOpen(true);
    const handleOpenLibrary = () => setIsSoundLibraryModalOpen(true);

    window.addEventListener('uuda:open-signin', handleOpenSignIn);
    window.addEventListener('uuda:open-plugins-modal', handleOpenPlugins);
    window.addEventListener('uuda:open-voiceover-modal', handleOpenVoiceover);
    window.addEventListener('uuda:open-library-modal', handleOpenLibrary);

    return () => {
      window.removeEventListener('uuda:open-signin', handleOpenSignIn);
      window.removeEventListener('uuda:open-plugins-modal', handleOpenPlugins);
      window.removeEventListener('uuda:open-voiceover-modal', handleOpenVoiceover);
      window.removeEventListener('uuda:open-library-modal', handleOpenLibrary);
    };
  }, []);

  // Single selected clip memo for quick toolbar and DSP actions
  const selectedClip = useMemo(() => {
    if (selectedClipIds.size !== 1) return null;
    const [id] = Array.from(selectedClipIds);
    for (const track of project.tracks) {
      const found = track.clips.find((c) => c.id === id);
      if (found) return found;
    }
    return null;
  }, [project.tracks, selectedClipIds]);

  const dspTargetClip = useMemo(() => {
    if (!dspTargetClipId) return selectedClip;
    for (const track of project.tracks) {
      const found = track.clips.find((c) => c.id === dspTargetClipId);
      if (found) return found;
    }
    return selectedClip;
  }, [project.tracks, dspTargetClipId, selectedClip]);

  const dspTargetAsset = useMemo(() => {
    if (!dspTargetClip) return null;
    return audioEngine.getAsset(dspTargetClip.assetId) || null;
  }, [dspTargetClip]);

  // Helper to extract a clip's active audio segment into an isolated AudioBuffer safely
  const extractClipAudioBuffer = useCallback(async (asset: Asset, clip: Clip): Promise<AudioBuffer> => {
    if (!asset.buffer) {
      throw new Error(`Audio buffer for asset "${asset.name}" is not loaded.`);
    }
    const sampleRate = asset.sampleRate || 48000;
    const numChannels = Math.max(1, Math.min(2, asset.numberOfChannels || 1));
    const safeOffset = Math.min(Math.max(0, clip.offsetSeconds || 0), Math.max(0, asset.buffer.duration - 0.001));
    const maxDur = Math.max(0.001, asset.buffer.duration - safeOffset);
    const safeDuration = Math.max(0.001, Math.min(clip.durationSeconds || maxDur, maxDur));
    const numFrames = Math.max(128, Math.round(safeDuration * sampleRate));

    const offlineCtx = new OfflineAudioContext(numChannels, numFrames, sampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = asset.buffer;
    src.connect(offlineCtx.destination);
    src.start(0, safeOffset, safeDuration);
    return await offlineCtx.startRendering();
  }, []);

  // Undo/Redo History Manager
  const historyManagerRef = useRef<HistoryManager>(new HistoryManager(DEFAULT_PROJECT));
  const [canUndo, setCanUndo] = useState<boolean>(false);
  const [canRedo, setCanRedo] = useState<boolean>(false);

  // Sync undo/redo button states
  const updateHistoryFlags = useCallback(() => {
    setCanUndo(historyManagerRef.current.canUndo());
    setCanRedo(historyManagerRef.current.canRedo());
  }, []);

  useEffect(() => {
    updateHistoryFlags();
  }, [project, updateHistoryFlags]);

  // Update project with undo history recording
  const setProjectWithHistory = useCallback(
    (newProjectOrFn: Project | ((prev: Project) => Project), skipHistory = false) => {
      setProject((prev) => {
        const next = typeof newProjectOrFn === 'function' ? newProjectOrFn(prev) : newProjectOrFn;
        if (!skipHistory) {
          historyManagerRef.current.pushState(next);
        }
        return next;
      });
    },
    []
  );

  // 1. Restore project and stored assets from IndexedDB on initial mount
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        // If launched as a new session in separate browser tab, start blank without restoring old session
        const urlParams = new URLSearchParams(window.location.search);
        const isForcedNew = urlParams.get('new') === '1' || urlParams.get('new_project') === '1';
        if (isForcedNew) {
          window.history.replaceState({}, '', window.location.pathname);
          if (isMounted) {
            addToast({
              type: 'success',
              title: 'New Blank Session Initialized',
              message: 'Fresh workspace ready in new browser tab.',
            });
          }
          return;
        }

        // Load stored audio assets into audio engine
        const restoredAssets = await loadAllAssetsFromDB(audioEngine);
        if (isMounted) {
          for (const asset of restoredAssets) {
            audioEngine.registerAsset(asset);
          }
        }

        // Load project metadata
        const savedProject = await loadProjectFromDB();
        if (isMounted && savedProject) {
          setProject(savedProject);
          historyManagerRef.current.reset(savedProject);
          updateHistoryFlags();
          setLastSavedAt(new Date());

          if (savedProject.tracks.length > 0) {
            addToast({
              type: 'info',
              title: 'Session Restored',
              message: `Restored ${savedProject.tracks.length} tracks from local storage.`,
            });
          }
        }
      } catch (err) {
        if (isMounted) {
          addToast({
            type: 'error',
            title: 'Storage Restore Warning',
            message: err instanceof Error ? err.message : 'Could not restore previous session.',
          });
        }
      }
    }

    restoreSession();
    return () => {
      isMounted = false;
    };
  }, [addToast, updateHistoryFlags]);

  // 2. Periodic Autosave to IndexedDB
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        setIsAutosaving(true);
        await saveProjectToDB(project);
        setLastSavedAt(new Date());
      } catch {
        // Autosave error handled silently or quietly
      } finally {
        setIsAutosaving(false);
      }
    }, 4000);

    return () => clearInterval(timer);
  }, [project]);

  // 3. Connect audio engine time update & playback ended listeners
  useEffect(() => {
    audioEngine.setOnTimeUpdate((time) => {
      setPlayheadSeconds(time);
    });
    audioEngine.setOnPlaybackEnded(() => {
      setIsPlaying(false);
    });
  }, []);

  // Sync track gain and pan nodes with audio engine when project tracks change
  useEffect(() => {
    audioEngine.syncTracks(project.tracks);
  }, [project.tracks]);

  // 4. Playback Handlers
  const handlePlay = async () => {
    try {
      await audioEngine.play(project, playheadSeconds);
      setIsPlaying(true);
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Playback Error',
        message: err instanceof Error ? err.message : 'Failed to start Web Audio playback.',
      });
    }
  };

  const handlePause = () => {
    audioEngine.pause();
    setIsPlaying(false);
  };

  const handleStop = () => {
    audioEngine.stop();
    setIsPlaying(false);
    setPlayheadSeconds(0);
  };

  const handleReturnToStart = useCallback(() => {
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    }
    audioEngine.seek(0);
    setPlayheadSeconds(0);
    addToast({
      type: 'info',
      title: 'Rewound to Head',
      message: 'Playhead returned to 00:00:00.',
    });
  }, [isPlaying, addToast]);

  const createBlankProject = useCallback(() => {
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    }
    audioEngine.seek(0);
    setPlayheadSeconds(0);
    const blankProject: Project = {
      id: `project-${Date.now()}`,
      name: 'Untitled Project',
      tracks: [],
      sampleRate: 48000,
      settings: {
        autoRefresh: true,
        sampleRate: 48000,
        duckPlayingTracks: true,
        duckingAmountDb: -12,
      },
      updatedAt: Date.now(),
    };
    setProjectWithHistory(blankProject);
    setSelectedTrackId(null);
    setSelectedClipIds(new Set());
    saveProjectToDB(blankProject).catch(() => {});
  }, [isPlaying, setProjectWithHistory]);

  const handleNewProject = useCallback(() => {
    if (project.tracks.length > 0) {
      setIsNewProjectModalOpen(true);
    } else {
      createBlankProject();
      addToast({
        type: 'success',
        title: 'New Blank Project Created',
        message: 'Ready for recording, voiceover, and sound design.',
      });
    }
  }, [project.tracks.length, createBlankProject, addToast]);

  const handleSaveProjectToFile = useCallback(() => {
    try {
      const projectData = {
        ...project,
        savedAt: new Date().toISOString(),
        version: '1.0',
      };
      const jsonString = JSON.stringify(projectData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const fileName = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Session'}.uuda.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast({
        type: 'success',
        title: 'Project Saved to Computer',
        message: `Downloaded "${fileName}" successfully.`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Save Failed',
        message: err instanceof Error ? err.message : 'Could not export project file.',
      });
    }
  }, [project, addToast]);

  const handleSaveAndNewProject = useCallback(() => {
    handleSaveProjectToFile();
    createBlankProject();
    setIsNewProjectModalOpen(false);
    addToast({
      type: 'success',
      title: 'Project Saved & New Session Initialized',
      message: 'Active project backed up to computer and new workspace ready.',
    });
  }, [handleSaveProjectToFile, createBlankProject, addToast]);

  const handleOpenNewProjectInTab = useCallback(() => {
    try {
      const url = `${window.location.origin}${window.location.pathname}?new=1`;
      window.open(url, '_blank', 'noopener,noreferrer');
      setIsNewProjectModalOpen(false);
      addToast({
        type: 'info',
        title: 'New Session Launched in New Tab',
        message: 'Active project remains open in this window.',
      });
    } catch {
      addToast({
        type: 'error',
        title: 'Could Not Open Tab',
        message: 'Please allow popups or check browser permissions.',
      });
    }
  }, [addToast]);

  const handleDiscardAndNewProject = useCallback(() => {
    createBlankProject();
    setIsNewProjectModalOpen(false);
    addToast({
      type: 'info',
      title: 'New Blank Workspace Loaded',
      message: 'Session reset to a fresh empty project.',
    });
  }, [createBlankProject, addToast]);

  const handleOpenProjectFromFile = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Project;
      if (!parsed || !Array.isArray(parsed.tracks)) {
        throw new Error('Selected file is not a valid UUDA Pro project file.');
      }
      if (isPlaying) {
        audioEngine.pause();
        setIsPlaying(false);
      }
      audioEngine.seek(0);
      setPlayheadSeconds(0);
      const loadedProject: Project = {
        ...parsed,
        id: parsed.id || `project-${Date.now()}`,
        name: parsed.name || file.name.replace(/\.[^/.]+$/, ''),
        tracks: parsed.tracks || [],
        sampleRate: parsed.sampleRate || 48000,
        settings: parsed.settings || {
          autoRefresh: true,
          sampleRate: 48000,
          duckPlayingTracks: true,
          duckingAmountDb: -12,
        },
        updatedAt: Date.now(),
      };
      setProjectWithHistory(loadedProject);
      setSelectedTrackId(loadedProject.tracks[0]?.id || null);
      setSelectedClipIds(new Set());
      addToast({
        type: 'success',
        title: 'Project Loaded from Computer',
        message: `"${loadedProject.name}" restored with ${loadedProject.tracks.length} tracks.`,
      });
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Open Project Failed',
        message: err instanceof Error ? err.message : 'Failed to parse project file.',
      });
    }
  }, [isPlaying, addToast, setProjectWithHistory]);

  const handleSeek = (seconds: number) => {
    let projectEnd = 0;
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const end = clip.startSeconds + clip.durationSeconds;
        if (end > projectEnd) projectEnd = end;
      }
    }
    const clamped = projectEnd > 0 ? Math.min(Math.max(0, seconds), projectEnd) : Math.max(0, seconds);
    setPlayheadSeconds(clamped);
    audioEngine.seek(clamped, isPlaying ? project : undefined);
  };

  // 5. File Import: Decode audio & insert NEW track at index 0 (top)
  const handleImportFiles = async (files: FileList) => {
    if (files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const toastId = addToast({
        type: 'info',
        title: 'Decoding Audio...',
        message: `Processing ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`,
        duration: 0,
      });

      try {
        // Real Web Audio decode
        const audioBuffer = await audioEngine.decodeAudioFile(file);
        const assetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        const asset: Asset = {
          id: assetId,
          name: file.name,
          kind: 'import',
          buffer: audioBuffer,
          sampleRate: audioBuffer.sampleRate,
          durationSeconds: audioBuffer.duration,
          numberOfChannels: audioBuffer.numberOfChannels,
        };

        // Register in engine and persist to IndexedDB
        audioEngine.registerAsset(asset);
        await saveAssetToDB(asset);

        // Create new track & clip placed at index 0 (top)
        const trackId = `track-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const clipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

        const newClip: Clip = {
          id: clipId,
          trackId: trackId,
          assetId: asset.id,
          name: file.name.replace(/\.[^/.]+$/, ''),
          startSeconds: 0, // float, placed at beginning
          offsetSeconds: 0,
          durationSeconds: audioBuffer.duration,
          gain: 1.0,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
          fadeShape: 'linear',
        };

        const newTrack: Track = {
          id: trackId,
          name: file.name.replace(/\.[^/.]+$/, ''),
          clips: [newClip],
          volume: 1.0,
          pan: 0,
          muted: false,
          solo: false,
        };

        // Insert at index 0 (top of tracks array as per FR-2.1)
        setProjectWithHistory((prev) => ({
          ...prev,
          tracks: [newTrack, ...prev.tracks],
        }));

        setSelectedTrackId(trackId);
        setSelectedClipIds(new Set([clipId]));

        addToast({
          type: 'success',
          title: 'Audio Imported',
          message: `${file.name} (${audioBuffer.duration.toFixed(2)}s) added to top track.`,
        });
      } catch (err) {
        addToast({
          type: 'error',
          title: 'Decode Failed',
          message: `${file.name}: ${err instanceof Error ? err.message : 'Unsupported or corrupted audio format.'}`,
        });
      }
    }
  };

  // 5b. Recording Finish: Decodes into AudioBuffer asset of kind 'recording' on a NEW top track
  const handleFinishRecording = async (audioBuffer: AudioBuffer, takeName: string) => {
    try {
      const assetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const asset: Asset = {
        id: assetId,
        name: `${takeName}.wav`,
        kind: 'recording',
        buffer: audioBuffer,
        sampleRate: audioBuffer.sampleRate,
        durationSeconds: audioBuffer.duration,
        numberOfChannels: audioBuffer.numberOfChannels,
      };

      // Register asset and save to IndexedDB
      audioEngine.registerAsset(asset);
      await saveAssetToDB(asset);

      // Create new track & clip placed at index 0 (top of timeline and tracks side panel)
      const trackId = `track-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const clipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

      const newClip: Clip = {
        id: clipId,
        trackId,
        assetId: asset.id,
        name: takeName,
        startSeconds: 0,
        offsetSeconds: 0,
        durationSeconds: audioBuffer.duration,
        gain: 1.0,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        fadeShape: 'linear',
      };

      const newTrack: Track = {
        id: trackId,
        name: takeName,
        clips: [newClip],
        volume: 1.0,
        pan: 0,
        muted: false,
        solo: false,
      };

      // Insert at index 0 (top track)
      setProjectWithHistory((prev) => ({
        ...prev,
        tracks: [newTrack, ...prev.tracks],
      }));

      setSelectedTrackId(trackId);
      setSelectedClipIds(new Set([clipId]));

      addToast({
        type: 'success',
        title: 'Recording Finished',
        message: `${takeName} (${audioBuffer.duration.toFixed(2)}s) docked on new top track.`,
      });
    } catch (err: unknown) {
      addToast({
        type: 'error',
        title: 'Save Recording Error',
        message: err instanceof Error ? err.message : 'Failed to save recording asset.',
      });
    }
  };

  const handleAddVoiceTrack = (asset: Asset, voiceMeta: VoiceMetadata) => {
    // Crucial: Register asset in audioEngine so timeline and playback can access audioBuffer
    audioEngine.registerAsset(asset);
    saveAssetToDB(asset).catch((err) => console.warn('Failed to save voice asset to IndexedDB:', err));
    waveformCache.clearAsset(asset.id);

    const trackId = `track-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const clipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    const newClip: Clip = {
      id: clipId,
      trackId,
      assetId: asset.id,
      name: asset.name,
      startSeconds: 0,
      offsetSeconds: 0,
      durationSeconds: Math.max(0.1, asset.durationSeconds),
      gain: 1.0,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      fadeShape: 'linear',
    };

    const newTrack: Track = {
      id: trackId,
      name: `Voice: ${voiceMeta.voiceName}`,
      clips: [newClip],
      volume: 1.0,
      pan: 0,
      muted: false,
      solo: false,
    };

    // Insert at index 0 (top track)
    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: [newTrack, ...prev.tracks],
    }));

    setSelectedTrackId(trackId);
    setSelectedClipIds(new Set([clipId]));

    addToast({
      type: 'success',
      title: 'Voiceover Added',
      message: `Speech generated with ${voiceMeta.voiceName} (${asset.durationSeconds.toFixed(1)}s) docked on new top track.`,
    });
  };

  // One commit handler for the shared voiceover job. A ref keeps it pointing at the latest handler.
  const addVoiceTrackRef = useRef(handleAddVoiceTrack);
  addVoiceTrackRef.current = handleAddVoiceTrack;
  useEffect(() => {
    voiceJob.setCommitHandler((asset, meta) => addVoiceTrackRef.current(asset, meta));
    return () => voiceJob.setCommitHandler(null);
  }, []);

  const handleAddLibraryTrack = (asset: Asset) => {
    // Crucial: Register asset in audioEngine so timeline and playback can access audioBuffer
    audioEngine.registerAsset(asset);
    saveAssetToDB(asset).catch((err) => console.warn('Failed to save library asset to IndexedDB:', err));
    waveformCache.clearAsset(asset.id);

    const trackId = `track-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const clipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    const newClip: Clip = {
      id: clipId,
      trackId,
      assetId: asset.id,
      name: asset.name,
      startSeconds: 0,
      offsetSeconds: 0,
      durationSeconds: Math.max(0.1, asset.durationSeconds),
      gain: 1.0,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      fadeShape: 'linear',
    };

    const newTrack: Track = {
      id: trackId,
      name: asset.name.length > 24 ? `${asset.name.slice(0, 24)}...` : asset.name,
      clips: [newClip],
      volume: 1.0,
      pan: 0,
      muted: false,
      solo: false,
    };

    // Insert at index 0 (top track)
    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: [newTrack, ...prev.tracks],
    }));

    setSelectedTrackId(trackId);
    setSelectedClipIds(new Set([clipId]));

    addToast({
      type: 'success',
      title: 'Sound Library Clip Added',
      message: `"${asset.name}" placed on new top track.`,
    });
  };

  // Ducking Settings Handlers
  const handleToggleDucking = () => {
    setProjectWithHistory((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        duckPlayingTracks: !prev.settings.duckPlayingTracks,
      },
    }));
  };

  const handleUpdateDuckingDb = (db: number) => {
    setProjectWithHistory((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        duckingAmountDb: db,
      },
    }));
  };

  // 6. Track management
  const handleAddEmptyTrack = () => {
    const trackId = `track-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const newTrack: Track = {
      id: trackId,
      name: `Track ${project.tracks.length + 1}`,
      clips: [],
      volume: 1.0,
      pan: 0,
      muted: false,
      solo: false,
    };

    // Insert at index 0 (top)
    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: [newTrack, ...prev.tracks],
    }));
    setSelectedTrackId(trackId);
  };

  const handleUpdateTrack = (trackId: string, updates: Partial<Track>) => {
    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, ...updates } : t)),
    }));
  };

  const handleDeleteTrack = (trackId: string) => {
    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: prev.tracks.filter((t) => t.id !== trackId),
    }));
    if (selectedTrackId === trackId) {
      setSelectedTrackId(null);
    }
    addToast({
      type: 'info',
      title: 'Track Deleted',
      message: 'Track removed from session.',
    });
  };

  const handleMoveTrack = (trackId: string, direction: 'up' | 'down') => {
    setProjectWithHistory((prev) => {
      const idx = prev.tracks.findIndex((t) => t.id === trackId);
      if (idx === -1) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.tracks.length) return prev;

      const newTracks = [...prev.tracks];
      const [moved] = newTracks.splice(idx, 1);
      newTracks.splice(targetIdx, 0, moved);

      return {
        ...prev,
        tracks: newTracks,
      };
    });

    addToast({
      type: 'info',
      title: 'Track Row Reordered',
      message: `Track moved ${direction}. Controller head and waveforms move together.`,
    });
  };

  // 7. Clip Editing & Clipboard Actions
  const handleCopyClip = (clipId?: string) => {
    const idToCopy = clipId || selectedClip?.id;
    if (!idToCopy) {
      addToast({ type: 'warning', title: 'Copy Warning', message: 'No clip selected to copy.' });
      return;
    }
    for (const track of project.tracks) {
      const c = track.clips.find((cl) => cl.id === idToCopy);
      if (c) {
        setClipboardClip({ ...c });
        addToast({
          type: 'info',
          title: 'Clip Copied',
          message: `"${c.name}" copied to clipboard (Ctrl+C). Ready to paste at selected track & playhead.`,
        });
        return;
      }
    }
  };

  const handleCutClip = (clipId?: string) => {
    const idToCut = clipId || selectedClip?.id;
    if (!idToCut) {
      addToast({ type: 'warning', title: 'Cut Warning', message: 'No clip selected to cut.' });
      return;
    }
    for (const track of project.tracks) {
      const c = track.clips.find((cl) => cl.id === idToCut);
      if (c) {
        setClipboardClip({ ...c });
        handleDeleteClip(idToCut);
        addToast({
          type: 'info',
          title: 'Clip Cut',
          message: `"${c.name}" cut to clipboard (Ctrl+X).`,
        });
        return;
      }
    }
  };

  const handlePasteClip = (targetTrackId?: string, targetTimeSeconds?: number) => {
    if (!clipboardClip) {
      addToast({
        type: 'warning',
        title: 'Clipboard Empty',
        message: 'Copy or cut a clip first before pasting (Ctrl+C / Ctrl+X).',
      });
      return;
    }

    // Determine target track:
    // 1. Explicit targetTrackId if provided
    // 2. Currently selectedTrackId
    // 3. Track of currently selected clip
    // 4. Track where the clip came from if it still exists
    // 5. First track in session
    let targetTrack: Track | undefined;
    const trackFromSelectedClip = selectedClip
      ? project.tracks.find((t) => t.clips.some((c) => c.id === selectedClip.id))
      : undefined;

    const trackIdToFind = targetTrackId || selectedTrackId || trackFromSelectedClip?.id;
    if (trackIdToFind) {
      targetTrack = project.tracks.find((t) => t.id === trackIdToFind);
    }
    if (!targetTrack && clipboardClip.trackId) {
      targetTrack = project.tracks.find((t) => t.id === clipboardClip.trackId);
    }
    if (!targetTrack && project.tracks.length > 0) {
      targetTrack = project.tracks[0];
    }

    const pasteTime = targetTimeSeconds !== undefined
      ? Math.max(0, targetTimeSeconds)
      : Math.max(0, playheadSeconds);

    const newClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

    if (targetTrack) {
      const newClip: Clip = {
        ...clipboardClip,
        id: newClipId,
        trackId: targetTrack.id,
        name: `${clipboardClip.name} (Pasted)`,
        startSeconds: pasteTime,
      };

      setProjectWithHistory((prev) => ({
        ...prev,
        tracks: prev.tracks.map((t) =>
          t.id === targetTrack!.id ? { ...t, clips: [...t.clips, newClip] } : t
        ),
      }));

      setSelectedTrackId(targetTrack.id);
      setSelectedClipIds(new Set([newClipId]));

      addToast({
        type: 'success',
        title: 'Clip Pasted',
        message: `Pasted into "${targetTrack.name}" at ${pasteTime.toFixed(3)}s.`,
      });
    } else {
      // Create new track ONLY if project has 0 tracks
      const newTrackId = `track-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
      const newClip: Clip = {
        ...clipboardClip,
        id: newClipId,
        trackId: newTrackId,
        name: `${clipboardClip.name} (Pasted)`,
        startSeconds: pasteTime,
      };
      const newTrack: Track = {
        id: newTrackId,
        name: `${clipboardClip.name} (Track)`,
        clips: [newClip],
        volume: 1.0,
        pan: 0,
        muted: false,
        solo: false,
      };

      setProjectWithHistory((prev) => ({
        ...prev,
        tracks: [newTrack],
      }));

      setSelectedTrackId(newTrackId);
      setSelectedClipIds(new Set([newClipId]));

      addToast({
        type: 'success',
        title: 'Clip Pasted',
        message: `Pasted at ${pasteTime.toFixed(3)}s on new track.`,
      });
    }
  };

  const handleSplitClip = (clipId?: string) => {
    const idToSplit = clipId || selectedClip?.id;
    if (!idToSplit) {
      addToast({
        type: 'warning',
        title: 'Cannot Split',
        message: 'Select a clip to split at the playhead position.',
      });
      return;
    }

    let targetClip: Clip | undefined;
    let targetTrack: Track | undefined;
    for (const track of project.tracks) {
      const c = track.clips.find((cl) => cl.id === idToSplit);
      if (c) {
        targetClip = c;
        targetTrack = track;
        break;
      }
    }

    if (
      !targetClip ||
      !targetTrack ||
      playheadSeconds <= targetClip.startSeconds ||
      playheadSeconds >= targetClip.startSeconds + targetClip.durationSeconds
    ) {
      addToast({
        type: 'warning',
        title: 'Cannot Split',
        message: 'Playhead must be strictly inside the selected clip to split.',
      });
      return;
    }

    // Exact sample frame cut: frame = floor(timeSeconds * sampleRate)
    const asset = audioEngine.getAsset(targetClip.assetId);
    const sampleRate = asset ? asset.sampleRate : project.sampleRate;
    const relativeSeconds = playheadSeconds - targetClip.startSeconds;
    const splitFrame = Math.floor(relativeSeconds * sampleRate);
    const leftDuration = splitFrame / sampleRate;
    const rightDuration = targetClip.durationSeconds - leftDuration;

    if (leftDuration <= 0.0001 || rightDuration <= 0.0001) {
      addToast({
        type: 'warning',
        title: 'Cannot Split',
        message: 'Split frame is too close to clip boundary.',
      });
      return;
    }

    const leftClip: Clip = {
      ...targetClip,
      durationSeconds: leftDuration,
      fadeOutSeconds: Math.min(targetClip.fadeOutSeconds, leftDuration / 2),
    };

    const rightClipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const rightClip: Clip = {
      id: rightClipId,
      trackId: targetTrack.id,
      assetId: targetClip.assetId, // Both clips share the same asset without gap or click
      name: `${targetClip.name} (Part 2)`,
      startSeconds: targetClip.startSeconds + leftDuration,
      offsetSeconds: targetClip.offsetSeconds + leftDuration,
      durationSeconds: rightDuration,
      gain: targetClip.gain,
      fadeInSeconds: 0,
      fadeOutSeconds: targetClip.fadeOutSeconds,
      fadeShape: targetClip.fadeShape,
      muted: targetClip.muted,
    };

    setProjectWithHistory((prev) => {
      const updatedTracks = prev.tracks.map((track) => {
        if (track.id !== targetTrack!.id) return track;
        const clipIdx = track.clips.findIndex((c) => c.id === idToSplit);
        if (clipIdx === -1) return track;
        const newClips = [...track.clips];
        newClips.splice(clipIdx, 1, leftClip, rightClip);
        return { ...track, clips: newClips };
      });
      return { ...prev, tracks: updatedTracks };
    });

    setSelectedClipIds(new Set([rightClipId]));

    addToast({
      type: 'success',
      title: 'Clip Split',
      message: `Cut at frame ${splitFrame} (${playheadSeconds.toFixed(4)}s). Both pieces share buffer.`,
    });
  };

  const handleDeleteClip = (clipId: string) => {
    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((c) => c.id !== clipId),
      })),
    }));
    setSelectedClipIds((prev) => {
      const next = new Set(prev);
      next.delete(clipId);
      return next;
    });
  };

  const handleDuplicateClip = (clipId?: string) => {
    const idToDup = clipId || selectedClip?.id;
    if (!idToDup) return;

    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => {
        const clip = track.clips.find((c) => c.id === idToDup);
        if (!clip) return track;

        const dup: Clip = {
          ...clip,
          id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          name: `${clip.name} (Copy)`,
          startSeconds: clip.startSeconds + clip.durationSeconds + 0.5,
        };

        return { ...track, clips: [...track.clips, dup] };
      }),
    }));

    addToast({
      type: 'info',
      title: 'Clip Duplicated',
      message: 'Created duplicate adjacent to original.',
    });
  };

  const handleToggleMuteClip = (clipId?: string) => {
    const idToMute = clipId || selectedClip?.id;
    if (!idToMute) return;

    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((c) => (c.id === idToMute ? { ...c, muted: !c.muted } : c)),
      })),
    }));
  };

  const handleMoveClipTrack = (clipId?: string, direction: 'up' | 'down' = 'up') => {
    const targetId = clipId || selectedClip?.id;
    if (!targetId) return;

    for (const track of project.tracks) {
      if (track.clips.some((c) => c.id === targetId)) {
        // Moving track up or down moves the entire track row (head + waveforms) together
        handleMoveTrack(track.id, direction);
        return;
      }
    }
  };

  const handleOpenDspModal = (type: DspModalType, clipId?: string) => {
    const targetId = clipId || selectedClip?.id || null;
    setDspTargetClipId(targetId);
    setActiveDspModal(type);
  };

  // DSP Effect processors
  const handleApplyAmplify = async (params: AmplifyParams, bakeBuffer: boolean) => {
    if (!dspTargetClip || !dspTargetAsset) throw new Error('Target clip or audio asset not found.');

    if (!bakeBuffer) {
      // Non-destructive clip gain multiplier
      const multiplier = Math.pow(10, params.gainDb / 20);
      const newGain = Math.max(0, (dspTargetClip.gain || 1.0) * multiplier);
      handleUpdateClip(dspTargetClip.id, { gain: newGain });
      addToast({
        type: 'success',
        title: 'Amplify Applied',
        message: `Set volume to ${formatVolumeDb(newGain)} (${params.gainDb > 0 ? '+' : ''}${params.gainDb} dB non-destructive).`,
      });
      return;
    }

    // Destructive bake: render into new AudioBuffer asset
    const rawBuffer = await extractClipAudioBuffer(dspTargetAsset, dspTargetClip);
    const offlineCtx = new OfflineAudioContext(rawBuffer.numberOfChannels, rawBuffer.length, rawBuffer.sampleRate);
    const src = offlineCtx.createBufferSource();
    src.buffer = rawBuffer;
    const gainNode = offlineCtx.createGain();
    const linearGain = (dspTargetClip.gain || 1.0) * Math.pow(10, params.gainDb / 20);
    gainNode.gain.setValueAtTime(Number.isFinite(linearGain) ? linearGain : 1.0, 0);
    src.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    src.start(0);
    const baked = await offlineCtx.startRendering();

    const newAssetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const newAsset: Asset = {
      id: newAssetId,
      name: `${dspTargetClip.name} (Amp ${params.gainDb}dB)`,
      kind: dspTargetAsset.kind,
      buffer: baked,
      sampleRate: baked.sampleRate,
      durationSeconds: baked.duration,
      numberOfChannels: baked.numberOfChannels,
    };
    audioEngine.registerAsset(newAsset);
    await saveAssetToDB(newAsset);

    waveformCache.clearAsset(dspTargetClip.assetId);
    waveformCache.clearAsset(newAsset.id);

    handleUpdateClip(dspTargetClip.id, {
      assetId: newAsset.id,
      offsetSeconds: 0,
      durationSeconds: baked.duration,
      gain: 1.0,
    });

    addToast({
      type: 'success',
      title: 'Gain Baked',
      message: `Rendered ${params.gainDb} dB permanently into new audio buffer.`,
    });
  };

  const handleApplyCompressor = async (params: CompressorParams) => {
    if (!dspTargetClip || !dspTargetAsset) throw new Error('Target clip or audio asset not found.');
    const rawBuffer = await extractClipAudioBuffer(dspTargetAsset, dspTargetClip);
    const compressed = await processCompression(rawBuffer, params);

    const newAssetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const newAsset: Asset = {
      id: newAssetId,
      name: `${dspTargetClip.name} (Comp)`,
      kind: dspTargetAsset.kind,
      buffer: compressed,
      sampleRate: compressed.sampleRate,
      durationSeconds: compressed.duration,
      numberOfChannels: compressed.numberOfChannels,
    };
    audioEngine.registerAsset(newAsset);
    await saveAssetToDB(newAsset);

    waveformCache.clearAsset(dspTargetClip.assetId);
    waveformCache.clearAsset(newAsset.id);

    handleUpdateClip(dspTargetClip.id, {
      assetId: newAsset.id,
      offsetSeconds: 0,
      durationSeconds: compressed.duration,
    });

    addToast({
      type: 'success',
      title: 'Compressor Applied',
      message: `Applied dynamics compression (${params.ratio}:1, ${params.thresholdDb} dB threshold).`,
    });
  };

  const handleApplyDenoise = async (params: DenoiseParams) => {
    if (!dspTargetClip || !dspTargetAsset) throw new Error('Target clip or audio asset not found.');
    const rawBuffer = await extractClipAudioBuffer(dspTargetAsset, dspTargetClip);
    const denoised = await processBasicDenoise(rawBuffer, params);

    const newAssetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const newAsset: Asset = {
      id: newAssetId,
      name: `${dspTargetClip.name} (Denoised)`,
      kind: dspTargetAsset.kind,
      buffer: denoised,
      sampleRate: denoised.sampleRate,
      durationSeconds: denoised.duration,
      numberOfChannels: denoised.numberOfChannels,
    };
    audioEngine.registerAsset(newAsset);
    await saveAssetToDB(newAsset);

    waveformCache.clearAsset(dspTargetClip.assetId);
    waveformCache.clearAsset(newAsset.id);

    handleUpdateClip(dspTargetClip.id, {
      assetId: newAsset.id,
      offsetSeconds: 0,
      durationSeconds: denoised.duration,
    });

    addToast({
      type: 'success',
      title: 'Basic Denoise Applied',
      message: `Processed with ${params.highPassFreq} Hz filter and ${params.reductionDb} dB spectral gate.`,
    });
  };

  const handleApplyPitch = async (params: PitchParams) => {
    if (!dspTargetClip || !dspTargetAsset) throw new Error('Target clip or audio asset not found.');
    const rawBuffer = await extractClipAudioBuffer(dspTargetAsset, dspTargetClip);
    const shifted = await processPitchShift(rawBuffer, params.semitones);

    const newAssetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const newAsset: Asset = {
      id: newAssetId,
      name: `${dspTargetClip.name} (${params.semitones > 0 ? '+' : ''}${params.semitones}st)`,
      kind: dspTargetAsset.kind,
      buffer: shifted,
      sampleRate: shifted.sampleRate,
      durationSeconds: shifted.duration,
      numberOfChannels: shifted.numberOfChannels,
    };
    audioEngine.registerAsset(newAsset);
    await saveAssetToDB(newAsset);

    waveformCache.clearAsset(dspTargetClip.assetId);
    waveformCache.clearAsset(newAsset.id);

    handleUpdateClip(dspTargetClip.id, {
      assetId: newAsset.id,
      offsetSeconds: 0,
      durationSeconds: shifted.duration,
    });

    addToast({
      type: 'success',
      title: 'Pitch Shift Applied',
      message: `Shifted by ${params.semitones} semitones using WSOLA (duration preserved).`,
    });
  };

  const handleApplySpeed = async (params: SpeedParams) => {
    if (!dspTargetClip || !dspTargetAsset) throw new Error('Target clip or audio asset not found.');
    const rawBuffer = await extractClipAudioBuffer(dspTargetAsset, dspTargetClip);
    const stretched = await processTimeStretch(rawBuffer, params.speedRatio);

    const newAssetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const newAsset: Asset = {
      id: newAssetId,
      name: `${dspTargetClip.name} (${params.speedRatio}x)`,
      kind: dspTargetAsset.kind,
      buffer: stretched,
      sampleRate: stretched.sampleRate,
      durationSeconds: stretched.duration,
      numberOfChannels: stretched.numberOfChannels,
    };
    audioEngine.registerAsset(newAsset);
    await saveAssetToDB(newAsset);

    waveformCache.clearAsset(dspTargetClip.assetId);
    waveformCache.clearAsset(newAsset.id);

    handleUpdateClip(dspTargetClip.id, {
      assetId: newAsset.id,
      offsetSeconds: 0,
      durationSeconds: stretched.duration,
    });

    addToast({
      type: 'success',
      title: 'Speed Changed',
      message: `Changed speed to ${params.speedRatio}x using WSOLA (pitch preserved).`,
    });
  };

  const handleApplyEffect = async (
    targetClipId: string,
    effect: TrackEffect,
    renderedBuffer: AudioBuffer,
    newDuration: number
  ) => {
    let targetClip: Clip | null = null;
    for (const track of project.tracks) {
      const found = track.clips.find((c) => c.id === targetClipId);
      if (found) {
        targetClip = found;
        break;
      }
    }
    if (!targetClip) throw new Error('Target clip not found.');

    const newAssetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const newAsset: Asset = {
      id: newAssetId,
      name: `${targetClip.name} (${effect.name})`,
      kind: 'recording',
      buffer: renderedBuffer,
      sampleRate: renderedBuffer.sampleRate,
      durationSeconds: newDuration,
      numberOfChannels: renderedBuffer.numberOfChannels,
    };
    audioEngine.registerAsset(newAsset);
    await saveAssetToDB(newAsset);

    waveformCache.clearAsset(targetClip.assetId);
    waveformCache.clearAsset(newAsset.id);

    handleUpdateClip(targetClip.id, {
      assetId: newAsset.id,
      offsetSeconds: 0,
      durationSeconds: newDuration,
      name: `${targetClip.name} (${effect.name})`,
    });

    addToast({
      type: 'success',
      title: `${effect.name} Applied`,
      message: `Rendered ${effect.name} with effect decay tail (${newDuration.toFixed(2)}s).`,
    });
  };

  const handleUpdateClip = (clipId: string, updates: Partial<Clip>) => {
    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((c) => (c.id === clipId ? { ...c, ...updates } : c)),
      })),
    }));
  };

  const handleDeleteSelected = () => {
    if (selectedClipIds.size === 0) return;
    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: prev.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((c) => !selectedClipIds.has(c.id)),
      })),
    }));
    setSelectedClipIds(new Set());
    addToast({
      type: 'info',
      title: 'Clips Deleted',
      message: 'Removed selected clips.',
    });
  };

  const handleSelectAll = () => {
    const allIds = new Set<string>();
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        allIds.add(clip.id);
      }
    }
    setSelectedClipIds(allIds);
  };

  // 8. Undo / Redo
  const handleUndo = () => {
    const previous = historyManagerRef.current.undo();
    if (previous) {
      setProject(previous);
      updateHistoryFlags();
      addToast({ type: 'info', title: 'Undo', message: 'Reverted last change.' });
    }
  };

  const handleRedo = () => {
    const next = historyManagerRef.current.redo();
    if (next) {
      setProject(next);
      updateHistoryFlags();
      addToast({ type: 'info', title: 'Redo', message: 'Reapplied change.' });
    }
  };

  // 9. Zoom controls
  const handleZoomIn = () => {
    setPixelsPerSecond((prev) => Math.min(1000, prev * 1.3));
  };

  const handleZoomOut = () => {
    setPixelsPerSecond((prev) => Math.max(10, prev / 1.3));
  };

  const handleZoomFit = () => {
    setPixelsPerSecond(60);
  };

  // 10. Clear Session & Workspace Reset Handlers
  const handleExecuteResetSession = useCallback(async () => {
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    }
    audioEngine.seek(0);
    setPlayheadSeconds(0);
    await clearAllProjectData().catch(() => {});
    const freshProject: Project = {
      id: `project-${Date.now()}`,
      name: 'Untitled Project',
      tracks: [],
      sampleRate: 48000,
      settings: {
        autoRefresh: true,
        sampleRate: 48000,
        duckPlayingTracks: true,
        duckingAmountDb: -12,
      },
      updatedAt: Date.now(),
    };
    setProject(freshProject);
    historyManagerRef.current.reset(freshProject);
    updateHistoryFlags();
    setSelectedTrackId(null);
    setSelectedClipIds(new Set());
    setIsResetSessionModalOpen(false);
  }, [isPlaying, updateHistoryFlags]);

  const handleClearSession = useCallback(() => {
    // If tracks or clips exist, prompt the user with modal to save their work before resetting
    if (project.tracks.length > 0) {
      setIsResetSessionModalOpen(true);
    } else {
      handleExecuteResetSession();
      addToast({
        type: 'info',
        title: 'Session Reset',
        message: 'Empty project session is ready.',
      });
    }
  }, [project.tracks.length, handleExecuteResetSession, addToast]);

  const handleSaveAndResetSession = useCallback(() => {
    handleSaveProjectToFile();
    handleExecuteResetSession();
    addToast({
      type: 'success',
      title: 'Project Saved & Session Reset',
      message: 'Active work downloaded and fresh timeline initialized.',
    });
  }, [handleSaveProjectToFile, handleExecuteResetSession, addToast]);

  const handleResetWithoutSaving = useCallback(() => {
    handleExecuteResetSession();
    addToast({
      type: 'info',
      title: 'Session Cleared',
      message: 'Timeline wiped and workspace reset.',
    });
  }, [handleExecuteResetSession, addToast]);

  // 11. Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing inside text input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Space: Play / Pause
      if (e.code === 'Space') {
        e.preventDefault();
        if (isPlaying) {
          handlePause();
        } else {
          handlePlay();
        }
      }

      // R: Open Recording Studio
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setIsRecordModalOpen(true);
      }

      // S: Split selected clip at playhead
      if (e.key === 's' || e.key === 'S') {
        if (selectedClipIds.size === 1) {
          const [clipId] = Array.from(selectedClipIds);
          handleSplitClip(clipId);
        }
      }

      // Delete / Backspace: Delete selected clips
      // Delete / Backspace: Delete selected clips
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipIds.size > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }

      // Ctrl+C / Cmd+C: Copy selected clip
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        if (selectedClipIds.size === 1) {
          e.preventDefault();
          handleCopyClip();
        }
      }

      // Ctrl+X / Cmd+X: Cut selected clip
      if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
        if (selectedClipIds.size === 1) {
          e.preventDefault();
          handleCutClip();
        }
      }

      // Ctrl+V / Cmd+V: Paste at playhead on new top track
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        if (clipboardClip) {
          e.preventDefault();
          handlePasteClip();
        }
      }

      // Ctrl+D / Cmd+D: Duplicate selected clip
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        if (selectedClipIds.size === 1) {
          e.preventDefault();
          handleDuplicateClip();
        }
      }

      // M: Mute / unmute selected clip
      if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey) {
        if (selectedClipIds.size === 1) {
          e.preventDefault();
          handleToggleMuteClip();
        }
      }

      // Ctrl+Z / Cmd+Z: Undo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }

      // Ctrl+Y / Cmd+Shift+Z: Redo
      if (
        ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z'))
      ) {
        e.preventDefault();
        handleRedo();
      }

      // Ctrl+A / Cmd+A: Select All
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        handleSelectAll();
      }

      // Arrow Up / Down: Move selected clip between tracks
      if (e.key === 'ArrowUp' && selectedClipIds.size === 1) {
        e.preventDefault();
        const [clipId] = Array.from(selectedClipIds);
        handleMoveClipTrack(clipId, 'up');
      }
      if (e.key === 'ArrowDown' && selectedClipIds.size === 1) {
        e.preventDefault();
        const [clipId] = Array.from(selectedClipIds);
        handleMoveClipTrack(clipId, 'down');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isPlaying,
    selectedClipIds,
    project,
    playheadSeconds,
    canUndo,
    canRedo,
    clipboardClip,
  ]);

  // Mouse wheel zoom (Ctrl + Wheel)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          setPixelsPerSecond((prev) => Math.min(1000, prev * 1.15));
        } else {
          setPixelsPerSecond((prev) => Math.max(10, prev / 1.15));
        }
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  // Total clip count
  const totalClips = project.tracks.reduce((acc, t) => acc + t.clips.length, 0);

  // Full-Page View Routing
  if (currentView === 'auth') {
    return (
      <SignInPage
        onContinueAsGuest={() => {
          sessionStorage.setItem('uuda_guest_mode', 'true');
          setCurrentView('studio');
        }}
        onSuccessSignIn={(info) => {
          setCurrentView('studio');
          if (info?.adminCodeSent) {
            addToast({
              type: 'info',
              title: 'Admin verification',
              message: 'A 6-digit code was sent to your email. Enter it to unlock the Admin Panel.',
            });
          }
        }}
      />
    );
  }

  if (currentView === 'dashboard') {
    return (
      <UserDashboard
        key={dashboardTab}
        initialTab={dashboardTab}
        onBackToStudio={() => {
          setDashboardTab(undefined);
          setCurrentView('studio');
        }}
        onOpenProject={() => {
          setCurrentView('studio');
        }}
      />
    );
  }

  if (currentView === 'admin') {
    return (
      <AdminPanel
        onBackToStudio={() => setCurrentView('studio')}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0A0A0C] text-zinc-100 overflow-hidden select-none font-sans">
      {/* Top Header Bar */}
      <Header
        project={project}
        isPlaying={isPlaying}
        canUndo={canUndo}
        canRedo={canRedo}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onReturnToStart={handleReturnToStart}
        onNewProject={handleNewProject}
        onSaveAndNewProject={handleSaveAndNewProject}
        onOpenNewProjectInTab={handleOpenNewProjectInTab}
        onSaveProjectToFile={handleSaveProjectToFile}
        onOpenProjectFromFile={handleOpenProjectFromFile}
        onOpenRecord={() => setIsRecordModalOpen(true)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSplit={() => {
          if (selectedClipIds.size === 1) {
            const [clipId] = Array.from(selectedClipIds);
            handleSplitClip(clipId);
          }
        }}
        onDuplicate={() => {
          if (selectedClipIds.size === 1) {
            const [clipId] = Array.from(selectedClipIds);
            handleDuplicateClip(clipId);
          }
        }}
        onCopy={() => handleCopyClip()}
        onCut={() => handleCutClip()}
        onPaste={handlePasteClip}
        canPaste={!!clipboardClip}
        hasSelectedClip={!!selectedClip}
        onToggleMuteClip={() => selectedClip && handleToggleMuteClip(selectedClip.id)}
        onMoveClip={(dir) => selectedClip && handleMoveClipTrack(selectedClip.id, dir)}
        onOpenDsp={(type) => handleOpenDspModal(type)}
        onOpenEffect={(type) => {
          setActiveEffectType(type);
          setIsEffectsModalOpen(true);
        }}
        onDeleteSelected={handleDeleteSelected}
        onSelectAll={handleSelectAll}
        onImportFiles={handleImportFiles}
        onUpdateProjectName={(name) => setProjectWithHistory((p) => ({ ...p, name }))}
        onToggleAutoRefresh={() =>
          setProjectWithHistory((p) => ({
            ...p,
            settings: { ...p.settings, autoRefresh: !p.settings.autoRefresh },
          }))
        }
        onToggleDucking={handleToggleDucking}
        onUpdateDuckingDb={handleUpdateDuckingDb}
        onManualRefresh={() => {
          // Trigger manual re-render
          setProject((p) => ({ ...p }));
          addToast({ type: 'info', title: 'Timeline Refreshed', message: 'Manual redraw completed.' });
        }}
        onClearSession={handleClearSession}
        activeSidebarTab={sidebarTab}
        onSelectSidebarTab={setSidebarTab}
        onOpenExport={() => setIsRightSidebarOpen(true)}
        onOpenPlugins={() => setIsPluginsRackModalOpen(true)}
        onOpenVoiceoverModal={() => setIsVoiceoverModalOpen(true)}
      />

      {/* Selected Clip Toolbar (Permanent accessible fallback docked below Header) */}
      <ClipToolbar
        clip={selectedClip}
        canPaste={!!clipboardClip}
        onSplit={(id) => handleSplitClip(id)}
        onCopy={(id) => handleCopyClip(id)}
        onCut={(id) => handleCutClip(id)}
        onPaste={handlePasteClip}
        onDelete={(id) => handleDeleteClip(id)}
        onToggleMute={(id) => handleToggleMuteClip(id)}
        onMoveTrack={(id, dir) => handleMoveClipTrack(id, dir)}
        onUpdateClip={handleUpdateClip}
        onOpenDsp={(type) => handleOpenDspModal(type, selectedClip?.id)}
        onOpenEffect={(type) => {
          setActiveEffectType(type);
          setIsEffectsModalOpen(true);
        }}
        onDeselect={() => setSelectedClipIds(new Set())}
        isControllerCollapsed={isTimelineControlsCollapsed}
        onToggleController={handleToggleTimelineControls}
        isTimelineCollapsed={isTimelineViewCollapsed}
        onToggleTimelineCollapsed={() => setIsTimelineViewCollapsed(!isTimelineViewCollapsed)}
      />

      {/* Main Workspace Body */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* Left Dockable Sidebar: Tracks, Voiceover Studio, Sound Library */}
        <LeftSidebar
          activeTab={sidebarTab}
          onSelectTab={setSidebarTab}
          isCollapsed={isLeftSidebarCollapsed}
          onToggleCollapse={() => setIsLeftSidebarCollapsed(!isLeftSidebarCollapsed)}
          user={user}
          unreadTicketsCount={unreadTicketsCount}
          onOpenDashboard={() => setCurrentView('dashboard')}
          onOpenSupport={() => {
            setDashboardTab('support');
            setCurrentView('dashboard');
          }}
          onOpenAdmin={() => setCurrentView('admin')}
          onOpenSignIn={() => setCurrentView('auth')}
          onOpenPlugins={() => setIsPluginsRackModalOpen(true)}
          onOpenVoiceoverModal={() => setIsVoiceoverModalOpen(true)}
          onOpenLibraryModal={() => setIsSoundLibraryModalOpen(true)}
          tracks={project.tracks}
          selectedTrackId={selectedTrackId}
          onSelectTrack={(id) => setSelectedTrackId(id)}
          onDeleteTrack={handleDeleteTrack}
          onMoveTrack={handleMoveTrack}
          onAddTrack={handleAddEmptyTrack}
          onAddVoiceTrack={handleAddVoiceTrack}
          onAddLibraryTrack={handleAddLibraryTrack}
        />

        {/* Center Workspace: Either Multi-Track Waveform Timeline OR Dedicated Editing & Mixing Desk */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-[#0A0A0C]">
          {isTimelineViewCollapsed ? (
            <div className="flex-1 flex flex-col h-full overflow-hidden p-3 bg-[#0c0c11]">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#10b981]" />
                  <span className="font-bold text-xs uppercase tracking-wider text-zinc-100">
                    Pro Mixing Console & Editing Workspace (Timeline Collapsed)
                  </span>
                </div>
                <button
                  onClick={() => setIsTimelineViewCollapsed(false)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-cyan-300 font-semibold text-xs border border-zinc-700 transition-colors cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>Restore Timeline Waveforms</span>
                </button>
              </div>

              <div className="flex-1 overflow-hidden">
                <MasterExportPanel
                  project={project}
                  isSidebarMode={false}
                  onUpdateTrack={handleUpdateTrack}
                  onAddTrack={handleAddEmptyTrack}
                  selectedTrackId={selectedTrackId}
                  onSelectTrack={(id) => setSelectedTrackId(id)}
                />
              </div>
            </div>
          ) : (
            <Timeline
              project={project}
              playheadSeconds={playheadSeconds}
              pixelsPerSecond={pixelsPerSecond}
              selectedTrackId={selectedTrackId}
              selectedClipIds={selectedClipIds}
              isControlsCollapsed={isTimelineControlsCollapsed}
              onToggleCollapseControls={handleToggleTimelineControls}
              onSelectTrack={(id) => setSelectedTrackId(id)}
              onSelectClips={(clipIds) => setSelectedClipIds(clipIds)}
              onUpdateTrack={handleUpdateTrack}
              onDeleteTrack={handleDeleteTrack}
              onMoveTrack={handleMoveTrack}
              onUpdateProject={(p) => setProjectWithHistory(p)}
              onSeek={handleSeek}
              onSplitClip={handleSplitClip}
              onDeleteClip={handleDeleteClip}
              onDuplicateClip={handleDuplicateClip}
              onCopyClip={handleCopyClip}
              onCutClip={handleCutClip}
              onPasteClip={handlePasteClip}
              canPaste={!!clipboardClip}
              onToggleMuteClip={handleToggleMuteClip}
              onOpenDspModal={(type) => handleOpenDspModal(type)}
              onMoveClipTrack={handleMoveClipTrack}
              onUpdateClip={handleUpdateClip}
              onFileDrop={handleImportFiles}
            />
          )}
        </div>

        {/* Right Dockable Sidebar: Master Bus & Export Inspector */}
        {!isTimelineViewCollapsed && isRightSidebarOpen && (
          <div className="flex h-full shrink-0 z-20 relative animate-in slide-in-from-right duration-150">
            <MasterExportPanel
              project={project}
              isSidebarMode={true}
              onClose={() => setIsRightSidebarOpen(false)}
              onUpdateTrack={handleUpdateTrack}
              onAddTrack={handleAddEmptyTrack}
              selectedTrackId={selectedTrackId}
              onSelectTrack={(id) => setSelectedTrackId(id)}
            />
          </div>
        )}

        {/* Right Sidebar Expand Tab (Shown when Master panel is collapsed) */}
        {!isTimelineViewCollapsed && !isRightSidebarOpen && (
          <button
            onClick={() => setIsRightSidebarOpen(true)}
            title="Expand Master Bus & Export Panel"
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-[#16161c] hover:bg-zinc-800 text-zinc-400 hover:text-emerald-300 border-l border-y border-zinc-700/80 rounded-l-md px-1 py-3 text-[10px] font-bold tracking-widest uppercase transition-all shadow-md flex flex-col items-center gap-1 cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-emerald-400" />
            <span className="[writing-mode:vertical-lr] text-[9px] text-zinc-400 hover:text-emerald-300">
              MASTER / EXPORT
            </span>
          </button>
        )}
      </div>

      {/* Bottom Status Bar */}
      <StatusBar
        sampleRate={project.sampleRate}
        trackCount={project.tracks.length}
        clipCount={totalClips}
        selectedClipCount={selectedClipIds.size}
        playheadSeconds={playheadSeconds}
        totalDurationSeconds={totalDurationSeconds}
        isPlaying={isPlaying}
        pixelsPerSecond={pixelsPerSecond}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
        isAutosaving={isAutosaving}
        lastSavedAt={lastSavedAt}
      />

      {/* New Project Modal (Preserves active project state with Save / New Tab / Discard) */}
      <NewProjectModal
        isOpen={isNewProjectModalOpen}
        projectName={project.name}
        trackCount={project.tracks.length}
        clipCount={totalClips}
        onSaveAndNew={handleSaveAndNewProject}
        onOpenInNewTab={handleOpenNewProjectInTab}
        onDiscardAndNew={handleDiscardAndNewProject}
        onClose={() => setIsNewProjectModalOpen(false)}
      />

      {/* Reset Session Modal prompting users to save work before clearing session */}
      <ResetSessionModal
        isOpen={isResetSessionModalOpen}
        projectName={project.name}
        trackCount={project.tracks.length}
        clipCount={totalClips}
        onSaveAndReset={handleSaveAndResetSession}
        onResetWithoutSaving={handleResetWithoutSaving}
        onClose={() => setIsResetSessionModalOpen(false)}
      />

      {/* Recording Studio Modal with 4-Band Input EQ */}
      <RecordingModal
        isOpen={isRecordModalOpen}
        onClose={() => setIsRecordModalOpen(false)}
        onFinishRecording={handleFinishRecording}
        duckPlayingTracks={project.settings.duckPlayingTracks}
        duckingAmountDb={project.settings.duckingAmountDb}
      />

      {/* Audio Effects Suite Rack (Delay, EQ, Chorus, Flanger, Phaser, Reverb) */}
      <EffectsModal
        isOpen={isEffectsModalOpen}
        initialEffectType={activeEffectType}
        project={project}
        selectedClipId={selectedClip?.id || null}
        onSelectClip={(id) => {
          setSelectedClipIds(new Set([id]));
        }}
        onClose={() => setIsEffectsModalOpen(false)}
        onApplyEffect={handleApplyEffect}
      />

      {/* DSP Processing Modals (Amplify, Compress, Denoise, Pitch, Speed) */}
      <DspModals
        activeModal={activeDspModal}
        clip={dspTargetClip}
        asset={dspTargetAsset}
        onClose={() => setActiveDspModal(null)}
        onApplyAmplify={handleApplyAmplify}
        onApplyCompressor={handleApplyCompressor}
        onApplyDenoise={handleApplyDenoise}
        onApplyPitch={handleApplyPitch}
        onApplySpeed={handleApplySpeed}
      />

      {/* Modular Audio Plugins Rack Modal (WAM 2.0 & Native DSP Stems) */}
      <PluginsRackModal
        isOpen={isPluginsRackModalOpen}
        onClose={() => setIsPluginsRackModalOpen(false)}
        tracks={project.tracks}
        selectedTrackId={selectedTrackId}
        onSelectTrack={(id) => setSelectedTrackId(id)}
      />

      {/* Expanded Multi-Pane Broadcast Voiceover Studio Workspace Modal */}
      <VoiceoverModal
        isOpen={isVoiceoverModalOpen}
        onClose={() => setIsVoiceoverModalOpen(false)}
      />

      {/* Expanded Sound Effects & Music Loop Library Workspace Modal */}
      <SoundLibraryModal
        isOpen={isSoundLibraryModalOpen}
        onClose={() => setIsSoundLibraryModalOpen(false)}
        onAddLibraryTrack={handleAddLibraryTrack}
      />
    </div>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <MainStudio />
    </ToastProvider>
  );
}
