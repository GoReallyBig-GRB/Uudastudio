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
import { importStreamedFile, shouldStreamImport } from './assets/streamImport';
import { deleteStreamedAssetWithRetry } from './assets/streamedStore';
import { HistoryManager } from './history/historyManager';
import {
  saveProjectToDB,
  loadProjectFromDB,
  saveAssetToDB,
  loadAssetFromDB,
  collectProjectAssetIds,
  markRestorePending,
  clearRestorePending,
  didPreviousRestoreFail,
  clearCurrentProjectData,
  cleanupOrphanedAssets,
  startNewProjectSession,
} from './storage/db';
import { Header } from './components/Header';
import { LeftSidebar, SidebarTab } from './components/LeftSidebar';
import { MasterConsolePanel } from './components/MasterConsolePanel';
import { ExportPanel } from './components/ExportPanel';
import { Timeline } from './components/Timeline';
import { StatusBar } from './components/StatusBar';
import { RecordingModal } from './components/RecordingModal';
import { takeStartSeconds } from './components/recordingMonitor';
import { nextPartName } from './components/clipTitle';
import { deleteRangeFromClips, type RangeSelection, type TimelineTool } from './components/rangeDelete';
import { getTrackLabel } from './utils/tracks';
import { ClipToolbar } from './components/ClipToolbar';
import { DspModals, DspModalType } from './components/DspModals';
import { EffectsModal } from './components/EffectsModal';
import { NewProjectModal } from './components/NewProjectModal';
import { ResetSessionModal } from './components/ResetSessionModal';
import { ToastProvider, useToast } from './components/Toast';
import { ChevronLeft, Eye, SlidersHorizontal, X, XCircle } from 'lucide-react';
import { processCompression } from './audio/dsp/compressor';
import { processBasicDenoise } from './audio/dsp/denoiser';
import { processPitchShift, processTimeStretch } from './audio/dsp/wsola';
import { peakProvider } from './waveform/peakProvider';
import { decodeProjectFile, encodeProjectFile, writeProjectFileToWritable } from './storage/projectFile';
import { chooseProjectRootDirectory, ensureProjectDirectoryPermission, loadProjectRootDirectory, ProjectDirectoryHandle, ProjectDirectoryFileHandle } from './storage/projectDirectory';
import { formatVolumeDb } from './utils/formatters';
import { masteringController } from './audio/masteringController';
import { analysisIsCurrent, masteringKey, mixFingerprint, normalizeMastering, type MasteringSettings } from './audio/masteringSettings';
import { toChainSettings } from './audio/masteringSettings';
import { useAuth } from './hooks/useAuth';
import { SignInPage } from './components/auth/SignInPage';
import { UserDashboard } from './components/dashboard/UserDashboard';
import { AdminPanel } from './components/admin/AdminPanel';
import { PluginsRackModal } from './components/PluginsRackModal';
import { pluginManager } from './plugins/pluginManager';
import { withPluginStates, restorePluginStates, hasSavedPlugins, isRestoringPlugins } from './plugins/projectPlugins';
import { TemplatesModal } from './components/TemplatesModal';
import { SaveTemplateModal } from './components/SaveTemplateModal';
import { saveCloudTemplate, TemplateSyncError } from './templates/templateApi';
import { projectFromTemplate, templateFromProject, serializeTemplate, templateFileName, UudaTemplate } from './templates/template';
import { pluginSignature, collectLive, attachLive, applySnapshot } from './plugins/pluginHistory';
import { VoiceoverModal } from './components/VoiceoverModal';
import { SoundLibraryModal } from './components/SoundLibraryModal';
import { calculateMinimumTimelineZoom } from './components/timelineZoom';


interface ProjectFileWritable {
  write(data: Blob | Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}
interface ProjectFileHandle {
  name?: string;
  createWritable(): Promise<ProjectFileWritable>;
}
interface WindowWithProjectFilePicker extends Window {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<ProjectFileHandle>;
}

function collectReferencedAssetIdsForUi(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const track of project.tracks) for (const clip of track.clips) {
    if (clip.assetId) ids.add(clip.assetId);
    for (const version of clip.versionHistory || []) if (version.assetId) ids.add(version.assetId);
  }
  return ids;
}

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
  const { addToast, removeToast } = useToast();
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
  const [adminCodePreview, setAdminCodePreview] = useState<string | undefined>(undefined);

  const [project, setProject] = useState<Project>(DEFAULT_PROJECT);
  const [, setTimelineRefreshVersion] = useState<number>(0);
  const projectRef = useRef<Project>(DEFAULT_PROJECT);
  const savedProjectRef = useRef<Project>(DEFAULT_PROJECT);
  // Audio IDs remain here until their IndexedDB write succeeds. Autosave omits
  // non-durable active clips and historical version references from recovery snapshots.
  const unsavedAssetIdsRef = useRef<Set<string>>(new Set());
  const autosaveFailureNotifiedRef = useRef<boolean>(false);
  // If restore fails, do not autosave the blank fallback over a potentially recoverable project.
  const storageRestoreBlockedRef = useRef<boolean>(false);
  // True until the first restore attempt finishes, so autosave never writes a blank project over a snapshot that
  // is still being restored.
  const restoreInProgressRef = useRef<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [trackImportProgress, setTrackImportProgress] = useState<{ progress: number; fileName: string } | null>(null);
  const [isTrackImportIndicatorDismissed, setIsTrackImportIndicatorDismissed] = useState<boolean>(false);
  const isTrackImportIndicatorDismissedRef = useRef<boolean>(false);
  const trackImportProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const importCancelledRef = useRef<boolean>(false);
  const streamImportCancelRef = useRef<(() => void) | null>(null);
  const [playheadSeconds, setPlayheadSeconds] = useState<number>(0);
  // Keep the authoritative clock outside React state. The audio engine ticks at display-frame
  // cadence; committing every tick rerenders the entire studio tree and its expensive timeline.
  const playheadSecondsRef = useRef<number>(0);
  const lastPlayheadRenderAtRef = useRef<number>(0);
  const projectFileHandleRef = useRef<ProjectFileHandle | null>(null);
  const projectRootDirectoryRef = useRef<ProjectDirectoryHandle | null>(null);
  const [projectRootDirectoryName, setProjectRootDirectoryName] = useState<string | null>(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(60);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState<number>(1200);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [clipboardClip, setClipboardClip] = useState<Clip | null>(null);
  const [activeDspModal, setActiveDspModal] = useState<DspModalType>(null);
  const [dspTargetClipId, setDspTargetClipId] = useState<string | null>(null);
  const [isAutosaving, setIsAutosaving] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [isRecordModalOpen, setIsRecordModalOpen] = useState<boolean>(false);
  // Track the next take is recorded into (null = a new top track) and where the playhead was when recording began.
  const [recordTargetTrackId, setRecordTargetTrackId] = useState<string | null>(null);
  const recordStartSecondsRef = useRef<number>(0);
  // Pointer tool and the highlighted range (one track, a span of time) that Delete removes and closes up.
  const [timelineTool, setTimelineTool] = useState<TimelineTool>('select');
  const [rangeSelection, setRangeSelection] = useState<RangeSelection | null>(null);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('tracks');
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
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState<boolean>(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [masterTab, setMasterTab] = useState<'console' | 'meters' | 'mastering'>('console');
  const [masterFaderRev, setMasterFaderRev] = useState(0);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);
  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState<boolean>(false);
  const [isSaveTemplateModalOpen, setIsSaveTemplateModalOpen] = useState<boolean>(false);
  const [templateListVersion, setTemplateListVersion] = useState<number>(0);
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
  useEffect(() => {
    let active = true;
    void loadProjectRootDirectory().then((directory) => {
      if (!active || !directory) return;
      projectRootDirectoryRef.current = directory;
      setProjectRootDirectoryName(directory.name);
    });
    return () => { active = false; };
  }, []);

  const handleChooseProjectRoot = useCallback(async () => {
    try {
      const directory = await chooseProjectRootDirectory();
      projectRootDirectoryRef.current = directory;
      projectFileHandleRef.current = null;
      setProjectRootDirectoryName(directory.name);
      addToast({ type: 'success', title: 'Project Folder Selected', message: `Project files will use “${directory.name}” as the default folder. Existing saved file handles still take priority until Save As or a folder save.` });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      addToast({ type: 'error', title: 'Folder Selection Failed', message: err instanceof Error ? err.message : 'Could not select a project folder.' });
    }
  }, [addToast]);



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

  // Keep a current project reference for unload protection without a stale event-handler closure.
  useEffect(() => { projectRef.current = project; }, [project]);

  // Mastering is a processor on the master bus: settings live with the project (not in undo history)
  const mastering = useMemo(() => normalizeMastering(project.mastering), [project.mastering]);
  const mixKey = useMemo(
    () => mixFingerprint(project, audioEngine.getMasterVolume(), audioEngine.getMasterMute()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, masterFaderRev],
  );
  const handleMasteringChange = useCallback((patch: Partial<MasteringSettings>) => {
    setProject((cur) => {
      const next = { ...normalizeMastering(cur.mastering), ...patch };
      // Changing the sound invalidates the saved measurement; switching on/off does not
      const { analysis: _drop, ...rest } = next;
      const soundChanged = masteringKey(next) !== masteringKey(normalizeMastering(cur.mastering));
      const merged: MasteringSettings = soundChanged ? rest : next;
      const updated = { ...cur, mastering: merged };
      projectRef.current = updated;
      return updated;
    });
  }, []);

  // Playback follows the settings; the make-up gain comes from the last measurement that matches them
  useEffect(() => {
    const matches = mastering.analysis && mastering.analysis.settingsKey === masteringKey(mastering);
    audioEngine.setMastering(mastering, mastering.active && matches ? mastering.analysis!.gainDb : 0);
  }, [mastering]);

  // Keep the measurement up to date in the background while mastering is on
  const hasAudioForMastering = project.tracks.some((t) => t.clips.length > 0);
  useEffect(() => {
    if (!mastering.active || !hasAudioForMastering || analysisIsCurrent(mastering, mixKey)) {
      if (!mastering.active || !hasAudioForMastering) masteringController.cancel();
      return;
    }
    masteringController.request({
      project,
      settings: toChainSettings(mastering),
      sampleRate: project.sampleRate || 48000,
      onDone: (analysis) => {
        setProject((cur) => {
          const m = normalizeMastering(cur.mastering);
          if (masteringKey(m) !== analysis.settingsKey) return cur;
          const updated = { ...cur, mastering: { ...m, analysis } };
          projectRef.current = updated;
          return updated;
        });
      },
    });
    return () => { /* a newer request replaces this one */ };
  }, [mastering, mixKey, hasAudioForMastering, project]);

  const handleMeasureMasteringNow = useCallback(() => {
    if (!mastering.active || !hasAudioForMastering) return;
    masteringController.requestNow({
      project: projectRef.current,
      settings: toChainSettings(mastering),
      sampleRate: project.sampleRate || 48000,
      onDone: (analysis) => {
        setProject((cur) => {
          const m = normalizeMastering(cur.mastering);
          if (masteringKey(m) !== analysis.settingsKey) return cur;
          const updated = { ...cur, mastering: { ...m, analysis } };
          projectRef.current = updated;
          return updated;
        });
      },
    });
  }, [mastering, hasAudioForMastering, project.sampleRate]);

  const openExport = useCallback(() => { setIsExportOpen(true); }, []);
  const openMastering = useCallback(() => { setIsExportOpen(false); setMasterTab('mastering'); setIsRightSidebarOpen(true); }, []);

  // Protect unsaved portable project changes when the tab is closed or navigated away.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (projectRef.current !== savedProjectRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // The export passes unavailable plugins through; say which ones, so a missing effect is never a surprise
  useEffect(() => {
    const onSkipped = (e: Event) => {
      const list = (e as CustomEvent).detail?.plugins as Array<{ name: string; reason: string }> | undefined;
      if (!list || list.length === 0) return;
      const names = Array.from(new Set(list.map((p) => p.name))).join(', ');
      addToast({
        type: 'warning',
        title: 'Export skipped some plugins',
        message: `${names} could not be applied, so the audio passes through unchanged.`,
      });
    };
    window.addEventListener('uuda:export-skipped-plugins', onSkipped);
    return () => window.removeEventListener('uuda:export-skipped-plugins', onSkipped);
  }, [addToast]);

  // Plugin chains in undo/redo: edits are written into the project (one history step per burst of edits)
  const applyingPluginsRef = useRef<boolean>(false);
  const pluginCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitPluginEdits = useCallback(async () => {
    if (applyingPluginsRef.current || isRestoringPlugins()) return;
    const live = await collectLive(projectRef.current);
    if (applyingPluginsRef.current || isRestoringPlugins()) return;
    setProjectWithHistory((prev) => {
      const next = attachLive(prev, live);
      return pluginSignature(next) === pluginSignature(prev) ? prev : next;
    });
  }, [setProjectWithHistory]);

  /** Records any pending plugin edit right now (before undo, before deleting a track) */
  const flushPluginEdits = useCallback(async () => {
    if (pluginCommitTimerRef.current) {
      clearTimeout(pluginCommitTimerRef.current);
      pluginCommitTimerRef.current = null;
    }
    await commitPluginEdits();
  }, [commitPluginEdits]);

  useEffect(() => {
    const unsubscribe = pluginManager.subscribeEdits(() => {
      if (applyingPluginsRef.current || isRestoringPlugins()) return;
      if (pluginCommitTimerRef.current) clearTimeout(pluginCommitTimerRef.current);
      // A knob drag is many edits; wait for it to settle so it is one undo step
      pluginCommitTimerRef.current = setTimeout(() => {
        pluginCommitTimerRef.current = null;
        void commitPluginEdits();
      }, 350);
    });
    return () => {
      unsubscribe();
      if (pluginCommitTimerRef.current) clearTimeout(pluginCommitTimerRef.current);
    };
  }, [commitPluginEdits]);

  /** After undo/redo: make the live chains match the snapshot, without adding a history step of their own */
  const syncPluginsToSnapshot = useCallback(async (snapshot: Project) => {
    applyingPluginsRef.current = true;
    try {
      const rebuilt = await applySnapshot(audioEngine.init(), snapshot);
      if (rebuilt) {
        // Rebuilt chains can differ in tiny ways (clamped values): rebase quietly so redo is not lost
        const live = await collectLive(projectRef.current);
        const rebased = attachLive(projectRef.current, live);
        historyManagerRef.current.setPresent(rebased);
        setProject(rebased);
      }
    } catch (err) {
      console.warn('Could not rebuild plugin chains after undo/redo:', err);
    } finally {
      applyingPluginsRef.current = false;
    }
  }, []);

  // 1. Restore project and stored assets from IndexedDB on initial mount
  useEffect(() => {
    let isMounted = true;

    async function restoreSession() {
      try {
        // If launched as a new session in separate browser tab, start blank without restoring old session
        const urlParams = new URLSearchParams(window.location.search);
        const isForcedNew = urlParams.get('new') === '1' || urlParams.get('new_project') === '1';
        if (isForcedNew) {
          startNewProjectSession();
          await cleanupOrphanedAssets().catch(() => ({ removedAssets: 0 }));
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

        // Resolve this tab's project slot first, then prune stale snapshots/orphaned assets
        // before loading PCM. The cleanup keeps every fresh tab's referenced assets intact.
        const savedProject = await loadProjectFromDB();
        await cleanupOrphanedAssets().catch(() => ({ removedAssets: 0 }));

        // Load only the audio the restored project actually uses, one file at a time, and let the browser breathe
        // between files. Anything else saved in local storage is left alone: it costs disk, not memory.
        const neededAssetIds = savedProject ? [...collectProjectAssetIds(savedProject)] : [];
        let restoreSkipped = false;
        if (neededAssetIds.length > 0) {
          if (didPreviousRestoreFail()) {
            // The last launch started restoring audio and never finished (closed or killed). Do not repeat
            // the same work and freeze the computer again.
            restoreSkipped = true;
            clearRestorePending();
          } else {
            markRestorePending();
            for (const assetId of neededAssetIds) {
              if (!isMounted) break;
              const asset = await loadAssetFromDB(assetId, audioEngine);
              if (asset && isMounted) audioEngine.registerAsset(asset);
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
            clearRestorePending();
          }
        }

        if (restoreSkipped) {
          clearCurrentProjectData().catch(() => {});
          if (isMounted) {
            addToast({
              type: 'warning',
              title: 'Last Session Not Restored',
              message: 'Restoring the previous session did not finish last time, so it was skipped to keep the app responsive. Open your saved .uuda file to continue.',
              duration: 0,
            });
          }
          return;
        }

        if (isMounted && savedProject) {
          savedProjectRef.current = savedProject;
          setProject(savedProject);
          historyManagerRef.current.reset(savedProject);
          updateHistoryFlags();
          setLastSavedAt(new Date());

          // Rebuild the saved plugin chains in the background (the audio context may wait for the first click)
          if (hasSavedPlugins(savedProject)) {
            restorePluginStates(audioEngine.init(), savedProject).catch((err) =>
              console.warn('Could not restore plugin chains:', err)
            );
          }

          if (savedProject.tracks.length > 0) {
            addToast({
              type: 'info',
              title: 'Session Restored',
              message: `Restored ${savedProject.tracks.length} tracks from local storage.`,
            });
          }
        }
      } catch (err) {
        // A transient IndexedDB read failure must not be treated as an empty project:
        // pause autosave so the blank fallback cannot overwrite a recoverable snapshot.
        storageRestoreBlockedRef.current = true;
        if (isMounted) {
          addToast({
            type: 'error',
            title: 'Storage Restore Warning',
            message: err instanceof Error
              ? `${err.message} Local autosave is paused to protect existing recovery data.`
              : 'Could not restore previous session. Local autosave is paused to protect existing recovery data.',
            duration: 0,
          });
        }
      }
    }

    restoreSession().finally(() => {
      restoreInProgressRef.current = false;
    });
    return () => {
      isMounted = false;
    };
  }, [addToast, updateHistoryFlags]);

  // 2. Periodic Autosave to IndexedDB. Read the latest project ref on each tick so
  // project edits do not continually tear down/recreate the timer or queue stale snapshots.
  useEffect(() => {
    let saveInFlight = false;
    const timer = setInterval(async () => {
      if (storageRestoreBlockedRef.current || restoreInProgressRef.current || saveInFlight) return;
      saveInFlight = true;
      try {
        setIsAutosaving(true);
        const snapshot = projectRef.current;
        const unsavedAssetIds = unsavedAssetIdsRef.current;
        const safeTracks = snapshot.tracks
          .map((track) => ({
            ...track,
            clips: track.clips
              .filter((clip) => !unsavedAssetIds.has(clip.assetId))
              .map((clip) => ({
                ...clip,
                // Historical clip versions also reference durable audio assets. Do not let
                // an in-flight/failed asset write leave a dangling version-history reference
                // in the recovery snapshot when the active clip itself is already saved.
                versionHistory: clip.versionHistory?.filter(
                  (version) => !unsavedAssetIds.has(version.assetId)
                ),
              })),
          }))
          .filter((track, index) => track.clips.length > 0 || snapshot.tracks[index].clips.length === 0);
        await saveProjectToDB(await withPluginStates({ ...snapshot, tracks: safeTracks }));
        autosaveFailureNotifiedRef.current = false;
        setLastSavedAt(new Date());
      } catch (error) {
        // Quota/permission failures must not silently imply that local recovery is current.
        if (!autosaveFailureNotifiedRef.current) {
          autosaveFailureNotifiedRef.current = true;
          addToast({
            type: 'warning',
            title: 'Local Recovery Save Failed',
            message: error instanceof Error
              ? `IndexedDB could not save the latest recovery snapshot: ${error.message}. Use Project → Save to keep a portable copy.`
              : 'IndexedDB could not save the latest recovery snapshot. Use Project → Save to keep a portable copy.',
            duration: 0,
          });
        }
      } finally {
        saveInFlight = false;
        setIsAutosaving(false);
      }
    }, 4000);

    return () => clearInterval(timer);
  }, [addToast]);

  // 3. Connect audio engine time update & playback ended listeners
  useEffect(() => {
    audioEngine.setOnTimeUpdate((time) => {
      playheadSecondsRef.current = time;
      const now = performance.now();
      const playbackIsActive = audioEngine.getIsPlaying();
      // While playing, refresh React-owned labels at most 10 times per second. Seek, stop,
      // and playback-end notifications still update immediately for exact user-visible state.
      if (!playbackIsActive || now - lastPlayheadRenderAtRef.current >= 100) {
        lastPlayheadRenderAtRef.current = now;
        setPlayheadSeconds(time);
      }
    });
    audioEngine.setOnPlaybackEnded(() => {
      setIsPlaying(false);
    });
  }, []);

  // Sync track gain and pan nodes with audio engine when project tracks change
  useEffect(() => {
    audioEngine.syncTracks(project.tracks);
    // Ducking settings or source clips may have changed mid-playback: re-apply only the curves that did
    audioEngine.refreshDucking(project);
  }, [project]);

  // 4. Playback Handlers
  const handlePlay = async () => {
    try {
      await audioEngine.play(project, playheadSecondsRef.current);
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
    const stoppedAt = audioEngine.getCurrentTime();
    playheadSecondsRef.current = stoppedAt;
    setPlayheadSeconds(stoppedAt);
    setIsPlaying(false);
  };

  const handleStop = () => {
    audioEngine.stop();
    setIsPlaying(false);
    playheadSecondsRef.current = 0;
    setPlayheadSeconds(0);
  };

  const handleReturnToStart = useCallback(() => {
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    }
    audioEngine.seek(0);
    playheadSecondsRef.current = 0;
    setPlayheadSeconds(0);
    addToast({
      type: 'info',
      title: 'Rewound to Head',
      message: 'Playhead returned to 00:00:00.',
    });
  }, [isPlaying, addToast]);

  const createBlankProject = useCallback(() => {
    projectFileHandleRef.current = null;
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    }
    audioEngine.seek(0);
    playheadSecondsRef.current = 0;
    setPlayheadSeconds(0);
    pluginManager.clearAll();
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
    savedProjectRef.current = blankProject;
    setProject(blankProject);
    historyManagerRef.current.reset(blankProject);
    updateHistoryFlags();
    setSelectedTrackId(null);
    setSelectedClipIds(new Set());
    saveProjectToDB(blankProject).catch(() => {});
  }, [isPlaying, updateHistoryFlags]);

  const handleNewProject = useCallback(() => {
    if (project !== savedProjectRef.current) {
      setIsNewProjectModalOpen(true);
    } else {
      createBlankProject();
      addToast({
        type: 'success',
        title: 'New Blank Project Created',
        message: 'Ready for recording, voiceover, and sound design.',
      });
    }
  }, [project, createBlankProject, addToast]);

  const handleSaveProjectToFile = useCallback(async (forceSaveAs = false): Promise<boolean> => {
    try {
      // The .uuda file is the portable project backup: project JSON plus every referenced
      // audio asset in a single binary container. IndexedDB remains the recovery autosave.
      // Use bounded writes when a file handle is available; build a Blob only for download fallback.
      // Include the plugin chains so a reopened file sounds the same
      const fullProject = await withPluginStates(project);
      const fileName = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_') || 'Session'}.uuda`;
      const pickerWindow = window as WindowWithProjectFilePicker;
      let fileHandle = !forceSaveAs ? projectFileHandleRef.current : null;

      // If a root folder is configured, create/update the project's .uuda file there
      // before falling back to the single-file Save As picker.
      if (!fileHandle && !forceSaveAs && projectRootDirectoryRef.current) {
        const directory = projectRootDirectoryRef.current;
        if (await ensureProjectDirectoryPermission(directory)) {
          fileHandle = await directory.getFileHandle(fileName, { create: true }) as unknown as ProjectFileHandle;
        }
      }

      if (!fileHandle && pickerWindow.showSaveFilePicker) {
        try {
          fileHandle = await pickerWindow.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'Uuda Studio project', accept: { 'application/vnd.uuda.project': ['.uuda'] } }],
          });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return false;
          throw err;
        }
      }

      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        try {
          await writeProjectFileToWritable(fullProject, (assetId) => audioEngine.getAsset(assetId), writable);
          await writable.close();
        } catch (err) {
          if (writable.abort) {
            try { await writable.abort(err); } catch { /* preserve original write error */ }
          }
          throw err;
        }
        projectFileHandleRef.current = fileHandle;
        addToast({
          type: 'success',
          title: 'Project Saved to Computer',
          message: `Saved self-contained project "${fileHandle.name || fileName}".`,
        });
      } else {
        // Non-Chromium fallback: downloads remain the supported save mechanism.
        const blob = encodeProjectFile(fullProject, (assetId) => audioEngine.getAsset(assetId));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        projectFileHandleRef.current = null;
        addToast({
          type: 'success',
          title: 'Project Saved to Computer',
          message: `Downloaded self-contained project "${fileName}".`,
        });
      }
      savedProjectRef.current = project;
      return true;
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Save Failed',
        message: err instanceof Error ? err.message : 'Could not export project file.',
      });
      return false;
    }
  }, [project, addToast]);

  /** Create a fresh project from a built-in or imported template. */
  const handleUseTemplate = useCallback(
    async (template: UudaTemplate, saveFirst: boolean) => {
      if (saveFirst) {
        const saved = await handleSaveProjectToFile(false);
        if (!saved) return;
      }
      if (isPlaying) {
        audioEngine.pause();
        setIsPlaying(false);
      }
      audioEngine.seek(0);
      setPlayheadSeconds(0);
      const next = projectFromTemplate(template);
      pluginManager.clearAll();
      setProjectWithHistory(next);
      if (hasSavedPlugins(next)) {
        restorePluginStates(audioEngine.init(), next).catch((err) => console.warn('Could not set up template plugins:', err));
      }
      setSelectedTrackId(next.tracks[0]?.id || null);
      setSelectedClipIds(new Set());
      saveProjectToDB(next).catch(() => {});
      setIsTemplatesModalOpen(false);
      addToast({ type: 'success', title: 'Project Created from Template', message: `"${template.name}" is ready with ${next.tracks.length} tracks.` });
    },
    [handleSaveProjectToFile, isPlaying, setProjectWithHistory, addToast],
  );

  const handleSaveAsTemplate = useCallback(
    async (meta: { name: string; description: string; tags: string[]; toFile: boolean; toAccount: boolean }) => {
      try {
        const full = await withPluginStates(project);
        const template = templateFromProject(full, { name: meta.name, description: meta.description, tags: meta.tags });
        const done: string[] = [];
        let accountError: string | null = null;

        if (meta.toAccount) {
          try {
            await saveCloudTemplate(template);
            setTemplateListVersion((v) => v + 1);
            done.push('saved to your account');
          } catch (err) {
            accountError = err instanceof TemplateSyncError ? err.message : 'Could not save to your account.';
          }
        }
        if (meta.toFile) {
          const blob = new Blob([serializeTemplate(template)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = templateFileName(template);
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          done.push(`downloaded as "${templateFileName(template)}"`);
        }

        if (accountError && done.length === 0) {
          // Nothing was saved: keep the window open so the user can try again or switch to a file
          addToast({ type: 'error', title: 'Could Not Save Template', message: accountError });
          return;
        }
        setIsSaveTemplateModalOpen(false);
        if (accountError) {
          addToast({ type: 'warning', title: 'Saved to File Only', message: `The file was downloaded, but your account copy failed: ${accountError}` });
        } else {
          addToast({ type: 'success', title: 'Template Saved', message: `"${template.name}" ${done.join(' and ')}.` });
        }
      } catch (err) {
        addToast({ type: 'error', title: 'Could Not Save Template', message: err instanceof Error ? err.message : 'Something went wrong.' });
      }
    },
    [project, addToast],
  );

  const handleSaveAndNewProject = useCallback(async () => {
    const saved = await handleSaveProjectToFile();
    if (!saved) return;
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
      if (project !== savedProjectRef.current) {
        const shouldReplace = window.confirm(
          'This project has changes that have not been saved to a portable .uuda file. Continue opening another project and replace the current workspace?'
        );
        if (!shouldReplace) return false;
      }
      const context = await audioEngine.init();
      const decoded = await decodeProjectFile(file, context);
      projectFileHandleRef.current = null;
      const parsed = decoded.project;
      // A missing asset in the opened container must not accidentally bind to an old
      // in-memory asset with the same ID from the previously open project.
      for (const missingId of decoded.missingAssetIds) audioEngine.unregisterAsset(missingId);
      if (!parsed || !Array.isArray(parsed.tracks)) {
        throw new Error('Selected file is not a valid UUDA project file.');
      }
      if (isPlaying) {
        audioEngine.pause();
        setIsPlaying(false);
      }
      audioEngine.seek(0);
      playheadSecondsRef.current = 0;
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

      // Register decoded audio immediately and mark it non-durable until each IndexedDB
      // write succeeds. Project opening must not wait behind large persistence writes.
      for (const asset of decoded.assets) {
        audioEngine.registerAsset(asset);
        unsavedAssetIdsRef.current.add(asset.id);
      }

      savedProjectRef.current = loadedProject;
      pluginManager.clearAll();
      setProject(loadedProject);
      historyManagerRef.current.reset(loadedProject);
      updateHistoryFlags();
      if (hasSavedPlugins(loadedProject)) {
        restorePluginStates(audioEngine.init(), loadedProject).catch((err) =>
          console.warn('Could not restore plugin chains:', err)
        );
      }
      setSelectedTrackId(loadedProject.tracks[0]?.id || null);
      setSelectedClipIds(new Set());

      const missingInMemory = [...collectReferencedAssetIdsForUi(loadedProject)].filter((id) => !audioEngine.getAsset(id));
      const missingFromFile = [...new Set([...decoded.missingAssetIds, ...missingInMemory])];
      if (missingFromFile.length > 0) {
        addToast({
          type: 'warning',
          title: 'Project Opened with Missing Audio',
          message: `${missingFromFile.length} referenced audio asset(s) could not be restored. The project timeline opened; affected clips may be silent.`,
          duration: 0,
        });
      } else {
        addToast({
          type: 'success',
          title: 'Project Loaded from Computer',
          message: `"${loadedProject.name}" restored with ${loadedProject.tracks.length} tracks and ${decoded.assets.length} audio assets. Local recovery is saving in the background.`,
        });
      }

      // Persist in the background after the timeline becomes available. Failed assets remain
      // excluded from recovery snapshots, and a later successful retry can make them durable.
      if (decoded.assets.length > 0) {
        void (async () => {
          const failedPersistenceAssetIds: string[] = [];
          for (const asset of decoded.assets) {
            try {
              await saveAssetToDB(asset);
              unsavedAssetIdsRef.current.delete(asset.id);
            } catch {
              failedPersistenceAssetIds.push(asset.id);
            }
          }
          if (failedPersistenceAssetIds.length > 0) {
            addToast({
              type: 'warning',
              title: 'Project Opened; Local Recovery Incomplete',
              message: `${failedPersistenceAssetIds.length} audio asset(s) could not be saved to IndexedDB. The project is playable now; keep the .uuda file as your recovery copy.`,
              duration: 0,
            });
          }
        })();
      }
      return true;
    } catch (err) {
      addToast({
        type: 'error',
        title: 'Open Project Failed',
        message: err instanceof Error ? err.message : 'Failed to read project file.',
      });
      return false;
    }
  }, [isPlaying, addToast, project, updateHistoryFlags]);


  const handleOpenProjectFromRoot = useCallback(async () => {
    try {
      let directory = projectRootDirectoryRef.current;
      if (!directory) {
        addToast({ type: 'info', title: 'Choose a Project Folder First', message: 'Select a root folder before opening a project from it.' });
        return;
      }
      if (!(await ensureProjectDirectoryPermission(directory))) {
        directory = await chooseProjectRootDirectory();
        projectRootDirectoryRef.current = directory;
        setProjectRootDirectoryName(directory.name);
      }
      const candidates: ProjectDirectoryFileHandle[] = [];
      for await (const entry of directory.values()) {
        if (entry.kind === 'file' && /\.uuda$/i.test(entry.name)) candidates.push(entry as unknown as ProjectDirectoryFileHandle);
      }
      candidates.sort((a, b) => a.name.localeCompare(b.name));
      if (candidates.length === 0) {
        addToast({ type: 'info', title: 'No Uuda Projects Found', message: `No .uuda files were found in “${directory.name}”.` });
        return;
      }
      const listing = candidates.map((entry, index) => `${index + 1}. ${entry.name}`).join('\n');
      const choice = window.prompt(`Open a project from “${directory.name}” by number:\n\n${listing}\n\nEnter a number (Cancel to keep the current project):`);
      if (choice === null) return;
      const index = Number.parseInt(choice, 10) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= candidates.length) {
        addToast({ type: 'error', title: 'Invalid Project Selection', message: 'Enter one of the project numbers shown.' });
        return;
      }
      const handle = candidates[index];
      const file = await handle.getFile();
      const opened = await handleOpenProjectFromFile(file);
      if (opened) projectFileHandleRef.current = handle as unknown as ProjectFileHandle;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      addToast({ type: 'error', title: 'Could Not Open From Folder', message: err instanceof Error ? err.message : 'Could not read a project from the selected folder.' });
    }
  }, [addToast, handleOpenProjectFromFile]);
  // Project shortcuts follow the PRD: Ctrl/Cmd+S saves, Shift adds Save As, and O opens.
  useEffect(() => {
    const handleProjectShortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || currentView !== 'studio') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void handleSaveProjectToFile(event.shiftKey);
      } else if (key === 'o') {
        event.preventDefault();
        window.dispatchEvent(new Event('uuda:open-project-picker'));
      }
    };
    window.addEventListener('keydown', handleProjectShortcuts);
    return () => window.removeEventListener('keydown', handleProjectShortcuts);
  }, [currentView, handleSaveProjectToFile]);

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

  // 5. File Import: make decoded audio available immediately, then persist it locally.
  const handleImportFiles = async (files: FileList) => {
    if (files.length === 0) return;

    importCancelledRef.current = false;
    isTrackImportIndicatorDismissedRef.current = false;
    setIsTrackImportIndicatorDismissed(false);
    const progressPerFile = 100 / files.length;
    for (let i = 0; i < files.length; i++) {
      if (importCancelledRef.current) break;
      const file = files[i];
      const fileProgressStart = i * progressPerFile;
      const fileProgressEnd = (i + 1) * progressPerFile;
      setTrackImportProgress({ progress: fileProgressStart, fileName: file.name });
      const progressTimer = isTrackImportIndicatorDismissedRef.current ? null : setInterval(() => {
        setTrackImportProgress((current) => current
          ? { ...current, progress: Math.min(fileProgressEnd - progressPerFile * 0.12, current.progress + Math.max(0.15, progressPerFile * 0.018)) }
          : current);
      }, 180);
      trackImportProgressTimerRef.current = progressTimer;
      const decodeToastId = addToast({
        type: 'info',
        title: 'Decoding Audio...',
        message: `Processing ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`,
        duration: 0,
      });
      let persistenceToastId: string | null = null;
      let trackAdded = false;

      try {
        const assetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        let asset: Asset;
        if (shouldStreamImport(file)) {
          // Long file: decode in the background straight to file storage. Nothing close to the whole file
          // is ever held in memory, so it cannot run the tab out of memory.
          if (progressTimer) clearInterval(progressTimer);
          trackImportProgressTimerRef.current = null;
          const handle = importStreamedFile(file, assetId, (fraction) => {
            setTrackImportProgress({ progress: fileProgressStart + fraction * progressPerFile * 0.98, fileName: file.name });
          });
          streamImportCancelRef.current = handle.cancel;
          try {
            asset = await handle.promise;
          } finally {
            streamImportCancelRef.current = null;
          }
        } else {
        const audioBuffer = await audioEngine.decodeAudioFile(file);
        // Audio decoding is not abortable through the current engine API. If cancelled meanwhile,
        // discard the decoded buffer and do not add this file or continue with the batch.
        if (importCancelledRef.current) {
          removeToast(decodeToastId);
          break;
        }
        asset = {
          id: assetId,
          name: file.name,
          kind: 'import',
          buffer: audioBuffer,
          sampleRate: audioBuffer.sampleRate,
          durationSeconds: audioBuffer.duration,
          numberOfChannels: audioBuffer.numberOfChannels,
        };
        }
        if (importCancelledRef.current) {
          removeToast(decodeToastId);
          if (asset.source) void deleteStreamedAssetWithRetry(asset.id);
          break;
        }

        audioEngine.registerAsset(asset);
        unsavedAssetIdsRef.current.add(assetId);

        const trackId = `track-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const clipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const newClip: Clip = {
          id: clipId,
          trackId,
          assetId: asset.id,
          name: file.name.replace(/\.[^/.]+$/, ''),
          startSeconds: 0,
          offsetSeconds: 0,
          durationSeconds: asset.durationSeconds,
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

        // The track becomes usable after decode; IndexedDB durability is a separate state.
        setProjectWithHistory((prev) => ({ ...prev, tracks: [newTrack, ...prev.tracks] }));
        setSelectedTrackId(trackId);
        setSelectedClipIds(new Set([clipId]));
        trackAdded = true;
        removeToast(decodeToastId);

        // The upload indicator represents getting the track onto the timeline, not disk persistence.
        // Hide it immediately; IndexedDB saving continues independently below.
        if (progressTimer) clearInterval(progressTimer);
        if (trackImportProgressTimerRef.current === progressTimer) trackImportProgressTimerRef.current = null;
        setTrackImportProgress(null);

        persistenceToastId = asset.source ? null : addToast({
          type: 'info',
          title: 'Saving Local Audio...',
          message: `${file.name} is playable; keeping a local recovery copy.`,
          duration: 0,
        });

        // Yield a task so React can paint the newly added track before storage work begins.
        // A timer is used instead of requestAnimationFrame because background tabs may suspend RAF.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await saveAssetToDB(asset);
        unsavedAssetIdsRef.current.delete(assetId);
        if (persistenceToastId) removeToast(persistenceToastId);
        persistenceToastId = null;
        addToast(asset.source
          ? {
              type: 'warning',
              title: 'Long Audio Imported',
              message: `${file.name} (${(asset.durationSeconds / 60).toFixed(1)} min) is stored on this device. The waveform, zoom, clip editing, playback and export work; audio effects and saving as a .uuda file for long audio arrive in later updates.`,
              duration: 12000,
            }
          : {
              type: 'success',
              title: 'Audio Imported and Saved',
              message: `${file.name} (${asset.durationSeconds.toFixed(2)}s) is ready and stored locally.`,
            });
      } catch (err) {
        removeToast(decodeToastId);
        if (persistenceToastId) removeToast(persistenceToastId);
        if (importCancelledRef.current && !trackAdded) continue; // cancelled by the user: no error toast
        addToast({
          type: trackAdded ? 'warning' : 'error',
          title: trackAdded ? 'Audio Playable, Local Save Failed' : 'Decode Failed',
          message: trackAdded
            ? `${file.name} is currently playable but will not survive a reload until saved. ${err instanceof Error ? err.message : 'IndexedDB storage failed.'}`
            : `${file.name}: ${err instanceof Error ? err.message : 'Unsupported or corrupted audio format.'}`,
        });
      } finally {
        if (progressTimer) clearInterval(progressTimer);
        if (trackImportProgressTimerRef.current === progressTimer) trackImportProgressTimerRef.current = null;
        setTrackImportProgress(null);
        removeToast(decodeToastId);
        if (persistenceToastId) removeToast(persistenceToastId);
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

      const clipId = `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

      // Recording into an existing track: add the take there at the playhead position it started from.
      const targetTrack = recordTargetTrackId ? project.tracks.find((t) => t.id === recordTargetTrackId) : undefined;
      if (targetTrack) {
        const startSeconds = takeStartSeconds(recordStartSecondsRef.current);
        const takeClip: Clip = {
          id: clipId,
          trackId: targetTrack.id,
          assetId: asset.id,
          name: takeName,
          startSeconds,
          offsetSeconds: 0,
          durationSeconds: audioBuffer.duration,
          gain: 1.0,
          fadeInSeconds: 0,
          fadeOutSeconds: 0,
          fadeShape: 'linear',
        };
        setProjectWithHistory((prev) => ({
          ...prev,
          tracks: prev.tracks.map((t) => (t.id === targetTrack.id ? { ...t, clips: [...t.clips, takeClip] } : t)),
        }));
        setSelectedTrackId(targetTrack.id);
        setSelectedClipIds(new Set([clipId]));
        addToast({
          type: 'success',
          title: 'Recording Finished',
          message: `${takeName} (${audioBuffer.duration.toFixed(2)}s) added to "${getTrackLabel(targetTrack, project.tracks.indexOf(targetTrack))}" at ${startSeconds.toFixed(2)}s.`,
        });
        return;
      }

      // Create new track & clip placed at index 0 (top of timeline and tracks side panel)
      const trackId = `track-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

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
    peakProvider.clearAsset(asset.id);

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

  const handleAddLibraryTrack = (asset: Asset) => {
    // Crucial: Register asset in audioEngine so timeline and playback can access audioBuffer
    audioEngine.registerAsset(asset);
    saveAssetToDB(asset).catch((err) => console.warn('Failed to save library asset to IndexedDB:', err));
    peakProvider.clearAsset(asset.id);

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

  const handleDeleteTrack = async (trackId: string) => {
    // Record the track's chain in history first, so undoing the delete brings its plugins back
    await flushPluginEdits();
    pluginManager.clearTrack(trackId);
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

  // Removes every empty lane that carries no effects (one undo step brings them back)
  const handleRemoveEmptyTracks = () => {
    const removable = project.tracks.filter(
      (t) => t.clips.length === 0 && pluginManager.getPluginsForTrack(t.id).length === 0
    );
    if (removable.length === 0) return;
    const ids = new Set(removable.map((t) => t.id));
    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: prev.tracks.filter((t) => !ids.has(t.id)),
    }));
    if (selectedTrackId && ids.has(selectedTrackId)) setSelectedTrackId(null);
    addToast({
      type: 'info',
      title: removable.length === 1 ? 'Empty track removed' : `${removable.length} empty tracks removed`,
      message: 'Press Ctrl+Z to bring them back.',
    });
  };

  // Called by the timeline when a drag emptied lanes that were never touched and removed them
  const handleTracksAutoRemoved = (ids: string[]) => {
    if (selectedTrackId && ids.includes(selectedTrackId)) setSelectedTrackId(null);
    addToast({
      type: 'info',
      title: ids.length === 1 ? 'Empty track removed' : `${ids.length} empty tracks removed`,
      message: 'The lane was left empty by the move. Press Ctrl+Z to undo.',
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
      : Math.max(0, playheadSecondsRef.current);

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
      playheadSecondsRef.current <= targetClip.startSeconds ||
      playheadSecondsRef.current >= targetClip.startSeconds + targetClip.durationSeconds
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
    const relativeSeconds = playheadSecondsRef.current - targetClip.startSeconds;
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
      name: nextPartName(targetClip.name),
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
      message: `Cut at frame ${splitFrame} (${playheadSecondsRef.current.toFixed(4)}s). Both pieces share buffer.`,
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

    peakProvider.clearAsset(dspTargetClip.assetId);
    peakProvider.clearAsset(newAsset.id);

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

    peakProvider.clearAsset(dspTargetClip.assetId);
    peakProvider.clearAsset(newAsset.id);

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

    peakProvider.clearAsset(dspTargetClip.assetId);
    peakProvider.clearAsset(newAsset.id);

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

    peakProvider.clearAsset(dspTargetClip.assetId);
    peakProvider.clearAsset(newAsset.id);

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

    peakProvider.clearAsset(dspTargetClip.assetId);
    peakProvider.clearAsset(newAsset.id);

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

    peakProvider.clearAsset(targetClip.assetId);
    peakProvider.clearAsset(newAsset.id);

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

  /** Remove the highlighted range from its track and slide the rest of that track left to close the gap. */
  const handleDeleteRange = () => {
    const sel = rangeSelection;
    if (!sel) return;
    const track = project.tracks.find((t) => t.id === sel.trackId);
    if (!track) {
      setRangeSelection(null);
      return;
    }
    const result = deleteRangeFromClips(
      track.clips,
      sel.startSeconds,
      sel.endSeconds,
      () => `clip-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    );
    setRangeSelection(null);
    if (result.removedSeconds === 0) {
      addToast({ type: 'info', title: 'Nothing to delete', message: 'There is no audio in that range on this track.' });
      return;
    }
    setProjectWithHistory((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === sel.trackId ? { ...t, clips: result.clips } : t)),
    }));
    setSelectedClipIds(new Set());
    addToast({
      type: 'success',
      title: 'Range Deleted',
      message: `Removed ${result.removedSeconds.toFixed(2)}s from this track and closed the gap.`,
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
  const handleUndo = async () => {
    await flushPluginEdits();
    const previous = historyManagerRef.current.undo();
    if (previous) {
      const restored = { ...previous, mastering: projectRef.current.mastering };
      setProject(restored);
      projectRef.current = restored;
      void syncPluginsToSnapshot(previous);
      updateHistoryFlags();
      addToast({ type: 'info', title: 'Undo', message: 'Reverted last change.' });
    }
  };

  const handleRedo = async () => {
    await flushPluginEdits();
    const next = historyManagerRef.current.redo();
    if (next) {
      const restored = { ...next, mastering: projectRef.current.mastering };
      setProject(restored);
      projectRef.current = restored;
      void syncPluginsToSnapshot(next);
      updateHistoryFlags();
      addToast({ type: 'info', title: 'Redo', message: 'Reapplied change.' });
    }
  };

  // 9. Zoom controls
  const controlsWidthForZoom = isTimelineControlsCollapsed ? 32 : 272;
  const usableTimelineWidth = Math.max(100, timelineViewportWidth - controlsWidthForZoom - 32);
  // Keep the whole mix visible with at most one minute of intentional right-side
  // breathing room. The minimum zoom is derived from the current mix duration.
  const minimumTimelineZoom = calculateMinimumTimelineZoom(usableTimelineWidth, totalDurationSeconds);

  // Recalculate the boundary when the mix duration or usable viewport changes.
  // This also prevents a shortened mix from leaving excessive empty space visible.
  useEffect(() => {
    setPixelsPerSecond((prev) => Math.max(prev, minimumTimelineZoom));
  }, [minimumTimelineZoom]);

  const handleZoomIn = () => {
    setPixelsPerSecond((prev) => Math.min(1000, prev * 1.3));
  };

  const handleZoomOut = () => {
    setPixelsPerSecond((prev) => Math.max(minimumTimelineZoom, prev / 1.3));
  };

  const handleZoomFit = () => {
    setPixelsPerSecond(minimumTimelineZoom);
  };

  // 10. Clear Session & Workspace Reset Handlers
  const handleExecuteResetSession = useCallback(async () => {
    projectFileHandleRef.current = null;
    if (isPlaying) {
      audioEngine.pause();
      setIsPlaying(false);
    }
    audioEngine.seek(0);
    playheadSecondsRef.current = 0;
    setPlayheadSeconds(0);
    await clearCurrentProjectData().catch(() => {});
    pluginManager.clearAll();
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
    savedProjectRef.current = freshProject;
    setProject(freshProject);
    historyManagerRef.current.reset(freshProject);
    updateHistoryFlags();
    setSelectedTrackId(null);
    setSelectedClipIds(new Set());
    setIsResetSessionModalOpen(false);
  }, [isPlaying, updateHistoryFlags]);

  const handleClearSession = useCallback(() => {
    // If tracks or clips exist, prompt the user with modal to save their work before resetting
    if (project !== savedProjectRef.current) {
      setIsResetSessionModalOpen(true);
    } else {
      handleExecuteResetSession();
      addToast({
        type: 'info',
        title: 'Session Reset',
        message: 'Empty project session is ready.',
      });
    }
  }, [project, handleExecuteResetSession, addToast]);

  const handleSaveAndResetSession = useCallback(async () => {
    const saved = await handleSaveProjectToFile();
    if (!saved) return;
    await handleExecuteResetSession();
    addToast({
      type: 'success',
      title: 'Project Saved & Session Reset',
      message: 'Active project saved and fresh timeline initialized.',
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
        if (rangeSelection) {
          e.preventDefault();
          handleDeleteRange();
        } else if (selectedClipIds.size > 0) {
          e.preventDefault();
          handleDeleteSelected();
        }
      }

      // Escape: clear the highlighted range
      if (e.key === 'Escape' && rangeSelection) {
        setRangeSelection(null);
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
    rangeSelection,
  ]);

  // Mouse wheel zoom (Ctrl + Wheel)
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          setPixelsPerSecond((prev) => Math.min(1000, prev * 1.15));
        } else {
          setPixelsPerSecond((prev) => Math.max(0.1, prev / 1.15));
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
        onSuccessSignIn={() => {
          // Admin verification codes are delivered out-of-band; never expose them in the browser UI.
          setCurrentView('studio');
        }}
      />
    );
  }

  if (currentView === 'dashboard') {
    return (
      <UserDashboard
        onBackToStudio={() => setCurrentView('studio')}
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
        initialConnectionCode={adminCodePreview}
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
        onSaveProjectToFile={() => { void handleSaveProjectToFile(false); }}
        onNewFromTemplate={() => setIsTemplatesModalOpen(true)}
        onSaveAsTemplate={() => setIsSaveTemplateModalOpen(true)}
        onSaveProjectAs={() => { void handleSaveProjectToFile(true); }}
        onChooseProjectRoot={() => void handleChooseProjectRoot()}
        onOpenProjectFromRoot={() => void handleOpenProjectFromRoot()}
        projectRootDirectoryName={projectRootDirectoryName}
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
        onToggleAutoRefresh={() =>
          setProjectWithHistory((p) => ({
            ...p,
            settings: { ...p.settings, autoRefresh: !p.settings.autoRefresh },
          }))
        }
        onToggleDucking={handleToggleDucking}
        onUpdateDuckingDb={handleUpdateDuckingDb}
        onManualRefresh={() => {
          // Force the view to render without replacing project identity, recording history,
          // or incorrectly marking the project dirty for portable-save purposes.
          setTimelineRefreshVersion((version) => version + 1);
          addToast({ type: 'info', title: 'Timeline Refreshed', message: 'Manual redraw completed.' });
        }}
        onClearSession={handleClearSession}
        activeSidebarTab={sidebarTab}
        onSelectSidebarTab={setSidebarTab}
        onOpenExport={openExport}
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
        projectName={project.name}
        onRenameProject={(name) => setProjectWithHistory((p) => ({ ...p, name }))}
        tool={timelineTool}
        onToolChange={(tool) => {
          setTimelineTool(tool);
          if (tool === 'select') setRangeSelection(null);
        }}
        rangeSeconds={rangeSelection ? rangeSelection.endSeconds - rangeSelection.startSeconds : null}
        onDeleteRange={handleDeleteRange}
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
          onUpdateTrack={handleUpdateTrack}
          onRemoveEmptyTracks={handleRemoveEmptyTracks}
          selectedClipIds={selectedClipIds}
          onAddVoiceTrack={handleAddVoiceTrack}
          onAddLibraryTrack={handleAddLibraryTrack}
        />

        {/* Center Workspace: Either Multi-Track Waveform Timeline OR Dedicated Editing & Mixing Desk */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-[#0A0A0C]">
      {trackImportProgress && !isTrackImportIndicatorDismissed && (
        <div
          role="status"
          aria-live="polite"
          aria-label={`Uploading ${trackImportProgress.fileName}`}
          className="pointer-events-none absolute bottom-8 left-1/2 z-30 w-80 max-w-[calc(100%-2rem)] -translate-x-1/2"
        >
          <div className="relative rounded-xl border border-white/[0.08] bg-[#111116]/95 px-5 pb-4 pt-5 shadow-[0_12px_48px_rgba(0,0,0,0.42)] backdrop-blur-xl">
            <button
              type="button"
              aria-label="Dismiss upload indicator"
              title="Hide indicator; upload continues"
              onClick={() => {
                isTrackImportIndicatorDismissedRef.current = true;
                setIsTrackImportIndicatorDismissed(true);
                if (trackImportProgressTimerRef.current) {
                  clearInterval(trackImportProgressTimerRef.current);
                  trackImportProgressTimerRef.current = null;
                }
              }}
              className="pointer-events-auto absolute right-2 top-2 rounded p-1 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
            <div className="mb-2 truncate pr-5 text-xs font-medium text-zinc-200" title={trackImportProgress.fileName}>
              {trackImportProgress.fileName}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800 ring-1 ring-white/[0.06]">
              <div
                className="track-import-progress-fill h-full rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.38)]"
                style={{ width: `${Math.max(0, Math.min(100, trackImportProgress.progress))}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-[11px] font-medium tracking-[0.08em] text-zinc-300">
                Uploading...
              </div>
              <button
                type="button"
                onClick={() => {
                  importCancelledRef.current = true;
                  streamImportCancelRef.current?.();
                  if (trackImportProgressTimerRef.current) {
                    clearInterval(trackImportProgressTimerRef.current);
                    trackImportProgressTimerRef.current = null;
                  }
                  setTrackImportProgress(null);
                }}
                className="pointer-events-auto inline-flex shrink-0 items-center gap-1 rounded-md border border-red-400/20 px-2 py-1 text-[10px] font-semibold text-red-300 transition-colors hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-200"
              >
                <XCircle className="h-3 w-3" />
                Cancel upload
              </button>
            </div>
          </div>
        </div>
      )}
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
                  <MasterConsolePanel
                    project={project}
                    isSidebarMode={false}
                    tab={masterTab}
                    onTabChange={setMasterTab}
                    mastering={mastering}
                    mixKey={mixKey}
                    isPlaying={isPlaying}
                    onMasteringChange={handleMasteringChange}
                    onMeasureMastering={handleMeasureMasteringNow}
                    onTogglePlay={() => (isPlaying ? handlePause() : handlePlay())}
                    onOpenExport={openExport}
                    onMasterFaderChange={() => setMasterFaderRev((r) => r + 1)}
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
              onViewportWidthChange={setTimelineViewportWidth}
              selectedTrackId={selectedTrackId}
              selectedClipIds={selectedClipIds}
              isControlsCollapsed={isTimelineControlsCollapsed}
              onToggleCollapseControls={handleToggleTimelineControls}
              onSelectTrack={(id) => setSelectedTrackId(id)}
              onSelectClips={(clipIds) => setSelectedClipIds(clipIds)}
              onUpdateTrack={handleUpdateTrack}
              onDeleteTrack={handleDeleteTrack}
              onMoveTrack={handleMoveTrack}
              tool={timelineTool}
              rangeSelection={rangeSelection}
              onRangeSelect={setRangeSelection}
              onRecordTrack={(trackId) => {
                setRecordTargetTrackId(trackId);
                setIsRecordModalOpen(true);
              }}
              onUpdateProject={(p) => setProjectWithHistory(p)}
              onTracksAutoRemoved={handleTracksAutoRemoved}
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
              <MasterConsolePanel
                project={project}
                isSidebarMode={true}
                tab={masterTab}
                onTabChange={setMasterTab}
                mastering={mastering}
                mixKey={mixKey}
                isPlaying={isPlaying}
                onMasteringChange={handleMasteringChange}
                onMeasureMastering={handleMeasureMasteringNow}
                onTogglePlay={() => (isPlaying ? handlePause() : handlePlay())}
                onOpenExport={openExport}
                onMasterFaderChange={() => setMasterFaderRev((r) => r + 1)}
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
            title="Open master console and mastering"
            className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-[#16161c] hover:bg-zinc-800 text-zinc-400 hover:text-emerald-300 border-l border-y border-zinc-700/80 rounded-l-md px-1 py-3 text-[10px] font-bold tracking-widest uppercase transition-all shadow-md flex flex-col items-center gap-1 cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-emerald-400" />
            <span className="[writing-mode:vertical-lr] text-[9px] text-zinc-400 hover:text-emerald-300">
              MASTER
            </span>
          </button>
        )}
      </div>

      {isExportOpen && (
        <ExportPanel project={project} mastering={mastering} mixKey={mixKey} onEditMastering={openMastering} onClose={() => setIsExportOpen(false)} />
      )}

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

      <TemplatesModal isOpen={isTemplatesModalOpen} onClose={() => setIsTemplatesModalOpen(false)} hasWork={project.tracks.length > 0} projectName={project.name} signedIn={!!user} refreshKey={templateListVersion} onUseTemplate={handleUseTemplate} />
      <SaveTemplateModal
        isOpen={isSaveTemplateModalOpen}
        onClose={() => setIsSaveTemplateModalOpen(false)}
        defaultName={project.name}
        trackCount={project.tracks.length}
        pluginCount={project.tracks.reduce((n, t) => n + (pluginManager.getPluginsForTrack(t.id).length || t.plugins?.length || 0), 0) + pluginManager.getPluginsForTrack('__master__').length}
        signedIn={!!user}
        onSave={handleSaveAsTemplate}
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
        onClose={() => {
          setIsRecordModalOpen(false);
          setRecordTargetTrackId(null);
        }}
        onFinishRecording={handleFinishRecording}
        duckPlayingTracks={project.settings.duckPlayingTracks}
        duckingAmountDb={project.settings.duckingAmountDb}
        targetTrackName={(() => {
          const i = project.tracks.findIndex((t) => t.id === recordTargetTrackId);
          return i >= 0 ? getTrackLabel(project.tracks[i], i) : null;
        })()}
        onRecordingStart={() => {
          recordStartSecondsRef.current = playheadSecondsRef.current;
        }}
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
        project={project}
        selectedTrackId={selectedTrackId}
        onSelectTrack={(id) => setSelectedTrackId(id)}
        onUpdateTrack={handleUpdateTrack}
      />

      {/* Expanded Multi-Pane Broadcast Voiceover Studio Workspace Modal */}
      <VoiceoverModal
        isOpen={isVoiceoverModalOpen}
        onClose={() => setIsVoiceoverModalOpen(false)}
        onAddVoiceTrack={handleAddVoiceTrack}
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
