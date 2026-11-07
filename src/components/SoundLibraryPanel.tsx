/**
 * X-PRO AUDIO - Sound Effects & Music Loop Library
 * Live integration with Freesound API (Strict CC0 Public Domain Filter Only).
 * Features live audio preview, OAuth2 user account connect for original audio download,
 * and automatic addition to a new top track on the timeline.
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, Music, Play, Pause, ExternalLink, ShieldCheck, Download, AlertTriangle, Key } from 'lucide-react';
import { Asset, FreesoundItem } from '../types';
import { audioEngine } from '../audio/engine';
import { useFreesound } from '../hooks/useFreesound';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { ModalShell } from './ui/ModalShell';
import { FIELD, pill, notice, PanelHeader, ExpandRow } from './sidebarParts';

interface SoundLibraryPanelProps {
  onAddLibraryTrack: (asset: Asset) => void;
  onClose?: () => void;
  onOpenLibraryModal?: () => void;
}

const QUICK_TAGS = ['All', 'Transition', 'Stinger', 'Jingle', 'Ambience', 'Alarm', 'Loop', 'Impact'];

export const SoundLibraryPanel: React.FC<SoundLibraryPanelProps> = ({
  onAddLibraryTrack,
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
    <div className="flex h-full flex-col border-r border-line bg-surface-1 text-ink-dim select-text">
      <PanelHeader icon={<Music className="h-3.5 w-3.5" />} title="Sound Library" subtitle="Freesound · CC0 public domain only" />

      {!isFeatureEnabled ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-warn" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-ink">Sound Library is off</h3>
          <p className="max-w-xs text-xs leading-relaxed text-ink-dim">
            The Freesound library is behind a feature flag, which is off by default in production.
          </p>
          <Button variant="primary" size="sm" onClick={() => setIsFeatureEnabled(true)}>
            Turn on for this session
          </Button>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 [scrollbar-width:thin]">
          <ExpandRow
            label="Open full sound library"
            title="Open the larger Sound Library workspace"
            onClick={() => {
              if (onOpenLibraryModal) onOpenLibraryModal();
              else window.dispatchEvent(new CustomEvent('uuda:open-library-modal'));
            }}
          />

          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex min-w-0 items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${userToken ? 'bg-ok' : 'bg-warn'}`} aria-hidden="true" />
              <span className="truncate text-ink-dim">{userToken ? 'Account connected' : 'Not connected: preview only, downloads off'}</span>
            </span>
            {userToken ? (
              <button
                type="button"
                onClick={() => {
                  sessionStorage.removeItem('xpro_freesound_token');
                  setUserToken(null);
                }}
                className={pill()}
              >
                Disconnect
              </button>
            ) : (
              <button type="button" onClick={handleOpenConnectFlow} className={pill(true)}>
                <Key className="h-3 w-3" aria-hidden="true" />
                <span>Connect</span>
              </button>
            )}
          </div>

          <form onSubmit={handleSearch} className="space-y-3 border-t border-line pt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search sounds"
                placeholder="Search stingers, sweeps, impacts"
                className={`${FIELD} h-8 pl-8`}
              />
            </div>

            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick tags">
              {QUICK_TAGS.map((tag) => (
                <button key={tag} type="button" aria-pressed={selectedTag === tag} onClick={() => setSelectedTag(tag)} className={pill(selectedTag === tag)}>
                  {tag}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block min-w-0">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-dim">Length</span>
                <select value={durationFilter} onChange={(e) => setDurationFilter(e.target.value as any)} className={`${FIELD} h-8 cursor-pointer`}>
                  <option value="any">Any length</option>
                  <option value="short">Under 5 s</option>
                  <option value="medium">5 to 20 s</option>
                  <option value="long">20 s to 5 min</option>
                </select>
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-dim">Sort by</span>
                <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as any)} className={`${FIELD} h-8 cursor-pointer`}>
                  <option value="score">Relevance</option>
                  <option value="downloads_desc">Most downloaded</option>
                  <option value="rating_desc">Highest rated</option>
                  <option value="created_desc">Newest</option>
                </select>
              </label>
            </div>
          </form>

          <div className="flex items-center justify-between gap-2 text-[10px] text-ink-faint">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span>CC0 only, safe to use anywhere</span>
            </span>
            <span className="font-num">{totalCount !== null ? `${totalCount} sounds` : ''}</span>
          </div>

          {rateLimitInfo && rateLimitInfo.remaining !== null && rateLimitInfo.remaining < 15 && (
            <div className={notice('warn')}>Freesound requests left: {rateLimitInfo.remaining} of 60</div>
          )}

          {searchError && <div className={notice('danger')} role="alert">{searchError}</div>}

          {isLoading ? (
            <div className="space-y-2 py-8 text-center text-xs text-ink-faint">
              <div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none" />
              <div>Searching Freesound...</div>
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-xs text-ink-faint">No CC0 sounds match. Try another keyword.</div>
          ) : (
            <ul className="space-y-2">
              {results.map((item) => {
                const isPlaying = currentPlayingId === item.id;
                const isDownloading = downloadingId === item.id;
                return (
                  <li key={item.id} className="space-y-2 rounded-control border border-line bg-surface-2 p-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-ink" title={item.name}>{item.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-faint">
                        <span className="truncate">by {item.username}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-num shrink-0">{item.duration.toFixed(1)}s</span>
                        <span aria-hidden="true">·</span>
                        <a href={item.url} target="_blank" rel="noreferrer" title="View on Freesound.org" className="shrink-0 hover:text-accent">
                          Freesound ↗
                        </a>
                      </div>
                      {item.tags && item.tags.length > 0 && (
                        <div className="mt-1 truncate text-[10px] text-ink-faint">{item.tags.slice(0, 4).map((t) => `#${t}`).join('  ')}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => togglePreview(item)} className={pill(isPlaying, 'w-[5.5rem]')}>
                        {isPlaying ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                        <span>{isPlaying ? 'Pause' : 'Preview'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={isDownloading}
                        onClick={() => handleAddToTimeline(item)}
                        className={pill(false, 'min-w-0 flex-1 border-accent/40 text-accent hover:bg-accent-soft hover:text-accent')}
                      >
                        <Download className="h-3 w-3 shrink-0" />
                        <span className="truncate">{isDownloading ? downloadStatusMsg : userToken ? 'Add to timeline' : 'Connect to add'}</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Connect dialog: portalled to the page so no panel layer can cover it */}
      {createPortal(
      <ModalShell
        open={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        title="Connect Freesound account"
        description="Needed to download the original, full-quality audio onto your timeline."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setIsConnectModalOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={isExchangingCode || !authCodeInput.trim()} onClick={handleExchangeCode}>
              {isExchangingCode ? 'Connecting...' : 'Connect and enable downloads'}
            </Button>
          </>
        }
      >
        <ol className="space-y-3 text-xs text-ink-dim">
          <li className="flex items-start gap-2.5">
            <span className="font-num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-[10px] text-ink">1</span>
            <div className="flex-1">
              {authUrl ? (
                <a href={authUrl} target="_blank" rel="noopener noreferrer" className={pill(true, 'h-8')}>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Open the Freesound authorization page</span>
                </a>
              ) : (
                <span>Log in to your free Freesound.org account.</span>
              )}
            </div>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="font-num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-[10px] text-ink">2</span>
            <span>Choose <strong className="text-ink">Authorize</strong> to let Uuda Studio download CC0 sounds.</span>
          </li>
          <li className="flex items-start gap-2.5">
            <span className="font-num flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line-strong text-[10px] text-ink">3</span>
            <span>Copy the code Freesound shows you and paste it here.</span>
          </li>
        </ol>
        <div className="mt-4">
          <Input
            label="Authorization code"
            value={authCodeInput}
            onChange={(e) => setAuthCodeInput(e.target.value)}
            placeholder="Paste the code here"
          />
        </div>
        {connectError && <div className={`${notice('danger')} mt-3`} role="alert">{connectError}</div>}
      </ModalShell>,
      document.body,
      )}
    </div>
  );
};
