/**
 * The admin team: who is an administrator, and the log of changes to it.
 * The super admin (the SUPER_ADMIN_EMAIL address) is always an administrator and is the only one who can add or remove others.
 * Someone can be named before they have ever signed in: the grant waits, and they become an administrator at their first sign-in.
 * Host-neutral (Web Request/Response, a small store interface) so it is tested without Cloudflare.
 */
import { userFor, type AuthEnv } from '../auth/handler';

export interface AdminGrant { email: string; added_by: string; added_at: string }
export interface AuditEntry { id: string; at: string; actor_email: string; action: string; target: string }

export interface TeamStore {
  grants(): Promise<AdminGrant[]>;
  has(email: string): Promise<boolean>;
  add(g: AdminGrant): Promise<void>;
  remove(email: string): Promise<void>;
  log(e: Omit<AuditEntry, 'id'>): Promise<void>;
  audit(limit: number): Promise<AuditEntry[]>;
}

/** Most grants kept, so the list and its page stay small */
export const MAX_ADMINS = 25;
const AUDIT_KEEP = 500;

export class MemoryTeamStore implements TeamStore {
  list: AdminGrant[] = [];
  entries: AuditEntry[] = [];
  async grants() { return [...this.list]; }
  async has(email: string) { return this.list.some((g) => g.email === email); }
  async add(g: AdminGrant) { if (!this.list.some((x) => x.email === g.email)) this.list.push(g); }
  async remove(email: string) { this.list = this.list.filter((g) => g.email !== email); }
  async log(e: Omit<AuditEntry, 'id'>) { this.entries.unshift({ ...e, id: String(this.entries.length + 1) }); }
  async audit(limit: number) { return this.entries.slice(0, limit); }
}

/** The parts of Cloudflare's D1 binding that are used */
export interface TeamD1 {
  prepare(q: string): { bind(...v: unknown[]): { first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown>; all?(): Promise<{ results?: Record<string, unknown>[] }> } };
  exec(q: string): Promise<unknown>;
}
const SCHEMA = 'CREATE TABLE IF NOT EXISTS admin_grants (email TEXT PRIMARY KEY, added_by TEXT NOT NULL, added_at INTEGER NOT NULL)';
const AUDIT_SCHEMA = 'CREATE TABLE IF NOT EXISTS admin_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_email TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL)';
/** The Worker builds a store per request, so the one-time table setup is remembered per database binding */
const prepared = new WeakMap<object, Promise<unknown>>();
const iso = (ms: number) => new Date(ms).toISOString();

export class D1TeamStore implements TeamStore {
  constructor(private db: TeamD1) {}
  private init() {
    let p = prepared.get(this.db);
    if (!p) {
      p = this.db.exec(SCHEMA).then(() => this.db.exec(AUDIT_SCHEMA));
      prepared.set(this.db, p);
      p.catch(() => prepared.delete(this.db));
    }
    return p;
  }
  private async rows(sql: string, ...v: unknown[]) { const q = this.db.prepare(sql).bind(...v); return (await (q.all ? q.all() : Promise.resolve({ results: [] as Record<string, unknown>[] }))).results ?? []; }
  async grants() { await this.init(); return (await this.rows('SELECT email, added_by, added_at FROM admin_grants ORDER BY added_at')).map((r) => ({ email: String(r.email), added_by: String(r.added_by), added_at: iso(Number(r.added_at)) })); }
  async has(email: string) { await this.init(); return !!(await this.db.prepare('SELECT 1 AS x FROM admin_grants WHERE email = ?').bind(email).first()); }
  async add(g: AdminGrant) { await this.init(); await this.db.prepare('INSERT OR IGNORE INTO admin_grants (email, added_by, added_at) VALUES (?, ?, ?)').bind(g.email, g.added_by, Date.parse(g.added_at)).run(); }
  async remove(email: string) { await this.init(); await this.db.prepare('DELETE FROM admin_grants WHERE email = ?').bind(email).run(); }
  async log(e: Omit<AuditEntry, 'id'>) {
    await this.init();
    await this.db.prepare('INSERT INTO admin_audit (at, actor_email, action, target) VALUES (?, ?, ?, ?)').bind(Date.parse(e.at), e.actor_email, e.action, e.target).run();
    await this.db.prepare('DELETE FROM admin_audit WHERE id <= (SELECT MAX(id) FROM admin_audit) - ?').bind(AUDIT_KEEP).run(); // the log stays a fixed size
  }
  async audit(limit: number) { await this.init(); return (await this.rows('SELECT id, at, actor_email, action, target FROM admin_audit ORDER BY id DESC LIMIT ?', limit)).map((r) => ({ id: String(r.id), at: iso(Number(r.at)), actor_email: String(r.actor_email), action: String(r.action), target: String(r.target) })); }
}

const H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
const send = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: H });
const fail = (status: number, error: string) => send({ error }, status);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TeamEnv { auth: AuthEnv; team: TeamStore }

/** /api/admin/admins (GET, POST), /api/admin/admins/<email> (DELETE) and /api/admin/audit (GET). `rest` is the path after /api/admin/. */
export const handleTeam = async (req: Request, rest: string[], env: TeamEnv): Promise<Response> => {
  const me = await userFor(req, env.auth);
  if (!me) return fail(401, 'Sign in first.');
  if (me.user.role !== 'admin') return fail(403, 'Not allowed.');
  const mine = me.user.email.toLowerCase();
  const superEmail = (env.auth.superAdminEmail ?? '').trim().toLowerCase();
  const isSuper = !!superEmail && mine === superEmail;

  if (rest[0] === 'audit' && rest.length === 1 && req.method === 'GET') return send({ entries: await env.team.audit(200) });
  if (rest[0] !== 'admins') return fail(404, 'Not found.');
  // A state-changing request must come from this site
  if (req.method !== 'GET') { const o = req.headers.get('origin'); if (o && o !== new URL(req.url).origin) return fail(403, 'Not allowed.'); }

  if (rest.length === 1 && req.method === 'GET') {
    const grants = await env.team.grants();
    const granted = new Set(grants.map((g) => g.email));
    // Anyone who already holds the role without a grant (the super admin, or an account made an administrator before grants existed)
    const holders = (await env.auth.store.all(500)).filter((u) => u.role === 'admin').map((u) => u.email.toLowerCase());
    const list = [
      ...(superEmail ? [{ email: superEmail, source: 'configured' as const, super: true, added_by: '', added_at: '' }] : []),
      ...holders.filter((e) => e !== superEmail && !granted.has(e)).map((e) => ({ email: e, source: 'configured' as const, super: false, added_by: '', added_at: '' })),
      ...grants.filter((g) => g.email !== superEmail).map((g) => ({ email: g.email, source: 'added' as const, super: false, added_by: g.added_by, added_at: g.added_at })),
    ];
    return send({ admins: list, superAdmin: superEmail, canManage: isSuper });
  }

  if (rest.length === 1 && req.method === 'POST') {
    if (!isSuper) return fail(403, 'Only the super admin can add administrators.');
    let email = '';
    try { const b = (await req.json()) as { email?: unknown }; email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''; } catch { /* empty */ }
    if (!EMAIL.test(email) || email.length > 200) return fail(400, 'Enter a valid email address.');
    if (email === superEmail) return fail(400, 'That is the super admin already.');
    const grants = await env.team.grants();
    if (!grants.some((g) => g.email === email) && grants.length >= MAX_ADMINS) return fail(400, `The team is limited to ${MAX_ADMINS} administrators.`);
    await env.team.add({ email, added_by: mine, added_at: new Date(env.auth.now()).toISOString() });
    // If they already have an account, it becomes an administrator now; otherwise it happens at their first sign-in
    const user = await env.auth.store.byEmail(email);
    if (user && !user.blocked && user.role !== 'admin') await env.auth.store.setRole(user.id, 'admin');
    await env.team.log({ at: new Date(env.auth.now()).toISOString(), actor_email: mine, action: 'admin.add', target: email });
    return send({ admin: { email, added_by: mine }, active: !!user });
  }

  if (rest.length === 2 && req.method === 'DELETE') {
    if (!isSuper) return fail(403, 'Only the super admin can remove administrators.');
    const email = decodeURIComponent(rest[1] ?? '').trim().toLowerCase();
    if (email === superEmail) return fail(400, 'The super admin cannot be removed.');
    if (!EMAIL.test(email)) return fail(400, 'Enter a valid email address.');
    await env.team.remove(email);
    const user = await env.auth.store.byEmail(email);
    if (user && user.role === 'admin') await env.auth.store.setRole(user.id, 'user');
    await env.team.log({ at: new Date(env.auth.now()).toISOString(), actor_email: mine, action: 'admin.remove', target: email });
    return send({ success: true });
  }

  return fail(405, 'Not allowed.');
};
