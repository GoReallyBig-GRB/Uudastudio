/**
 * Uuda Studio - Audio Plugins Rack
 * Effect chains for each track and for the master bus (the whole mix), built from Native plugins and verified
 * Web Audio Modules (WAM 2.0).
 *
 * Chain list: reorder, bypass, one Mix control, show/hide the inline controls (eye), pop out into a full modal.
 * Layout: library on the left and chain on the right from md up; one pane at a time below that.
 * Look: solid surfaces, 1px borders, small radii. No blur and no glow.
 */

import React, { useEffect, useState } from 'react';
import {
  X,
  Sliders,
  Sparkles,
  Layers,
  Power,
  ChevronDown,
  ChevronUp,
  Trash2,
  Plus,
  ExternalLink,
  ShieldCheck,
  Globe,
  Cpu,
  Eye,
  EyeOff,
  AlertTriangle,
  Maximize2,
} from 'lucide-react';
import { Track, Project } from '../types';
import { audioEngine } from '../audio/engine';
import { pluginManager, MASTER_TRACK_ID } from '../plugins/pluginManager';
import { PluginDescriptor, PluginInstance } from '../plugins/types';
import {
  NATIVE_STEM_PLUGINS,
  VERIFIED_THIRD_PARTY_PLUGINS,
  isModuleOriginWhitelisted,
} from '../plugins/registry';
import { getTrackLabel } from '../utils/tracks';
import { PluginPanel } from './plugins/PluginPanel';
import { PluginPopout } from './plugins/PluginPopout';
import { PreviewButton } from './plugins/PreviewButton';
import { DuckingPanel } from './plugins/DuckingPanel';
import { normalizeDucking } from '../audio/ducking';

interface PluginsRackModalProps {
  isOpen: boolean;
  onClose: () => void;
  tracks: Track[];
  /** Whole project, so Preview can play the target on its own */
  project: Project;
  selectedTrackId: string | null;
  onSelectTrack: (trackId: string) => void;
  onUpdateTrack: (trackId: string, updates: Partial<Track>) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  all: 'All',
  dynamics: 'Dynamics',
  eq: 'EQ',
  spatial: 'Spatial',
  modulation: 'Modulation',
  restoration: 'Restoration',
  'pitch-time': 'Pitch',
  utility: 'Utility',
};

export const PluginsRackModal: React.FC<PluginsRackModalProps> = ({
  isOpen,
  onClose,
  tracks,
  project,
  selectedTrackId,
  onSelectTrack,
  onUpdateTrack,
}) => {
  // 'Master bus' is a local target, so the app's selected track is left alone
  const [masterTarget, setMasterTarget] = useState<boolean>(false);
  const activeTrackId = masterTarget ? MASTER_TRACK_ID : selectedTrackId || (tracks.length > 0 ? tracks[0].id : null);
  // A preview belongs to one target: switching target or closing the rack ends it
  useEffect(() => {
    const playing = audioEngine.getPreviewTarget();
    if (playing && playing !== activeTrackId) audioEngine.stopPreview();
  }, [activeTrackId]);
  useEffect(() => {
    if (!isOpen) audioEngine.stopPreview();
    return () => audioEngine.stopPreview();
  }, [isOpen]);
  const activeIndex = tracks.findIndex((t) => t.id === activeTrackId);
  const activeLabel = masterTarget
    ? 'Master Bus'
    : activeIndex >= 0
      ? getTrackLabel(tracks[activeIndex], activeIndex)
      : 'No track';

  const [activePlugins, setActivePlugins] = useState<PluginInstance[]>([]);
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});
  const [popoutId, setPopoutId] = useState<string | null>(null);

  // Small screens show one pane at a time
  const [pane, setPane] = useState<'library' | 'chain'>('chain');

  const [browserCategory, setBrowserCategory] = useState<'native' | 'third-party'>('native');
  const [pluginSearch, setPluginSearch] = useState<string>('');
  const [pluginCategory, setPluginCategory] = useState<string>('all');
  const filteredNativePlugins = NATIVE_STEM_PLUGINS.filter((p) => {
    if (pluginCategory !== 'all' && p.category !== pluginCategory) return false;
    const q = pluginSearch.trim().toLowerCase();
    return !q || `${p.name} ${p.description || ''} ${p.category}`.toLowerCase().includes(q);
  });

  // Custom WAM URL input state
  const [customWamUrl, setCustomWamUrl] = useState<string>('');
  const [customWamName, setCustomWamName] = useState<string>('');
  const [customUrlError, setCustomUrlError] = useState<string | null>(null);
  const [showCustomConfirm, setShowCustomConfirm] = useState<boolean>(false);
  const [pendingCustomDescriptor, setPendingCustomDescriptor] = useState<PluginDescriptor | null>(null);

  // Follow the chain on the active target
  useEffect(() => {
    const update = () => {
      setActivePlugins(activeTrackId ? [...pluginManager.getPluginsForTrack(activeTrackId)] : []);
    };
    update();
    return pluginManager.subscribe(update);
  }, [activeTrackId]);

  // Close the pop-out when the target changes or its plugin is removed
  useEffect(() => {
    if (popoutId && !activePlugins.some((p) => p.instanceId === popoutId)) setPopoutId(null);
  }, [activePlugins, popoutId]);

  if (!isOpen) return null;

  const showChain = () => setPane('chain');

  const handleAddPlugin = async (descriptor: PluginDescriptor) => {
    if (!activeTrackId) return;

    // Third-party modules from outside the verified list need an explicit OK
    if (descriptor.type === 'third-party-wam' && descriptor.moduleUrl) {
      if (!isModuleOriginWhitelisted(descriptor.moduleUrl)) {
        setPendingCustomDescriptor(descriptor);
        setShowCustomConfirm(true);
        return;
      }
    }

    try {
      const ctx = await audioEngine.init();
      const instance = await pluginManager.addPluginToTrack(ctx, activeTrackId, descriptor);
      setOpenPanels((prev) => ({ ...prev, [instance.instanceId]: true }));
      showChain();
    } catch (err) {
      console.error('Failed to add plugin:', err);
    }
  };

  const handleAddCustomWam = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomUrlError(null);

    const url = customWamUrl.trim();
    if (!url || (!url.startsWith('https://') && !url.startsWith('http://localhost'))) {
      setCustomUrlError('Use a secure HTTPS module URL, or localhost for testing.');
      return;
    }

    const name = customWamName.trim() || `Custom WAM (${url.split('/').pop()?.replace('.js', '') || 'Module'})`;
    const descriptor: PluginDescriptor = {
      id: `custom-wam-${Date.now()}`,
      name,
      vendor: 'Third-Party Developer',
      version: '1.0.0',
      type: 'third-party-wam',
      category: 'utility',
      description: `Loaded from external URL: ${url}`,
      moduleUrl: url,
      hasCustomGui: false,
      parameters: {
        dryWet: { min: 0, max: 1.0, defaultValue: 1.0, step: 0.01, unit: '%', label: 'Mix' },
      },
    };

    setPendingCustomDescriptor(descriptor);
    setShowCustomConfirm(true);
  };

  const handleConfirmAddCustom = async () => {
    if (!pendingCustomDescriptor || !activeTrackId) return;
    try {
      const ctx = await audioEngine.init();
      const instance = await pluginManager.addPluginToTrack(ctx, activeTrackId, pendingCustomDescriptor);
      setOpenPanels((prev) => ({ ...prev, [instance.instanceId]: true }));
      setCustomWamUrl('');
      setCustomWamName('');
      setShowCustomConfirm(false);
      setPendingCustomDescriptor(null);
      showChain();
    } catch (err) {
      setCustomUrlError(err instanceof Error ? err.message : String(err));
      setShowCustomConfirm(false);
    }
  };

  const handleToggleBypass = (instance: PluginInstance) => {
    if (!activeTrackId) return;
    pluginManager.setPluginBypass(activeTrackId, instance.instanceId, !instance.isBypassed);
  };

  const handleRemovePlugin = (instanceId: string) => {
    if (!activeTrackId) return;
    pluginManager.removePluginFromTrack(activeTrackId, instanceId);
    setOpenPanels((prev) => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
  };

  const handleMoveUp = (index: number) => {
    if (!activeTrackId || index <= 0) return;
    pluginManager.reorderTrackPlugins(activeTrackId, index, index - 1);
  };

  const handleMoveDown = (index: number) => {
    if (!activeTrackId || index >= activePlugins.length - 1) return;
    pluginManager.reorderTrackPlugins(activeTrackId, index, index + 1);
  };

  const popoutPlugin = popoutId ? activePlugins.find((p) => p.instanceId === popoutId) : undefined;

  const iconBtn =
    'p-1.5 rounded-sm text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-25 disabled:cursor-default';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 select-none">
      <div className="w-full max-w-6xl h-[calc(100dvh-1rem)] sm:h-[90vh] bg-[#0F0F16] border border-zinc-700 rounded-lg flex flex-col overflow-hidden text-zinc-100">
        {/* Header */}
        <div className="px-3 sm:px-5 py-2.5 border-b border-zinc-800 flex flex-wrap items-center gap-x-4 gap-y-2 bg-[#13131D] shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1 basis-56">
            <div className="w-8 h-8 rounded-sm bg-purple-500/15 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-black uppercase tracking-wide text-white truncate">Plugin Rack</h1>
              <p className="hidden sm:block text-[11px] text-zinc-500 truncate">Effect chains for tracks and the master bus</p>
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0 flex-1 basis-56 justify-end">
            <label className="flex items-center gap-2 min-w-0 flex-1 max-w-xs bg-[#09090D] border border-zinc-700 rounded-sm px-2.5 py-1.5">
              <span className="text-[11px] text-zinc-400 shrink-0">Target</span>
              <select
                value={activeTrackId || ''}
                onChange={(e) => {
                  if (e.target.value === MASTER_TRACK_ID) {
                    setMasterTarget(true);
                  } else {
                    setMasterTarget(false);
                    onSelectTrack(e.target.value);
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-xs font-bold text-cyan-300 focus:outline-none cursor-pointer truncate"
              >
                <option value={MASTER_TRACK_ID} className="bg-[#121218] text-zinc-200">
                  Master Bus (whole mix)
                </option>
                {tracks.map((t, idx) => (
                  <option key={t.id} value={t.id} className="bg-[#121218] text-zinc-200">
                    {getTrackLabel(t, idx)}
                  </option>
                ))}
              </select>
            </label>
            <PreviewButton project={project} targetId={activeTrackId} />
            <button type="button" onClick={onClose} title="Close" aria-label="Close" className={iconBtn}>
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Pane switch (small screens only) */}
        <div className="md:hidden grid grid-cols-2 p-1 gap-1 bg-[#0D0D14] border-b border-zinc-800 shrink-0">
          {(['chain', 'library'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPane(p)}
              className={`py-1.5 rounded-sm text-xs font-bold cursor-pointer ${
                pane === p ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {p === 'chain' ? `Chain (${activePlugins.length})` : 'Library'}
            </button>
          ))}
        </div>

        {/* Third-party authorisation */}
        {showCustomConfirm && pendingCustomDescriptor && (
          <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#161622] border border-amber-500/60 rounded-lg p-5 space-y-3">
              <div className="flex items-center gap-2.5 text-amber-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="text-sm font-bold uppercase tracking-wide">Load external module?</h3>
              </div>
              <code className="block p-2 bg-black/60 rounded-sm text-[11px] font-mono text-cyan-300 break-all border border-zinc-800">
                {pendingCustomDescriptor.moduleUrl}
              </code>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                It runs in a sandboxed audio worklet. Only load modules from authors you trust.
              </p>
              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomConfirm(false);
                    setPendingCustomDescriptor(null);
                  }}
                  className="px-3 py-1.5 rounded-sm text-xs text-zinc-400 hover:bg-zinc-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAddCustom}
                  className="px-4 py-1.5 rounded-sm bg-amber-500 text-black font-bold text-xs hover:bg-amber-400 cursor-pointer"
                >
                  Load
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 flex min-h-0 overflow-hidden md:divide-x divide-zinc-800">
          {/* Library */}
          <div
            className={`${pane === 'library' ? 'flex' : 'hidden'} md:flex w-full md:w-[340px] lg:w-[380px] flex-col bg-[#0D0D14] shrink-0 p-3 sm:p-4 overflow-y-auto gap-3`}
          >
            <span className="text-xs font-bold uppercase tracking-wide text-zinc-300 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-purple-400" />
              Library
            </span>

            <div className="grid grid-cols-2 p-1 gap-1 bg-[#14141E] border border-zinc-800 rounded-md">
              <button
                type="button"
                onClick={() => setBrowserCategory('native')}
                className={`py-1.5 rounded-sm text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                  browserCategory === 'native' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                Native
              </button>
              <button
                type="button"
                onClick={() => setBrowserCategory('third-party')}
                className={`py-1.5 rounded-sm text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                  browserCategory === 'third-party' ? 'bg-cyan-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                WAM
              </button>
            </div>

            {browserCategory === 'native' && (
              <div className="space-y-2">
                <input
                  type="search"
                  value={pluginSearch}
                  onChange={(e) => setPluginSearch(e.target.value)}
                  placeholder="Search effects"
                  className="w-full px-3 py-1.5 bg-[#14141E] border border-zinc-800 rounded-sm text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-purple-500"
                />
                <div className="flex flex-wrap gap-1">
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPluginCategory(key)}
                      className={`px-2 py-0.5 rounded-sm text-[10px] font-semibold border cursor-pointer ${
                        pluginCategory === key
                          ? 'bg-purple-600 border-purple-500 text-white'
                          : 'bg-[#14141E] border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-zinc-500">
                  {filteredNativePlugins.length === NATIVE_STEM_PLUGINS.length
                    ? `${NATIVE_STEM_PLUGINS.length} plugins`
                    : `${filteredNativePlugins.length} of ${NATIVE_STEM_PLUGINS.length}`}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {browserCategory === 'native' ? (
                filteredNativePlugins.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 py-4 text-center">No match.</div>
                ) : (
                  filteredNativePlugins.map((plugin) => (
                    <div
                      key={plugin.id}
                      className="p-3 bg-[#14141E] border border-zinc-800 hover:border-purple-500/60 rounded-md flex flex-col gap-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-zinc-100 block truncate">{plugin.name}</span>
                          <span className="text-[10px] text-zinc-500 capitalize">
                            {CATEGORY_LABELS[plugin.category] || plugin.category}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddPlugin(plugin)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-sm bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold cursor-pointer shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </button>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-snug line-clamp-2">{plugin.description}</p>
                    </div>
                  ))
                )
              ) : (
                <>
                  {VERIFIED_THIRD_PARTY_PLUGINS.map((plugin) => (
                    <div
                      key={plugin.id}
                      className="p-3 bg-[#14141E] border border-zinc-800 hover:border-cyan-500/60 rounded-md flex flex-col gap-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="text-xs font-bold text-zinc-100 block truncate">{plugin.name}</span>
                          <span className="text-[10px] text-cyan-400 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            Verified
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddPlugin(plugin)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-sm bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold cursor-pointer shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add
                        </button>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-snug line-clamp-2">{plugin.description}</p>
                    </div>
                  ))}

                  <form
                    onSubmit={handleAddCustomWam}
                    className="p-3 bg-[#111119] border border-dashed border-zinc-700 rounded-md space-y-2"
                  >
                    <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                      <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                      Load external WAM
                    </span>
                    <input
                      type="url"
                      value={customWamUrl}
                      onChange={(e) => setCustomWamUrl(e.target.value)}
                      placeholder="https://example.org/plugin/index.js"
                      className="w-full bg-[#09090D] border border-zinc-800 rounded-sm px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                    <input
                      type="text"
                      value={customWamName}
                      onChange={(e) => setCustomWamName(e.target.value)}
                      placeholder="Name (optional)"
                      className="w-full bg-[#09090D] border border-zinc-800 rounded-sm px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500"
                    />
                    {customUrlError && <p className="text-[10px] text-rose-400">{customUrlError}</p>}
                    <button
                      type="submit"
                      className="w-full py-1.5 rounded-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs cursor-pointer"
                    >
                      Import
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>

          {/* Chain */}
          <div
            className={`${pane === 'chain' ? 'flex' : 'hidden'} md:flex flex-1 min-w-0 flex-col bg-[#111118] p-3 sm:p-5 overflow-y-auto gap-3`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h2 className="text-xs font-black uppercase tracking-wide text-zinc-200 flex items-center gap-2 min-w-0">
                <Sliders className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="truncate">Chain: {activeLabel}</span>
              </h2>
              <span className="text-[11px] text-zinc-500 font-mono">
                {activePlugins.length} {activePlugins.length === 1 ? 'plugin' : 'plugins'}
              </span>
            </div>

            {!masterTarget && activeIndex >= 0 && (
              <DuckingPanel
                track={tracks[activeIndex]}
                tracks={tracks}
                onChange={(u) =>
                  onUpdateTrack(tracks[activeIndex].id, { ducking: normalizeDucking({ ...tracks[activeIndex].ducking, ...u }) })
                }
              />
            )}

            {activePlugins.length === 0 ? (
              <div className="flex-1 min-h-[220px] border border-dashed border-zinc-700 rounded-lg flex flex-col items-center justify-center p-6 text-center gap-3">
                <Sliders className="w-7 h-7 text-zinc-600" />
                <div>
                  <h3 className="text-sm font-bold text-zinc-300">Chain is empty</h3>
                  <p className="text-xs text-zinc-500 mt-1">Add a plugin from the library.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPane('library')}
                  className="md:hidden px-3 py-1.5 rounded-sm bg-purple-600 text-white text-xs font-bold cursor-pointer"
                >
                  Open library
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {activePlugins.map((plugin, index) => {
                  const descriptor = plugin.descriptor;
                  const isNative = descriptor.type === 'native';
                  const hasMix = 'dryWet' in descriptor.parameters;
                  const ownsGui = descriptor.type === 'third-party-wam' && descriptor.hasCustomGui && !!plugin.renderGUI;
                  const panelOpen = !!openPanels[plugin.instanceId];
                  const isMissing = !!plugin.missing;

                  return (
                    <div
                      key={plugin.instanceId}
                      className={`rounded-md border overflow-hidden ${
                        plugin.isBypassed ? 'bg-[#14141c] border-zinc-800 opacity-70' : 'bg-[#151522] border-zinc-700'
                      }`}
                    >
                      {/* Row */}
                      <div className="p-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 bg-[#181826]">
                        <div className="flex items-center gap-2 min-w-0 flex-1 basis-44">
                          <div className="flex flex-col shrink-0">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => handleMoveUp(index)}
                              title="Move up"
                              aria-label="Move up"
                              className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 cursor-pointer"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === activePlugins.length - 1}
                              onClick={() => handleMoveDown(index)}
                              title="Move down"
                              aria-label="Move down"
                              className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 cursor-pointer"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <span className="w-5 h-5 rounded-sm bg-zinc-800 flex items-center justify-center font-mono text-[10px] font-bold text-zinc-300 shrink-0">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-bold text-zinc-100 truncate">{descriptor.name}</span>
                              {isMissing ? (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-sm font-mono font-bold shrink-0 bg-amber-500/20 text-amber-300">
                                  Missing
                                </span>
                              ) : (
                                <span
                                  className={`hidden sm:inline text-[9px] px-1.5 py-0.5 rounded-sm font-mono font-bold shrink-0 ${
                                    isNative ? 'bg-purple-500/15 text-purple-300' : 'bg-cyan-500/15 text-cyan-300'
                                  }`}
                                >
                                  {isNative ? 'Native' : 'WAM'}
                                </span>
                              )}
                            </div>
                            <span className={`text-[10px] truncate block ${isMissing ? 'text-amber-400' : 'text-zinc-500'}`}>
                              {isMissing ? `${plugin.missingReason || 'Not available'} Audio passes through; settings are kept.` : descriptor.vendor}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 ml-auto">
                          {hasMix && (
                            <label className="flex items-center gap-2 bg-[#0C0C12] border border-zinc-800 rounded-sm px-2 py-1">
                              <span className="text-[10px] text-zinc-400 font-semibold uppercase">Mix</span>
                              <input
                                type="range"
                                aria-label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                value={plugin.dryWet}
                                onChange={(e) => {
                                  if (activeTrackId) {
                                    pluginManager.setPluginDryWet(activeTrackId, plugin.instanceId, parseFloat(e.target.value));
                                  }
                                }}
                                className="w-16 sm:w-20 h-1.5 bg-zinc-700 rounded-sm accent-cyan-400 cursor-pointer"
                              />
                              <span className="text-[10px] font-mono text-cyan-300 font-bold w-8 text-right">
                                {Math.round(plugin.dryWet * 100)}%
                              </span>
                            </label>
                          )}

                          {!isMissing && (
                          <button
                            type="button"
                            onClick={() => handleToggleBypass(plugin)}
                            title={plugin.isBypassed ? 'Bypassed. Click to engage' : 'Active. Click to bypass'}
                            aria-pressed={!plugin.isBypassed}
                            className={`flex items-center gap-1.5 px-2 py-1 rounded-sm text-[11px] font-bold border cursor-pointer ${
                              plugin.isBypassed
                                ? 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white'
                                : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/50'
                            }`}
                          >
                            <Power className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{plugin.isBypassed ? 'Off' : 'On'}</span>
                          </button>
                          )}

                          {!isMissing && (
                          <button
                            type="button"
                            onClick={() => setOpenPanels((prev) => ({ ...prev, [plugin.instanceId]: !prev[plugin.instanceId] }))}
                            title={panelOpen ? 'Hide controls' : 'Show controls'}
                            aria-label={panelOpen ? 'Hide controls' : 'Show controls'}
                            aria-pressed={panelOpen}
                            className={`${iconBtn} ${panelOpen ? 'bg-purple-500/20 text-purple-200' : ''}`}
                          >
                            {panelOpen ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                          )}

                          {!ownsGui && !isMissing && (
                            <button
                              type="button"
                              onClick={() => setPopoutId(plugin.instanceId)}
                              title="Open in a window"
                              aria-label="Open in a window"
                              className={iconBtn}
                            >
                              <Maximize2 className="w-4 h-4" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleRemovePlugin(plugin.instanceId)}
                            title="Remove"
                            aria-label="Remove"
                            className={`${iconBtn} hover:text-rose-400`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Inline controls (eye) */}
                      {panelOpen && (
                        <div className="p-3 bg-[#111119] border-t border-zinc-800">
                          <PluginPanel instance={plugin} trackId={activeTrackId || ''} showPresets showMix={false} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {popoutPlugin && activeTrackId && (
        <PluginPopout
          instance={popoutPlugin}
          trackId={activeTrackId}
          trackLabel={activeLabel}
          project={project}
          onClose={() => setPopoutId(null)}
        />
      )}
    </div>
  );
};
