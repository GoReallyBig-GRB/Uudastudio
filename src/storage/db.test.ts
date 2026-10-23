import { describe, expect, it } from 'vitest';
import {
  isSessionProjectExpired,
  MAX_SESSION_AGE_MS,
  projectStorageKeyForSession,
} from './db';

describe('per-tab project autosave lifecycle', () => {
  it('uses a distinct IndexedDB key for each tab session', () => {
    expect(projectStorageKeyForSession('tab-a')).toBe('session:tab-a');
    expect(projectStorageKeyForSession('tab-a')).not.toBe(projectStorageKeyForSession('tab-b'));
  });

  it('keeps a session snapshot while it is within the recovery window', () => {
    const now = 1_800_000_000_000;
    expect(isSessionProjectExpired(now - MAX_SESSION_AGE_MS + 1, now)).toBe(false);
    expect(isSessionProjectExpired(now, now)).toBe(false);
  });

  it('expires snapshots older than the recovery window', () => {
    const now = 1_800_000_000_000;
    expect(isSessionProjectExpired(now - MAX_SESSION_AGE_MS - 1, now)).toBe(true);
  });

  it('treats snapshots without a valid timestamp as expired', () => {
    const now = 1_800_000_000_000;
    expect(isSessionProjectExpired(undefined, now)).toBe(true);
    expect(isSessionProjectExpired(Number.NaN, now)).toBe(true);
  });
});
