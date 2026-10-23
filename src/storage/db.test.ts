import { describe, expect, it } from 'vitest';
import { projectStorageKeyForSession } from './db';

describe('per-tab project storage keys', () => {
  it('keeps separate tabs on separate autosave slots', () => {
    expect(projectStorageKeyForSession('tab-a')).toBe('session:tab-a');
    expect(projectStorageKeyForSession('tab-b')).toBe('session:tab-b');
    expect(projectStorageKeyForSession('tab-a')).not.toBe(projectStorageKeyForSession('tab-b'));
  });
});
