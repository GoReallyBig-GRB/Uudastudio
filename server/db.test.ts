import { describe, it, expect, beforeAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';

let db: typeof import('./db').db;
const admin = 'killdasmoke@gmail.com';

beforeAll(async () => {
  process.env.UUDA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uuda-db-'));
  process.env.SUPER_ADMIN_EMAIL = admin;
  db = (await import('./db')).db;
});

describe('admin connection codes', () => {
  it('creates a 6-digit code and never stores it in clear text', () => {
    const code = db.createAdminConnectionCode(admin);
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify((db as any).data.adminCodes)).not.toContain(code);
  });

  it('accepts the right code once and verifies only that session', () => {
    const code = db.createAdminConnectionCode(admin);
    expect(db.verifyAdminConnectionCode(admin, '000000', 'sessA').ok).toBe(false);
    expect(db.verifyAdminConnectionCode(admin, code, 'sessA').ok).toBe(true);
    expect(db.isAdminSessionVerified('sessA')).toBe(true);
    expect(db.verifyAdminConnectionCode(admin, code, 'sessB').ok).toBe(false);
    expect(db.isAdminSessionVerified('sessB')).toBe(false);
  });

  it('locks after five wrong attempts, even for the right code', () => {
    const code = db.createAdminConnectionCode(admin);
    let last: ReturnType<typeof db.verifyAdminConnectionCode> | undefined;
    for (let i = 0; i < 5; i++) last = db.verifyAdminConnectionCode(admin, '111111', 'sessC');
    expect(last?.reason).toBe('locked');
    expect(db.verifyAdminConnectionCode(admin, code, 'sessC').reason).toBe('locked');
  });
});

describe('admin list and sessions', () => {
  it('takes the super admin from configuration and seeds no account', () => {
    expect(db.isAdminEmail('KillDaSmoke@gmail.com')).toBe(true);
    expect(db.isAdminEmail('someone@example.com')).toBe(false);
    expect(db.getUserByEmail('chucksagonsi@gmail.com')).toBeNull();
  });

  it('expires sessions after seven days', () => {
    db.setSession('uuda_sess_test', 'u1');
    expect(db.getSession('uuda_sess_test')).not.toBeNull();
    (db as any).data.sessions['uuda_sess_test'].createdAt = Date.now() - 8 * 86400000;
    expect(db.getSession('uuda_sess_test')).toBeNull();
  });
});
