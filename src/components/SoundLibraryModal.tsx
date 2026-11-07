/**
 * X-PRO AUDIO - Expanded Sound Library Modal
 * Features multi-column layout: Search & filters, Sound Source selector,
 * paginated search results with waveform images and author attribution,
 * live preview playback, and direct ingestion into the timeline.
 */

import React, { useState, useEffect } from 'react';
import { Search, Play, Pause, ExternalLink, Download, Radio, ChevronLeft, ChevronRight, Key, Loader2 } from 'lucide-react';
import { Asset, FreesoundItem } from '../types';
import { useFreesound, SoundSource } from '../hooks/useFreesound';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { ModalShell } from './ui/ModalShell';
import { SegmentedControl } from './ui/SegmentedControl';
import { FIELD, pill, notice } from './sidebarParts';

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

  // Automatically select first result if none selected
  useEffect(() => {
    if (results.length > 0 && !selectedItem) {
      setSelectedItem(results[0]);
    } else if (results.length > 0 && selectedItem) {
      const match = results.find((r) => r.id === selectedItem.id);
      if (match) setSelectedItem(match);
    }
  }, [results]);

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

  const closeLibrary = () => {
    stopPreview();
    onClose();
  };

  const sourceOptions = AVAILABLE_SOURCES.map((src) => ({
    value: src.id,
    label: src.enabled ? 'Freesound' : 'Broadcast · soon',
    disabled: !src.enabled,
  }));

  const label = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ink-dim';

  return (
    <>
      <ModalShell
        open={isOpen}
        onClose={closeLibrary}
        title="Sound Library"
        description="Browse, preview and add free CC0 sound effects and music loops from Freesound"
        variant="workspace"
        dismissible={!isConnectModalOpen}
      >
        {searchError && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-danger/30 bg-danger/10 px-6 py-2 text-xs text-danger" role="alert">
            <span>{searchError}</span>
            <button type="button" onClick={() => search()} className={pill()}>Retry</button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col divide-y divide-line overflow-y-auto md:flex-row md:divide-x md:divide-y-0 md:overflow-hidden">
          {/* Left: source, account, search and filters */}
          <div className="flex w-full shrink-0 flex-col gap-4 bg-surface-1 p-4 md:w-72 md:overflow-y-auto">
            <div>
              <span className={label}>Source</span>
              <SegmentedControl
                label="Sound source"
                size="sm"
                value={selectedSourceId}
                onChange={setSelectedSourceId}
                options={sourceOptions}
                className="w-full [&>button]:flex-1"
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${userToken ? 'bg-ok' : 'bg-warn'}`} aria-hidden="true" />
                <span className="truncate text-ink-dim">{userToken ? 'Account connected' : 'Not connected'}</span>
              </span>
              {!userToken && (
                <button
                  type="button"
                  onClick={() => {
                    fetchAuthUrl();
                    setIsConnectModalOpen(true);
                  }}
                  className={pill(true)}
                >
                  <Key className="h-3 w-3" aria-hidden="true" />
                  <span>Connect</span>
                </button>
              )}
            </div>

            <form onSubmit={handleSearchSubmit} className="space-y-2 border-t border-line pt-4">
              <label htmlFor="library-search" className={label}>Search</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
                <input
                  id="library-search"
                  type="text"
                  value={localQuery}
                  onChange={(e) => setLocalQuery(e.target.value)}
                  placeholder="rain, laser, riser, drone"
                  className={`${FIELD} h-9 pl-8`}
                />
              </div>
              <Button type="submit" variant="primary" size="sm" className="w-full" disabled={isLoading} loading={isLoading} leftIcon={<Search className="h-3.5 w-3.5" />}>
                Search
              </Button>
            </form>

            <div className="border-t border-line pt-4">
              <span className={label}>Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {TAG_SUGGESTIONS.map((tag) => {
                  const on = selectedTag.toLowerCase() === tag.toLowerCase();
                  return (
                    <button key={tag} type="button" aria-pressed={on} onClick={() => handleTagClick(tag)} className={pill(on)}>
                      #{tag}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-line pt-4">
              <span className={label}>Length</span>
              <div className="grid grid-cols-2 gap-1.5">
                {(['any', 'short', 'medium', 'long'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={durationFilter === d}
                    onClick={() => {
                      setDurationFilter(d);
                      search({ duration: d, page: 1 });
                    }}
                    className={pill(durationFilter === d, 'w-full')}
                  >
                    {d === 'any' && 'Any length'}
                    {d === 'short' && 'Under 5 s'}
                    {d === 'medium' && '5 to 20 s'}
                    {d === 'long' && '20 s and up'}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-line pt-4">
              <label htmlFor="library-sort" className={label}>Sort by</label>
              <select
                id="library-sort"
                value={sortOrder}
                onChange={(e) => {
                  const next = e.target.value as any;
                  setSortOrder(next);
                  search({ sort: next, page: 1 });
                }}
                className={`${FIELD} h-8 cursor-pointer`}
              >
                <option value="score">Relevance</option>
                <option value="downloads_desc">Most downloaded</option>
                <option value="rating_desc">Highest rated</option>
                <option value="created_desc">Newest first</option>
              </select>
            </div>
          </div>

          {/* Centre: results */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-0">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface-1 px-5 py-2.5 text-xs text-ink-dim">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold text-ink">
                  {totalCount !== null ? `${totalCount.toLocaleString()} results` : 'Searching...'}
                </span>
                {selectedTag !== 'All' && <span className={pill(true, 'h-6 cursor-default')}>#{selectedTag}</span>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-num text-[11px] text-ink-faint">Page {page} of {Math.max(1, totalPages)}</span>
                <button type="button" disabled={page <= 1 || isLoading} onClick={() => handlePageChange(page - 1)} title="Previous page" aria-label="Previous page" className={pill(false, 'w-7 px-0')}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button type="button" disabled={page >= totalPages || isLoading} onClick={() => handlePageChange(page + 1)} title="Next page" aria-label="Next page" className={pill(false, 'w-7 px-0')}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-2 overflow-y-auto p-4">
              {isLoading && (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-ink-dim">
                  <Loader2 className="h-6 w-6 animate-spin text-accent motion-reduce:animate-none" />
                  <span className="text-xs">Searching the CC0 library...</span>
                </div>
              )}

              {!isLoading && results.length === 0 && (
                <div className="flex h-64 flex-col items-center justify-center gap-2 text-ink-faint">
                  <Radio className="h-8 w-8 stroke-[1.5]" aria-hidden="true" />
                  <span className="text-sm text-ink-dim">No sounds match your filters.</span>
                  <span className="text-xs">Try another keyword or a wider length.</span>
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
                      className={`flex cursor-pointer items-center gap-3 rounded-control border p-3 transition-colors ${
                        isSelected ? 'border-accent/40 bg-surface-2' : 'border-line bg-surface-1 hover:bg-surface-2'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePreview(item);
                        }}
                        title={isPlaying ? 'Pause preview' : 'Play preview'}
                        aria-label={isPlaying ? `Pause ${item.name}` : `Play ${item.name}`}
                        className={pill(isPlaying, 'h-9 w-9 px-0')}
                      >
                        {isPlaying ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="truncate text-xs font-semibold text-ink">{item.name}</h4>
                          <span className="font-num shrink-0 text-[11px] text-ink-dim">{item.duration.toFixed(1)}s</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-ink-faint">
                          <span className="truncate">by {item.username}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-num uppercase">{item.type || 'WAV'}</span>
                        </div>
                        {item.images?.waveform_m && (
                          <div className="mt-2 h-7 w-full overflow-hidden rounded-control border border-line bg-surface-0">
                            <img src={item.images.waveform_m} alt="" className="h-full w-full object-cover opacity-70 transition-opacity hover:opacity-100" />
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        disabled={isDownloading}
                        onClick={(e) => {
                          e.stopPropagation();
                          addToTimeline(item, onAddLibraryTrack);
                        }}
                        className={pill(false, 'h-8 border-accent/40 text-accent hover:bg-accent-soft hover:text-accent')}
                      >
                        {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Download className="h-3.5 w-3.5" />}
                        <span>{isDownloading ? 'Adding...' : userToken ? 'Add track' : 'Connect to add'}</span>
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Right: inspector */}
          <div className="flex w-full shrink-0 flex-col gap-4 bg-surface-1 p-5 md:w-80 md:overflow-y-auto">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">Details</h3>

            {selectedItem ? (
              <div className="space-y-4 text-xs">
                <div>
                  <h4 className="text-sm font-semibold text-ink">{selectedItem.name}</h4>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[11px]">
                    <dt className="text-ink-faint">Creator</dt>
                    <dd className="truncate text-right text-ink">{selectedItem.username}</dd>
                    <dt className="text-ink-faint">Length</dt>
                    <dd className="font-num text-right text-ink">{selectedItem.duration.toFixed(2)} s</dd>
                    <dt className="text-ink-faint">Licence</dt>
                    <dd className="text-right text-ink">CC0, free to use</dd>
                    <dt className="text-ink-faint">Format</dt>
                    <dd className="font-num text-right uppercase text-ink">{selectedItem.type || 'WAV'}</dd>
                    <dt className="text-ink-faint">Sample rate</dt>
                    <dd className="font-num text-right text-ink">{selectedItem.samplerate ? `${selectedItem.samplerate} Hz` : '48000 Hz'}</dd>
                  </dl>
                </div>

                <div className="space-y-2 border-t border-line pt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => togglePreview(selectedItem)}
                    leftIcon={currentPlayingId === selectedItem.id ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                  >
                    {currentPlayingId === selectedItem.id ? 'Pause preview' : 'Play preview'}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full"
                    disabled={downloadingId === selectedItem.id}
                    onClick={() => addToTimeline(selectedItem, onAddLibraryTrack)}
                    leftIcon={downloadingId === selectedItem.id ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Download className="h-3.5 w-3.5" />}
                  >
                    {downloadingId === selectedItem.id ? downloadStatusMsg || 'Downloading...' : userToken ? 'Add to a new top track' : 'Connect Freesound to add'}
                  </Button>
                </div>

                {selectedItem.tags && selectedItem.tags.length > 0 && (
                  <div className="border-t border-line pt-4">
                    <span className={label}>Tags</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedItem.tags.map((t) => (
                        <span key={t} className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] text-ink-dim">#{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-xs text-ink-faint">Select a sound to see its details</div>
            )}
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={isOpen && isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        title="Connect Freesound account"
        description="Needed to download sounds onto your timeline. You can search and preview without it."
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setIsConnectModalOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              disabled={isExchangingCode || !authCodeInput.trim()}
              loading={isExchangingCode}
              onClick={async () => {
                const ok = await exchangeCode(authCodeInput.trim());
                if (ok) setAuthCodeInput('');
              }}
            >
              Authorize and save
            </Button>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-ink-dim">
          Freesound needs a free authorization code to give you the full-quality original file.
        </p>
        {connectError && <div className={`${notice('danger')} mt-3`} role="alert">{connectError}</div>}
        <div className="mt-4 space-y-4">
          <div>
            <span className={label}>Step 1</span>
            {authUrl ? (
              <a href={authUrl} target="_blank" rel="noopener noreferrer" className={pill(true, 'h-8')}>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Open the Freesound authorization page</span>
              </a>
            ) : (
              <button type="button" onClick={fetchAuthUrl} className={pill(true, 'h-8')}>Load the authorization link</button>
            )}
          </div>
          <Input
            label="Step 2: paste the authorization code"
            value={authCodeInput}
            onChange={(e) => setAuthCodeInput(e.target.value)}
            placeholder="Paste the code here"
          />
        </div>
      </ModalShell>
    </>
  );
};
