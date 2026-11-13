import { describe, expect, it } from 'vitest';
import { pickMics } from './devices';
import { systemDefaults, toDevices, withoutDefaultTwin } from '../audio/deviceWatch';

const d = (deviceId: string, label: string, groupId: string, kind = 'audioinput') => ({ deviceId, label, groupId, kind });

describe('system default and its real device', () => {
  const desktop = [
    d('default', 'Default - Internal Microphone (Conexant ISST Audio)', 'g1'),
    d('communications', 'Communications - Internal Microphone (Conexant ISST Audio)', 'g1'),
    d('aaa', 'Internal Microphone (Conexant ISST Audio)', 'g1'),
    d('bbb', 'Fduce Microphone (USB)', 'g2'),
  ];
  it('lists the built-in microphone once, and still offers the other ones', () => {
    const { mics, defaultLabel } = pickMics(desktop);
    expect(mics.map((m) => m.label)).toEqual(['Fduce Microphone (USB)']);
    expect(defaultLabel).toBe('Internal Microphone (Conexant ISST Audio)');
  });
  it('when a USB microphone becomes the default, the built-in one is offered separately', () => {
    const list = [d('default', 'Default - Fduce Microphone (USB)', 'g2'), d('aaa', 'Internal Microphone (Conexant ISST Audio)', 'g1'), d('bbb', 'Fduce Microphone (USB)', 'g2')];
    const { mics, defaultLabel } = pickMics(list);
    expect(mics.map((m) => m.label)).toEqual(['Internal Microphone (Conexant ISST Audio)']);
    expect(defaultLabel).toBe('Fduce Microphone (USB)');
  });
  it('a phone that only shows a default entry keeps it as the one choice, named', () => {
    const { mics, defaultLabel } = pickMics([d('default', 'Default - USB Audio Device', 'g9')]);
    expect(mics).toEqual([]);
    expect(defaultLabel).toBe('USB Audio Device');
  });
  it('treats an entry labelled "Default audio input device" as an alias, not a microphone', () => {
    const { mics } = pickMics([d('x1', 'Default audio input device', 'g1'), d('x2', 'Phone microphone', 'g2')]);
    expect(mics.map((m) => m.label)).toEqual(['Phone microphone']);
  });
  it('keeps devices whose group is unknown', () => {
    const { mics } = pickMics([d('default', 'Default - A', ''), d('a', 'A', ''), d('b', 'B', '')]);
    expect(mics).toHaveLength(2);
  });
  it('works per direction on the desktop list', () => {
    const raw = [...desktop, d('default', 'Default - Speakers (Realtek)', 'o1', 'audiooutput'), d('o2', 'Speakers (Realtek)', 'o1', 'audiooutput'), d('o3', 'Headphones (USB)', 'o3', 'audiooutput')];
    const devs = withoutDefaultTwin(toDevices(raw), systemDefaults(raw));
    expect(devs.map((x) => x.label)).toEqual(['Fduce Microphone (USB)', 'Headphones (USB)']);
  });
});
