import { describe, expect, it } from 'vitest';
import { Bucket, Buckets } from './bucket';

describe('message bucket', () => {
  it('lets a burst through, then refuses until it refills', () => {
    const b = new Bucket(10, 5, 0);
    for (let i = 0; i < 10; i++) expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.strikes).toBe(1);
    expect(b.take(200)).toBe(true); // 200 ms refills one message at 5 a second
    expect(b.strikes).toBe(0);
  });
  it('never holds more than its capacity however long it rests', () => {
    const b = new Bucket(3, 100, 0);
    for (let i = 0; i < 3; i++) expect(b.take(1_000_000)).toBe(true);
    expect(b.take(1_000_000)).toBe(false);
  });
  it('keeps one bucket per connection and forgets it on close', () => {
    const bs = new Buckets(1, 0);
    expect(bs.take('a', 0).ok).toBe(true);
    expect(bs.take('a', 0).ok).toBe(false);
    expect(bs.take('b', 0).ok).toBe(true);
    bs.forget('a');
    expect(bs.take('a', 0).ok).toBe(true);
  });
});
