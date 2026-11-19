import { describe, expect, it } from 'vitest';
import { DELIVERY_TEXT, deliveryStatus } from './integrity';

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
    expect(DELIVERY_TEXT.waiting('Ada')).toMatch(/safe on this computer/);
  });
});
