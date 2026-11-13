import { DurableObject } from 'cloudflare:workers';

interface ReservationRow extends Record<string, SqlStorageValue> { job_id: string; bytes: number }

/** Storage accounting for job audio across all JobRoom objects sharing this Worker namespace. */
export class JobRegistry extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS job_audio (job_id TEXT PRIMARY KEY, bytes INTEGER NOT NULL)');
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS upload_reservations (upload_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, bytes INTEGER NOT NULL)');
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
    const parseBody = async (): Promise<Record<string, unknown> | null> => {
      try {
        const body = await request.json() as Record<string, unknown>;
        return body && typeof body === 'object' ? body : null;
      } catch { return null; }
    };

    if (request.method === 'GET' && url.pathname === '/status') {
      const limitBytes = Number(url.searchParams.get('limitBytes'));
      const row = this.ctx.storage.sql.exec('SELECT COALESCE(SUM(bytes), 0) AS bytes FROM job_audio').toArray()[0] as { bytes: number } | undefined;
      return json({ totalBytes: Number(row?.bytes) || 0, limitBytes: Number.isSafeInteger(limitBytes) && limitBytes > 0 ? limitBytes : 0, mode: 'guarded' });
    }

    if (request.method !== 'POST') return json({ error: 'Not found.' }, 404);
    const body = await parseBody();
    if (!body) return json({ error: 'Bad request.' }, 400);

    if (url.pathname === '/reserve') {
      const jobId = typeof body.jobId === 'string' ? body.jobId : '';
      const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
      const bytes = Number(body.bytes);
      const limitBytes = Number(body.limitBytes);
      if (!jobId || !uploadId || !Number.isSafeInteger(bytes) || bytes <= 0 || !Number.isSafeInteger(limitBytes) || limitBytes <= 0) return json({ error: 'Bad request.' }, 400);
      const existing = this.ctx.storage.sql.exec('SELECT job_id, bytes FROM upload_reservations WHERE upload_id = ?', uploadId).toArray()[0] as ReservationRow | undefined;
      if (existing) return json({ allowed: String(existing.job_id) === jobId && Number(existing.bytes) === bytes });
      const row = this.ctx.storage.sql.exec<{ bytes: number }>(`SELECT
        (SELECT COALESCE(SUM(bytes), 0) FROM job_audio) +
        (SELECT COALESCE(SUM(bytes), 0) FROM upload_reservations) AS bytes`).toArray()[0];
      const total = Number(row?.bytes) || 0;
      if (total + bytes > limitBytes) return json({ allowed: false, totalBytes: total, limitBytes });
      this.ctx.storage.sql.exec('INSERT INTO upload_reservations (upload_id, job_id, bytes) VALUES (?, ?, ?)', uploadId, jobId, bytes);
      return json({ allowed: true, totalBytes: total, limitBytes });
    }

    if (url.pathname === '/report') {
      const jobId = typeof body.jobId === 'string' ? body.jobId : '';
      const bytes = Number(body.bytes);
      const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
      if (!jobId || !Number.isSafeInteger(bytes) || bytes < 0) return json({ error: 'Bad request.' }, 400);
      if (bytes > 0) this.ctx.storage.sql.exec('INSERT OR REPLACE INTO job_audio (job_id, bytes) VALUES (?, ?)', jobId, bytes);
      else this.ctx.storage.sql.exec('DELETE FROM job_audio WHERE job_id = ?', jobId);
      if (uploadId) this.ctx.storage.sql.exec('DELETE FROM upload_reservations WHERE upload_id = ? AND job_id = ?', uploadId, jobId);
      if (body.clearReservations === true) this.ctx.storage.sql.exec('DELETE FROM upload_reservations WHERE job_id = ?', jobId);
      return json({ ok: true });
    }

    if (url.pathname === '/release') {
      const jobId = typeof body.jobId === 'string' ? body.jobId : '';
      const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
      if (!jobId || !uploadId) return json({ error: 'Bad request.' }, 400);
      this.ctx.storage.sql.exec('DELETE FROM upload_reservations WHERE upload_id = ? AND job_id = ?', uploadId, jobId);
      return json({ ok: true });
    }

    return json({ error: 'Not found.' }, 404);
  }
}
