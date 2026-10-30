import { describe, expect, it } from 'vitest';
import type { Clip, Project } from '../types';
import { GROUP_PALETTE, colorFromHex, formatGroupSpan, groupColor, groupColorIndex, isHexColor, nextGroupColorIndex, nextGroupName, summarizeGroups, withAlpha } from './groupInfo';

const clip = (id: string, start: number, dur: number, groupId?: string): Clip => ({
  id, trackId: 't', assetId: 'a', name: id, startSeconds: start, offsetSeconds: 0, durationSeconds: dur,
  gain: 1, fadeInSeconds: 0, fadeOutSeconds: 0, fadeShape: 'linear', groupId,
});
const proj = (clipsA: Clip[], clipsB: Clip[] = [], groupSettings?: Project['groupSettings']) =>
  ({ tracks: [{ id: 'A', clips: clipsA }, { id: 'B', clips: clipsB }], groupSettings }) as unknown as Project;

describe('summarizeGroups', () => {
  it('counts clips and spans first start to last end, across tracks', () => {
    const p = proj([clip('a', 2, 3, 'g'), clip('x', 0, 1)], [clip('b', 10, 4, 'g')]);
    const [g] = summarizeGroups(p);
    expect(g.clipCount).toBe(2);
    expect(g.trackCount).toBe(2);
    expect(g.startSeconds).toBe(2);
    expect(g.endSeconds).toBe(14);
    expect(g.durationSeconds).toBe(12); // not 3 + 4
    expect(g.clipIds.sort()).toEqual(['a', 'b']);
  });

  it('lists groups in creation order by name and skips groups with no clips', () => {
    const p = proj([clip('a', 5, 1, 'g2'), clip('b', 0, 1, 'g1')], [], {
      g1: { volume: 1, pan: 0, muted: false, name: 'Group 2' },
      g2: { volume: 1, pan: 0, muted: false, name: 'Group 1' },
      gone: { volume: 1, pan: 0, muted: false, name: 'Group 3' },
    });
    expect(summarizeGroups(p).map((g) => g.id)).toEqual(['g2', 'g1']);
  });
});

describe('group colour and name', () => {
  it('gives each new group the least used colour, so colours are not repeated until the palette is full', () => {
    const settings: NonNullable<Project['groupSettings']> = {};
    const clips: Clip[] = [];
    const used = new Set<number>();
    for (let i = 0; i < GROUP_PALETTE.length; i++) {
      const p = proj(clips, [], settings);
      const idx = nextGroupColorIndex(p);
      expect(used.has(idx)).toBe(false);
      used.add(idx);
      settings['g' + i] = { volume: 1, pan: 0, muted: false, color: idx };
      clips.push(clip('c' + i, i, 1, 'g' + i));
    }
    expect(used.size).toBe(GROUP_PALETTE.length);
  });

  it('keeps a stored colour and falls back to a stable one', () => {
    const p = proj([clip('a', 0, 1, 'gx')], [], { gx: { volume: 1, pan: 0, muted: false, color: 3 } });
    expect(groupColorIndex(p, 'gx')).toBe(3);
    expect(groupColorIndex(proj([]), 'zzz')).toBe(groupColorIndex(proj([]), 'zzz'));
  });

  it('names the next group one above the highest number in use', () => {
    expect(nextGroupName(proj([]))).toBe('Group 1');
    const p = proj([clip('a', 0, 1, 'g1'), clip('b', 0, 1, 'g2')], [], {
      g1: { volume: 1, pan: 0, muted: false, name: 'Group 1' },
      g2: { volume: 1, pan: 0, muted: false, name: 'Group 4' },
    });
    expect(nextGroupName(p)).toBe('Group 5');
  });
});

describe('formatGroupSpan', () => {
  it('formats short and long spans', () => {
    expect(formatGroupSpan(0)).toBe('0.0s');
    expect(formatGroupSpan(12.34)).toBe('12.3s');
    expect(formatGroupSpan(65.2)).toBe('1:05.2');
    expect(formatGroupSpan(723)).toBe('12:03');
  });
});

describe('custom colours', () => {
  it('accepts only #rrggbb', () => {
    expect(isHexColor('#a1B2c3')).toBe(true);
    expect(isHexColor('#abc')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(isHexColor(3)).toBe(false);
  });

  it('derives a border, a dark body and a lighter waveform from the picked colour', () => {
    const c = colorFromHex('#ff0000');
    expect(c.border).toBe('#ff0000');
    expect(c.fill.startsWith('rgba(')).toBe(true);
    expect(c.wave).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.wave).not.toBe('#ff0000');
  });

  it('a group with a picked colour uses it, keeps no palette slot, and does not shift the others', () => {
    const p = proj([clip('a', 0, 1, 'g1'), clip('b', 0, 1, 'g2')], [], {
      g1: { volume: 1, pan: 0, muted: false, color: '#123456' },
      g2: { volume: 1, pan: 0, muted: false, color: 0 },
    });
    expect(groupColorIndex(p, 'g1')).toBe(-1);
    expect(groupColor(p, 'g1').border).toBe('#123456');
    expect(summarizeGroups(p).find((g) => g.id === 'g1')?.colorIndex).toBe(-1);
    expect(nextGroupColorIndex(p)).not.toBe(0); // palette slot 0 is still taken by g2
  });

  it('keeps list order when a group is renamed', () => {
    const p = proj([clip('a', 5, 1, 'g2'), clip('b', 0, 1, 'g1')], [], {
      g1: { volume: 1, pan: 0, muted: false, name: 'Drums', order: 1 },
      g2: { volume: 1, pan: 0, muted: false, name: 'Atmos', order: 2 },
    });
    expect(summarizeGroups(p).map((g) => g.name)).toEqual(['Drums', 'Atmos']);
    expect(nextGroupName(p)).toBe('Group 3');
  });

  it('withAlpha builds an rgba string', () => {
    expect(withAlpha('#ff8000', 0.5)).toBe('rgba(255, 128, 0, 0.5)');
  });
});
