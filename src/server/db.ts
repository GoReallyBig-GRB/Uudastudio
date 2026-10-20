/**
 * Uuda Pro - Server Database & Persistence Engine
 * File-backed atomic JSON store for Users, Generations, Support Tickets, Projects, and Admin Codes.
 * Ensures data persists across server restarts and enforces server-side integrity rules.
 */

import fs from 'fs';
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
  code: string;
  expires_at: number;
}

interface DatabaseSchema {
  users: Record<string, UserRecord>;
  generations: GenerationLog[];
  tickets: SupportTicket[];
  projects: ServerProject[];
  adminCodes: Record<string, AdminCodeEntry>;
  verifiedAdminSessions: string[]; // session tokens that passed connection code check
  sessions: Record<string, { userId: string; createdAt: number }>;
}

const DB_FILE_PATH = path.resolve(process.cwd(), 'data', 'uuda_db.json');

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
          verifiedAdminSessions: parsed.verifiedAdminSessions || [],
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
      verifiedAdminSessions: [],
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

    const defaultEmail = 'chucksagonsi@gmail.com';
    if (!this.getUserByEmail(defaultEmail)) {
      this.createOrUpdateUserOnSignIn({
        googleId: 'usr_owner_seed',
        email: defaultEmail,
        displayName: 'Producer Admin',
        photoUrl: '',
      });
    }
  }

  public getAdminAllowlist(): string[] {
    const envList = process.env.ADMIN_EMAILS || 'chucksagonsi@gmail.com,killdasmoke@gmail.com';
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
  public createAdminConnectionCode(email: string): string {
    const clean = email.trim().toLowerCase();
    // 6-digit numeric code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.data.adminCodes[clean] = {
      email: clean,
      code,
      expires_at: Date.now() + 30 * 60 * 1000, // 30 minutes
    };
    this.save();
    console.log(`[AUTH] Admin connection code generated for ${clean}: ${code}`);
    return code;
  }

  public verifyAdminConnectionCode(email: string, code: string, sessionToken: string): boolean {
    const clean = email.trim().toLowerCase();
    const entry = this.data.adminCodes[clean];
    if (!entry) return false;
    if (Date.now() > entry.expires_at) return false;
    if (entry.code.trim() === code.trim()) {
      if (!this.data.verifiedAdminSessions.includes(sessionToken)) {
        this.data.verifiedAdminSessions.push(sessionToken);
      }
      this.save();
      return true;
    }
    return false;
  }

  public verifyAdminSession(sessionToken: string): void {
    if (!this.data.verifiedAdminSessions.includes(sessionToken)) {
      this.data.verifiedAdminSessions.push(sessionToken);
      this.save();
    }
  }

  public setSession(token: string, userId: string): void {
    if (!this.data.sessions) this.data.sessions = {};
    this.data.sessions[token] = { userId, createdAt: Date.now() };
    this.save();
  }

  public getSession(token: string): { userId: string; createdAt: number } | null {
    if (!this.data.sessions) this.data.sessions = {};
    return this.data.sessions[token] || null;
  }

  public removeSession(token: string): void {
    if (!this.data.sessions) return;
    delete this.data.sessions[token];
    this.save();
  }

  public isAdminSessionVerified(sessionToken: string): boolean {
    return this.data.verifiedAdminSessions.includes(sessionToken);
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
