/**
 * A person's Freesound connection, kept on the server so they connect once.
 * Freesound gives an access token (24 hours) and a refresh token. The refresh token renews the access token without
 * the person doing anything, and each renewal returns a new refresh token, so the stored one is replaced every time.
 * Both are stored encrypted (AES-GCM, key derived from the Worker's SESSION_SECRET), never in the browser's storage.
 */
import type { D1Full } from '../templates/store';

export interface FreesoundTokens { refresh: string; access: string; /** when the access token stops working, in ms */ expires: number }

export interface TokenStore {
  get(userId: string): Promise<FreesoundTokens | null>;
  put(userId: string, t: FreesoundTokens): Promise<void>;
  delete(userId: string): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  rows = new Map<string, FreesoundTokens>();
  async get(id: string) { return this.rows.get(id) ?? null; }
  async put(id: string, t: FreesoundTokens) { this.rows.set(id, t); }
  async delete(id: string) { this.rows.delete(id); }
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (u: Uint8Array) => { let s = ''; for (const b of u) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = (s: string) => { const t = atob(s.replace(/-/g, '+').replace(/_/g, '/')); const u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };

export interface Sealer { seal(v: unknown): Promise<string>; open<T>(s: string): Promise<T | null> }

/** Encrypts small JSON values. A wrong key, or a changed value, opens as null. */
export const makeSealer = (secret: string): Sealer => {
  let key: Promise<CryptoKey> | null = null;
  const getKey = () => (key ??= crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']).then((k) =>
    crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode('uuda'), info: enc.encode('freesound-tokens-v1') }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])));
  return {
    async seal(v) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getKey(), enc.encode(JSON.stringify(v))));
      const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
      return b64(out);
    },
    async open<T>(s: string) {
      try {
        const raw = unb64(s);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, await getKey(), raw.slice(12));
        return JSON.parse(dec.decode(pt)) as T;
      } catch { return null; }
    },
  };
};

const SCHEMA = 'CREATE TABLE IF NOT EXISTS freesound_tokens (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)';

/** D1 on the free plan: a connection is 1 write, a renewal (about once a day per person) is 1 write, a read is 1 read */
export class D1TokenStore implements TokenStore {
  private ready: Promise<unknown> | null = null;
  constructor(private db: D1Full, private sealer: Sealer, private now: () => number = Date.now) {}
  private init() { return (this.ready ??= this.db.exec(SCHEMA).catch((e) => { this.ready = null; throw e; })); }
  async get(userId: string) {
    await this.init();
    const r = await this.db.prepare('SELECT data FROM freesound_tokens WHERE user_id = ?').bind(userId).first<{ data: string }>();
    return r ? await this.sealer.open<FreesoundTokens>(r.data) : null;
  }
  async put(userId: string, t: FreesoundTokens) {
    await this.init();
    await this.db.prepare('INSERT INTO freesound_tokens (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(userId, await this.sealer.seal(t), this.now()).run();
  }
  async delete(userId: string) {
    await this.init();
    await this.db.prepare('DELETE FROM freesound_tokens WHERE user_id = ?').bind(userId).run();
  }
}
