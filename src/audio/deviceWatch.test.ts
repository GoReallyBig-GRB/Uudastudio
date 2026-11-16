import { describe, expect, it } from 'vitest';
import { kindOf, newDevices, shouldOpenOnLoad, signature, toDevices } from './deviceWatch';

const raw = [
  { deviceId: 'default', kind: 'audioinput', label: 'Default - Mic' },
  { deviceId: 'a', kind: 'audioinput', label: 'Microphone (Fduce SL40X)' },
  { deviceId: 'b', kind: 'audioinput', label: 'Internal Microphone' },
  { deviceId: 'c', kind: 'audiooutput', label: 'Speakers' },
  { deviceId: '', kind: 'audioinput', label: '' },
  { deviceId: 'v', kind: 'videoinput', label: 'Camera' },
];

describe('device lists', () => {
  it('drops aliases, id-less entries and cameras', () => {
    expect(toDevices(raw).map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });
  it('recognises kinds from labels', () => {
    expect(kindOf('Microphone (Fduce SL40X)', 'input')).toBe('usb');
    expect(kindOf('Scarlett 2i2 USB', 'input')).toBe('interface');
    expect(kindOf('Mackie ProFX12v3 USB', 'input')).toBe('mixer');
    expect(kindOf('Allen & Heath Qu-16', 'input')).toBe('mixer');
    expect(kindOf('Behringer X32', 'input')).toBe('mixer');
    expect(kindOf('RODECaster Pro II', 'input')).toBe('mixer');
    expect(kindOf('Pioneer DJ DDJ-FLX4', 'output')).toBe('deck');
    expect(kindOf('Numark Mixtrack Pro FX', 'output')).toBe('deck');
    expect(kindOf('Traktor Kontrol Z1', 'output')).toBe('deck');
    expect(kindOf('Internal Microphone (Realtek)', 'input')).toBe('builtin');
    expect(kindOf('AirPods Pro', 'output')).toBe('bluetooth');
    expect(kindOf('Headphones (Realtek)', 'output')).toBe('headphones');
    expect(kindOf('Internal Microphone', 'input')).toBe('builtin');
  });
  it('finds what was plugged in', () => {
    const before = new Set(['a', 'b', 'c']);
    expect(newDevices(before, toDevices([...raw, { deviceId: 'd', kind: 'audiooutput', label: 'Headphones' }])).map((d) => d.id)).toEqual(['d']);
    expect(newDevices(before, toDevices(raw))).toEqual([]);
  });
});

describe('opening on load', () => {
  const devs = toDevices(raw);
  it('opens the first time, and when the setup or the chosen mic changed, but not otherwise', () => {
    expect(shouldOpenOnLoad(devs, null, '')).toBe(true);
    expect(shouldOpenOnLoad(devs, signature(devs), '')).toBe(false);
    expect(shouldOpenOnLoad(devs, signature(devs.slice(1)), '')).toBe(true);
    expect(shouldOpenOnLoad(devs, signature(devs), 'gone')).toBe(true);
    expect(shouldOpenOnLoad(devs, signature(devs), 'a')).toBe(false);
  });
  it('stays closed when no device names are available yet', () => {
    expect(shouldOpenOnLoad([], null, '')).toBe(false);
  });
});
