/**
 * Uuda Studio - Firestore data store (production)
 *
 * Collections: users, sessions, adminCodes, verifiedAdmin, generations, tickets, projects, admins, audit.
 * Project contents can be many MB, which does not fit a Firestore document (1 MiB), so the project JSON is kept in
 * Cloud Storage (projects/<uid>/<id>.json) and only its details (name, size, dates) live in Firestore.
 *
 * Session tokens and admin codes are stored hashed. Set a Firestore TTL policy on the `expires_at` field of
 * `sessions`, `adminCodes` and `verifiedAdmin` to have old records removed automatically (see docs/DEPLOY.md).
 */

import crypto from 'crypto';
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { ensureFirebaseApp } from './firebaseAdmin';
import type { DataStore } from './store';
import {
  UserRecord,
  GenerationLog,
  SupportTicket,
  ServerProject,
  AdminRecord,
  AuditEntry,
  ADMIN_CODE_TTL_MS,
  ADMIN_CODE_MAX_ATTEMPTS,
  ADMIN_CODE_LOCK_MS,
  ADMIN_VERIFIED_TTL_MS,
  SESSION_TTL_MS,
} from './db';

const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const rid = (prefix: string) => `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
const hmac = (code: string, salt: string) => crypto.createHmac('sha256', salt).update(String(code).trim()).digest('hex');
const emailKey = (email: string) => encodeURIComponent(email.trim().toLowerCase());

function adminAllowlist(): string[] {
  const superAdmin = process.env.SUPER_ADMIN_EMAIL || 'killdasmoke@gmail.com';
  return [superAdmin, process.env.ADMIN_EMAILS || '']
    .join(',')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function createFirestoreStore(): DataStore {
  ensureFirebaseApp();
  const fs: Firestore = getFirestore();
  const bucket = () => getStorage().bucket();
  const objectPath = (uid: string, id: string) => `projects/${uid}/${id}.json`;

  const users = fs.collection('users');
  const sessions = fs.collection('sessions');
  const codes = fs.collection('adminCodes');
  const verified = fs.collection('verifiedAdmin');
  const generations = fs.collection('generations');
  const tickets = fs.collection('tickets');
  const projects = fs.collection('projects');
  const admins = fs.collection('admins');
  const audit = fs.collection('audit');

  const getTicket = async (id: string): Promise<SupportTicket | null> => {
    const snap = await tickets.doc(id).get();
    return snap.exists ? (snap.data() as SupportTicket) : null;
  };

  const getUserByEmail = async (email: string): Promise<UserRecord | null> => {
    const q = await users.where('email', '==', email.trim().toLowerCase()).limit(1).get();
    return q.empty ? null : (q.docs[0].data() as UserRecord);
  };

  const deleteWhere = async (col: ReturnType<Firestore['collection']>, field: string, value: string) => {
    const q = await col.where(field, '==', value).get();
    for (let i = 0; i < q.docs.length; i += 400) {
      const batch = fs.batch();
      q.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    return q.docs.length;
  };

  const store: DataStore = {
    backend: 'firestore',

    // ---- users
    async getUserById(id) {
      const snap = await users.doc(id).get();
      return snap.exists ? (snap.data() as UserRecord) : null;
    },
    getUserByEmail,
    async getAllUsers() {
      const q = await users.orderBy('created_at', 'desc').limit(5000).get();
      return q.docs.map((d) => d.data() as UserRecord);
    },
    async createOrUpdateUserOnSignIn({ googleId, email, displayName, photoUrl }) {
      const cleanEmail = email.trim().toLowerCase();
      const isAdmin = await store.isAdminEmail(cleanEmail);
      const ref = users.doc(googleId);
      return fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = new Date().toISOString();
        if (snap.exists) {
          const existing = snap.data() as UserRecord;
          existing.last_active_at = now;
          if (photoUrl && photoUrl !== existing.photo_url) existing.photo_url = photoUrl;
          if (isAdmin) existing.role = 'admin';
          tx.set(ref, existing);
          return { user: existing, isNew: false };
        }
        const user: UserRecord = {
          id: googleId,
          email: cleanEmail,
          display_name: displayName || cleanEmail.split('@')[0],
          photo_url: photoUrl || '',
          role: isAdmin ? 'admin' : 'user',
          created_at: now,
          last_active_at: now,
          blocked: false,
          preferences: {
            defaultVoice: 'Zephyr',
            defaultModel: 'gemini-3.8-flash-tts',
            defaultDelivery: 'Clear broadcast style',
            autoRefresh: true,
          },
        };
        tx.set(ref, user);
        return { user, isNew: true };
      });
    },
    async updateUserProfile(userId, updates) {
      const ref = users.doc(userId);
      return fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('User not found');
        const user = snap.data() as UserRecord;
        if (updates.display_name !== undefined) {
          const trimmed = updates.display_name.trim();
          if (trimmed.length < 2 || trimmed.length > 50) throw new Error('Display name must be between 2 and 50 characters');
          user.display_name = trimmed;
        }
        if (updates.preferences) user.preferences = { ...user.preferences, ...updates.preferences };
        tx.set(ref, user);
        return user;
      });
    },
    async toggleUserBlocked(userId) {
      const ref = users.doc(userId);
      return fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('User not found');
        const user = snap.data() as UserRecord;
        user.blocked = !user.blocked;
        tx.set(ref, user);
        return user;
      });
    },
    async deleteUserPermanently(userId) {
      const projectDocs = await projects.where('user_id', '==', userId).get();
      await Promise.all(projectDocs.docs.map((d) => bucket().file(objectPath(userId, d.data().id)).delete({ ignoreNotFound: true })));
      await Promise.all([
        deleteWhere(tickets, 'user_id', userId),
        deleteWhere(projects, 'user_id', userId),
        deleteWhere(generations, 'user_id', userId),
        deleteWhere(sessions, 'user_id', userId),
      ]);
      await users.doc(userId).delete();
    },

    // ---- admins
    async isAdminEmail(email) {
      const clean = email.trim().toLowerCase();
      if (adminAllowlist().includes(clean)) return true;
      return (await admins.doc(emailKey(clean)).get()).exists;
    },
    isSuperAdminEmail: (e) =>
      (process.env.SUPER_ADMIN_EMAIL || 'killdasmoke@gmail.com').trim().toLowerCase() === e.trim().toLowerCase(),
    async listAdmins() {
      const q = await admins.get();
      return q.docs.map((d) => d.data() as AdminRecord);
    },
    async addAdmin(email, addedBy) {
      const clean = email.trim().toLowerCase();
      const rec: AdminRecord = { email: clean, added_by: addedBy, added_at: new Date().toISOString() };
      await admins.doc(emailKey(clean)).set(rec);
      const user = await getUserByEmail(clean);
      if (user) await users.doc(user.id).update({ role: 'admin' });
      return rec;
    },
    async removeAdmin(email) {
      const clean = email.trim().toLowerCase();
      await admins.doc(emailKey(clean)).delete();
      const user = await getUserByEmail(clean);
      if (user && !adminAllowlist().includes(clean)) await users.doc(user.id).update({ role: 'user' });
    },
    async appendAudit(entry) {
      const id = rid('aud');
      const rec: AuditEntry = { id, at: new Date().toISOString(), ...entry };
      await audit.doc(id).set(rec);
    },
    async listAudit(limit = 200) {
      const q = await audit.orderBy('at', 'desc').limit(limit).get();
      return q.docs.map((d) => d.data() as AuditEntry);
    },

    // ---- sessions and admin codes (tokens and codes are never stored in plain form)
    async setSession(token, userId) {
      const now = Date.now();
      await sessions.doc(sha(token)).set({
        user_id: userId,
        created_at: now,
        expires_at: Timestamp.fromMillis(now + SESSION_TTL_MS),
      });
    },
    async getSession(token) {
      const ref = sessions.doc(sha(token));
      const snap = await ref.get();
      if (!snap.exists) return null;
      const d = snap.data() as { user_id: string; created_at: number };
      if (Date.now() - d.created_at > SESSION_TTL_MS) {
        await Promise.all([ref.delete(), verified.doc(sha(token)).delete()]);
        return null;
      }
      return { userId: d.user_id, createdAt: d.created_at };
    },
    async removeSession(token) {
      await Promise.all([sessions.doc(sha(token)).delete(), verified.doc(sha(token)).delete()]);
    },
    async isAdminSessionVerified(token) {
      const snap = await verified.doc(sha(token)).get();
      if (!snap.exists) return false;
      return (snap.data() as { until: number }).until > Date.now();
    },
    async createAdminConnectionCode(email) {
      const clean = email.trim().toLowerCase();
      const code = crypto.randomInt(100000, 1000000).toString();
      const salt = crypto.randomBytes(16).toString('hex');
      const ref = codes.doc(emailKey(clean));
      await fs.runTransaction(async (tx) => {
        const prev = await tx.get(ref);
        const lockedUntil = prev.exists ? (prev.data() as { locked_until: number }).locked_until : 0;
        const expires = Date.now() + ADMIN_CODE_TTL_MS;
        tx.set(ref, {
          email: clean,
          hash: hmac(code, salt),
          salt,
          expires_at: Timestamp.fromMillis(expires + ADMIN_CODE_LOCK_MS),
          expires_ms: expires,
          attempts: 0,
          locked_until: lockedUntil > Date.now() ? lockedUntil : 0,
        });
      });
      return code;
    },
    async adminCodeCooldownSeconds(email) {
      const snap = await codes.doc(emailKey(email)).get();
      if (!snap.exists) return 0;
      const issuedAt = (snap.data() as { expires_ms: number }).expires_ms - ADMIN_CODE_TTL_MS;
      return Math.max(0, Math.ceil((issuedAt + 60 * 1000 - Date.now()) / 1000));
    },
    async verifyAdminConnectionCode(email, code, sessionToken) {
      const ref = codes.doc(emailKey(email));
      return fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { ok: false, reason: 'expired' as const };
        const e = snap.data() as { hash: string; salt: string; expires_ms: number; attempts: number; locked_until: number };
        const now = Date.now();
        if (e.locked_until > now) {
          return { ok: false, reason: 'locked' as const, retryAfterSec: Math.ceil((e.locked_until - now) / 1000) };
        }
        if (now > e.expires_ms) return { ok: false, reason: 'expired' as const };
        const given = Buffer.from(hmac(code, e.salt), 'hex');
        const wanted = Buffer.from(e.hash, 'hex');
        const match = given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
        if (!match) {
          const attempts = e.attempts + 1;
          if (attempts >= ADMIN_CODE_MAX_ATTEMPTS) {
            tx.update(ref, { attempts: 0, locked_until: now + ADMIN_CODE_LOCK_MS });
            return { ok: false, reason: 'locked' as const, retryAfterSec: Math.ceil(ADMIN_CODE_LOCK_MS / 1000) };
          }
          tx.update(ref, { attempts });
          return { ok: false, reason: 'invalid' as const };
        }
        tx.delete(ref); // single use
        tx.set(verified.doc(sha(sessionToken)), {
          until: now + ADMIN_VERIFIED_TTL_MS,
          expires_at: Timestamp.fromMillis(now + ADMIN_VERIFIED_TTL_MS),
        });
        return { ok: true };
      });
    },

    // ---- generations
    async logGeneration(log) {
      const entry: GenerationLog = { id: rid('gen'), ...log, created_at: new Date().toISOString() };
      await generations.doc(entry.id).set(entry);
      return entry;
    },
    async getGenerationsForUser(userId) {
      const q = await generations.where('user_id', '==', userId).get();
      return q.docs.map((d) => d.data() as GenerationLog);
    },
    async getAllGenerations() {
      const q = await generations.orderBy('created_at', 'desc').limit(20000).get();
      return q.docs.map((d) => d.data() as GenerationLog);
    },

    // ---- tickets
    async createTicket(userId, userEmail, userName, title, type, initialMessage) {
      const now = new Date().toISOString();
      const ticket: SupportTicket = {
        id: rid('tkt'),
        user_id: userId,
        user_email: userEmail,
        user_name: userName,
        title: title.trim(),
        type,
        status: 'Open',
        created_at: now,
        updated_at: now,
        has_unread_admin_reply: false,
        messages: [{ id: rid('msg'), sender: 'user', sender_name: userName, content: initialMessage.trim(), created_at: now }],
      };
      await tickets.doc(ticket.id).set(ticket);
      return ticket;
    },
    async getTicketsForUser(userId) {
      const q = await tickets.where('user_id', '==', userId).get();
      return q.docs.map((d) => d.data() as SupportTicket).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async getAllTickets() {
      const q = await tickets.orderBy('created_at', 'desc').limit(2000).get();
      return q.docs.map((d) => d.data() as SupportTicket);
    },
    getTicketById: getTicket,
    async addTicketReply(ticketId, sender, senderName, content, newStatus) {
      const ref = tickets.doc(ticketId);
      return fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Ticket not found');
        const ticket = snap.data() as SupportTicket;
        if ((ticket.status === 'Closed' || ticket.status === 'Archived') && sender === 'user') {
          throw new Error('This ticket is closed and read-only');
        }
        const now = new Date().toISOString();
        ticket.messages.push({ id: rid('msg'), sender, sender_name: senderName, content: content.trim(), created_at: now });
        ticket.updated_at = now;
        if (newStatus) ticket.status = newStatus;
        ticket.has_unread_admin_reply = sender === 'admin';
        tx.set(ref, ticket);
        return ticket;
      });
    },
    async setTicketStatus(ticketId, status) {
      const ref = tickets.doc(ticketId);
      return fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error('Ticket not found');
        const ticket = snap.data() as SupportTicket;
        ticket.status = status;
        ticket.updated_at = new Date().toISOString();
        tx.set(ref, ticket);
        return ticket;
      });
    },
    async markTicketAsRead(ticketId, userId) {
      const t = await getTicket(ticketId);
      if (t && t.user_id === userId && t.has_unread_admin_reply) {
        await tickets.doc(ticketId).update({ has_unread_admin_reply: false });
      }
    },

    // ---- projects (details in Firestore, contents in Cloud Storage)
    async saveProject(userId, projectId, name, data) {
      const body = JSON.stringify(data ?? null);
      const size = Buffer.byteLength(body, 'utf8');
      await bucket().file(objectPath(userId, projectId)).save(body, { contentType: 'application/json', resumable: false });
      const ref = projects.doc(`${userId}__${projectId}`);
      const now = new Date().toISOString();
      const snap = await ref.get();
      const meta: Omit<ServerProject, 'data'> = {
        id: projectId,
        user_id: userId,
        name,
        size_bytes: size,
        created_at: snap.exists ? (snap.data() as ServerProject).created_at : now,
        updated_at: now,
      };
      await ref.set(meta);
      return { ...meta, data } as ServerProject;
    },
    async getProjectsForUser(userId) {
      const q = await projects.where('user_id', '==', userId).get();
      return q.docs
        .map((d) => d.data() as ServerProject)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
    async countProjectsByUser() {
      const q = await projects.select('user_id').get();
      const counts: Record<string, number> = {};
      q.docs.forEach((d) => {
        const uid = d.get('user_id') as string;
        counts[uid] = (counts[uid] || 0) + 1;
      });
      return counts;
    },
    async getProject(userId, projectId) {
      const snap = await projects.doc(`${userId}__${projectId}`).get();
      if (!snap.exists) return null;
      const meta = snap.data() as ServerProject;
      const [buf] = await bucket().file(objectPath(userId, projectId)).download();
      return { ...meta, data: JSON.parse(buf.toString('utf8')) };
    },
    async deleteProject(userId, projectId) {
      const ref = projects.doc(`${userId}__${projectId}`);
      const snap = await ref.get();
      if (!snap.exists) return false;
      await ref.delete();
      await bucket().file(objectPath(userId, projectId)).delete({ ignoreNotFound: true });
      return true;
    },
    async duplicateProject(userId, projectId) {
      const original = await store.getProject(userId, projectId);
      if (!original) throw new Error('Original project not found');
      return store.saveProject(userId, rid('proj'), `${original.name} (Copy)`, original.data);
    },
  };
  return store;
}
