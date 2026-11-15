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

describe('the Freesound connection belongs to the signed-in account', () => {
  const reply = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  it('is forgotten on sign-out and asks for nothing while signed out', async () => {
    let calls = 0;
    (globalThis as any).fetch = async () => { calls++; return reply(200, { connected: false })(); };
    await sharedSoundStore.handleSignedInUser('account-a');
    sharedSoundStore.setUserToken('token-of-a');
    calls = 0;
    await sharedSoundStore.handleSignedInUser(null);
    expect(sharedSoundStore.getSnapshot().userToken).toBeNull();
    expect(calls).toBe(0);
  });

  it("does not carry one account's connection over to another account", async () => {
    (globalThis as any).fetch = reply(200, { connected: false });
    await sharedSoundStore.handleSignedInUser('account-a');
    sharedSoundStore.setUserToken('token-of-a');
    await sharedSoundStore.handleSignedInUser('account-b');
    expect(sharedSoundStore.getSnapshot().userToken).toBeNull();
  });

  it("takes the new account's own saved connection from the server", async () => {
    (globalThis as any).fetch = reply(200, { connected: true, access_token: 'token-of-c', expires_in: 3600 });
    await sharedSoundStore.handleSignedInUser(null);
    await sharedSoundStore.handleSignedInUser('account-c');
    expect(sharedSoundStore.getSnapshot().userToken).toBe('token-of-c');
  });

  it('drops a token the server no longer stands behind, and keeps it through a server error', async () => {
    (globalThis as any).fetch = reply(200, { connected: true, access_token: 'token-d', expires_in: 3600 });
    await sharedSoundStore.handleSignedInUser(null);
    await sharedSoundStore.handleSignedInUser('account-d');
    expect(sharedSoundStore.getSnapshot().userToken).toBe('token-d');
    (globalThis as any).fetch = reply(500, {});
    await sharedSoundStore.restoreConnection(true);
    expect(sharedSoundStore.getSnapshot().userToken).toBe('token-d');
    (globalThis as any).fetch = reply(401, {});
    await sharedSoundStore.restoreConnection(true);
    expect(sharedSoundStore.getSnapshot().userToken).toBeNull();
  });
});
