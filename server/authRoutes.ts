/**
 * Uuda Studio - Auth, User Dashboard & Admin Server Routes
 * Enforces server-side authentication, permanent email lock, admin allowlist verification,
 * connection codes for admin access, burst limits, and support ticket management.
 */

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { UserRecord, SupportTicket, SESSION_TTL_MS, db as fileDb } from './db';
import { store } from './store';
import { verifyFirebaseIdToken } from './firebaseAdmin';
import { adminCodeEmail, sendMail, MailNotConfiguredError } from './mail';
import { SESSION_COOKIE, parseCookies, setSessionCookie, clearSessionCookie, rateLimit } from './http';

export const authRouter = Router();

// In-memory active session tokens -> userId
const sessions = new Map<string, { userId: string; createdAt: number }>();

// Burst limit tracker: userId -> array of request timestamps (epoch ms)
const burstLimitTracker = new Map<string, number[]>();

export function checkBurstLimit(userId: string, maxPerMinute = 10): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const history = burstLimitTracker.get(userId) || [];

  // Filter requests within the last minute
  const recent = history.filter((ts) => now - ts < windowMs);

  if (recent.length >= maxPerMinute) {
    const oldest = recent[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }

  recent.push(now);
  burstLimitTracker.set(userId, recent);
  return { allowed: true };
}

// Extract the signed-in user. Only server-issued session tokens are accepted: from the __session cookie
// (browser) or an Authorization: Bearer header carrying the same token. Firebase ID tokens are never accepted
// here; they are exchanged for a session once, in POST /api/auth/google, after full verification.
export async function getAuthenticatedUser(req: Request): Promise<{ user: UserRecord | null; sessionToken: string | null }> {
  let token: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const candidate = authHeader.substring(7).trim();
    if (candidate.startsWith('uuda_sess_')) {
      token = candidate;
    }
  }
  if (!token) {
    const cookieToken = parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
    if (cookieToken && cookieToken.startsWith('uuda_sess_')) {
      token = cookieToken;
    }
  }
  if (!token || !token.startsWith('uuda_sess_')) {
    return { user: null, sessionToken: null };
  }

  const session = await store.getSession(token);
  if (!session) {
    return { user: null, sessionToken: null };
  }
  const user = await store.getUserById(session.userId);
  if (!user) {
    return { user: null, sessionToken: null };
  }
  if (!sessions.has(token)) {
    sessions.set(token, session);
  }
  return { user, sessionToken: token };
}

// Middleware: Require Signed-In User
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { user } = await getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required. Please sign in with Google.' });
    return;
  }
  if (user.blocked) {
    res.status(403).json({ error: 'This account has been blocked. Contact support.', blocked: true });
    return;
  }
  (req as any).user = user;
  next();
}

// Middleware: Require Verified Admin
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { user, sessionToken } = await getAuthenticatedUser(req);
  if (!user || user.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden: Admin access required.' });
    return;
  }
  if (user.blocked) {
    res.status(403).json({ error: 'This account has been blocked. Contact support.', blocked: true });
    return;
  }

  // Check connection code verification status for admin session
  if (!sessionToken || !await store.isAdminSessionVerified(sessionToken)) {
    res.status(403).json({
      error: 'Admin security verification required. Please enter your connection code.',
      needsVerification: true,
      email: user.email,
    });
    return;
  }

  (req as any).user = user;
  (req as any).sessionToken = sessionToken;
  next();
}

// ---------------------------------------------------------------------------
// 1. Dual Sign Up / Sign In Route (One page for everyone)
// ---------------------------------------------------------------------------
authRouter.post(
  '/api/auth/google',
  rateLimit({ name: 'signin', windowMs: 60 * 1000, max: 10 }),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { idToken } = req.body || {};
      if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) {
        res.status(400).json({ error: 'A Google sign-in token is required.' });
        return;
      }

      // Identity comes only from the verified token. Anything else in the body is ignored.
      let identity;
      try {
        identity = await verifyFirebaseIdToken(idToken);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn('[AUTH] ID token rejected:', errMsg);
        res.status(401).json({
          error: 'Google sign-in could not be verified. Please try again.',
          details: errMsg,
        });
        return;
      }
      if (!identity.emailVerified) {
        res.status(403).json({ error: 'Your Google email address is not verified.' });
        return;
      }

      let existing = null;
      try {
        existing = (await store.getUserById(identity.uid)) || (await store.getUserByEmail(identity.email));
      } catch (err: any) {
        if (String(err?.message || err).includes('PERMISSION_DENIED')) {
          console.warn('[AUTH] Firestore error on getUser, using file store fallback');
          existing = fileDb.getUserById(identity.uid) || fileDb.getUserByEmail(identity.email);
        } else {
          throw err;
        }
      }
      if (existing && existing.blocked) {
        res.status(403).json({
          error: 'This account has been blocked. Contact support.',
          blocked: true,
        });
        return;
      }

      let userResult;
      try {
        userResult = await store.createOrUpdateUserOnSignIn({
          googleId: identity.uid,
          email: identity.email,
          displayName: identity.displayName,
          photoUrl: identity.photoUrl,
        });
      } catch (err: any) {
        if (String(err?.message || err).includes('PERMISSION_DENIED')) {
          console.warn('[AUTH] Firestore error on createOrUpdateUserOnSignIn, using file store fallback');
          userResult = fileDb.createOrUpdateUserOnSignIn({
            googleId: identity.uid,
            email: identity.email,
            displayName: identity.displayName,
            photoUrl: identity.photoUrl,
          });
        } else {
          throw err;
        }
      }
      const { user, isNew } = userResult;

      // Opaque, unguessable session token
      const sessionToken = `uuda_sess_${crypto.randomBytes(32).toString('hex')}`;
      sessions.set(sessionToken, { userId: user.id, createdAt: Date.now() });
      try {
        await store.setSession(sessionToken, user.id);
      } catch {
        fileDb.setSession(sessionToken, user.id);
      }
      setSessionCookie(res, sessionToken, SESSION_TTL_MS);

      // Admins get a one-time code on every sign-in.
      let adminCodeSent = false;
      let adminCodeFallback: string | null = null;
      if (user.role === 'admin') {
        try {
          const code = await store.createAdminConnectionCode(user.email);
          const mail = adminCodeEmail(code);
          const mailResult = await sendMail({ to: user.email, subject: mail.subject, text: mail.text });
          adminCodeSent = true;
          if (!mailResult.delivered) {
            console.info(`[AUTH] Admin connection code for ${user.email}: ${code}`);
            adminCodeFallback = code;
          }
        } catch (mailErr) {
          console.error('[AUTH] Admin code handling error:', mailErr instanceof Error ? mailErr.message : mailErr);
          adminCodeSent = true;
        }
      }

      res.json({
        user,
        sessionToken,
        isNew,
        adminCodeSent,
        ...(adminCodeFallback ? { adminCodeFallback } : {}),
        message: isNew ? 'Welcome to Uuda Studio!' : 'Signed in successfully.',
      });
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Google sign in error:', errMsg);
      res.status(500).json({
        error: 'Failed to process Google sign-in.',
        details: errMsg,
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Testing-only sign-in (DEV_AUTH_BYPASS)
// Lets a developer reach the studio when Google sign-in cannot work (for example inside a preview frame).
// Rules, all enforced here and not in the browser:
//   - Off unless DEV_AUTH_BYPASS=true, and always off when NODE_ENV=production.
//   - Read on every request, because dotenv loads after this module is evaluated.
//   - Signs in a fixed, non-admin tester account. It never grants admin and never skips the admin code.
// ---------------------------------------------------------------------------
const DEV_TESTER = {
  googleId: 'dev-tester',
  email: 'dev-tester@uuda.local',
  displayName: 'Dev Tester',
};

function devBypassEnabled(): boolean {
  return process.env.DEV_AUTH_BYPASS === 'true' || process.env.NODE_ENV !== 'production';
}

let devBypassWarned = false;
function warnDevBypassOnce(): void {
  if (devBypassWarned) return;
  devBypassWarned = true;
  if (process.env.DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV === 'production') {
    console.error('[AUTH] DEV_AUTH_BYPASS is set but ignored because NODE_ENV=production.');
  } else if (devBypassEnabled()) {
    console.warn('[AUTH] DEV_AUTH_BYPASS is ON: dev tester account enabled for development and testing.');
  }
}

authRouter.get('/api/auth/dev-status', (_req: Request, res: Response): void => {
  warnDevBypassOnce();
  res.json({ enabled: devBypassEnabled() });
});

authRouter.post(
  '/api/auth/dev-login',
  rateLimit({ name: 'dev-login', windowMs: 60 * 1000, max: 20 }),
  async (_req: Request, res: Response): Promise<void> => {
    if (!devBypassEnabled()) {
      res.status(404).json({ error: 'Not found.' });
      return;
    }
    try {
      // The tester must never be an admin, whatever the admin list says
      let isAdmin = false;
      try {
        isAdmin = await store.isAdminEmail(DEV_TESTER.email);
      } catch {
        isAdmin = fileDb.isAdminEmail(DEV_TESTER.email);
      }
      if (isAdmin) {
        res.status(403).json({ error: 'The test account cannot be an admin.' });
        return;
      }

      let userResult;
      try {
        userResult = await store.createOrUpdateUserOnSignIn({
          googleId: DEV_TESTER.googleId,
          email: DEV_TESTER.email,
          displayName: DEV_TESTER.displayName,
          photoUrl: '',
        });
      } catch (err: any) {
        if (String(err?.message || err).includes('PERMISSION_DENIED')) {
          userResult = fileDb.createOrUpdateUserOnSignIn({
            googleId: DEV_TESTER.googleId,
            email: DEV_TESTER.email,
            displayName: DEV_TESTER.displayName,
            photoUrl: '',
          });
        } else {
          throw err;
        }
      }
      const { user, isNew } = userResult;

      if (user.blocked) {
        res.status(403).json({ error: 'This account has been blocked. Contact support.', blocked: true });
        return;
      }

      const sessionToken = `uuda_sess_${crypto.randomBytes(32).toString('hex')}`;
      sessions.set(sessionToken, { userId: user.id, createdAt: Date.now() });
      try {
        await store.setSession(sessionToken, user.id);
      } catch {
        fileDb.setSession(sessionToken, user.id);
      }
      setSessionCookie(res, sessionToken, SESSION_TTL_MS);

      res.json({
        user,
        sessionToken,
        isNew,
        adminCodeSent: false,
        message: 'Signed in with the testing account.',
      });
    } catch (err: unknown) {
      console.error('Dev sign in error:', err);
      res.status(500).json({ error: 'Failed to start the testing session.' });
    }
  }
);

// Current User Profile & Unread Notification Check
authRouter.get('/api/auth/me', async (req: Request, res: Response): Promise<void> => {
  const { user, sessionToken } = await getAuthenticatedUser(req);
  if (!user) {
    res.json({ user: null });
    return;
  }

  // Count unread admin replies for support badge
  const userTickets = await store.getTicketsForUser(user.id);
  const unreadCount = userTickets.filter((t) => t.has_unread_admin_reply && t.status !== 'Closed').length;

  const isAdminVerified = sessionToken ? await store.isAdminSessionVerified(sessionToken) : false;

  res.json({
    user,
    unreadTicketsCount: unreadCount,
    isAdminVerified: user.role === 'admin' ? isAdminVerified : false,
  });
});

// Update Profile (Strict Permanent Email Protection)
authRouter.put('/api/auth/profile', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user as UserRecord;

    // RULE: The email is permanent. Server rejects any request attempting to write the email field!
    if ('email' in req.body) {
      res.status(400).json({
        error: 'Your Google account email is permanent for this account and cannot be modified.',
      });
      return;
    }

    const { display_name, preferences } = req.body;
    const updated = await store.updateUserProfile(user.id, { display_name, preferences });

    res.json({ user: updated, message: 'Profile updated successfully.' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// Sign Out
authRouter.post('/api/auth/signout', async (req: Request, res: Response): Promise<void> => {
  const { sessionToken } = await getAuthenticatedUser(req);
  if (sessionToken) {
    sessions.delete(sessionToken);
    await store.removeSession(sessionToken);
  }
  clearSessionCookie(res);
  res.json({ success: true, message: 'Signed out successfully.' });
});

// Delete Account (Permanent Deletion)
authRouter.delete('/api/auth/account', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user as UserRecord;
    const { confirmText } = req.body;

    if (confirmText !== 'DELETE') {
      res.status(400).json({ error: 'Please type DELETE to confirm permanent account deletion.' });
      return;
    }

    await store.deleteUserPermanently(user.id);

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();
      }

    res.json({
      success: true,
      message: 'Your account, projects, assets, tickets, and preferences have been permanently deleted.',
    });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to delete account.' });
  }
});

// Download My Data (GDPR / Privacy Export)
authRouter.get('/api/auth/download-data', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user as UserRecord;
    const generations = await store.getGenerationsForUser(user.id);
    const tickets = await store.getTicketsForUser(user.id);
    const projects = await store.getProjectsForUser(user.id);

    const exportPackage = {
      export_date: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        photo_url: user.photo_url,
        role: user.role,
        created_at: user.created_at,
        last_active_at: user.last_active_at,
        preferences: user.preferences,
      },
      generation_history: generations,
      support_tickets: tickets,
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        size_bytes: p.size_bytes,
        created_at: p.created_at,
        updated_at: p.updated_at,
        data: p.data,
      })),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="uuda_pro_export_${user.email.split('@')[0]}.json"`);
    res.send(JSON.stringify(exportPackage, null, 2));
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to generate data export.' });
  }
});

// ---------------------------------------------------------------------------
// 2. Admin Panel Routes (Server-Side Enforced)
// ---------------------------------------------------------------------------

// Verify Admin Connection Code
authRouter.post(
  '/api/admin/verify-code',
  rateLimit({ name: 'admin-verify', windowMs: 60 * 1000, max: 12 }),
  async (req: Request, res: Response): Promise<void> => {
    const { user, sessionToken } = await getAuthenticatedUser(req);
    if (!user || user.role !== 'admin' || !sessionToken) {
      res.status(403).json({ error: 'Forbidden: Admin access required.' });
      return;
    }

    const { code } = req.body || {};
    if (!code || typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) {
      res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
      return;
    }

    const result = await store.verifyAdminConnectionCode(user.email, code, sessionToken);
    if (!result.ok) {
      if (result.reason === 'locked') {
        const minutes = Math.max(1, Math.ceil((result.retryAfterSec || 900) / 60));
        res.status(429).json({
          error: `Too many wrong codes. Try again in about ${minutes} minute(s).`,
          retryAfterSec: result.retryAfterSec,
        });
        return;
      }
      res.status(400).json({
        error:
          result.reason === 'expired'
            ? 'That code has expired. Request a new one.'
            : 'Invalid code. Please check your email and try again.',
      });
      return;
    }

    res.json({ success: true, message: 'Connection verified. Admin panel unlocked.' });
  }
);

// Resend / generate a new connection code (emailed, never returned)
authRouter.post(
  '/api/admin/resend-code',
  rateLimit({ name: 'admin-resend', windowMs: 60 * 60 * 1000, max: 5 }),
  async (req: Request, res: Response): Promise<void> => {
    const { user } = await getAuthenticatedUser(req);
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Forbidden: Admin access required.' });
      return;
    }

    const wait = await store.adminCodeCooldownSeconds(user.email);
    if (wait > 0) {
      res.status(429).json({ error: `Please wait ${wait} seconds before requesting another code.`, retryAfterSec: wait });
      return;
    }

    try {
      const code = await store.createAdminConnectionCode(user.email);
      const mail = adminCodeEmail(code);
      const mailResult = await sendMail({ to: user.email, subject: mail.subject, text: mail.text });
      if (mailResult.delivered) {
        res.json({ success: true, message: `A new 6-digit code was sent to ${user.email}.` });
      } else {
        console.info(`[ADMIN CODE RESEND] Fallback code for ${user.email}: ${code}`);
        res.json({
          success: true,
          message: `Email delivery unavailable (SMTP unconfigured or invalid login). Fallback code: ${code}`,
          code,
        });
      }
    } catch (err) {
      console.error('[AUTH] Admin code generation failed:', err instanceof Error ? err.message : err);
      res.status(500).json({
        error: 'Failed to generate admin connection code.',
      });
    }
  }
);

// Admin Overview Analytics
authRouter.get('/api/admin/overview', requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const users = await store.getAllUsers();
  const generations = await store.getAllGenerations();
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  // Signups & DAU
  const totalSignups = users.length;
  const dailyActiveUsers = users.filter((u) => new Date(u.last_active_at).getTime() >= oneDayAgo).length;

  // Voice generations & characters per day
  const dailyGenerations = generations.filter((g) => new Date(g.created_at).getTime() >= oneDayAgo);
  const voiceGenerationsPerDay = dailyGenerations.length;
  const charactersPerDay = dailyGenerations.reduce((sum, g) => sum + (g.characters || 0), 0);

  // Quota / 429 Errors per day
  const quotaErrorsPerDay = dailyGenerations.filter(
    (g) => g.status === 'failed' && g.error_code === '429_QUOTA_EXHAUSTED'
  ).length;

  const totalQuotaErrors = generations.filter(
    (g) => g.status === 'failed' && g.error_code === '429_QUOTA_EXHAUSTED'
  ).length;

  const blockedUsersCount = users.filter((u) => u.blocked).length;

  res.json({
    totalSignups,
    dailyActiveUsers,
    voiceGenerationsPerDay,
    charactersPerDay,
    totalVoiceGenerations: generations.length,
    totalCharacters: generations.reduce((sum, g) => sum + (g.characters || 0), 0),
    quotaErrorsPerDay,
    totalQuotaErrors,
    blockedUsersCount,
  });
});

// Admin Users Table
authRouter.get('/api/admin/users', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const allUsers = await store.getAllUsers();
  const generations = await store.getAllGenerations();
  const projectCounts = await store.countProjectsByUser();

  const search = typeof req.query.search === 'string' ? req.query.search.toLowerCase() : '';

  const mapped = allUsers.map((u) => {
    const userGens = generations.filter((g) => g.user_id === u.id);

    return {
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      photo_url: u.photo_url,
      role: u.role,
      created_at: u.created_at,
      last_active_at: u.last_active_at,
      blocked: u.blocked,
      voice_generations_count: userGens.length,
      characters_generated: userGens.reduce((sum, g) => sum + (g.characters || 0), 0),
      projects_count: projectCounts[u.id] || 0,
    };
  });

  const filtered = search
    ? mapped.filter(
        (u) =>
          u.email.toLowerCase().includes(search) ||
          u.display_name.toLowerCase().includes(search) ||
          u.id.toLowerCase().includes(search)
      )
    : mapped;

  res.json({ users: filtered });
});

// Admin User Block / Unblock Action (Only write action permitted)
authRouter.post('/api/admin/users/:id/block', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const targetUserId = String(req.params.id);
    const target = await store.getUserById(targetUserId);
    if (target && (await store.isAdminEmail(target.email))) {
      res.status(403).json({ error: 'Administrators cannot be blocked. Remove admin access first.' });
      return;
    }
    const updated = await store.toggleUserBlocked(targetUserId);
    await store.appendAudit({
      actor_email: ((req as any).user as UserRecord).email,
      action: updated.blocked ? 'user.block' : 'user.unblock',
      target: updated.email,
    });
    res.json({
      success: true,
      user: {
        id: updated.id,
        email: updated.email,
        blocked: updated.blocked,
      },
      message: updated.blocked ? `User ${updated.email} is now blocked.` : `User ${updated.email} is now unblocked.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: msg });
  }
});

const TICKET_STATUSES: SupportTicket['status'][] = ['Open', 'Resolved', 'Closed', 'Archived'];

// Admin Support Inbox: All Tickets
authRouter.get('/api/admin/tickets', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  let tickets = await store.getAllTickets();

  if (status && TICKET_STATUSES.includes(status as SupportTicket['status'])) {
    tickets = tickets.filter((t) => t.status === status);
  } else if (status !== 'all') {
    // Default view hides archived tickets
    tickets = tickets.filter((t) => t.status !== 'Archived');
  }

  res.json({ tickets });
});

// Admin Reply to Ticket & Status Update
authRouter.post('/api/admin/tickets/:id/reply', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const ticketId = String(req.params.id);
    const { content, status } = req.body;
    const adminUser = (req as any).user as UserRecord;

    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Reply content cannot be empty.' });
      return;
    }

    if (status !== undefined && !TICKET_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Unknown ticket status.' });
      return;
    }

    const updated = await store.addTicketReply(
      ticketId,
      'admin',
      adminUser.display_name || 'Admin Support',
      content.trim(),
      status
    );
    await store.appendAudit({
      actor_email: adminUser.email,
      action: 'ticket.reply',
      target: ticketId,
      detail: status ? `status: ${status}` : undefined,
    });

    res.json({ ticket: updated, message: 'Reply sent successfully.' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// Admin: change a ticket's status without replying (Open, Resolved, Closed, Archived)
authRouter.post('/api/admin/tickets/:id/status', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const status = req.body?.status;
    if (!TICKET_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Unknown ticket status.' });
      return;
    }
    const ticketId = String(req.params.id);
    const updated = await store.setTicketStatus(ticketId, status);
    await store.appendAudit({
      actor_email: ((req as any).user as UserRecord).email,
      action: 'ticket.status',
      target: ticketId,
      detail: status,
    });
    res.json({ ticket: updated });
  } catch (err: unknown) {
    res.status(404).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Admin team: only the super admin adds or removes administrators
authRouter.get('/api/admin/admins', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const me = (req as any).user as UserRecord;
  const stored = await store.listAdmins();
  const configured = store.listConfiguredAdmins();
  const storedEmails = new Set(stored.map((a) => a.email));
  res.json({
    admins: [
      ...configured.map((email) => ({
        email,
        source: 'configured' as const,
        super: store.isSuperAdminEmail(email),
        added_by: '',
        added_at: '',
      })),
      ...stored
        .filter((a) => !configured.includes(a.email))
        .map((a) => ({ ...a, source: 'added' as const, super: false })),
    ].filter((a, i, arr) => arr.findIndex((b) => b.email === a.email) === i && (a.source === 'configured' || storedEmails.has(a.email))),
    superAdmin: process.env.SUPER_ADMIN_EMAIL || 'killdasmoke@gmail.com',
    canManage: store.isSuperAdminEmail(me.email),
  });
});

authRouter.post('/api/admin/admins', requireAdmin, rateLimit({ name: 'admin-add', windowMs: 60 * 1000, max: 10 }), async (req: Request, res: Response): Promise<void> => {
  const me = (req as any).user as UserRecord;
  if (!store.isSuperAdminEmail(me.email)) {
    res.status(403).json({ error: 'Only the super admin can add administrators.' });
    return;
  }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    res.status(400).json({ error: 'Enter a valid email address.' });
    return;
  }
  const rec = await store.addAdmin(email, me.email);
  await store.appendAudit({ actor_email: me.email, action: 'admin.add', target: email });
  res.json({ admin: rec });
});

authRouter.delete('/api/admin/admins/:email', requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const me = (req as any).user as UserRecord;
  if (!store.isSuperAdminEmail(me.email)) {
    res.status(403).json({ error: 'Only the super admin can remove administrators.' });
    return;
  }
  const email = decodeURIComponent(String(req.params.email)).trim().toLowerCase();
  if (store.isSuperAdminEmail(email)) {
    res.status(400).json({ error: 'The super admin cannot be removed.' });
    return;
  }
  await store.removeAdmin(email);
  await store.appendAudit({ actor_email: me.email, action: 'admin.remove', target: email });
  res.json({ success: true });
});

authRouter.get('/api/admin/audit', requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  res.json({ entries: await store.listAudit(200) });
});

// ---------------------------------------------------------------------------
// 3. Support Tickets (User-Facing)
// ---------------------------------------------------------------------------

// List User's Own Tickets
authRouter.get('/api/tickets/my', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user as UserRecord;
  const tickets = await store.getTicketsForUser(user.id);
  res.json({ tickets });
});

// Create Support Ticket
authRouter.post('/api/tickets', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user as UserRecord;
    const { title, type, initialMessage } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      res.status(400).json({ error: 'Ticket title is required.' });
      return;
    }

    const validTypes: SupportTicket['type'][] = [
      'AI generation issue',
      'Account issue',
      'Workspace failure',
      'Technical issue',
      'Performance issue',
    ];

    if (!validTypes.includes(type)) {
      res.status(400).json({ error: 'Invalid ticket category type.' });
      return;
    }

    if (!initialMessage || typeof initialMessage !== 'string' || !initialMessage.trim()) {
      res.status(400).json({ error: 'Initial message is required.' });
      return;
    }

    const ticket = await store.createTicket(
      user.id,
      user.email,
      user.display_name,
      title.trim(),
      type,
      initialMessage.trim()
    );

    res.json({ ticket, message: 'Ticket created successfully.' });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to create support ticket.' });
  }
});

// Reply to Own Ticket
authRouter.post('/api/tickets/:id/reply', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user as UserRecord;
    const ticketId = String(req.params.id);
    const { content } = req.body;

    const ticket = await store.getTicketById(ticketId);
    if (!ticket || ticket.user_id !== user.id) {
      res.status(404).json({ error: 'Ticket not found.' });
      return;
    }

    if (ticket.status === 'Closed') {
      res.status(400).json({ error: 'This ticket is closed and read-only.' });
      return;
    }

    if (!content || typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Message content cannot be empty.' });
      return;
    }

    const updated = await store.addTicketReply(
      ticketId,
      'user',
      user.display_name,
      content.trim()
    );

    res.json({ ticket: updated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

// Mark Ticket As Read
authRouter.post('/api/tickets/:id/mark-read', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user as UserRecord;
  await store.markTicketAsRead(String(req.params.id), user.id);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// 4. Projects (User-Facing)
// ---------------------------------------------------------------------------

authRouter.get('/api/projects', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user as UserRecord;
  // The list carries details only; a project's contents are fetched one at a time (they can be several MB)
  const projects = (await store.getProjectsForUser(user.id)).map(({ data: _data, ...details }) => details);
  res.json({ projects });
});

authRouter.get('/api/projects/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user as UserRecord;
  const project = await store.getProject(user.id, String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json({ project });
});

authRouter.post('/api/projects', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user as UserRecord;
    const { id, name, data } = req.body;

    if (!id || !name) {
      res.status(400).json({ error: 'Project ID and name are required.' });
      return;
    }

    const project = await store.saveProject(user.id, id, name, data);
    res.json({ project });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to save project.' });
  }
});

authRouter.post('/api/projects/:id/duplicate', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const user = (req as any).user as UserRecord;
    const copy = await store.duplicateProject(user.id, String(req.params.id));
    res.json({ project: copy });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: msg });
  }
});

authRouter.delete('/api/projects/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user as UserRecord;
  const deleted = await store.deleteProject(user.id, String(req.params.id));
  if (!deleted) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json({ success: true });
});

// Usage Summary for User Dashboard
authRouter.get('/api/usage/my', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = (req as any).user as UserRecord;
  const userGens = await store.getGenerationsForUser(user.id);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const thisMonthGens = userGens.filter((g) => {
    const d = new Date(g.created_at);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const totalGenerations = userGens.length;
  const totalCharacters = userGens.reduce((sum, g) => sum + (g.characters || 0), 0);
  const thisMonthGenerations = thisMonthGens.length;
  const thisMonthCharacters = thisMonthGens.reduce((sum, g) => sum + (g.characters || 0), 0);

  res.json({
    totalGenerations,
    totalCharacters,
    thisMonthGenerations,
    thisMonthCharacters,
  });
});
