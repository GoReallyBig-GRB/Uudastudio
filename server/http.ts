/**
 * Uuda Studio - Small HTTP helpers: cookies and rate limits (no extra dependencies)
 */

import { Request, Response, NextFunction } from 'express';

export const SESSION_COOKIE = '__session'; // the only cookie Firebase Hosting forwards to Cloud Run

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function setSessionCookie(res: Response, token: string, maxAgeMs: number): void {
  const secure = process.env.NODE_ENV === 'production';
  res.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`
  );
}

export function clearSessionCookie(res: Response): void {
  const secure = process.env.NODE_ENV === 'production';
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
}

/**
 * Same-origin check for requests that change data. Browsers always send Origin on cross-site POSTs.
 * Requests with no Origin (curl, server to server) are allowed because they carry no ambient cookie risk.
 */
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try {
    if (new URL(origin).host === String(host).split(',')[0].trim()) {
      next();
      return;
    }
  } catch {
    // fall through
  }
  res.status(403).json({ error: 'Cross-site request blocked.' });
}

/**
 * Sliding-window rate limit kept in memory.
 * This is correct for one server instance. When more than one instance runs, the counters move to
 * Firestore (planned for the data-layer stage); until then deploy with a maximum of one instance.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(options: { name: string; windowMs: number; max: number; key?: (req: Request) => string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const keyPart = options.key ? options.key(req) : req.ip || 'unknown';
    const key = `${options.name}:${keyPart}`;
    const now = Date.now();
    const recent = (buckets.get(key) || []).filter((t) => now - t < options.windowMs);
    if (recent.length >= options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((recent[0] + options.windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: 'Too many requests. Please wait and try again.', retryAfterSec });
      return;
    }
    recent.push(now);
    buckets.set(key, recent);
    next();
  };
}

// Drop idle buckets so memory stays flat
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of buckets) {
    if (list.length === 0 || now - list[list.length - 1] > 60 * 60 * 1000) buckets.delete(key);
  }
}, 10 * 60 * 1000).unref();
