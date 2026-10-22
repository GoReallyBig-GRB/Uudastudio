/**
 * Uuda Studio - Data store
 *
 * One async interface for everything the server saves. Two implementations:
 *   - file      (server/db.ts)             local development only
 *   - firestore (server/firestoreStore.ts) production on Cloud Run (data survives restarts, safe with many instances)
 *
 * DATA_BACKEND=file|firestore picks one. Default: firestore when running on Cloud Run (K_SERVICE is set), else file.
 */

import {
  db as fileDb,
  UserRecord,
  UserPreferences,
  GenerationLog,
  SupportTicket,
  ServerProject,
  AdminRecord,
  AuditEntry,
} from './db';

export type { UserRecord, UserPreferences, GenerationLog, SupportTicket, ServerProject, AdminRecord, AuditEntry };

export type AdminCodeResult = { ok: boolean; reason?: 'locked' | 'invalid' | 'expired'; retryAfterSec?: number };

export interface DataStore {
  readonly backend: 'file' | 'firestore';

  // users
  getUserById(id: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  getAllUsers(): Promise<UserRecord[]>;
  createOrUpdateUserOnSignIn(p: {
    googleId: string;
    email: string;
    displayName: string;
    photoUrl: string;
  }): Promise<{ user: UserRecord; isNew: boolean }>;
  updateUserProfile(
    userId: string,
    updates: { display_name?: string; preferences?: Partial<UserPreferences> }
  ): Promise<UserRecord>;
  toggleUserBlocked(userId: string): Promise<UserRecord>;
  deleteUserPermanently(userId: string): Promise<void>;

  // admins
  isAdminEmail(email: string): Promise<boolean>;
  isSuperAdminEmail(email: string): boolean;
  /** Admins fixed in configuration (SUPER_ADMIN_EMAIL and ADMIN_EMAILS); they cannot be removed in the app */
  listConfiguredAdmins(): string[];
  listAdmins(): Promise<AdminRecord[]>;
  addAdmin(email: string, addedBy: string): Promise<AdminRecord>;
  removeAdmin(email: string): Promise<void>;
  appendAudit(entry: Omit<AuditEntry, 'id' | 'at'>): Promise<void>;
  listAudit(limit?: number): Promise<AuditEntry[]>;

  // sessions and admin codes
  setSession(token: string, userId: string): Promise<void>;
  getSession(token: string): Promise<{ userId: string; createdAt: number } | null>;
  removeSession(token: string): Promise<void>;
  isAdminSessionVerified(sessionToken: string): Promise<boolean>;
  createAdminConnectionCode(email: string): Promise<string>;
  adminCodeCooldownSeconds(email: string): Promise<number>;
  verifyAdminConnectionCode(email: string, code: string, sessionToken: string): Promise<AdminCodeResult>;

  // generations
  logGeneration(log: Omit<GenerationLog, 'id' | 'created_at'>): Promise<GenerationLog>;
  getGenerationsForUser(userId: string): Promise<GenerationLog[]>;
  getAllGenerations(): Promise<GenerationLog[]>;

  // tickets
  createTicket(
    userId: string,
    userEmail: string,
    userName: string,
    title: string,
    type: SupportTicket['type'],
    initialMessage: string
  ): Promise<SupportTicket>;
  getTicketsForUser(userId: string): Promise<SupportTicket[]>;
  getAllTickets(): Promise<SupportTicket[]>;
  getTicketById(ticketId: string): Promise<SupportTicket | null>;
  addTicketReply(
    ticketId: string,
    sender: 'user' | 'admin',
    senderName: string,
    content: string,
    newStatus?: SupportTicket['status']
  ): Promise<SupportTicket>;
  setTicketStatus(ticketId: string, status: SupportTicket['status']): Promise<SupportTicket>;
  markTicketAsRead(ticketId: string, userId: string): Promise<void>;

  // projects
  saveProject(userId: string, projectId: string, name: string, data: unknown): Promise<ServerProject>;
  getProjectsForUser(userId: string): Promise<ServerProject[]>;
  countProjectsByUser(): Promise<Record<string, number>>;
  getProject(userId: string, projectId: string): Promise<ServerProject | null>;
  deleteProject(userId: string, projectId: string): Promise<boolean>;
  duplicateProject(userId: string, projectId: string): Promise<ServerProject>;
}

/** The file database, wrapped so every call returns a promise */
function createFileStore(): DataStore {
  const d = fileDb;
  return {
    backend: 'file',
    getUserById: async (id) => d.getUserById(id),
    getUserByEmail: async (e) => d.getUserByEmail(e),
    getAllUsers: async () => d.getAllUsers(),
    createOrUpdateUserOnSignIn: async (p) => d.createOrUpdateUserOnSignIn(p),
    updateUserProfile: async (id, u) => d.updateUserProfile(id, u),
    toggleUserBlocked: async (id) => d.toggleUserBlocked(id),
    deleteUserPermanently: async (id) => d.deleteUserPermanently(id),
    isAdminEmail: async (e) => d.isAdminEmail(e),
    isSuperAdminEmail: (e) => d.isSuperAdminEmail(e),
    listConfiguredAdmins: () => d.getAdminAllowlist(),
    listAdmins: async () => d.listAdmins(),
    addAdmin: async (e, by) => d.addAdmin(e, by),
    removeAdmin: async (e) => d.removeAdmin(e),
    appendAudit: async (en) => d.appendAudit(en),
    listAudit: async (l) => d.listAudit(l),
    setSession: async (t, u) => d.setSession(t, u),
    getSession: async (t) => d.getSession(t),
    removeSession: async (t) => d.removeSession(t),
    isAdminSessionVerified: async (t) => d.isAdminSessionVerified(t),
    createAdminConnectionCode: async (e) => d.createAdminConnectionCode(e),
    adminCodeCooldownSeconds: async (e) => d.adminCodeCooldownSeconds(e),
    verifyAdminConnectionCode: async (e, c, t) => d.verifyAdminConnectionCode(e, c, t),
    logGeneration: async (l) => d.logGeneration(l),
    getGenerationsForUser: async (u) => d.getGenerationsForUser(u),
    getAllGenerations: async () => d.getAllGenerations(),
    createTicket: async (a, b, c, t, ty, m) => d.createTicket(a, b, c, t, ty, m),
    getTicketsForUser: async (u) => d.getTicketsForUser(u),
    getAllTickets: async () => d.getAllTickets(),
    getTicketById: async (i) => d.getTicketById(i),
    addTicketReply: async (i, s, n, c, st) => d.addTicketReply(i, s, n, c, st),
    setTicketStatus: async (i, s) => d.setTicketStatus(i, s),
    markTicketAsRead: async (i, u) => d.markTicketAsRead(i, u),
    saveProject: async (u, p, n, data) => d.saveProject(u, p, n, data),
    getProjectsForUser: async (u) => d.getProjectsForUser(u),
    countProjectsByUser: async () => {
      const counts: Record<string, number> = {};
      for (const u of d.getAllUsers()) counts[u.id] = d.getProjectsForUser(u.id).length;
      return counts;
    },
    getProject: async (u, p) => d.getProjectsForUser(u).find((x) => x.id === p) || null,
    deleteProject: async (u, p) => d.deleteProject(u, p),
    duplicateProject: async (u, p) => d.duplicateProject(u, p),
  };
}

let instance: DataStore | null = null;

export async function initStore(): Promise<DataStore> {
  if (instance) return instance;
  const wanted = process.env.DATA_BACKEND || (process.env.K_SERVICE ? 'firestore' : 'file');
  if (wanted === 'firestore') {
    try {
      const { createFirestoreStore } = await import('./firestoreStore');
      const storeCandidate = createFirestoreStore();

      // Probe Firestore admin permissions with a timeout
      const { ensureFirebaseApp, resolveFirebaseConfig } = await import('./firebaseAdmin');
      const { getFirestore } = await import('firebase-admin/firestore');
      const app = ensureFirebaseApp();
      const config = resolveFirebaseConfig();
      const fs = config.databaseId ? getFirestore(app, config.databaseId) : getFirestore(app);

      const probePromise = fs.collection('_probe').limit(1).get();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firestore probe timeout')), 2500)
      );
      await Promise.race([probePromise, timeoutPromise]);

      instance = storeCandidate;
      console.info(`[store] backend: firestore (${config.databaseId || 'default'})`);
      return instance;
    } catch (probeErr: unknown) {
      const msg = probeErr instanceof Error ? probeErr.message : String(probeErr);
      console.warn(`[store] Firestore is not accessible from server runtime (${msg}). Falling back to file store.`);
    }
  }

  if (process.env.NODE_ENV === 'production') {
    console.warn('[store] Using the local file store in production. Data is kept in atomic JSON store.');
  }
  instance = createFileStore();
  console.info(`[store] backend: ${instance.backend}`);
  return instance;
}

/** Use after initStore() has run at startup */
export const store: DataStore = new Proxy({} as DataStore, {
  get(_t, prop) {
    if (!instance) throw new Error('Store used before initStore()');
    return (instance as unknown as Record<string | symbol, unknown>)[prop];
  },
});
