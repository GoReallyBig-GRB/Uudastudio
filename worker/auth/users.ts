/**
 * Where accounts are kept. A small interface with two implementations: memory (tests, local) and Cloudflare D1 (SQLite).
 * Only this file knows the storage; moving to Postgres later means writing one more class here.
 * Costs on D1's free plan: a sign-in is 1 read and at most 1 write; a signed-in call is 1 read; last-active is written at most once an hour.
 */
export interface Preferences { defaultVoice: string; defaultModel: string; defaultDelivery: string; autoRefresh: boolean }

export interface UserRow {
  id: string; email: string; display_name: string; photo_url: string; role: 'user' | 'admin';
  created_at: string; last_active_at: string; blocked: boolean; preferences: Preferences;
  /** Session tokens issued before this time (ms) no longer work. Set on sign-out. */
  validAfter: number;
}

export const DEFAULT_PREFERENCES: Preferences = { defaultVoice: 'Zephyr', defaultModel: 'gemini-3.8-flash-tts', defaultDelivery: 'Clear broadcast style', autoRefresh: true };

/** The user as the browser sees it: no internal fields */
export const publicUser = (u: UserRow) => { const { validAfter: _v, ...rest } = u; return rest; };

export interface UserStore {
  get(id: string): Promise<UserRow | null>;
  /** Makes the user on first sign-in; later ones refresh name and photo. Never changes the email or role of an existing user. */
  signIn(p: { id: string; email: string; name: string; photo: string; role: 'user' | 'admin'; now: number }): Promise<{ user: UserRow; isNew: boolean }>;
  update(id: string, p: { display_name?: string; preferences?: Partial<Preferences> }): Promise<UserRow | null>;
  /** Sign out everywhere: tokens issued before `ms` stop working */
  revokeBefore(id: string, ms: number): Promise<void>;
}

/** Last-active is written at most this often, to spare D1's write allowance */
export const ACTIVE_WRITE_MS = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s : '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const cleanPrefs = (cur: Preferences, p: Partial<Preferences> | undefined): Preferences => ({
  defaultVoice: p && typeof p.defaultVoice === 'string' ? clean(p.defaultVoice, 60) || cur.defaultVoice : cur.defaultVoice,
  defaultModel: p && typeof p.defaultModel === 'string' ? clean(p.defaultModel, 80) || cur.defaultModel : cur.defaultModel,
  defaultDelivery: p && typeof p.defaultDelivery === 'string' ? clean(p.defaultDelivery, 120) || cur.defaultDelivery : cur.defaultDelivery,
  autoRefresh: p && typeof p.autoRefresh === 'boolean' ? p.autoRefresh : cur.autoRefresh,
});

export class MemoryUserStore implements UserStore {
  users = new Map<string, UserRow>();
  async get(id: string) { return this.users.get(id) ?? null; }
  async signIn(p: Parameters<UserStore['signIn']>[0]) {
    const old = this.users.get(p.id);
    if (old) {
      const next = { ...old, display_name: old.display_name || clean(p.name, 120), photo_url: clean(p.photo, 500) || old.photo_url, last_active_at: iso(p.now) };
      this.users.set(p.id, next);
      return { user: next, isNew: false };
    }
    const user: UserRow = { id: p.id, email: p.email, display_name: clean(p.name, 120) || p.email.split('@')[0], photo_url: clean(p.photo, 500), role: p.role, created_at: iso(p.now), last_active_at: iso(p.now), blocked: false, preferences: { ...DEFAULT_PREFERENCES }, validAfter: 0 };
    this.users.set(p.id, user);
    return { user, isNew: true };
  }
  async update(id: string, p: { display_name?: string; preferences?: Partial<Preferences> }) {
    const u = this.users.get(id); if (!u) return null;
    const next = { ...u, display_name: p.display_name !== undefined ? clean(p.display_name, 120) || u.display_name : u.display_name, preferences: cleanPrefs(u.preferences, p.preferences) };
    this.users.set(id, next); return next;
  }
  async revokeBefore(id: string, ms: number) { const u = this.users.get(id); if (u) this.users.set(id, { ...u, validAfter: Math.max(u.validAfter, ms) }); }
}

/** The parts of Cloudflare's D1 binding that are used */
export interface D1Like {
  prepare(q: string): { bind(...v: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown> } };
  exec(q: string): Promise<unknown>;
}

const SCHEMA = 'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, photo_url TEXT NOT NULL DEFAULT \'\', role TEXT NOT NULL DEFAULT \'user\', created_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL, blocked INTEGER NOT NULL DEFAULT 0, prefs TEXT NOT NULL, valid_after INTEGER NOT NULL DEFAULT 0)';

const fromRow = (r: Record<string, unknown>): UserRow => {
  let prefs = DEFAULT_PREFERENCES;
  try { prefs = cleanPrefs(DEFAULT_PREFERENCES, JSON.parse(String(r.prefs))); } catch { /* defaults */ }
  return { id: String(r.id), email: String(r.email), display_name: String(r.display_name), photo_url: String(r.photo_url ?? ''), role: r.role === 'admin' ? 'admin' : 'user', created_at: iso(Number(r.created_at)), last_active_at: iso(Number(r.last_active_at)), blocked: Number(r.blocked) === 1, preferences: prefs, validAfter: Number(r.valid_after) || 0 };
};

export class D1UserStore implements UserStore {
  private ready: Promise<unknown> | null = null;
  constructor(private db: D1Like) {}
  private init() { return (this.ready ??= this.db.exec(SCHEMA).catch((e) => { this.ready = null; throw e; })); }
  async get(id: string) { await this.init(); const r = await this.db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first(); return r ? fromRow(r) : null; }
  async signIn(p: Parameters<UserStore['signIn']>[0]) {
    await this.init();
    const old = await this.get(p.id);
    if (old) {
      if (p.now - Date.parse(old.last_active_at) >= ACTIVE_WRITE_MS) await this.db.prepare('UPDATE users SET last_active_at = ?, photo_url = ? WHERE id = ?').bind(p.now, clean(p.photo, 500) || old.photo_url, p.id).run();
      return { user: { ...old, last_active_at: iso(Math.max(p.now, Date.parse(old.last_active_at))) }, isNew: false };
    }
    const name = clean(p.name, 120) || p.email.split('@')[0];
    await this.db.prepare('INSERT INTO users (id, email, display_name, photo_url, role, created_at, last_active_at, blocked, prefs, valid_after) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0)').bind(p.id, p.email, name, clean(p.photo, 500), p.role, p.now, p.now, JSON.stringify(DEFAULT_PREFERENCES)).run();
    return { user: (await this.get(p.id))!, isNew: true };
  }
  async update(id: string, p: { display_name?: string; preferences?: Partial<Preferences> }) {
    const u = await this.get(id); if (!u) return null;
    const name = p.display_name !== undefined ? clean(p.display_name, 120) || u.display_name : u.display_name;
    await this.db.prepare('UPDATE users SET display_name = ?, prefs = ? WHERE id = ?').bind(name, JSON.stringify(cleanPrefs(u.preferences, p.preferences)), id).run();
    return this.get(id);
  }
  async revokeBefore(id: string, ms: number) { await this.init(); await this.db.prepare('UPDATE users SET valid_after = MAX(valid_after, ?) WHERE id = ?').bind(ms, id).run(); }
}
