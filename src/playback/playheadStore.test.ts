import { beforeEach, describe, expect, it } from 'vitest';
import { getPlayhead, setPlayhead, subscribePlayhead } from './playheadStore';

describe('playhead store', () => {
  beforeEach(() => setPlayhead(0));
  it('notifies subscribers only when the position changes', () => {
    let calls = 0;
    const off = subscribePlayhead(() => { calls++; });
    setPlayhead(1.5);
    setPlayhead(1.5);
    setPlayhead(2);
    expect(calls).toBe(2);
    expect(getPlayhead()).toBe(2);
    off();
    setPlayhead(3);
    expect(calls).toBe(2);
  });
});
