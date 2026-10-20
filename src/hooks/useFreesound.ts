/**
 * X-PRO AUDIO - Shared Freesound & Sound Library Hook
 * Shared state between SoundLibraryPanel (sidebar) and SoundLibraryModal (expanded).
 * Coordinates CC0 audio search, preview player, OAuth connection, and timeline ingestion.
 */

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Asset, FreesoundItem } from '../types';
import { audioEngine } from '../audio/engine';
import { saveAssetToDB } from '../storage/db';

export interface SoundSource {
  id: string;
  label: string;
  enabled: boolean;
  search: (query: string, filters: SoundSearchFilters, page: number) => Promise<SoundSearchResult>;
}

export interface SoundSearchFilters {
  tag?: string;
  durationFilter?: 'any' | 'short' | 'medium' | 'long';
  minDuration?: number;
  maxDuration?: number;
  sort?: 'score' | 'downloads_desc' | 'rating_desc' | 'created_desc';
  pageSize?: number;
}

export interface SoundSearchResult {
  results: FreesoundItem[];
  totalCount: number;
  rateLimitRemaining?: number | null;
  rateLimitReset?: number | null;
}

export interface SharedSoundState {
  query: string;
  selectedTag: string;
  durationFilter: 'any' | 'short' | 'medium' | 'long';
  sortOrder: 'score' | 'downloads_desc' | 'rating_desc' | 'created_desc';
  page: number;
  pageSize: number;
  results: FreesoundItem[];
  totalCount: number | null;
  isLoading: boolean;
  searchError: string | null;
  rateLimitInfo: { remaining: number | null; resetSeconds: number | null } | null;
  userToken: string | null;
  currentPlayingId: number | null;
  downloadingId: number | null;
  downloadStatusMsg: string;
  isConnectModalOpen: boolean;
  authUrl: string | null;
  connectError: string | null;
  isExchangingCode: boolean;
}

const TOKEN_STORAGE_KEY = 'xpro_freesound_token';

// Singleton shared audio element for preview so only one preview plays at any time
let sharedAudioPreview: HTMLAudioElement | null = null;

class SharedSoundStore {
  private state: SharedSoundState;
  private listeners = new Set<() => void>();

  constructor() {
    let token: string | null = null;
    if (typeof window !== 'undefined') {
      token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    }

    this.state = {
      query: '',
      selectedTag: 'All',
      durationFilter: 'any',
      sortOrder: 'score',
      page: 1,
      pageSize: 20,
      results: [],
      totalCount: null,
      isLoading: false,
      searchError: null,
      rateLimitInfo: null,
      userToken: token,
      currentPlayingId: null,
      downloadingId: null,
      downloadStatusMsg: '',
      isConnectModalOpen: false,
      authUrl: null,
      connectError: null,
      isExchangingCode: false,
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        if (e.key === TOKEN_STORAGE_KEY) {
          this.state = { ...this.state, userToken: e.newValue };
          this.notify();
        }
      });
    }
  }

  public getSnapshot = (): SharedSoundState => this.state;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify() {
    for (const l of this.listeners) l();
  }

  public setState(updates: Partial<SharedSoundState>) {
    this.state = { ...this.state, ...updates };
    this.notify();
  }

  public setUserToken(token: string | null) {
    if (typeof window !== 'undefined') {
      if (token) {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    }
    this.setState({ userToken: token });
  }

  public stopPreview() {
    if (sharedAudioPreview) {
      sharedAudioPreview.pause();
      sharedAudioPreview.src = '';
    }
    this.setState({ currentPlayingId: null });
  }

  public togglePreview(item: FreesoundItem) {
    const previewUrl =
      item.previews['preview-hq-mp3'] ||
      item.previews['preview-hq-ogg'] ||
      item.previews['preview-lq-mp3'];

    if (!previewUrl) {
      this.setState({ searchError: 'Preview audio file is not available for this sound.' });
      return;
    }

    if (this.state.currentPlayingId === item.id) {
      this.stopPreview();
      return;
    }

    if (!sharedAudioPreview && typeof window !== 'undefined') {
      sharedAudioPreview = new Audio();
      sharedAudioPreview.onended = () => {
        this.setState({ currentPlayingId: null });
      };
      sharedAudioPreview.onerror = () => {
        this.setState({ currentPlayingId: null });
      };
    }

    if (sharedAudioPreview) {
      sharedAudioPreview.src = previewUrl;
      sharedAudioPreview.play().catch((err) => {
        console.warn('Audio play error:', err);
      });
      this.setState({ currentPlayingId: item.id });
    }
  }

  public async fetchSearch(overrideParams?: Partial<{
    query: string;
    tag: string;
    duration: 'any' | 'short' | 'medium' | 'long';
    sort: 'score' | 'downloads_desc' | 'rating_desc' | 'created_desc';
    page: number;
    pageSize: number;
  }>) {
    const q = overrideParams?.query !== undefined ? overrideParams.query : this.state.query;
    const tag = overrideParams?.tag !== undefined ? overrideParams.tag : this.state.selectedTag;
    const duration = overrideParams?.duration !== undefined ? overrideParams.duration : this.state.durationFilter;
    const sort = overrideParams?.sort !== undefined ? overrideParams.sort : this.state.sortOrder;
    const page = overrideParams?.page !== undefined ? overrideParams.page : this.state.page;
    const pageSize = overrideParams?.pageSize !== undefined ? overrideParams.pageSize : this.state.pageSize;

    this.setState({
      isLoading: true,
      searchError: null,
      query: q,
      selectedTag: tag,
      durationFilter: duration,
      sortOrder: sort,
      page,
      pageSize,
    });

    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('query', q.trim());
      if (tag && tag !== 'All') params.set('tag', tag.toLowerCase());

      if (duration === 'short') {
        params.set('minDuration', '0');
        params.set('maxDuration', '5');
      } else if (duration === 'medium') {
        params.set('minDuration', '5');
        params.set('maxDuration', '20');
      } else if (duration === 'long') {
        params.set('minDuration', '20');
        params.set('maxDuration', '300');
      }

      params.set('sort', sort);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));

      const res = await fetch(`/api/freesound/search?${params.toString()}`);

      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        this.setState({
          isLoading: false,
          searchError: data.error || 'Freesound rate limit reached (60 req/min). Please wait.',
        });
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Search failed with status ${res.status}`);
      }

      const data = await res.json();
      this.setState({
        results: data.results || [],
        totalCount: data.count ?? (data.results ? data.results.length : 0),
        isLoading: false,
        rateLimitInfo: data.rateLimitRemaining !== undefined ? {
          remaining: data.rateLimitRemaining,
          resetSeconds: data.rateLimitReset,
        } : null,
      });
    } catch (err: unknown) {
      console.error('Freesound search error:', err);
      this.setState({
        isLoading: false,
        searchError: err instanceof Error ? err.message : 'Search error occurred',
        results: [],
      });
    }
  }

  public async fetchAuthUrl(): Promise<string | null> {
    try {
      const res = await fetch('/api/freesound/oauth/url');
      if (res.ok) {
        const data = await res.json();
        if (data.authUrl) {
          this.setState({ authUrl: data.authUrl });
          return data.authUrl;
        }
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.error) this.setState({ connectError: data.error });
      }
    } catch (err) {
      console.warn('Could not fetch Freesound OAuth URL', err);
    }
    return null;
  }

  public async exchangeCode(code: string): Promise<boolean> {
    if (!code.trim()) {
      this.setState({ connectError: 'Please paste the authorization code from Freesound.' });
      return false;
    }

    this.setState({ isExchangingCode: true, connectError: null });

    try {
      const res = await fetch('/api/freesound/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to authorize code.');
      }

      const data = await res.json();
      if (data.access_token) {
        this.setUserToken(data.access_token);
        this.setState({
          isConnectModalOpen: false,
          isExchangingCode: false,
          connectError: null,
        });
        return true;
      }
      throw new Error('No access token received.');
    } catch (err: unknown) {
      this.setState({
        isExchangingCode: false,
        connectError: err instanceof Error ? err.message : 'Token exchange failed',
      });
      return false;
    }
  }

  public async addToTimeline(item: FreesoundItem, onAddLibraryTrack: (asset: Asset) => void) {
    if (!this.state.userToken) {
      this.setState({ isConnectModalOpen: true });
      this.fetchAuthUrl();
      return;
    }

    this.setState({
      downloadingId: item.id,
      downloadStatusMsg: `Downloading original audio (${item.name})...`,
    });

    try {
      const res = await fetch(`/api/freesound/download/${item.id}`, {
        headers: {
          Authorization: `Bearer ${this.state.userToken}`,
        },
      });

      if (res.status === 401) {
        this.setUserToken(null);
        this.setState({ isConnectModalOpen: true });
        throw new Error('Freesound session expired. Please connect your account again.');
      }

      if (res.status === 429) {
        throw new Error('Freesound download rate limit reached. Please wait.');
      }

      if (!res.ok) {
        throw new Error(`Failed to download audio file (${res.status})`);
      }

      this.setState({ downloadStatusMsg: 'Decoding audio into timeline...' });
      const arrayBuffer = await res.arrayBuffer();

      let decodedBuffer: AudioBuffer;
      try {
        decodedBuffer = await audioEngine.decodeAudio(arrayBuffer);
      } catch (decodeErr) {
        throw new Error(
          `Browser cannot decode format ${item.type || 'of file'}. Try a standard WAV or MP3 sound.`
        );
      }

      const newAssetId = `lib-${item.id}-${Date.now()}`;
      const newAsset: Asset = {
        id: newAssetId,
        name: `FX - ${item.name} (${item.username})`,
        kind: 'library',
        buffer: decodedBuffer,
        sampleRate: decodedBuffer.sampleRate,
        durationSeconds: decodedBuffer.duration,
        numberOfChannels: decodedBuffer.numberOfChannels,
      };

      audioEngine.registerAsset(newAsset);
      await saveAssetToDB(newAsset);

      onAddLibraryTrack(newAsset);

      this.setState({ downloadStatusMsg: 'Added to timeline!' });
      setTimeout(() => {
        this.setState({ downloadingId: null, downloadStatusMsg: '' });
      }, 1200);
    } catch (err: unknown) {
      console.error('Download error:', err);
      this.setState({
        downloadingId: null,
        downloadStatusMsg: '',
        searchError: err instanceof Error ? err.message : 'Error adding sound to timeline',
      });
    }
  }
}

export const sharedSoundStore = new SharedSoundStore();

export function useFreesound() {
  const state = useSyncExternalStore(
    sharedSoundStore.subscribe,
    sharedSoundStore.getSnapshot,
    sharedSoundStore.getSnapshot
  );

  return {
    ...state,
    setQuery: (q: string) => sharedSoundStore.setState({ query: q }),
    setSelectedTag: (tag: string) => sharedSoundStore.setState({ selectedTag: tag }),
    setDurationFilter: (d: 'any' | 'short' | 'medium' | 'long') =>
      sharedSoundStore.setState({ durationFilter: d }),
    setSortOrder: (s: 'score' | 'downloads_desc' | 'rating_desc' | 'created_desc') =>
      sharedSoundStore.setState({ sortOrder: s }),
    setPage: (p: number) => sharedSoundStore.setState({ page: p }),
    setIsConnectModalOpen: (open: boolean) => sharedSoundStore.setState({ isConnectModalOpen: open }),
    setSearchError: (err: string | null) => sharedSoundStore.setState({ searchError: err }),
    setUserToken: (t: string | null) => sharedSoundStore.setUserToken(t),
    search: (override?: any) => sharedSoundStore.fetchSearch(override),
    togglePreview: (item: FreesoundItem) => sharedSoundStore.togglePreview(item),
    stopPreview: () => sharedSoundStore.stopPreview(),
    fetchAuthUrl: () => sharedSoundStore.fetchAuthUrl(),
    exchangeCode: (code: string) => sharedSoundStore.exchangeCode(code),
    addToTimeline: (item: FreesoundItem, onAdd: (asset: Asset) => void) =>
      sharedSoundStore.addToTimeline(item, onAdd),
  };
}
