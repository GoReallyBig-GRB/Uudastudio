/**
 * X-PRO AUDIO - Sound Effects & Music Loop Library
 * Live integration with Freesound API (Strict CC0 Public Domain Filter Only).
 * Features live audio preview, OAuth2 user account connect for original audio download,
 * and automatic addition to a new top track on the timeline.
 */

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  Music,
  Play,
  Pause,
  ExternalLink,
  ShieldCheck,
  Download,
  AlertTriangle,
  RotateCcw,
  CheckCircle,
  Key,
  X,
  Radio,
  SlidersHorizontal,
  Clock,
  Filter,
  Sparkles,
} from 'lucide-react';
import { Asset, FreesoundItem } from '../types';
import { audioEngine } from '../audio/engine';
import { useFreesound } from '../hooks/useFreesound';

interface SoundLibraryPanelProps {
  onAddLibraryTrack: (asset: Asset) => void;
  onClose?: () => void;
  onOpenLibraryModal?: () => void;
}

const QUICK_TAGS = ['All', 'Transition', 'Stinger', 'Jingle', 'Ambience', 'Alarm', 'Loop', 'Impact'];

export const SoundLibraryPanel: React.FC<SoundLibraryPanelProps> = ({
  onAddLibraryTrack,
  onClose,
  onOpenLibraryModal,
}) => {
  const [isFeatureEnabled, setIsFeatureEnabled] = useState(true);
  const [clientId, setClientId] = useState<string | null>(null);

  const {
    query,
    setQuery,
    selectedTag,
    setSelectedTag,
    durationFilter,
    setDurationFilter,
    sortOrder,
    setSortOrder,
    results,
    totalCount,
    isLoading,
    searchError,
    setSearchError,
    rateLimitInfo,
    userToken,
    setUserToken,
    currentPlayingId,
    downloadingId,
    downloadStatusMsg,
    isConnectModalOpen,
    setIsConnectModalOpen,
    authUrl,
    connectError,
    isExchangingCode,
    search,
    togglePreview,
    stopPreview,
    fetchAuthUrl,
    exchangeCode,
    addToTimeline,
  } = useFreesound();

  const [authCodeInput, setAuthCodeInput] = useState('');

  // Close connect modal on Escape key
  useEffect(() => {
    if (!isConnectModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsConnectModalOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isConnectModalOpen, setIsConnectModalOpen]);

  // Check server configuration & feature flag
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const res = await fetch('/api/freesound/config');
        if (res.ok) {
          const cfg = await res.json();
          setIsFeatureEnabled(cfg.enabled ?? true);
          setClientId(cfg.clientId);
        }
      } catch (err) {
        console.warn('Could not read Freesound config from server', err);
      }
    };
    checkConfig();
  }, []);

  // Run initial search
  useEffect(() => {
    if (isFeatureEnabled) {
      search();
    }
  }, [selectedTag, durationFilter, sortOrder, isFeatureEnabled]);

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    search({ query, page: 1 });
  };

  const handleOpenConnectFlow = async () => {
    window.dispatchEvent(new CustomEvent('xpro:close-popups'));
    setIsConnectModalOpen(true);
    fetchAuthUrl();
  };

  const handleExchangeCode = async () => {
    const ok = await exchangeCode(authCodeInput.trim());
    if (ok) setAuthCodeInput('');
  };

  const handleAddToTimeline = (item: FreesoundItem) => {
    addToTimeline(item, onAddLibraryTrack);
  };

  return (
    <div className="flex flex-col h-full bg-[#121216] border-r border-zinc-800 text-zinc-200 select-text">
      {/* Panel Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/80 bg-[#16161c]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            <Music className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-100 flex items-center gap-1.5">
              <span>Sound Library</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/40">
                CC0 Only
              </span>
            </h2>
            <p className="text-[10px] text-zinc-400">Freesound API • Public Domain CC0 Filter Locked</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (onOpenLibraryModal) {
                onOpenLibraryModal();
              } else {
                window.dispatchEvent(new CustomEvent('uuda:open-library-modal'));
              }
            }}
            title="Expand to Full Sound Library Workspace Modal"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/80 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span>Expand Library</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Feature Flag Notice */}
      {!isFeatureEnabled ? (
        <div className="p-6 text-center space-y-3 flex-1 flex flex-col items-center justify-center">
          <AlertTriangle className="w-10 h-10 text-amber-400" />
          <h3 className="text-sm font-bold text-zinc-200">Sound Library is Disabled</h3>
          <p className="text-xs text-zinc-400 max-w-xs leading-relaxed">
            The Freesound CC0 library is behind a feature flag (default off in production).
          </p>
          <button
            onClick={() => setIsFeatureEnabled(true)}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors"
          >
            Enable for this session
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Connection status banner */}
          <div className="p-2.5 rounded-lg bg-[#0a0a0e] border border-zinc-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  userToken ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
              <span className="text-zinc-300 font-medium text-[11px]">
                {userToken ? 'Freesound Account Connected' : 'Account Disconnected (Preview only)'}
              </span>
            </div>

            {userToken ? (
              <button
                onClick={() => {
                  sessionStorage.removeItem('xpro_freesound_token');
                  setUserToken(null);
                }}
                className="text-[10px] text-zinc-500 hover:text-rose-400 transition-colors"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleOpenConnectFlow}
                className="text-[10px] font-semibold text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
              >
                <Key className="w-3 h-3" />
                <span>Connect Account</span>
              </button>
            )}
          </div>

          {/* Search Form */}
          <form onSubmit={handleSearch} className="space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stingers, sweeps, sweeps, drops, impacts..."
                className="w-full bg-[#0a0a0e] border border-zinc-700/80 rounded-lg pl-8.5 pr-3 py-2 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
              />
            </div>

            {/* Quick Tag Pills */}
            <div className="flex flex-wrap gap-1">
              {QUICK_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(tag)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    selectedTag === tag
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                      : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 border border-zinc-800'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>

            {/* Filter controls row */}
            <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
              <div>
                <label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold block mb-0.5">
                  Duration
                </label>
                <select
                  value={durationFilter}
                  onChange={(e) => setDurationFilter(e.target.value as any)}
                  className="w-full bg-[#0a0a0e] border border-zinc-800 rounded p-1 text-zinc-300 focus:outline-none"
                >
                  <option value="any">Any Length</option>
                  <option value="short">&lt; 5 seconds</option>
                  <option value="medium">5 - 20 seconds</option>
                  <option value="long">20s - 5 minutes</option>
                </select>
              </div>

              <div>
                <label className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold block mb-0.5">
                  Sort By
                </label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as any)}
                  className="w-full bg-[#0a0a0e] border border-zinc-800 rounded p-1 text-zinc-300 focus:outline-none"
                >
                  <option value="score">Relevance</option>
                  <option value="downloads_desc">Most Downloaded</option>
                  <option value="rating_desc">Highest Rated</option>
                  <option value="created_desc">Newest Added</option>
                </select>
              </div>
            </div>
          </form>

          {/* Locked CC0 Badge Notice */}
          <div className="p-2 rounded bg-emerald-950/30 border border-emerald-500/30 text-[10px] text-emerald-300 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Licence locked to CC0 (Creative Commons 0 - Public Domain)</span>
            </span>
            <span className="font-mono text-zinc-400">
              {totalCount !== null ? `${totalCount} sounds` : ''}
            </span>
          </div>

          {/* Rate Limit Notice if active */}
          {rateLimitInfo && rateLimitInfo.remaining !== null && rateLimitInfo.remaining < 15 && (
            <div className="p-2 rounded bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300">
              Freesound API requests remaining: {rateLimitInfo.remaining} / 60
            </div>
          )}

          {/* Search Error */}
          {searchError && (
            <div className="p-3 rounded-lg bg-rose-500/15 border border-rose-500/40 text-xs text-rose-300">
              {searchError}
            </div>
          )}

          {/* Results List */}
          {isLoading ? (
            <div className="py-8 text-center text-xs text-zinc-500 space-y-2">
              <div className="w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin mx-auto" />
              <div>Querying Freesound API...</div>
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              No CC0 sounds found matching your criteria. Try another keyword.
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((item) => {
                const isPlaying = currentPlayingId === item.id;
                const isDownloading = downloadingId === item.id;

                return (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-lg bg-[#0a0a0e] border border-zinc-800/80 hover:border-zinc-700 transition-colors space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-200 truncate" title={item.name}>
                          {item.name}
                        </div>
                        <div className="text-[10px] text-zinc-400 flex items-center gap-2 mt-0.5">
                          <span>by {item.username}</span>
                          <span>•</span>
                          <span className="font-mono text-zinc-300">{item.duration.toFixed(1)}s</span>
                          <span>•</span>
                          <span className="px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-bold">
                            CC0
                          </span>
                        </div>
                      </div>

                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        title="View on Freesound.org"
                        className="text-zinc-500 hover:text-emerald-400 p-1 shrink-0 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>

                    {/* Tags preview */}
                    {item.tags && item.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 text-[9px] text-zinc-500">
                        {item.tags.slice(0, 4).map((t) => (
                          <span key={t} className="px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800">
                            #{t}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Actions: Preview & Add to Timeline */}
                    <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/60">
                      {/* Preview Button */}
                      <button
                        type="button"
                        onClick={() => togglePreview(item)}
                        className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
                          isPlaying
                            ? 'bg-emerald-500 text-black'
                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                        }`}
                      >
                        {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
                        <span>{isPlaying ? 'Pause' : 'Preview'}</span>
                      </button>

                      {/* Add to Timeline Button */}
                      <button
                        type="button"
                        disabled={isDownloading}
                        onClick={() => handleAddToTimeline(item)}
                        className="flex-1 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
                      >
                        <Download className="w-3 h-3" />
                        <span>{isDownloading ? downloadStatusMsg : 'Add to Timeline'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Freesound OAuth2 Connect Modal (Portal to body at z-[100] to ensure it cannot be covered by any timeline controls or strips) */}
      {isConnectModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/85 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-150"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsConnectModalOpen(false);
            }}
          >
            <div
              className="bg-[#121218] border border-zinc-700/90 rounded-xl p-5 max-w-md w-full shadow-[0_20px_60px_rgba(0,0,0,0.9),0_0_24px_rgba(16,185,129,0.15)] space-y-4 animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-zinc-100">Connect Freesound Account</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsConnectModalOpen(false)}
                  className="text-zinc-500 hover:text-zinc-300 p-1 rounded hover:bg-zinc-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-zinc-400 leading-relaxed">
                Freesound API requires user authorization via OAuth2 to download original, uncompressed
                audio files onto your multi-track timeline.
              </p>

              <div className="text-xs text-zinc-300 space-y-2.5 bg-[#0a0a0e] p-3 rounded-lg border border-zinc-800">
                <div className="font-semibold text-zinc-200">How to connect:</div>
                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">
                    1
                  </span>
                  <div className="flex-1">
                    {authUrl ? (
                      <a
                        href={authUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/50 text-xs font-semibold transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open Freesound Login & Authorization Page ↗</span>
                      </a>
                    ) : (
                      <span>Log in to your free Freesound.org account and authorize access.</span>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">
                    2
                  </span>
                  <span>Click <strong>Authorize</strong> to allow Uuda Studio to access CC0 downloads.</span>
                </div>

                <div className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] flex items-center justify-center shrink-0 mt-0.5 font-bold">
                    3
                  </span>
                  <span>Copy the authorization code from Freesound and paste it below:</span>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Authorization Code
                </label>
                <input
                  type="text"
                  value={authCodeInput}
                  onChange={(e) => setAuthCodeInput(e.target.value)}
                  placeholder="Paste authorization code here..."
                  className="w-full bg-[#0a0a0e] border border-zinc-700 rounded-lg p-2.5 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500 font-mono"
                />
              </div>

              {connectError && (
                <div className="text-xs text-rose-400 p-2.5 rounded bg-rose-500/10 border border-rose-500/30">
                  {connectError}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConnectModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isExchangingCode || !authCodeInput.trim()}
                  onClick={handleExchangeCode}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 disabled:opacity-40 transition-colors shadow-lg shadow-emerald-900/30"
                >
                  {isExchangingCode ? 'Connecting...' : 'Connect & Enable Downloads'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
