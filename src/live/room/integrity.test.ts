import { describe, expect, it } from 'vitest';
import { DELIVERY_TEXT, alignmentNote, deliveryStatus } from './integrity';

describe('delivery check', () => {
  it('waits, receives and completes', () => {
    expect(deliveryStatus({ copySeconds: 60, offeredSeconds: null, done: false })).toBe('waiting');
    expect(deliveryStatus({ copySeconds: 60, offeredSeconds: 60, done: false })).toBe('receiving');
    expect(deliveryStatus({ copySeconds: 60, offeredSeconds: 59.5, done: true })).toBe('received');
  });
  it('flags a file that is clearly shorter than the call copy', () => {
    expect(deliveryStatus({ copySeconds: 600, offeredSeconds: 300, done: true })).toBe('short');
    expect(deliveryStatus({ copySeconds: 600, offeredSeconds: 300, done: false })).toBe('short');
  });
  it('allows a small difference and ignores very short takes', () => {
    expect(deliveryStatus({ copySeconds: 600, offeredSeconds: 575, done: true })).toBe('received');
    expect(deliveryStatus({ copySeconds: 20, offeredSeconds: 18.5, done: true })).toBe('received');
    expect(deliveryStatus({ copySeconds: 2, offeredSeconds: 0.1, done: true })).toBe('received');
  });
  it('speaks plainly and names the guest', () => {
    expect(DELIVERY_TEXT.short('Ada')).toMatch(/Ada's recording is shorter/);
    expect(DELIVERY_TEXT.waiting('Ada')).toMatch(/session backup/);
  });
  it('holds the big file while a guest is on the relay, and flags missing stretches', () => {
    expect(deliveryStatus({ copySeconds: 60, offeredSeconds: null, done: false, relayed: true })).toBe('held');
    expect(deliveryStatus({ copySeconds: 60, offeredSeconds: 60, done: true, complete: false })).toBe('gaps');
    expect(deliveryStatus({ copySeconds: 60, offeredSeconds: 60, done: true, complete: true })).toBe('received');
    expect(DELIVERY_TEXT.held('Ada')).toMatch(/relay/);
  });
  it('only mentions timing when it is clearly off', () => {
    const m = (offsetMs: number, driftPpm: number | null, confidence = 0.8) => ({ offsetMs, driftPpm, confidence, coverage: 1 });
    expect(alignmentNote(m(-300, 100), 0, 'Ada')).toBeNull();
    expect(alignmentNote(m(4000, 100), 0, 'Ada')).toMatch(/4\.0 seconds/);
    expect(alignmentNote(m(5200, 0), 5000, 'Ada')).toBeNull();
    expect(alignmentNote(m(0, 3000), 0, 'Ada')).toMatch(/drifts/);
    expect(alignmentNote(m(9000, 0, 0.1), 0, 'Ada')).toBeNull();
    expect(alignmentNote(null, 0, 'Ada')).toBeNull();
  });
});
