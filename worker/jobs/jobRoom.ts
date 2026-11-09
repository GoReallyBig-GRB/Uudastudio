import { DurableObject } from 'cloudflare:workers';
import { RETENTION_MS, handleJob } from './handler';
import { SqlRepo } from './repo';

const newKey = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(24));
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
};

/** One voice-talent job: its script, keys, message thread and audio. One of these exists per job; it deletes itself after 60 days without activity. */
export class JobRoom extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const repo = new SqlRepo(this.ctx.storage.sql);
    const parts = new URL(request.url).pathname.split('/').filter(Boolean); // api, jobs, <id>, ...rest
    const rest = parts.slice(3);
    return handleJob(request, rest, {
      repo,
      now: () => Date.now(),
      newKey,
      touch: () => { void this.ctx.storage.setAlarm(Date.now() + RETENTION_MS); },
      wipe: async () => { await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); },
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
