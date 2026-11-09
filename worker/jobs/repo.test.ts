import { describe, expect, it } from 'vitest';
import { MemoryRepo, SqlRepo, type JobRepo, type Sql } from './repo';

/** A real SQLite for the tests: node's built-in one, or Bun's. If neither exists the SQL half is skipped. */
const openSql = async (): Promise<Sql | null> => {
  try {
    const { DatabaseSync } = await import('node:sqlite' as string);
    const db = new DatabaseSync(':memory:');
    return { exec: (q: string, ...b: unknown[]) => { const s = db.prepare(q); const bind = b.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x)); return /^\s*select|returning/i.test(q) ? { toArray: () => s.all(...bind) } : (s.run(...bind), { toArray: () => [] }); } };
  } catch { /* try Bun */ }
  try {
    const { Database } = await import('bun:sqlite' as string);
    const db = new Database(':memory:');
    return { exec: (q: string, ...b: unknown[]) => { const s = db.query(q); const bind = b.map((x) => (x instanceof ArrayBuffer ? new Uint8Array(x) : x)); return /^\s*select|returning/i.test(q) ? { toArray: () => s.all(...bind) } : (s.run(...bind), { toArray: () => [] }); } };
  } catch { return null; }
};

const sqlAvailable = (await openSql()) !== null;
const makers: [string, () => Promise<JobRepo>][] = [
  ['memory', async () => new MemoryRepo()],
  ['sql', async () => new SqlRepo((await openSql())!)],
];

for (const [label, make] of makers) {
  describe.skipIf(label === 'sql' && !sqlAvailable)(`job storage (${label})`, () => {
    it('keeps the job, keys and revocation', async () => {
      const r = await make();
      expect(r.getJob()).toBeNull();
      r.putJob({ title: 'T', script: 'S', notes: 'N', producer: 'P', targetSeconds: 30, createdAt: 5, referenceAtt: null });
      expect(r.getJob()).toEqual({ title: 'T', script: 'S', notes: 'N', producer: 'P', targetSeconds: 30, createdAt: 5, referenceAtt: null });
      r.setKey('talent', 'abc'); r.setKey('producer', 'def'); r.revokeKey('talent');
      expect(r.getKeys().sort((a, b) => a.role.localeCompare(b.role))).toEqual([{ role: 'producer', key: 'def', revoked: false }, { role: 'talent', key: 'abc', revoked: true }]);
    });
    it('numbers messages in order and pages by id', async () => {
      const r = await make();
      const ids = [1, 2, 3].map((i) => r.addMessage({ ts: i, thread: 'talent', role: 'talent', name: 'n', text: `m${i}`, att: null }));
      r.addMessage({ ts: 9, thread: 'client', role: 'producer', name: 'n', text: 'other thread', att: null });
      expect(ids[2]).toBeGreaterThan(ids[0]);
      expect(r.messagesAfter('talent', ids[0], 10).map((m) => m.text)).toEqual(['m2', 'm3']);
      expect(r.messagesAfter('talent', 0, 2)).toHaveLength(2);
      expect(r.lastMessageId('talent')).toBe(ids[2]);
      expect(r.messageCount()).toBe(4);
    });
    it('stores, reads, counts and deletes audio pieces', async () => {
      const r = await make();
      r.addAtt({ id: 'a1', name: 'x.wav', mime: 'audio/wav', bytes: 7, ts: 1 });
      r.putChunk('a1', 0, new Uint8Array([1, 2, 3, 4])); r.putChunk('a1', 1, new Uint8Array([5, 6, 7]));
      expect(Array.from(r.getChunk('a1', 1)!)).toEqual([5, 6, 7]);
      expect(r.getChunk('a1', 2)).toBeNull();
      expect(r.totalBytes()).toBe(7);
      expect(r.getAtt('a1')?.name).toBe('x.wav');
      r.deleteAtt('a1');
      expect([r.getAtt('a1'), r.getChunk('a1', 0), r.totalBytes()]).toEqual([null, null, 0]);
    });
    it('can point the job at a reference recording', async () => {
      const r = await make();
      r.putJob({ title: 'T', script: '', notes: '', producer: '', targetSeconds: null, createdAt: 1, referenceAtt: null });
      r.setReference('att9');
      expect(r.getJob()?.referenceAtt).toBe('att9');
      r.setReference(null);
      expect(r.getJob()?.referenceAtt).toBeNull();
    });
  });
}
