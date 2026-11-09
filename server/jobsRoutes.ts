/**
 * Voice-talent jobs on the Express server (AI Studio and local development). Same rules as the Cloudflare version
 * (worker/jobs/handler.ts), but kept in memory: jobs disappear when the server restarts. Hosted use runs on Cloudflare.
 */
import crypto from 'crypto';
import { Readable } from 'stream';
import { Router, type Request as ExpressRequest, type Response as ExpressResponse } from 'express';
import { handleJob, RETENTION_MS } from '../worker/jobs/handler';
import { MemoryRepo } from '../worker/jobs/repo';

const MAX_JOBS = 200;
const jobs = new Map<string, { repo: MemoryRepo; last: number }>();

const newKey = () => crypto.randomBytes(24).toString('hex');

const sweep = () => {
  const cutoff = Date.now() - RETENTION_MS;
  for (const [id, j] of jobs) if (j.last < cutoff) jobs.delete(id);
};

const toWeb = (req: ExpressRequest): Request => {
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  return new Request(url, { method: req.method, headers: req.headers as Record<string, string>, ...(hasBody ? { body: Readable.toWeb(req) as unknown as ReadableStream, duplex: 'half' } : {}) } as RequestInit);
};

const send = async (res: ExpressResponse, r: Response) => {
  res.status(r.status);
  r.headers.forEach((v, k) => res.setHeader(k, v));
  if (!r.body) { res.end(); return; }
  Readable.fromWeb(r.body as never).on('error', () => res.destroy()).pipe(res);
};

export const jobsRouter = Router();

export const handleJobsRequest = async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
  try {
    const rest = req.path.split('/').filter(Boolean);
    if (rest[0] === 'ping' && req.method === 'GET') { res.json({ ok: true, createRequiresCode: false, temporary: true }); return; }
    if (rest.length === 0 && req.method === 'POST') {
      sweep();
      if (jobs.size >= MAX_JOBS) { res.status(429).json({ error: 'Too many jobs on this test server.' }); return; }
      const id = crypto.randomBytes(16).toString('hex');
      const entry = { repo: new MemoryRepo(), last: Date.now() };
      const init = await handleJob(toWeb(req), ['init'], { repo: entry.repo, now: Date.now, newKey });
      if (init.ok) jobs.set(id, entry);
      const body = (await init.json()) as Record<string, unknown>;
      res.status(init.status).json(init.ok ? { jobId: id, ...body } : body);
      return;
    }
    const entry = /^[0-9a-f]{32}$/.test(rest[0] ?? '') ? jobs.get(rest[0]) : undefined;
    if (!entry) { res.status(404).json({ error: 'This job does not exist or has been deleted.' }); return; }
    const id = rest[0];
    const out = await handleJob(toWeb(req), rest.slice(1), { repo: entry.repo, now: Date.now, newKey, touch: () => { entry.last = Date.now(); }, wipe: () => { jobs.delete(id); } });
    await send(res, out);
  } catch {
    if (!res.headersSent) res.status(500).json({ error: 'Something went wrong.' });
  }
};

jobsRouter.use('/api/jobs', handleJobsRequest);
