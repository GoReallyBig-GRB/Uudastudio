import { describe, expect, it } from 'vitest';
import { cleanName, uniqueName, writeInto } from './studioFolder';

class FakeFile { data: Blob | null = null; constructor(public name: string) {} async createWritable() { return { write: async (b: Blob) => { this.data = b; }, close: async () => {} }; } }
class FakeDir {
  dirs = new Map<string, FakeDir>(); files = new Map<string, FakeFile>();
  constructor(public name: string) {}
  async getDirectoryHandle(n: string) { if (!this.dirs.has(n)) this.dirs.set(n, new FakeDir(n)); return this.dirs.get(n)!; }
  async getFileHandle(n: string) { if (!this.files.has(n)) this.files.set(n, new FakeFile(n)); return this.files.get(n)!; }
  async *keys() { yield* this.dirs.keys(); yield* this.files.keys(); }
}

describe('names', () => {
  it('cleans folder and file names', () => {
    expect(cleanName('Intro: "spot"/v2?')).toBe('Intro_ _spot__v2_');
    expect(cleanName('..hidden. ')).toBe('hidden');
    expect(cleanName('   ')).toBe('Untitled');
  });
  it('never overwrites', () => {
    expect(uniqueName('a.wav', new Set())).toBe('a.wav');
    expect(uniqueName('a.wav', new Set(['a.wav']))).toBe('a (2).wav');
    expect(uniqueName('a.wav', new Set(['a.wav', 'a (2).wav']))).toBe('a (3).wav');
  });
});

describe('writeInto', () => {
  it('files go into Uuda Studio / Jobs / <job>, and a second copy does not replace the first', async () => {
    const root = new FakeDir('Uuda Studio');
    const p1 = await writeInto(root as any, ['Jobs', 'Intro spot'], 'take-1.wav', new Blob(['a']));
    const p2 = await writeInto(root as any, ['Jobs', 'Intro spot'], 'take-1.wav', new Blob(['b']));
    expect(p1).toBe('Uuda Studio / Jobs / Intro spot / take-1.wav');
    expect(p2).toBe('Uuda Studio / Jobs / Intro spot / take-1 (2).wav');
    const dir = root.dirs.get('Jobs')!.dirs.get('Intro spot')!;
    expect([...dir.files.keys()]).toEqual(['take-1.wav', 'take-1 (2).wav']);
  });
});
