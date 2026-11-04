import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { HistoryManager } from './historyManager';
import { undoLeftProcessingInPlace } from './historyLimits';

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
    expect(steps).toBe(2); // back to the state with P3, then the last Undo returns to the original
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

  it('when the steps run out, the last Undo returns to the original and Redo comes back', () => {
    const h = new HistoryManager(proj('orig'));
    h.setPolicy({ processedMinutes: (id) => (id.startsWith('P') ? 90 : undefined), limitFor: () => 1 });
    for (const a of ['P1', 'P2', 'P3']) h.pushState(proj(a));
    // Only P3 is kept; the steps in between are gone
    expect(h.canUndo()).toBe(true);
    expect(h.nextUndoIsOriginal()).toBe(true);
    const back = h.undo();
    expect(back?.tracks[0].clips[0].assetId).toBe('orig');
    expect(h.isAtOriginalAnchor()).toBe(true);
    expect(h.canUndo()).toBe(false);
    expect(h.undo()).toBe(null);
    const fwd = h.redo();
    expect(fwd?.tracks[0].clips[0].assetId).toBe('P3');
    expect(h.isAtOriginalAnchor()).toBe(false);
  });
  it('a new edit made at the original keeps working', () => {
    const h = new HistoryManager(proj('orig'));
    h.setPolicy({ processedMinutes: (id) => (id.startsWith('P') ? 90 : undefined), limitFor: () => 1 });
    for (const a of ['P1', 'P2']) h.pushState(proj(a));
    h.undo();
    h.pushState(proj('orig', 5));
    expect(h.undo()?.tracks[0].clips[0].assetId).toBe('orig');
  });

  it('falls back to the state just before the FIRST processing, keeping the edits made before it', () => {
    const h = new HistoryManager(proj('orig', 0));
    h.setPolicy({ processedMinutes: (id) => (id.startsWith('P') ? 150 : undefined), limitFor: () => 1 });
    h.pushState(proj('orig', 1)); // a cut
    h.pushState(proj('orig', 2)); // another cut: the state before the first effect
    for (const [a, t] of [['P1', 3], ['P2', 4], ['P3', 5], ['P4', 6], ['P5', 7]] as const) h.pushState(proj(a, t));
    expect(h.nextUndoIsOriginal()).toBe(true);
    const back = h.undo();
    expect(back?.name).toBe('p2'); // not p0, the very first state
    expect(back?.tracks[0].clips[0].assetId).toBe('orig');
    expect(h.isAtOriginalAnchor()).toBe(true);
  });
  it('needs no fallback when the state before the first effect is still in the steps', () => {
    const h = new HistoryManager(proj('orig', 0));
    h.setPolicy({ processedMinutes: (id) => (id.startsWith('P') ? 150 : undefined), limitFor: () => 2 });
    h.pushState(proj('P1', 1));
    h.pushState(proj('P2', 2));
    let steps = 0;
    while (h.undo()) steps++;
    expect(steps).toBe(2);
    expect(h.isAtOriginalAnchor()).toBe(false);
  });

  describe('a 127 minute track (limit 1): what Undo does', () => {
    const long = (h: HistoryManager) =>
      h.setPolicy({ processedMinutes: (id) => (id.startsWith('P') ? 127 : undefined), limitFor: () => 1 });
    const isP = (id: string) => id.startsWith('P');
    const assetOf = (p: Project | null) => p?.tracks[0].clips[0].assetId;

    it('one effect then five light edits: five Undos only reach the state with the effect still applied', () => {
      const h = new HistoryManager(proj('orig'));
      long(h);
      h.pushState(proj('P1'));
      for (let i = 1; i <= 5; i++) h.pushState(proj('P1', i)); // five cuts / level changes after the effect
      let last: Project | null = null;
      let before = h.getPresent();
      let stillProcessed = 0;
      for (let i = 0; i < 5; i++) {
        last = h.undo();
        if (last && undoLeftProcessingInPlace(before, last, isP)) stillProcessed++;
        before = last ?? before;
      }
      expect(assetOf(last)).toBe('P1'); // the effect is still there after five Undos
      expect(stillProcessed).toBe(5); // every one of the five Undos only reverted a light edit; the effect stayed
      expect(h.canUndo()).toBe(true);
      expect(assetOf(h.undo())).toBe('orig'); // the sixth Undo is the one that removes the effect
    });

    it('two effects in a row: one Undo goes back to the unprocessed audio, and says so beforehand', () => {
      const h = new HistoryManager(proj('orig'));
      long(h);
      h.pushState(proj('P1'));
      h.pushState(proj('P2'));
      expect(h.nextUndoIsOriginal()).toBe(true); // the app asks for confirmation here
      expect(assetOf(h.undo())).toBe('orig');
      expect(h.canUndo()).toBe(false);
    });

    it('a notice is raised each time the history is shortened', () => {
      const h = new HistoryManager(proj('orig'));
      const limited: number[] = [];
      h.setPolicy({
        processedMinutes: (id) => (id.startsWith('P') ? 127 : undefined),
        limitFor: () => 1,
        onLimited: (l) => limited.push(l),
      });
      h.pushState(proj('P1'));
      expect(limited).toEqual([]); // one processed copy is within the limit
      h.pushState(proj('P2'));
      expect(limited).toEqual([1]);
    });
  });

  it('undoLeftProcessingInPlace is false when the Undo removed the processing, or there was none', () => {
    const isP = (id: string) => id.startsWith('P');
    expect(undoLeftProcessingInPlace(proj('P1'), proj('orig'), isP)).toBe(false);
    expect(undoLeftProcessingInPlace(proj('orig', 1), proj('orig', 2), isP)).toBe(false);
    expect(undoLeftProcessingInPlace(proj('P1', 1), proj('P1', 2), isP)).toBe(true);
  });
});
