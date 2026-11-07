/**
 * Uuda Studio - Audio Plugins Rack
 * Effect chains for each track and for the master bus (the whole mix), built from Native plugins and verified
 * Web Audio Modules (WAM 2.0).
 *
 * Chain list: reorder, bypass, one Mix control, show/hide the inline controls (eye), pop out into a full modal.
 * Layout: library on the left and chain on the right from md up; one pane at a time below that.
 * Look: the app's dialog frame, tokens only, pill controls, rounded cards. One cyan accent.
 */

import React, { useEffect, useState } from 'react';
import {
  Sliders,
  Power,
  ChevronDown,
  ChevronUp,
  Trash2,
  Plus,
  ExternalLink,
  ShieldCheck,
  Eye,
  EyeOff,
  Maximize2,
} from 'lucide-react';
import { Track, Project } from '../types';
import { audioEngine } from '../audio/engine';
import { pluginManager, MASTER_TRACK_ID } from '../plugins/pluginManager';
import { groupChainId, groupIdsOf, groupLabel, isGroupChainId, groupIdOfChain } from '../plugins/groupChain';
import { PluginDescriptor, PluginInstance } from '../plugins/types';
import {
  NATIVE_STEM_PLUGINS,
  VERIFIED_THIRD_PARTY_PLUGINS,
  isModuleOriginWhitelisted,
} from '../plugins/registry';
import { getTrackLabel } from '../utils/tracks';
import { Button, ModalShell, SegmentedControl, cn } from './ui';
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
  /** Opens the rack on this clip group's chain (from Quick Actions), instead of the selected track. */
  initialGroupId?: string | null;
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
  initialGroupId = null,
}) => {
  // 'Master bus' is a local target, so the app's selected track is left alone
  const [masterTarget, setMasterTarget] = useState<boolean>(false);
  // A clip group is a third kind of target: its chain processes the whole group as one unit
  const [groupTarget, setGroupTarget] = useState<string | null>(null);
  useEffect(() => {
    if (isOpen && initialGroupId) {
      setGroupTarget(initialGroupId);
      setMasterTarget(false);
    }
  }, [isOpen, initialGroupId]);
  const groupIds = groupIdsOf(project);
  const groupTargetValid = groupTarget !== null && groupIds.includes(groupTarget);
  const activeTrackId = masterTarget ? MASTER_TRACK_ID : groupTargetValid ? groupChainId(groupTarget as string) : selectedTrackId || (tracks.length > 0 ? tracks[0].id : null);
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
    : groupTargetValid
      ? groupLabel(project, groupTarget as string)
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
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-dim transition-colors hover:bg-white/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default disabled:opacity-25 disabled:hover:bg-transparent';
  const field =
    'h-9 w-full rounded-full border border-line-strong bg-surface-3 px-3.5 text-xs text-ink placeholder:text-ink-faint transition-colors hover:border-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50';
  const chip = (on: boolean) =>
    cn(
      'h-6 shrink-0 rounded-full border px-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
      on ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-ink-dim hover:border-line-strong hover:text-ink',
    );
  const childOpen = showCustomConfirm || !!popoutPlugin;

  /** Library card. A plugin already in this chain gets a cyan glow, an "In chain" badge and an "Add again" button, so a second copy is always deliberate. */
  const libraryCard = (plugin: PluginDescriptor, note: React.ReactNode) => {
    const copies = activePlugins.filter((p) => p.descriptor.id === plugin.id).length;
    const inChain = copies > 0;
    return (
      <div
        key={plugin.id}
        className={cn(
          'flex flex-col gap-1.5 rounded-card border bg-surface-2 p-3 transition-colors',
          inChain ? 'border-accent/70 shadow-[0_0_14px_-3px_var(--color-accent)]' : 'border-line hover:border-line-strong',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="block text-sm font-bold leading-tight text-ink">{plugin.name}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
              <span className="rounded-full bg-surface-3 px-2 py-0.5">{note}</span>
              {inChain && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 font-semibold text-accent">
                  {copies > 1 ? `In chain x${copies}` : 'In chain'}
                </span>
              )}
            </span>
          </div>
          <Button
            size="sm"
            variant={inChain ? 'secondary' : 'primary'}
            onClick={() => handleAddPlugin(plugin)}
            title={inChain ? 'Already in this chain. Add a second copy only if you mean to.' : 'Add to this chain'}
            leftIcon={<Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            className="h-7 shrink-0 px-3"
          >
            {inChain ? 'Add again' : 'Add'}
          </Button>
        </div>
        <p className="line-clamp-2 text-xs leading-snug text-ink-dim">{plugin.description}</p>
      </div>
    );
  };

  return (
    <>
      <ModalShell
        open={isOpen}
        onClose={onClose}
        dismissible={!childOpen}
        variant="workspace"
        title="Plugin rack"
        description="Effect chains for tracks, clip groups and the master bus"
      >
        {/* Target and preview */}
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-3">
          <label className="flex h-9 min-w-0 flex-1 basis-56 items-center gap-2 rounded-full border border-line-strong bg-surface-3 px-3.5 focus-within:ring-2 focus-within:ring-accent/50 sm:max-w-sm">
            <span className="shrink-0 text-xs text-ink-faint">Target</span>
            <select
              value={activeTrackId || ''}
              onChange={(e) => {
                if (e.target.value === MASTER_TRACK_ID) {
                  setMasterTarget(true);
                  setGroupTarget(null);
                } else if (isGroupChainId(e.target.value)) {
                  setMasterTarget(false);
                  setGroupTarget(groupIdOfChain(e.target.value));
                } else {
                  setMasterTarget(false);
                  setGroupTarget(null);
                  onSelectTrack(e.target.value);
                }
              }}
              className="min-w-0 flex-1 cursor-pointer truncate bg-transparent text-xs font-semibold text-ink focus:outline-none"
            >
              <option value={MASTER_TRACK_ID} className="bg-surface-2 text-ink">
                Master Bus (whole mix)
              </option>
              {groupIds.map((g) => (
                <option key={g} value={groupChainId(g)} className="bg-surface-2 text-ink">
                  {groupLabel(project, g)}
                </option>
              ))}
              {tracks.map((t, idx) => (
                <option key={t.id} value={t.id} className="bg-surface-2 text-ink">
                  {getTrackLabel(t, idx)}
                </option>
              ))}
            </select>
          </label>
          <PreviewButton project={project} targetId={activeTrackId} />
        </div>

        {/* Pane switch (small screens only) */}
        <div className="shrink-0 border-b border-line px-5 py-2 md:hidden">
          <SegmentedControl
            label="Pane"
            size="sm"
            value={pane}
            onChange={setPane}
            options={[
              { value: 'chain', label: `Chain (${activePlugins.length})` },
              { value: 'library', label: 'Library' },
            ]}
          />
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden md:divide-x md:divide-line">
          {/* Library */}
          <div className={`${pane === 'library' ? 'flex' : 'hidden'} w-full shrink-0 flex-col gap-3 overflow-y-auto p-5 md:flex md:w-[340px] lg:w-[380px]`}>
            <SegmentedControl
              label="Library"
              size="sm"
              value={browserCategory}
              onChange={setBrowserCategory}
              options={[
                { value: 'native', label: 'Native' },
                { value: 'third-party', label: 'WAM' },
              ]}
            />

            {browserCategory === 'native' && (
              <div className="space-y-2.5">
                <input
                  type="search"
                  aria-label="Search effects"
                  value={pluginSearch}
                  onChange={(e) => setPluginSearch(e.target.value)}
                  placeholder="Search effects"
                  className={field}
                />
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setPluginCategory(key)} aria-pressed={pluginCategory === key} className={chip(pluginCategory === key)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-ink-faint">
                  {filteredNativePlugins.length === NATIVE_STEM_PLUGINS.length
                    ? `${NATIVE_STEM_PLUGINS.length} plugins`
                    : `${filteredNativePlugins.length} of ${NATIVE_STEM_PLUGINS.length}`}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {browserCategory === 'native' ? (
                filteredNativePlugins.length === 0 ? (
                  <div className="py-4 text-center text-xs text-ink-faint">No match.</div>
                ) : (
                  filteredNativePlugins.map((plugin) => libraryCard(plugin, <span className="capitalize">{CATEGORY_LABELS[plugin.category] || plugin.category}</span>))
                )
              ) : (
                <>
                  {VERIFIED_THIRD_PARTY_PLUGINS.map((plugin) =>
                    libraryCard(plugin, <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" aria-hidden="true" />Verified</span>),
                  )}

                  <form onSubmit={handleAddCustomWam} className="space-y-2.5 rounded-card border border-dashed border-line-strong p-3">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                      <ExternalLink className="h-3.5 w-3.5 text-ink-dim" aria-hidden="true" />
                      Load external WAM
                    </span>
                    <input
                      type="url"
                      aria-label="Module URL"
                      value={customWamUrl}
                      onChange={(e) => setCustomWamUrl(e.target.value)}
                      placeholder="https://example.org/plugin/index.js"
                      className={cn(field, 'font-mono')}
                    />
                    <input
                      type="text"
                      aria-label="Name (optional)"
                      value={customWamName}
                      onChange={(e) => setCustomWamName(e.target.value)}
                      placeholder="Name (optional)"
                      className={field}
                    />
                    {customUrlError && <p role="alert" className="text-xs text-danger">{customUrlError}</p>}
                    <Button type="submit" size="sm" variant="secondary" className="w-full">
                      Import
                    </Button>
                  </form>
                </>
              )}
            </div>
          </div>

          {/* Chain */}
          <div className={`${pane === 'chain' ? 'flex' : 'hidden'} min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-5 md:flex`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                <Sliders className="h-4 w-4 shrink-0 text-ink-dim" aria-hidden="true" />
                <span className="truncate">Chain: {activeLabel}</span>
              </h3>
              <span className="font-num text-xs text-ink-faint">
                {activePlugins.length} {activePlugins.length === 1 ? 'plugin' : 'plugins'}
              </span>
            </div>

            {!masterTarget && !groupTargetValid && activeIndex >= 0 && (
              <DuckingPanel
                track={tracks[activeIndex]}
                tracks={tracks}
                onChange={(u) =>
                  onUpdateTrack(tracks[activeIndex].id, { ducking: normalizeDucking({ ...tracks[activeIndex].ducking, ...u }) })
                }
              />
            )}

            {activePlugins.length === 0 ? (
              <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-3 rounded-card border border-dashed border-line-strong p-6 text-center">
                <Sliders className="h-7 w-7 text-ink-faint" aria-hidden="true" />
                <div>
                  <h4 className="text-sm font-semibold text-ink">Chain is empty</h4>
                  <p className="mt-1 text-xs text-ink-faint">Add a plugin from the library.</p>
                </div>
                <Button variant="primary" size="sm" className="md:hidden" onClick={() => setPane('library')}>
                  Open library
                </Button>
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
                      className={cn('overflow-hidden rounded-card border', plugin.isBypassed ? 'border-line bg-surface-1 opacity-70' : 'border-accent/70 bg-surface-2 shadow-[0_0_14px_-3px_var(--color-accent)]')}
                    >
                      {/* Row */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-2.5">
                        <div className="flex min-w-0 flex-1 basis-44 items-center gap-2">
                          <div className="flex shrink-0 flex-col">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => handleMoveUp(index)}
                              title="Move up"
                              aria-label="Move up"
                              className="rounded-full text-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-20"
                            >
                              <ChevronUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === activePlugins.length - 1}
                              onClick={() => handleMoveDown(index)}
                              title="Move down"
                              aria-label="Move down"
                              className="rounded-full text-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-20"
                            >
                              <ChevronDown className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <span className="font-num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[10px] font-semibold text-ink-dim">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-xs font-semibold text-ink">{descriptor.name}</span>
                              {isMissing ? (
                                <span className="shrink-0 rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">Missing</span>
                              ) : (
                                <span
                                  className={cn(
                                    'hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline',
                                    isNative ? 'bg-surface-3 text-ink-dim' : 'bg-accent-soft text-accent',
                                  )}
                                >
                                  {isNative ? 'Native' : 'WAM'}
                                </span>
                              )}
                            </div>
                            <span className={cn('block truncate text-[11px]', isMissing ? 'text-warn' : 'text-ink-faint')}>
                              {isMissing ? `${plugin.missingReason || 'Not available'} Audio passes through; settings are kept.` : descriptor.vendor}
                            </span>
                          </div>
                        </div>

                        <div className="ml-auto flex items-center gap-1.5">
                          {hasMix && (
                            <label className="mr-1 flex items-center gap-2 rounded-full border border-line bg-surface-3 px-3 py-1">
                              <span className="text-[11px] text-ink-dim">Mix</span>
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
                                className="w-16 cursor-pointer sm:w-20"
                              />
                              <span className="font-num w-8 text-right text-[11px] text-ink">{Math.round(plugin.dryWet * 100)}%</span>
                            </label>
                          )}

                          {!isMissing && (
                            <button
                              type="button"
                              onClick={() => handleToggleBypass(plugin)}
                              title={plugin.isBypassed ? 'Bypassed. Click to engage' : 'Active. Click to bypass'}
                              aria-pressed={!plugin.isBypassed}
                              className={cn(
                                'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                                plugin.isBypassed
                                  ? 'border-line-strong bg-surface-3 text-ink-dim hover:text-ink'
                                  : 'border-accent/40 bg-accent-soft text-accent',
                              )}
                            >
                              <Power className="h-3.5 w-3.5" aria-hidden="true" />
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
                              className={cn(iconBtn, panelOpen && 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent')}
                            >
                              {panelOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          )}

                          {!ownsGui && !isMissing && (
                            <button type="button" onClick={() => setPopoutId(plugin.instanceId)} title="Open in a window" aria-label="Open in a window" className={iconBtn}>
                              <Maximize2 className="h-4 w-4" />
                            </button>
                          )}

                          <button type="button" onClick={() => handleRemovePlugin(plugin.instanceId)} title="Remove" aria-label="Remove" className={cn(iconBtn, 'hover:text-danger')}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Inline controls (eye) */}
                      {panelOpen && (
                        <div className="border-t border-line bg-surface-1 p-3">
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
      </ModalShell>

      {/* Third-party authorisation: a separate dialog above the rack */}
      <ModalShell
        open={showCustomConfirm && !!pendingCustomDescriptor}
        onClose={() => {
          setShowCustomConfirm(false);
          setPendingCustomDescriptor(null);
        }}
        title="Load external module?"
        description="It runs in a sandboxed audio worklet. Only load modules from authors you trust."
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowCustomConfirm(false);
                setPendingCustomDescriptor(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirmAddCustom}>
              Load
            </Button>
          </>
        }
      >
        <code className="block break-all rounded-control border border-line bg-surface-0 p-3 font-mono text-[11px] text-ink-dim">
          {pendingCustomDescriptor?.moduleUrl}
        </code>
      </ModalShell>

      {popoutPlugin && activeTrackId && (
        <PluginPopout
          instance={popoutPlugin}
          trackId={activeTrackId}
          trackLabel={activeLabel}
          project={project}
          onClose={() => setPopoutId(null)}
        />
      )}
    </>
  );
};
