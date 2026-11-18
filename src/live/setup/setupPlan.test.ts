import { describe, expect, it } from 'vitest';
import { GEAR_IDS, classifyDevice, guessGear, inputWarning, recommend, suggestInput, type Gear } from './setupPlan';

describe('setup plan', () => {
  it('has advice for every kind of equipment', () => {
    for (const gear of GEAR_IDS) {
      const p = recommend({ goal: 'radio', gear, hostOnAirViaMixer: false });
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.connect.length).toBeGreaterThan(0);
    }
  });
  it('a podcast is a conversation, radio and on-air are broadcasts', () => {
    expect(recommend({ goal: 'podcast', gear: 'usb-mic', hostOnAirViaMixer: false }).mode).toBe('conversation');
    expect(recommend({ goal: 'radio', gear: 'usb-mic', hostOnAirViaMixer: false }).mode).toBe('broadcast');
    expect(recommend({ goal: 'on-air', gear: 'analog-desk', hostOnAirViaMixer: true }).mode).toBe('broadcast');
  });
  it('sends guests only when the host already goes on air through a mixer', () => {
    expect(recommend({ goal: 'on-air', gear: 'usb-mixer', hostOnAirViaMixer: true }).programContains).toBe('guests');
    expect(recommend({ goal: 'on-air', gear: 'usb-mixer', hostOnAirViaMixer: false }).programContains).toBe('all');
    expect(recommend({ goal: 'radio', gear: 'usb-mic', hostOnAirViaMixer: true }).programContains).toBe('all');
    expect(recommend({ goal: 'podcast', gear: 'usb-mixer', hostOnAirViaMixer: true }).programContains).toBe('all');
  });
  it('warns about Bluetooth and an analog desk without the gear for it', () => {
    expect(recommend({ goal: 'radio', gear: 'bluetooth', hostOnAirViaMixer: false }).warnings[0]).toMatch(/Bluetooth/);
    expect(recommend({ goal: 'on-air', gear: 'analog-desk', hostOnAirViaMixer: true }).needs[0]).toMatch(/USB audio interface/);
  });
  it('guesses the equipment from what the person can see', () => {
    expect(guessGear(['sliders', 'usb-cable'])).toEqual({ gear: 'usb-mixer', sure: true });
    expect(guessGear(['sliders'])).toEqual({ gear: 'analog-desk', sure: true });
    expect(guessGear(['xlr'])).toEqual({ gear: 'interface', sure: true });
    expect(guessGear(['usb-mic'])).toEqual({ gear: 'usb-mic', sure: true });
    expect(guessGear(['bluetooth']).gear).toBe('bluetooth');
    expect(guessGear([])).toEqual({ gear: 'laptop', sure: false });
  });
});

describe('finding the right input', () => {
  const devs = [
    { deviceId: 'default', label: 'Default - MacBook Pro Microphone' },
    { deviceId: 'a', label: 'MacBook Pro Microphone' },
    { deviceId: 'b', label: 'Scarlett 2i2 USB' },
    { deviceId: 'c', label: 'AirPods Pro' },
    { deviceId: 'd', label: 'BlackHole 2ch' },
  ];
  it('sorts device names into kinds', () => {
    expect(classifyDevice('AirPods Pro')).toBe('bluetooth');
    expect(classifyDevice('BlackHole 2ch')).toBe('virtual');
    expect(classifyDevice('MacBook Pro Microphone')).toBe('builtin');
    expect(classifyDevice('Scarlett 2i2 USB')).toBe('usb');
    expect(classifyDevice('Studio thing')).toBe('unknown');
  });
  it('suggests the device that matches the equipment', () => {
    const want = (g: Gear) => suggestInput(devs, g)?.deviceId;
    expect(want('usb-mixer')).toBe('b');
    expect(want('usb-mic')).toBe('b');
    expect(want('laptop')).toBe('a');
    expect(want('bluetooth')).toBe('c');
    expect(suggestInput([], 'usb-mic')).toBeNull();
  });
  it('warns when the chosen input does not look like the equipment', () => {
    expect(inputWarning('MacBook Pro Microphone', 'usb-mixer')).toMatch(/own microphone/);
    expect(inputWarning('AirPods Pro', 'usb-mic')).toMatch(/Bluetooth/);
    expect(inputWarning('BlackHole 2ch', 'usb-mic')).toMatch(/virtual/);
    expect(inputWarning('Scarlett 2i2 USB', 'usb-mic')).toBeNull();
    expect(inputWarning('MacBook Pro Microphone', 'laptop')).toBeNull();
  });
});
