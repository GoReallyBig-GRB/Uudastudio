import { describe, expect, it } from 'vitest';
import { blockedPickerMessage, isEmbeddedFrame, isPickerBlockedError, isPickerCancelled } from './fsAccess';

describe('fsAccess', () => {
  it('detects an embedded frame', () => {
    const w = {} as { self: unknown; top: unknown };
    w.self = w;
    w.top = w;
    expect(isEmbeddedFrame(w)).toBe(false);
    expect(isEmbeddedFrame({ self: w, top: {} })).toBe(true);
  });

  it('treats a throwing window.top as embedded', () => {
    const win = { self: {}, get top(): unknown { throw new Error('cross origin'); } };
    expect(isEmbeddedFrame(win)).toBe(true);
  });

  it('separates a blocked picker from a cancel', () => {
    expect(isPickerBlockedError({ name: 'SecurityError' })).toBe(true);
    expect(isPickerBlockedError({ name: 'NotAllowedError' })).toBe(true);
    expect(isPickerBlockedError({ name: 'AbortError' })).toBe(false);
    expect(isPickerCancelled({ name: 'AbortError' })).toBe(true);
    expect(isPickerCancelled(null)).toBe(false);
  });

  it('explains the embedded case differently', () => {
    expect(blockedPickerMessage(true)).toContain('own browser tab');
    expect(blockedPickerMessage(false)).not.toContain('embedded');
  });
});
