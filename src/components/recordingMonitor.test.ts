import { describe, expect, it } from 'vitest';
import { defaultModeFromSettings, duckDbForMode, isOtherTracksMode, takeStartSeconds } from './recordingMonitor';

describe('other tracks while recording', () => {
  it('ducks by the project ducking level', () => {
    expect(duckDbForMode('duck', -12)).toBe(-12);
    expect(duckDbForMode('duck', -6)).toBe(-6);
  });

  it('mutes completely, whatever the ducking level is', () => {
    expect(duckDbForMode('mute', -12)).toBe(Number.NEGATIVE_INFINITY);
    // The engine turns dB into linear gain this way; mute must land on exactly zero.
    expect(Math.pow(10, duckDbForMode('mute', -12)! / 20)).toBe(0);
  });

  it('leaves the other tracks alone when off', () => {
    expect(duckDbForMode('off', -12)).toBeNull();
  });

  it('defaults from the existing project switch', () => {
    expect(defaultModeFromSettings(true)).toBe('duck');
    expect(defaultModeFromSettings(false)).toBe('off');
  });

  it('only accepts the three known modes', () => {
    expect(isOtherTracksMode('duck')).toBe(true);
    expect(isOtherTracksMode('mute')).toBe(true);
    expect(isOtherTracksMode('off')).toBe(true);
    expect(isOtherTracksMode('loud')).toBe(false);
    expect(isOtherTracksMode(null)).toBe(false);
  });
});

describe('take start position', () => {
  it('uses the playhead at record start', () => {
    expect(takeStartSeconds(12.5)).toBe(12.5);
  });

  it('never returns a negative or non-finite start', () => {
    expect(takeStartSeconds(-3)).toBe(0);
    expect(takeStartSeconds(Number.NaN)).toBe(0);
    expect(takeStartSeconds(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
