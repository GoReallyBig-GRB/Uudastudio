import { describe, expect, it } from 'vitest';
import { checkRecording, isInAppBrowser } from './env';

const good = { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36', hasMediaDevices: true, isSecureContext: true, hasAudioContext: true };
describe('recording capability', () => {
  it('accepts a normal browser', () => expect(checkRecording(good).ok).toBe(true));
  it('flags in-app browsers', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) AppleWebKit Mobile/15E148 Instagram 300.0')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 13; wv) Chrome/119 Mobile Safari/537.36')).toBe(true);
    expect(isInAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17.0 Mobile Safari/604.1')).toBe(false);
    expect(checkRecording({ ...good, userAgent: 'x FBAN/FBIOS' }).problem).toMatch(/Open it in Chrome/);
  });
  it('explains missing microphone support and insecure addresses', () => {
    expect(checkRecording({ ...good, isSecureContext: false }).problem).toMatch(/https/);
    expect(checkRecording({ ...good, hasMediaDevices: false }).problem).toMatch(/cannot record/);
  });
});
