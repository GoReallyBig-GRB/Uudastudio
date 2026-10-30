/**
 * X-PRO AUDIO - Expanded Sound Library Modal
 * Features multi-column layout: Search & filters, Sound Source selector,
 * paginated search results with waveform images and author attribution,
 * live preview playback, and direct ingestion into the timeline.
 */

import React, { useState, useEffect } from 'react';
import {
  Search,
  Music,
  Play,
  Pause,
  ExternalLink,
  ShieldCheck,
  Download,
  AlertTriangle,
  X,
  Radio,
  SlidersHorizontal,
  Clock,
  Filter,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sparkles,
  Key,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { Asset, FreesoundItem } from '../types';
import { useFreesound, SoundSource } from '../hooks/useFreesound';

interface SoundLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddLibraryTrack: (asset: Asset) => void;
}

const TAG_SUGGESTIONS = [
  'ambience',
  'whoosh',
  'impact',
  'ui',
  'foley',
  'music loop',
  'voice',
  'transition',
  'stinger',
  'alarm',
];

const AVAILABLE_SOURCES: SoundSource[] = [
  {
    id: 'freesound',
    label: 'Freesound (CC0 Public Domain)',
    enabled: true,
    search: async () => ({ results: [], totalCount: 0 }),
  },
  {
    id: 'google-audio',
    label: 'Broadcast Soundfx (Coming Soon)',
    enabled: false,
    search: async () => ({ results: [], totalCount: 0 }),
  },
];

export const SoundLibraryModal: React.FC<SoundLibraryModalProps> = ({
  isOpen,
  onClose,
  onAddLibraryTrack,
}) => {
  const {
    query,
    setQuery,
    selectedTag,
    setSelectedTag,
    durationFilter,
    setDurationFilter,
    sortOrder,
    setSortOrder,
    page,
    pageSize,
    results,
    totalCount,
    isLoading,
    searchError,
    rateLimitInfo,
    userToken,
    currentPlayingId,
    downloadingId,
    downloadStatusMsg,
    isConnectModalOpen,
    authUrl,
    connectError,
    isExchangingCode,
    setIsConnectModalOpen,
    search,
    togglePreview,
    stopPreview,
    fetchAuthUrl,
    exchangeCode,
    addToTimeline,
  } = useFreesound();

  const [localQuery, setLocalQuery] = useState(query);
  const [selectedItem, setSelectedItem] = useState<FreesoundItem | null>(null);
  const [authCodeInput, setAuthCodeInput] = useState('');
  const [selectedSourceId, setSelectedSourceId] = useState('freesound');

  // Synchronize local search input if query changed externally
  useEffect(() => {
    setLocalQuery(query);
  }, [query]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isConnectModalOpen) {
          setIsConnectModalOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isConnectModalOpen, onClose, setIsConnectModalOpen]);

  // Automatically select first result if none selected
  useEffect(() => {
    if (results.length > 0 && !selectedItem) {
      setSelectedItem(results[0]);
    } else if (results.length > 0 && selectedItem) {
      const match = results.find((r) => r.id === selectedItem.id);
      if (match) setSelectedItem(match);
    }
  }, [results]);

  if (!isOpen) return null;

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    search({ query: localQuery, page: 1 });
  };

  const handleTagClick = (tag: string) => {
    const next = selectedTag === tag ? 'All' : tag;
    setSelectedTag(next);
    search({ tag: next, page: 1 });
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1) return;
    search({ page: newPage });
  };

  const totalPages = totalCount ? Math.ceil(totalCount / pageSize) : 1;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopPreview();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-black/85 backdrop-blur-md select-none animate-in fade-in duration-200"
    >
      <div className="w-full max-w-6xl h-[calc(100dvh-1.5rem)] md:h-[92dvh] bg-[#0E0E14] border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-zinc-100">
        {/* Modal Header */}
        <div className="h-14 px-3 sm:px-6 border-b border-zinc-800 flex items-center justify-between bg-[#12121A] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-[0_0_15px_rgba(16,185,129,0.35)]">
              <Music className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-black uppercase tracking-wider text-white">
                  Sound Library Workspace
                </h1>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 font-mono font-semibold border border-emerald-800/80">
                  CC0 Public Domain
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Browse, preview, and import royalty-free broadcast SFX & music loops
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* OAuth Connection Status Indicator */}
            {userToken ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-950/60 border border-emerald-800 text-[11px] text-emerald-300">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Freesound Connected</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  fetchAuthUrl();
                  setIsConnectModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-xs font-semibold transition-colors cursor-pointer"
              >
                <Key className="w-3.5 h-3.5 text-amber-400" />
                <span>Connect Account</span>
              </button>
            )}

            <button
              onClick={() => {
                stopPreview();
                onClose();
              }}
              className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close Library (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Status / Alert Bar */}
        {searchError && (
          <div className="px-6 py-2 bg-rose-950/70 border-b border-rose-800 text-xs text-rose-200 flex items-center justify-between shrink-0">
            <span className="font-medium">{searchError}</span>
            <button onClick={() => search()} className="text-rose-300 hover:text-white text-xs underline cursor-pointer">
              Retry
            </button>
          </div>
        )}

        {/* 3-Column Body Layout */}
        <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-zinc-800">
          {/* Left Column: Search & Filters */}
          <div className="w-full md:w-72 p-4 bg-[#101017] flex flex-col gap-4 overflow-y-auto shrink-0">
            {/* Sound Source Selector */}
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                Sound Source
              </label>
              <div className="space-y-1.5">
                {AVAILABLE_SOURCES.map((src) => (
                  <button
                    key={src.id}
                    disabled={!src.enabled}
                    onClick={() => setSelectedSourceId(src.id)}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium flex items-center justify-between border transition-all ${
                      selectedSourceId === src.id
                        ? 'bg-emerald-950/50 border-emerald-500/80 text-emerald-200'
                        : src.enabled
                        ? 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800'
                        : 'bg-zinc-900/40 border-zinc-900 text-zinc-600 cursor-not-allowed'
                    }`}
                  >
                    <span>{src.label}</span>
                    {src.enabled ? (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#10b981]" />
                    ) : (
                      <span className="text-[9px] text-zinc-600 font-mono">Soon</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Search Input Box */}
            <form onSubmit={handleSearchSubmit} className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                Search Audio
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={localQuery}
                  onChange={(e) => setLocalQuery(e.target.value)}
                  placeholder="e.g. rain, laser, riser, drone..."
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs shadow-[0_0_12px_rgba(16,185,129,0.3)] transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                <span>Search</span>
              </button>
            </form>

            {/* Tag Suggestions */}
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                Tag Suggestions
              </label>
              <div className="flex flex-wrap gap-1.5">
                {TAG_SUGGESTIONS.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => handleTagClick(tag)}
                    className={`px-2 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                      selectedTag.toLowerCase() === tag.toLowerCase()
                        ? 'bg-emerald-500 text-black font-bold'
                        : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Duration Presets */}
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                Duration Filter
              </label>
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                {(['any', 'short', 'medium', 'long'] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setDurationFilter(d);
                      search({ duration: d, page: 1 });
                    }}
                    className={`py-1.5 px-2 rounded-lg text-[11px] font-medium border text-center transition-all cursor-pointer ${
                      durationFilter === d
                        ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800'
                    }`}
                  >
                    {d === 'any' && 'Any Length'}
                    {d === 'short' && '< 5s (SFX)'}
                    {d === 'medium' && '5s - 20s'}
                    {d === 'long' && '20s+ (Beds)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort Order */}
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                Sort By
              </label>
              <select
                value={sortOrder}
                onChange={(e) => {
                  const s = e.target.value as any;
                  setSortOrder(s);
                  search({ sort: s, page: 1 });
                }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
              >
                <option value="score">Relevance (Score)</option>
                <option value="downloads_desc">Most Downloaded</option>
                <option value="rating_desc">Highest Rated</option>
                <option value="created_desc">Newest First</option>
              </select>
            </div>
          </div>

          {/* Center Column: Paginated Sound Results List */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#0C0C12] overflow-hidden">
            {/* Results Toolbar */}
            <div className="px-5 py-2.5 border-b border-zinc-800/80 bg-[#121218] flex items-center justify-between text-xs text-zinc-400 shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-200">
                  {totalCount !== null ? `${totalCount.toLocaleString()} results found` : 'Searching...'}
                </span>
                {selectedTag !== 'All' && (
                  <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-mono text-[10px]">
                    #{selectedTag}
                  </span>
                )}
              </div>

              {/* Pagination controls */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-zinc-400">
                  Page {page} of {Math.max(1, totalPages)}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    disabled={page <= 1 || isLoading}
                    onClick={() => handlePageChange(page - 1)}
                    className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-200 cursor-pointer"
                    title="Previous page"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    disabled={page >= totalPages || isLoading}
                    onClick={() => handlePageChange(page + 1)}
                    className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 text-zinc-200 cursor-pointer"
                    title="Next page"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {isLoading && (
                <div className="h-64 flex flex-col items-center justify-center gap-3 text-zinc-400">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  <span className="text-xs">Searching CC0 audio library...</span>
                </div>
              )}

              {!isLoading && results.length === 0 && (
                <div className="h-64 flex flex-col items-center justify-center gap-3 text-zinc-500">
                  <Radio className="w-8 h-8 text-zinc-600 stroke-[1.5]" />
                  <span className="text-sm">No audio clips found matching your filters.</span>
                  <span className="text-xs text-zinc-600">Try a different keyword or broaden the duration filter.</span>
                </div>
              )}

              {!isLoading &&
                results.map((item) => {
                  const isPlaying = currentPlayingId === item.id;
                  const isSelected = selectedItem?.id === item.id;
                  const isDownloading = downloadingId === item.id;

                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-zinc-800/80 border-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                          : 'bg-zinc-900/60 border-zinc-800/80 hover:bg-zinc-800/50 hover:border-zinc-700'
                      }`}
                    >
                      {/* Play Preview Button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreview(item);
                        }}
                        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-105 cursor-pointer ${
                          isPlaying
                            ? 'bg-emerald-500 text-black shadow-[0_0_12px_rgba(16,185,129,0.6)]'
                            : 'bg-zinc-800 text-zinc-200 hover:bg-emerald-600 hover:text-white'
                        }`}
                      >
                        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                      </button>

                      {/* Sound Info & Waveform */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-bold text-zinc-100 truncate hover:text-emerald-300">
                            {item.name}
                          </h4>
                          <span className="text-[11px] font-mono text-emerald-400 font-semibold shrink-0">
                            {item.duration.toFixed(1)}s
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-[10px] text-zinc-400 mt-1">
                          <span>By <strong className="text-zinc-300">{item.username}</strong></span>
                          <span>•</span>
                          <span className="uppercase font-mono">{item.type || 'WAV'}</span>
                          <span>•</span>
                          <span className="text-emerald-400/90 font-mono">CC0 Public Domain</span>
                        </div>

                        {/* Waveform preview image if available */}
                        {item.images?.waveform_m ? (
                          <div className="mt-2 h-7 w-full bg-black/60 rounded overflow-hidden border border-zinc-800/60">
                            <img
                              src={item.images.waveform_m}
                              alt="Waveform preview"
                              className="w-full h-full object-cover opacity-75 hover:opacity-100 transition-opacity"
                            />
                          </div>
                        ) : (
                          <div className="mt-2 h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500/40 rounded-full w-2/3" />
                          </div>
                        )}
                      </div>

                      {/* Add to Timeline Action */}
                      <button
                        type="button"
                        disabled={isDownloading}
                        onClick={(e) => {
                          e.stopPropagation();
                          addToTimeline(item, onAddLibraryTrack);
                        }}
                        className={`px-3 py-2 rounded-lg text-xs font-bold shrink-0 transition-all cursor-pointer flex items-center gap-1.5 ${
                          isDownloading
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                        }`}
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Adding...</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5" />
                            <span>Add Track</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Right Column: Detailed Sound Inspector & Metadata */}
          <div className="w-full md:w-80 p-5 bg-[#101017] flex flex-col gap-4 overflow-y-auto shrink-0">
            <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
              <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Sound Inspector</span>
            </h3>

            {selectedItem ? (
              <div className="space-y-4 text-xs">
                <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 space-y-2">
                  <h4 className="font-bold text-zinc-100 text-sm">{selectedItem.name}</h4>
                  <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                    <span>Creator:</span>
                    <strong className="text-zinc-200">{selectedItem.username}</strong>
                  </div>
                  <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                    <span>Duration:</span>
                    <strong className="text-emerald-400 font-mono">{selectedItem.duration.toFixed(2)} seconds</strong>
                  </div>
                  <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                    <span>License:</span>
                    <strong className="text-emerald-400 font-mono">Creative Commons 0 (Free Broadcast)</strong>
                  </div>
                  <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                    <span>Format:</span>
                    <span className="font-mono uppercase">{selectedItem.type || 'WAV'}</span>
                  </div>
                  <div className="text-[11px] text-zinc-400 flex items-center gap-2">
                    <span>Sample Rate:</span>
                    <span className="font-mono">{selectedItem.samplerate ? `${selectedItem.samplerate} Hz` : '48000 Hz'}</span>
                  </div>
                </div>

                {/* Big Preview Control */}
                <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">
                    Audio Preview
                  </span>
                  <button
                    onClick={() => togglePreview(selectedItem)}
                    className="w-full py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    {currentPlayingId === selectedItem.id ? (
                      <>
                        <Pause className="w-4 h-4 fill-current text-emerald-400" />
                        <span>Pause Preview</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current text-emerald-400 ml-0.5" />
                        <span>Play Sample</span>
                      </>
                    )}
                  </button>

                  <button
                    disabled={downloadingId === selectedItem.id}
                    onClick={() => addToTimeline(selectedItem, onAddLibraryTrack)}
                    className="w-full py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold flex items-center justify-center gap-2 shadow-[0_0_12px_rgba(16,185,129,0.3)] transition-all cursor-pointer"
                  >
                    {downloadingId === selectedItem.id ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>{downloadStatusMsg || 'Downloading...'}</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Add to New Top Track</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Tags list */}
                {selectedItem.tags && selectedItem.tags.length > 0 && (
                  <div>
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                      Tags
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {selectedItem.tags.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-400">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-40 flex items-center justify-center text-zinc-600 text-xs">
                Select a clip to inspect details
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Freesound OAuth In-App Modal Dialog */}
      {isConnectModalOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
          <div className="w-full max-w-md bg-[#14141E] border border-zinc-700 rounded-2xl shadow-2xl p-6 text-zinc-100 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-sm">Connect Freesound Account</h3>
              </div>
              <button
                onClick={() => setIsConnectModalOpen(false)}
                className="text-zinc-400 hover:text-white p-1 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed">
              Freesound needs a free user authorization code to give you the full-quality original. This is optional: without it, sounds are still added to your timeline at preview quality.
            </p>

            {connectError && (
              <div className="p-2.5 rounded bg-rose-950/70 border border-rose-800 text-xs text-rose-200">
                {connectError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <span className="text-xs font-semibold text-zinc-200 block mb-1">Step 1: Open Authorize Page</span>
                {authUrl ? (
                  <a
                    href={authUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
                  >
                    <span>Authorize on Freesound</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <button
                    onClick={fetchAuthUrl}
                    className="text-xs text-emerald-400 underline cursor-pointer"
                  >
                    Load authorization URL...
                  </button>
                )}
              </div>

              <div>
                <span className="text-xs font-semibold text-zinc-200 block mb-1">Step 2: Paste Authorization Code</span>
                <input
                  type="text"
                  value={authCodeInput}
                  onChange={(e) => setAuthCodeInput(e.target.value)}
                  placeholder="Paste authorization code here"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <button
                disabled={isExchangingCode || !authCodeInput.trim()}
                onClick={async () => {
                  const ok = await exchangeCode(authCodeInput.trim());
                  if (ok) setAuthCodeInput('');
                }}
                className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                {isExchangingCode ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                <span>Authorize & Save Token</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
