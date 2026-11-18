import { describe, expect, it } from 'vitest';
import { bytesPerSecond, fitLabel, isStale, newRecordingId, parseJournal, recoverableFrames, secondsThatFit } from './recordingJournal';

describe('recording journal', () => {
  it('reads a valid journal and rejects damaged ones', () => {
    const j = parseJournal(JSON.stringify({ storeId: 'rec-1', sampleRate: 48000, channels: 2, startedAt: 5, name: 'Take' }));
    expect(j).toEqual({ storeId: 'rec-1', sampleRate: 48000, channels: 2, startedAt: 5, name: 'Take' });
    expect(parseJournal('not json')).toBeNull();
    expect(parseJournal(JSON.stringify({ storeId: '', sampleRate: 48000, channels: 2 }))).toBeNull();
    expect(parseJournal(JSON.stringify({ storeId: 'a', sampleRate: 5, channels: 2 }))).toBeNull();
    expect(parseJournal(JSON.stringify({ storeId: 'a', sampleRate: 48000, channels: 0 }))).toBeNull();
  });
  it('counts only the frames every channel has in full', () => {
    expect(recoverableFrames([4000, 4000])).toBe(1000);
    expect(recoverableFrames([4000, 3997])).toBe(999); // a half-written frame in one channel
    expect(recoverableFrames([])).toBe(0);
  });
  it('works out how much recording fits', () => {
    expect(bytesPerSecond(48000, 2)).toBe(384000);
    const fit = secondsThatFit(1_000_000_000, 48000, 1);
    expect(fit).toBe(Math.floor((1_000_000_000 - 64 * 1024 * 1024) / 192000));
    expect(secondsThatFit(10, 48000, 2)).toBe(0);
    expect(fitLabel(30)).toBe('less than a minute');
    expect(fitLabel(45 * 60)).toBe('45 min');
    expect(fitLabel(3 * 3600 + 20 * 60)).toBe('3 h 20 min');
    expect(fitLabel(2 * 3600)).toBe('2 h');
  });
  it('treats a folder as cut short only after it goes quiet', () => {
    expect(isStale(1000, 1000 + 5_000)).toBe(false);
    expect(isStale(1000, 1000 + 31_000)).toBe(true);
    expect(newRecordingId(7)).toMatch(/^rec-7-/);
  });
});
