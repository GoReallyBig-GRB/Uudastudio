import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { HistoryManager } from './historyManager';

const proj = (asset: string, tag = 0): Project =>
  ({ name: `p${tag}`, tracks: [{ id: 't', clips: [{ id: 'c', assetId: asset }] }] } as unknown as Project);

describe('history with processed copies of long audio', () => {
  it('keeps the limit, undoes back to the original, and reports copies nothing needs', () => {
    const h = new HistoryManager(proj('orig'));
    const gone: string[] = [];
    h.setPolicy({
      processedMinutes: (id) => (id.startsWith('P') ? 90 : undefined),
      limitFor: () => 2,
      onUnreferenced: (ids) => gone.push(...ids),
    });
    for (const a of ['P1', 'P2', 'P3', 'P4']) h.pushState(proj(a));
    // 2 copies alive: P4 (now) and P3
    expect(gone.sort()).toEqual(['P1', 'P2']);
    let steps = 0;
    while (h.undo()) steps++;
    expect(steps).toBe(1); // back to the state with P3
  });
  it('light edits are never limited', () => {
    const h = new HistoryManager(proj('orig'));
    h.setPolicy({ processedMinutes: () => undefined, limitFor: () => 1 });
    for (let i = 1; i <= 10; i++) h.pushState(proj('orig', i));
    let steps = 0;
    while (h.undo()) steps++;
    expect(steps).toBe(10);
  });
  it('a new edit after undo frees the copies only the discarded redo states used', () => {
    const h = new HistoryManager(proj('orig'));
    const gone: string[] = [];
    h.setPolicy({ processedMinutes: (id) => (id.startsWith('P') ? 5 : undefined), limitFor: () => null, onUnreferenced: (ids) => gone.push(...ids) });
    h.pushState(proj('P1'));
    h.undo();
    h.pushState(proj('orig', 9));
    expect(gone).toEqual(['P1']);
  });
});
