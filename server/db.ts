/**
 * Uuda Pro - Server Database & Persistence Engine
 * File-backed atomic JSON store for Users, Generations, Support Tickets, Projects, and Admin Codes.
 * Ensures data persists across server restarts and enforces server-side integrity rules.
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

export interface UserPreferences {
  defaultVoice: string;
  defaultModel: string;
  defaultDelivery: string;
  autoRefresh: boolean;
}

export interface UserRecord {
  id: string; // Google User ID (stable)
  email: string; // Permanent email (lowercase)
  display_name: string;
  photo_url: string;
  role: 'user' | 'admin';
  created_at: string;
  last_active_at: string;
  blocked: boolean;
  preferences: UserPreferences;
}

export interface GenerationLog {
  id: string;
  user_id: string;
  user_email: string;
  kind: 'voice';
  model: string;
  characters: number;
  status: 'succeeded' | 'failed';
  error_code: string | null;
  used_own_key: boolean;
  created_at: string;
}

export interface TicketMessage {
  id: string;
  sender: 'user' | 'admin';
  sender_name: string;
  content: string;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  title: string;
  type: 'AI generation issue' | 'Account issue' | 'Workspace failure' | 'Technical issue' | 'Performance issue';
  status: 'Open' | 'Resolved' | 'Closed';
  created_at: string;
  updated_at: string;
  has_unread_admin_reply: boolean;
  messages: TicketMessage[];
}

export interface ServerProject {
  id: string;
  user_id: string;
  name: string;
  size_bytes: number;
  data: any;
  created_at: string;
  updated_at: string;
}

export interface AdminCodeEntry {
  email: string;
  /** HMAC-SHA256 of the code with a per-code random salt; the code itself is never stored */
  hash: string;
  salt: string;
  expires_at: number;
  attempts: number;
  locked_until: number;
}

/** Admin code policy */
export const ADMIN_CODE_TTL_MS = 10 * 60 * 1000;
export const ADMIN_CODE_MAX_ATTEMPTS = 5;
export const ADMIN_CODE_LOCK_MS = 15 * 60 * 1000;
export const ADMIN_VERIFIED_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface DatabaseSchema {
  users: Record<string, UserRecord>;
  generations: GenerationLog[];
  tickets: SupportTicket[];
  projects: ServerProject[];
  adminCodes: Record<string, AdminCodeEntry>;
  verifiedAdminSessions: Record<string, number>; // session token -> verified-until (epoch ms)
  sessions: Record<string, { userId: string; createdAt: number }>;
}

// Local development store only. Cloud Run's disk is temporary and per-instance; production data moves to Firestore (stage 2).
const DB_FILE_PATH = path.resolve(process.env.UUDA_DATA_DIR || path.resolve(process.cwd(), 'data'), 'uuda_db.json');

class DatabaseService {
  private data: DatabaseSchema;
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.data = this.loadDatabase();
    this.seedDefaultAdmin();
  }

  private loadDatabase(): DatabaseSchema {
    try {
      const dataDir = path.dirname(DB_FILE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      if (fs.existsSync(DB_FILE_PATH)) {
        const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          users: parsed.users || {},
          generations: parsed.generations || [],
          tickets: parsed.tickets || [],
          projects: parsed.projects || [],
          adminCodes: parsed.adminCodes || {},
          // Older files stored an array with no expiry; those verifications are dropped on purpose
          verifiedAdminSessions: Array.isArray(parsed.verifiedAdminSessions) ? {} : parsed.verifiedAdminSessions || {},
          sessions: parsed.sessions || {},
        };
      }
    } catch (err) {
      console.error('[DB] Failed to load database file, creating fresh store:', err);
    }

    return {
      users: {},
      generations: [],
      tickets: [],
      projects: [],
      adminCodes: {},
      verifiedAdminSessions: {},
      sessions: {},
    };
  }

  private saveDatabaseNow() {
    try {
      const dataDir = path.dirname(DB_FILE_PATH);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      fs.writeFileSync(DB_FILE_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[DB] Failed to write database file:', err);
    }
  }

  public save() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.saveDatabaseNow();
      this.saveTimeout = null;
    }, 100);
  }

  // Pre-seed admin user and allowlist
  private seedDefaultAdmin() {
    const adminEmails = this.getAdminAllowlist();
    // Ensure any existing users in allowlist are marked role = 'admin'
    for (const user of Object.values(this.data.users)) {
      if (adminEmails.includes(user.email.toLowerCase())) {
        user.role = 'admin';
      }
    }
  }

  public getAdminAllowlist(): string[] {
    // The super-admin comes from configuration; extra admins can be listed in ADMIN_EMAILS (comma separated).
    const superAdmin = process.env.SUPER_ADMIN_EMAIL || 'killdasmoke@gmail.com';
    const envList = [superAdmin, process.env.ADMIN_EMAILS || ''].join(',');
    return envList
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  }

  public isAdminEmail(email: string): boolean {
    const clean = email.trim().toLowerCase();
    return this.getAdminAllowlist().includes(clean);
  }

  // User management
  public getUserById(id: string): UserRecord | null {
    return this.data.users[id] || null;
  }

  public getUserByEmail(email: string): UserRecord | null {
    const clean = email.trim().toLowerCase();
    for (const u of Object.values(this.data.users)) {
      if (u.email.toLowerCase() === clean) return u;
    }
    return null;
  }

  public getAllUsers(): UserRecord[] {
    return Object.values(this.data.users);
  }

  public createOrUpdateUserOnSignIn(params: {
    googleId: string;
    email: string;
    displayName: string;
    photoUrl: string;
  }): { user: UserRecord; isNew: boolean } {
    const { googleId, email, displayName, photoUrl } = params;
    const cleanEmail = email.trim().toLowerCase();
    const isAdmin = this.isAdminEmail(cleanEmail);

    let existing = this.data.users[googleId];
    if (existing) {
      // Existing account: update last active and photo/name if provided, NEVER email
      existing.last_active_at = new Date().toISOString();
      if (photoUrl && photoUrl !== existing.photo_url) {
        existing.photo_url = photoUrl;
      }
      if (isAdmin) {
        existing.role = 'admin';
      }
      this.save();
      return { user: existing, isNew: false };
    }

    // New account creation
    const newUser: UserRecord = {
      id: googleId,
      email: cleanEmail,
      display_name: displayName || cleanEmail.split('@')[0],
      photo_url: photoUrl || '',
      role: isAdmin ? 'admin' : 'user',
      created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
      blocked: false,
      preferences: {
        defaultVoice: 'Zephyr',
        defaultModel: 'gemini-3.8-flash-tts',
        defaultDelivery: 'Clear broadcast style',
        autoRefresh: true,
      },
    };

    this.data.users[googleId] = newUser;
    this.save();
    return { user: newUser, isNew: true };
  }

  public updateUserProfile(
    userId: string,
    updates: { display_name?: string; preferences?: Partial<UserPreferences> }
  ): UserRecord {
    const user = this.data.users[userId];
    if (!user) throw new Error('User not found');

    if (updates.display_name !== undefined) {
      const trimmed = updates.display_name.trim();
      if (trimmed.length < 2 || trimmed.length > 50) {
        throw new Error('Display name must be between 2 and 50 characters');
      }
      user.display_name = trimmed;
    }

    if (updates.preferences) {
      user.preferences = {
        ...user.preferences,
        ...updates.preferences,
      };
    }

    this.save();
    return user;
  }

  public toggleUserBlocked(userId: string): UserRecord {
    const user = this.data.users[userId];
    if (!user) throw new Error('User not found');
    user.blocked = !user.blocked;
    this.save();
    return user;
  }

  public deleteUserPermanently(userId: string): void {
    delete this.data.users[userId];
    // Delete tickets
    this.data.tickets = this.data.tickets.filter((t) => t.user_id !== userId);
    // Delete projects
    this.data.projects = this.data.projects.filter((p) => p.user_id !== userId);
    // Delete generations
    this.data.generations = this.data.generations.filter((g) => g.user_id !== userId);
    this.save();
  }

  // Admin connection codes
  private hashAdminCode(code: string, salt: string): string {
    return crypto.createHmac('sha256', salt).update(String(code).trim()).digest('hex');
  }

  /** Creates a fresh single-use code. The caller must email it; it is never logged or returned by an API route. */
  public createAdminConnectionCode(email: string): string {
    const clean = email.trim().toLowerCase();
    const code = crypto.randomInt(100000, 1000000).toString();
    const salt = crypto.randomBytes(16).toString('hex');
    const previous = this.data.adminCodes[clean];
    this.data.adminCodes[clean] = {
      email: clean,
      hash: this.hashAdminCode(code, salt),
      salt,
      expires_at: Date.now() + ADMIN_CODE_TTL_MS,
      attempts: 0,
      locked_until: previous && previous.locked_until > Date.now() ? previous.locked_until : 0,
    };
    this.save();
    return code;
  }

  /** Seconds until a new code may be requested (one per minute), or 0 */
  public adminCodeCooldownSeconds(email: string): number {
    const entry = this.data.adminCodes[email.trim().toLowerCase()];
    if (!entry) return 0;
    const issuedAt = entry.expires_at - ADMIN_CODE_TTL_MS;
    return Math.max(0, Math.ceil((issuedAt + 60 * 1000 - Date.now()) / 1000));
  }

  public verifyAdminConnectionCode(
    email: string,
    code: string,
    sessionToken: string
  ): { ok: boolean; reason?: 'locked' | 'invalid' | 'expired'; retryAfterSec?: number } {
    const clean = email.trim().toLowerCase();
    const entry = this.data.adminCodes[clean];
    if (!entry) return { ok: false, reason: 'expired' };
    const now = Date.now();
    if (entry.locked_until > now) {
      return { ok: false, reason: 'locked', retryAfterSec: Math.ceil((entry.locked_until - now) / 1000) };
    }
    if (now > entry.expires_at) return { ok: false, reason: 'expired' };

    const given = Buffer.from(this.hashAdminCode(code, entry.salt), 'hex');
    const wanted = Buffer.from(entry.hash, 'hex');
    const match = given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
    if (!match) {
      entry.attempts += 1;
      let locked = false;
      if (entry.attempts >= ADMIN_CODE_MAX_ATTEMPTS) {
        entry.locked_until = now + ADMIN_CODE_LOCK_MS;
        entry.attempts = 0;
        locked = true;
      }
      this.save();
      return locked
        ? { ok: false, reason: 'locked', retryAfterSec: Math.ceil(ADMIN_CODE_LOCK_MS / 1000) }
        : { ok: false, reason: 'invalid' };
    }

    // Single use: burn the code, then mark this session as verified for a limited time
    delete this.data.adminCodes[clean];
    this.data.verifiedAdminSessions[sessionToken] = now + ADMIN_VERIFIED_TTL_MS;
    this.save();
    return { ok: true };
  }

  public setSession(token: string, userId: string): void {
    if (!this.data.sessions) this.data.sessions = {};
    this.data.sessions[token] = { userId, createdAt: Date.now() };
    this.save();
  }

  public getSession(token: string): { userId: string; createdAt: number } | null {
    if (!this.data.sessions) this.data.sessions = {};
    const entry = this.data.sessions[token];
    if (!entry) return null;
    if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
      delete this.data.sessions[token];
      delete this.data.verifiedAdminSessions[token];
      this.save();
      return null;
    }
    return entry;
  }

  public removeSession(token: string): void {
    if (!this.data.sessions) return;
    delete this.data.sessions[token];
    delete this.data.verifiedAdminSessions[token];
    this.save();
  }

  public isAdminSessionVerified(sessionToken: string): boolean {
    const until = this.data.verifiedAdminSessions[sessionToken];
    return typeof until === 'number' && until > Date.now();
  }

  // Generations log
  public logGeneration(log: Omit<GenerationLog, 'id' | 'created_at'>): GenerationLog {
    const entry: GenerationLog = {
      id: `gen_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ...log,
      created_at: new Date().toISOString(),
    };
    this.data.generations.push(entry);
    this.save();
    return entry;
  }

  public getGenerationsForUser(userId: string): GenerationLog[] {
    return this.data.generations.filter((g) => g.user_id === userId);
  }

  public getAllGenerations(): GenerationLog[] {
    return this.data.generations;
  }

  // Support Tickets
  public createTicket(
    userId: string,
    userEmail: string,
    userName: string,
    title: string,
    type: SupportTicket['type'],
    initialMessage: string
  ): SupportTicket {
    const ticketId = `tkt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = new Date().toISOString();
    const newTicket: SupportTicket = {
      id: ticketId,
      user_id: userId,
      user_email: userEmail,
      user_name: userName,
      title: title.trim(),
      type,
      status: 'Open',
      created_at: now,
      updated_at: now,
      has_unread_admin_reply: false,
      messages: [
        {
          id: `msg_${Date.now()}_1`,
          sender: 'user',
          sender_name: userName,
          content: initialMessage.trim(),
          created_at: now,
        },
      ],
    };

    this.data.tickets.unshift(newTicket);
    this.save();
    return newTicket;
  }

  public getTicketsForUser(userId: string): SupportTicket[] {
    return this.data.tickets.filter((t) => t.user_id === userId);
  }

  public getAllTickets(): SupportTicket[] {
    return this.data.tickets;
  }

  public getTicketById(ticketId: string): SupportTicket | null {
    return this.data.tickets.find((t) => t.id === ticketId) || null;
  }

  public addTicketReply(
    ticketId: string,
    sender: 'user' | 'admin',
    senderName: string,
    content: string,
    newStatus?: SupportTicket['status']
  ): SupportTicket {
    const ticket = this.getTicketById(ticketId);
    if (!ticket) throw new Error('Ticket not found');
    if (ticket.status === 'Closed' && sender === 'user') {
      throw new Error('This ticket is closed and read-only');
    }

    const now = new Date().toISOString();
    ticket.messages.push({
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sender,
      sender_name: senderName,
      content: content.trim(),
      created_at: now,
    });

    ticket.updated_at = now;
    if (newStatus) {
      ticket.status = newStatus;
    }

    if (sender === 'admin') {
      ticket.has_unread_admin_reply = true;
    } else {
      ticket.has_unread_admin_reply = false;
    }

    this.save();
    return ticket;
  }

  public markTicketAsRead(ticketId: string, userId: string): void {
    const ticket = this.getTicketById(ticketId);
    if (ticket && ticket.user_id === userId) {
      ticket.has_unread_admin_reply = false;
      this.save();
    }
  }

  // Projects
  public saveProject(userId: string, projectId: string, name: string, data: any): ServerProject {
    const now = new Date().toISOString();
    const dataString = JSON.stringify(data);
    const sizeBytes = Buffer.byteLength(dataString, 'utf8');

    let project = this.data.projects.find((p) => p.id === projectId && p.user_id === userId);
    if (project) {
      project.name = name;
      project.data = data;
      project.size_bytes = sizeBytes;
      project.updated_at = now;
    } else {
      project = {
        id: projectId,
        user_id: userId,
        name,
        size_bytes: sizeBytes,
        data,
        created_at: now,
        updated_at: now,
      };
      this.data.projects.unshift(project);
    }

    this.save();
    return project;
  }

  public getProjectsForUser(userId: string): ServerProject[] {
    return this.data.projects.filter((p) => p.user_id === userId);
  }

  public deleteProject(userId: string, projectId: string): boolean {
    const initialLen = this.data.projects.length;
    this.data.projects = this.data.projects.filter((p) => !(p.id === projectId && p.user_id === userId));
    const deleted = this.data.projects.length < initialLen;
    if (deleted) this.save();
    return deleted;
  }

  public duplicateProject(userId: string, projectId: string): ServerProject {
    const original = this.data.projects.find((p) => p.id === projectId && p.user_id === userId);
    if (!original) throw new Error('Original project not found');

    const newId = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const copy: ServerProject = {
      ...original,
      id: newId,
      name: `${original.name} (Copy)`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.data.projects.unshift(copy);
    this.save();
    return copy;
  }
}

export const db = new DatabaseService();
