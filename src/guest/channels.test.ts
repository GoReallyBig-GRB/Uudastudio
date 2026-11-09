import { describe, expect, it } from 'vitest';
import { mixBlock, newMixState } from './channels';
import { isBluetoothLabel, toMicInfo } from './devices';

const tone = (n: number, amp: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i * 0.2));
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('channel mixing', () => {
  it('one channel is passed through untouched', () => {
    const l = tone(512, 0.5);
    expect(mixBlock(l, null, newMixState())).toEqual({ out: l, mode: 'mono' });
  });
  it('identical channels are averaged back to the same level', () => {
    const s = newMixState(), l = tone(512, 0.5);
    const r = mixBlock(l, l.slice(), s);
    expect(r.mode).toBe('both');
    expect(rms(r.out)).toBeCloseTo(rms(l), 6);
  });
  it('a silent right side does not halve the level: the live side is used as it is', () => {
    const s = newMixState(), l = tone(512, 0.5);
    const r = mixBlock(l, new Float32Array(512), s);
    expect(r.mode).toBe('left');
    expect(rms(r.out)).toBeCloseTo(rms(l), 6);
  });
  it('and the other way round', () => {
    const s = newMixState(), x = tone(512, 0.5);
    expect(mixBlock(new Float32Array(512), x, s).mode).toBe('right');
  });
  it('two different real channels are averaged', () => {
    const s = newMixState(), l = tone(512, 0.5), r = tone(512, 0.4);
    expect(mixBlock(l, r, s).mode).toBe('both');
  });
  it('a side that wakes up later is noticed as the old energy fades', () => {
    const s = newMixState(), l = tone(512, 0.5);
    for (let i = 0; i < 20; i++) mixBlock(l, new Float32Array(512), s);
    let mode = 'left';
    for (let i = 0; i < 400 && mode === 'left'; i++) mode = mixBlock(l, l.slice(), s).mode;
    expect(mode).toBe('both');
  });
});

describe('microphone labels', () => {
  it('recognises Bluetooth headsets', () => {
    expect(isBluetoothLabel('AirPods Pro')).toBe(true);
    expect(isBluetoothLabel('Headset Hands-Free (Bluetooth)')).toBe(true);
    expect(isBluetoothLabel('Samson Q2U USB Microphone')).toBe(false);
    expect(isBluetoothLabel('iPhone Microphone')).toBe(false);
  });
  it('names a mic even when the browser gives no label', () => {
    expect(toMicInfo({ deviceId: 'a', label: '' }, 1)).toEqual({ id: 'a', label: 'Microphone 2', bluetooth: false });
  });
});
