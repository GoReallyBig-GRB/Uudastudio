/**
 * Uuda Studio - Audio Plugins Framework & Effects Rack Modal
 * Comprehensive effects rack for Native Stems and verified Web Audio Modules (WAM 2.0).
 * Features categorized plugin browser, per-track effect chain reordering,
 * bypass toggles, dry/wet sliders, custom GUIs, and auto-generated generic parameter editors.
 */

import React, { useState, useEffect, useRef } from 'react';
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
  RotateCcw,
} from 'lucide-react';
import { Track } from '../types';
import { audioEngine } from '../audio/engine';
import { pluginManager } from '../plugins/pluginManager';
import { PluginDescriptor, PluginInstance } from '../plugins/types';
import {
  NATIVE_STEM_PLUGINS,
  VERIFIED_THIRD_PARTY_PLUGINS,
  isModuleOriginWhitelisted,
} from '../plugins/registry';

interface PluginsRackModalProps {
  isOpen: boolean;
  onClose: () => void;
  tracks: Track[];
  selectedTrackId: string | null;
  onSelectTrack: (trackId: string) => void;
}

export const PluginsRackModal: React.FC<PluginsRackModalProps> = ({
  isOpen,
  onClose,
  tracks,
  selectedTrackId,
  onSelectTrack,
}) => {
  // Active target track
  const activeTrackId = selectedTrackId || (tracks.length > 0 ? tracks[0].id : null);
  const activeTrack = tracks.find((t) => t.id === activeTrackId);

  // Active instances in selected track
  const [activePlugins, setActivePlugins] = useState<PluginInstance[]>([]);
  const [expandedGuis, setExpandedGuis] = useState<Record<string, boolean>>({});

  // Browser category
  const [browserCategory, setBrowserCategory] = useState<'native' | 'third-party'>('native');

  // Native list search and category filter
  const [pluginSearch, setPluginSearch] = useState<string>('');
  const [pluginCategory, setPluginCategory] = useState<string>('all');
  const CATEGORY_LABELS: Record<string, string> = {
    all: 'All',
    dynamics: 'Dynamics',
    eq: 'EQ',
    spatial: 'Spatial',
    modulation: 'Modulation',
    restoration: 'Restoration',
    'pitch-time': 'Pitch/Time',
    utility: 'Utility',
  };
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

  // GUI Mount containers map: instanceId -> HTMLDivElement
  const guiContainersRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Subscribe to PluginManager changes
  useEffect(() => {
    const update = () => {
      if (activeTrackId) {
        const list = pluginManager.getPluginsForTrack(activeTrackId);
        setActivePlugins([...list]);
      } else {
        setActivePlugins([]);
      }
    };

    update();
    const unsubscribe = pluginManager.subscribe(update);
    return () => {
      unsubscribe();
    };
  }, [activeTrackId]);

  // Mount GUIs when expanded
  useEffect(() => {
    activePlugins.forEach((instance) => {
      const isExpanded = expandedGuis[instance.instanceId];
      const container = guiContainersRef.current.get(instance.instanceId);

      if (isExpanded && container && instance.renderGUI && container.children.length === 0) {
        instance.renderGUI(container).catch((err) => {
          console.warn('Failed to render custom GUI for plugin:', err);
        });
      }
    });
  }, [activePlugins, expandedGuis]);

  if (!isOpen) return null;

  // Add Plugin to Track
  const handleAddPlugin = async (descriptor: PluginDescriptor) => {
    if (!activeTrackId) return;

    // Security check: If third-party and not from verified whitelist origin, prompt confirmation
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
      // Auto-expand GUI
      setExpandedGuis((prev) => ({ ...prev, [instance.instanceId]: true }));
    } catch (err) {
      console.error('Failed to add plugin:', err);
    }
  };

  // Add Custom WAM URL
  const handleAddCustomWam = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomUrlError(null);

    const url = customWamUrl.trim();
    if (!url || (!url.startsWith('https://') && !url.startsWith('http://localhost'))) {
      setCustomUrlError('Please provide a secure HTTPS module URL or localhost testing URL.');
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
      setExpandedGuis((prev) => ({ ...prev, [instance.instanceId]: true }));
      setCustomWamUrl('');
      setCustomWamName('');
      setShowCustomConfirm(false);
      setPendingCustomDescriptor(null);
    } catch (err) {
      setCustomUrlError(err instanceof Error ? err.message : String(err));
      setShowCustomConfirm(false);
    }
  };

  // Toggle Bypass
  const handleToggleBypass = (instance: PluginInstance) => {
    if (!activeTrackId) return;
    pluginManager.setPluginBypass(activeTrackId, instance.instanceId, !instance.isBypassed);
  };

  // Remove Plugin
  const handleRemovePlugin = (instanceId: string) => {
    if (!activeTrackId) return;
    pluginManager.removePluginFromTrack(activeTrackId, instanceId);
    setExpandedGuis((prev) => {
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
  };

  // Reorder
  const handleMoveUp = (index: number) => {
    if (!activeTrackId || index <= 0) return;
    pluginManager.reorderTrackPlugins(activeTrackId, index, index - 1);
  };

  const handleMoveDown = (index: number) => {
    if (!activeTrackId || index >= activePlugins.length - 1) return;
    pluginManager.reorderTrackPlugins(activeTrackId, index, index + 1);
  };

  // Toggle GUI View
  const handleToggleGui = (instanceId: string) => {
    setExpandedGuis((prev) => ({ ...prev, [instanceId]: !prev[instanceId] }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/85 backdrop-blur-md select-none animate-in fade-in duration-200">
      <div className="w-full max-w-6xl h-[90vh] bg-[#0F0F16] border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Top Header */}
        <div className="h-14 px-6 border-b border-zinc-800 flex items-center justify-between bg-[#13131D] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center text-white shadow-[0_0_15px_rgba(168,85,247,0.4)]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-black uppercase tracking-wider text-white">
                  Audio Plugins & Effects Rack
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-950/80 text-purple-300 font-mono font-semibold border border-purple-800/80">
                  WAM 2.0 & Native DSP
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Modular track audio processing with zero-latency high-frequency automation
              </p>
            </div>
          </div>

          {/* Track Target Selector */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-[#09090D] border border-zinc-700/80 rounded-lg px-3 py-1.5">
              <span className="text-xs text-zinc-400 font-medium">Target Track:</span>
              <select
                value={activeTrackId || ''}
                onChange={(e) => onSelectTrack(e.target.value)}
                className="bg-transparent text-xs font-bold text-cyan-300 focus:outline-none cursor-pointer"
              >
                {tracks.map((t, idx) => (
                  <option key={t.id} value={t.id} className="bg-[#121218] text-zinc-200">
                    Track {idx + 1}: {t.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close Rack"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Security Warning Modal for Custom Untrusted Modules */}
        {showCustomConfirm && pendingCustomDescriptor && (
          <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-[#161622] border border-amber-500/60 rounded-xl p-5 shadow-2xl space-y-3">
              <div className="flex items-center gap-2.5 text-amber-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="text-sm font-bold uppercase tracking-wider">
                  Third-Party Plugin Authorization
                </h3>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                You are loading an external Web Audio Module from:
                <code className="block mt-1 p-2 bg-black/60 rounded text-[11px] font-mono text-cyan-300 break-all border border-zinc-800">
                  {pendingCustomDescriptor.moduleUrl}
                </code>
              </p>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Uuda Studio executes audio modules in a sandboxed AudioWorklet scope with volatile credential isolation. Ensure you trust the author of this module.
              </p>
              <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setShowCustomConfirm(false);
                    setPendingCustomDescriptor(null);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAddCustom}
                  className="px-4 py-1.5 rounded-lg bg-amber-500 text-black font-bold text-xs hover:bg-amber-400 cursor-pointer shadow-md"
                >
                  Authorize & Load Plugin
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Multi-Pane Body */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-zinc-800">
          {/* Left Column: Categorized Available Effects Browser */}
          <div className="w-full md:w-[380px] flex flex-col bg-[#0D0D14] shrink-0 p-4 overflow-y-auto space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-purple-400" />
                  <span>Available Effects Library</span>
                </span>
              </div>

              {/* Category Filter Tabs: Native Stems vs Verified Third-Party */}
              <div className="grid grid-cols-2 p-1 bg-[#14141E] border border-zinc-800 rounded-xl mb-3">
                <button
                  type="button"
                  onClick={() => setBrowserCategory('native')}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    browserCategory === 'native'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Native Stems</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBrowserCategory('third-party')}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    browserCategory === 'third-party'
                      ? 'bg-cyan-600 text-white shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Verified WAM</span>
                </button>
              </div>
            </div>

            {/* Native list: search, category chips, count */}
            {browserCategory === 'native' && (
              <div className="mb-3 space-y-2">
                <input
                  type="search"
                  value={pluginSearch}
                  onChange={(e) => setPluginSearch(e.target.value)}
                  placeholder="Search effects (delay, de-esser, filter...)"
                  className="w-full px-3 py-1.5 bg-[#14141E] border border-zinc-800 rounded-lg text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-hidden focus:border-purple-500"
                />
                <div className="flex flex-wrap gap-1">
                  {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPluginCategory(key)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors cursor-pointer ${
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
                    ? `${NATIVE_STEM_PLUGINS.length} native plugins`
                    : `${filteredNativePlugins.length} of ${NATIVE_STEM_PLUGINS.length} native plugins`}
                </div>
              </div>
            )}

            {/* Plugin Cards List */}
            <div className="space-y-2">
              {browserCategory === 'native' ? (
                filteredNativePlugins.length === 0 ? (
                  <div className="text-[11px] text-zinc-500 py-4 text-center">No effects match your search.</div>
                ) : (
                filteredNativePlugins.map((plugin) => (
                  <div
                    key={plugin.id}
                    className="p-3 bg-[#14141E] border border-zinc-800/90 hover:border-purple-500/50 rounded-xl transition-all flex flex-col gap-2 group"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-zinc-100 group-hover:text-purple-300 transition-colors">
                            {plugin.name}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-950/80 text-purple-300 border border-purple-800/60 font-mono font-semibold">
                            v{plugin.version}
                          </span>
                        </div>
                        <span className="text-[10px] text-zinc-500 block">{plugin.vendor}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddPlugin(plugin)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold transition-colors cursor-pointer shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-snug">
                      {plugin.description}
                    </p>
                  </div>
                ))
                )
              ) : (
                <>
                  {VERIFIED_THIRD_PARTY_PLUGINS.map((plugin) => (
                    <div
                      key={plugin.id}
                      className="p-3 bg-[#14141E] border border-zinc-800/90 hover:border-cyan-500/50 rounded-xl transition-all flex flex-col gap-2 group"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-zinc-100 group-hover:text-cyan-300 transition-colors">
                              {plugin.name}
                            </span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-950/80 text-cyan-300 border border-cyan-800/60 font-mono font-semibold flex items-center gap-0.5">
                              <ShieldCheck className="w-3 h-3 text-cyan-400" />
                              <span>Verified</span>
                            </span>
                          </div>
                          <span className="text-[10px] text-zinc-500 block">{plugin.vendor} • v{plugin.version}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddPlugin(plugin)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold transition-colors cursor-pointer shrink-0"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add</span>
                        </button>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-snug">
                        {plugin.description}
                      </p>
                    </div>
                  ))}

                  {/* Add Custom WAM URL Form */}
                  <form
                    onSubmit={handleAddCustomWam}
                    className="p-3 bg-[#111119] border border-dashed border-zinc-800 rounded-xl space-y-2 mt-2"
                  >
                    <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                      <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Load External WAM 2.0 Module</span>
                    </span>
                    <input
                      type="url"
                      value={customWamUrl}
                      onChange={(e) => setCustomWamUrl(e.target.value)}
                      placeholder="https://example.org/my-plugin/index.js"
                      className="w-full bg-[#09090D] border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500 font-mono"
                    />
                    <input
                      type="text"
                      value={customWamName}
                      onChange={(e) => setCustomWamName(e.target.value)}
                      placeholder="Plugin Name (optional)"
                      className="w-full bg-[#09090D] border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500"
                    />
                    {customUrlError && (
                      <p className="text-[10px] text-rose-400">{customUrlError}</p>
                    )}
                    <button
                      type="submit"
                      className="w-full py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs transition-colors cursor-pointer"
                    >
                      + Import WAM Module
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>

          {/* Right Column: Ordered Track Effects Rack */}
          <div className="flex-1 flex flex-col bg-[#111118] p-5 overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-black uppercase tracking-wider text-zinc-200 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-cyan-400" />
                  <span>
                    Active Effect Chain • {activeTrack ? activeTrack.name : 'Select Track'}
                  </span>
                </h2>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Audio flows top-to-bottom through each inserted effect. Reorder or bypass modules in real time.
                </p>
              </div>

              <span className="text-xs text-zinc-400 font-mono">
                {activePlugins.length} {activePlugins.length === 1 ? 'Plugin' : 'Plugins'} Active
              </span>
            </div>

            {/* Empty Chain State */}
            {activePlugins.length === 0 ? (
              <div className="flex-1 min-h-[300px] border-2 border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-zinc-800/80 flex items-center justify-center text-zinc-500">
                  <Sliders className="w-6 h-6 stroke-[1.5]" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-300">Effects Rack Empty</h3>
                  <p className="text-xs text-zinc-500 max-w-sm mt-1">
                    Select any Native Stem or Verified Web Audio Module from the library on the left to insert it into this track's signal chain.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {activePlugins.map((plugin, index) => {
                  const isExpanded = !!expandedGuis[plugin.instanceId];
                  const descriptor = plugin.descriptor;
                  const isNative = descriptor.type === 'native';

                  return (
                    <div
                      key={plugin.instanceId}
                      className={`rounded-2xl border transition-all overflow-hidden ${
                        plugin.isBypassed
                          ? 'bg-[#14141c]/60 border-zinc-800 opacity-60'
                          : 'bg-[#151522] border-zinc-700/80 shadow-lg'
                      }`}
                    >
                      {/* Rack Unit Control Strip Header */}
                      <div className="p-3.5 flex items-center justify-between gap-3 bg-[#181826] border-b border-zinc-800">
                        {/* Left: Reorder buttons & Plugin info */}
                        <div className="flex items-center gap-3">
                          {/* Reorder Buttons */}
                          <div className="flex flex-col gap-0.5 shrink-0">
                            <button
                              type="button"
                              disabled={index === 0}
                              onClick={() => handleMoveUp(index)}
                              title="Move plugin earlier in chain"
                              className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 cursor-pointer"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={index === activePlugins.length - 1}
                              onClick={() => handleMoveDown(index)}
                              title="Move plugin later in chain"
                              className="text-zinc-500 hover:text-zinc-200 disabled:opacity-20 cursor-pointer"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Index Badge */}
                          <span className="w-5 h-5 rounded-md bg-zinc-800 flex items-center justify-center font-mono text-[10px] font-bold text-zinc-300">
                            {index + 1}
                          </span>

                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-zinc-100">
                                {descriptor.name}
                              </span>
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold border ${
                                  isNative
                                    ? 'bg-purple-950/80 text-purple-300 border-purple-800/80'
                                    : 'bg-cyan-950/80 text-cyan-300 border-cyan-800/80'
                                }`}
                              >
                                {isNative ? 'Native Stem' : 'WAM 2.0'}
                              </span>
                            </div>
                            <span className="text-[10px] text-zinc-500">
                              {descriptor.vendor} • v{descriptor.version}
                            </span>
                          </div>
                        </div>

                        {/* Right: Inline Controls (Bypass, Dry/Wet, GUI Toggle, Remove) */}
                        <div className="flex items-center gap-3">
                          {/* Dry / Wet Mix Slider */}
                          <div className="flex items-center gap-2 bg-[#0C0C12] border border-zinc-800 rounded-lg px-2.5 py-1">
                            <span className="text-[10px] text-zinc-400 font-semibold uppercase">Mix:</span>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.01}
                              defaultValue={plugin.dryWet ?? 1.0}
                              onInput={(e) => {
                                const val = parseFloat((e.target as HTMLInputElement).value);
                                if (activeTrackId) {
                                  pluginManager.setPluginDryWet(activeTrackId, plugin.instanceId, val);
                                }
                              }}
                              className="w-20 accent-cyan-400 cursor-pointer h-1.5 bg-zinc-700 rounded-lg"
                            />
                            <span className="text-[10px] font-mono text-cyan-400 font-bold min-w-[28px] text-right">
                              {Math.round((plugin.dryWet ?? 1.0) * 100)}%
                            </span>
                          </div>

                          {/* Bypass Switch */}
                          <button
                            type="button"
                            onClick={() => handleToggleBypass(plugin)}
                            title={plugin.isBypassed ? 'Unbypass Plugin (Engage)' : 'Bypass Plugin'}
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                              plugin.isBypassed
                                ? 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-white'
                                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                            }`}
                          >
                            <Power className="w-3.5 h-3.5" />
                            <span>{plugin.isBypassed ? 'Bypassed' : 'Active'}</span>
                          </button>

                          {/* GUI View Toggle */}
                          <button
                            type="button"
                            onClick={() => handleToggleGui(plugin.instanceId)}
                            title={isExpanded ? 'Hide Interface' : 'Show Interface'}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                              isExpanded
                                ? 'bg-purple-950/60 border-purple-500/60 text-purple-200'
                                : 'bg-zinc-800/80 border-zinc-700/80 text-zinc-300 hover:text-white'
                            }`}
                          >
                            {isExpanded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            <span>{isExpanded ? 'Hide GUI' : 'GUI'}</span>
                          </button>

                          {/* Remove Plugin Button */}
                          <button
                            type="button"
                            onClick={() => handleRemovePlugin(plugin.instanceId)}
                            title="Remove plugin from track"
                            className="text-zinc-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Expandable Plugin Interface Panel */}
                      {isExpanded && (
                        <div className="p-4 bg-[#111119] border-t border-zinc-800/80">
                          {/* If custom GUI available, container mounted here */}
                          <div
                            ref={(el) => {
                              if (el) {
                                guiContainersRef.current.set(plugin.instanceId, el);
                              } else {
                                guiContainersRef.current.delete(plugin.instanceId);
                              }
                            }}
                          />

                          {/* Auto-generated Generic Editor for plugins without custom GUI */}
                          {(!descriptor.hasCustomGui || !plugin.renderGUI) && (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between text-xs font-bold text-zinc-400 uppercase tracking-wider pb-2 border-b border-zinc-800">
                                <span>Parameter Automation Controls</span>
                                <span className="text-[10px] font-mono text-cyan-400">
                                  Direct AudioNode Automation
                                </span>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                {Object.entries(descriptor.parameters).map(([paramId, def]) => {
                                  const currentVal = plugin.getParameter ? plugin.getParameter(paramId) : def.defaultValue;
                                  return (
                                    <div
                                      key={paramId}
                                      className="p-3 bg-[#161622] rounded-xl border border-zinc-800 flex flex-col gap-1.5"
                                    >
                                      <div className="flex items-center justify-between text-xs">
                                        <span className="font-semibold text-zinc-300">
                                          {def.label || def.name || paramId}
                                        </span>
                                        <span
                                          id={`val-disp-${plugin.instanceId}-${paramId}`}
                                          className="font-mono text-cyan-400 font-bold"
                                        >
                                          {currentVal}
                                          {def.unit || ''}
                                        </span>
                                      </div>
                                      <input
                                        type="range"
                                        min={def.min}
                                        max={def.max}
                                        step={def.step || (def.max - def.min) / 100}
                                        defaultValue={currentVal}
                                        onInput={(e) => {
                                          const val = parseFloat((e.target as HTMLInputElement).value);
                                          // Direct high-frequency automation without React re-render
                                          if (activeTrackId) {
                                            pluginManager.setParameterDirect(
                                              activeTrackId,
                                              plugin.instanceId,
                                              paramId,
                                              val
                                            );
                                          }
                                          const disp = document.getElementById(
                                            `val-disp-${plugin.instanceId}-${paramId}`
                                          );
                                          if (disp) {
                                            disp.innerText = `${val}${def.unit || ''}`;
                                          }
                                        }}
                                        className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-zinc-700 rounded-lg mt-1"
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
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
    </div>
  );
};
