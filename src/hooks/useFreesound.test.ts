import { describe, expect, it } from 'vitest';
import { sharedSoundStore } from './useFreesound';
import type { FreesoundItem } from '../types';

const item = { id: 7, name: 'door', username: 'u', previews: { 'preview-hq-mp3': 'https://x/p.mp3' } } as unknown as FreesoundItem;

describe('adding a Freesound sound needs a connected account', () => {
  it('without a token it opens the connect dialog and downloads nothing', async () => {
    const urls: string[] = [];
    (globalThis as any).fetch = async (u: string) => { urls.push(String(u)); return { ok: false, json: async () => ({}) }; };
    sharedSoundStore.setUserToken(null);
    let added = false;
    await sharedSoundStore.addToTimeline(item, () => { added = true; });
    expect(added).toBe(false);
    expect(sharedSoundStore.getSnapshot().isConnectModalOpen).toBe(true);
    expect(sharedSoundStore.getSnapshot().downloadingId).toBeNull();
    expect(urls.every((u) => u.includes('/oauth/url'))).toBe(true); // only the sign-in link is requested, never a preview or download
  });
});
