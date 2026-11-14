import { useRef, useState } from 'react';
import { ApiError, createClientLink, createJob, deleteJob, ping, postMessage } from './api';

/**
 * A page that tests the real server from the person's own browser, for the places the build machine cannot reach.
 * Open it at #/selftest, press Run, then copy the result. It makes one test job and deletes it at the end.
 */
const IDLE_SECONDS = 60;
type Line = { ok: boolean | null; text: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wsUrl = (id: string, key: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/jobs/${id}/live?k=${encodeURIComponent(key)}`;

/** One test connection that records what it hears */
const sock = (id: string, key: string) => {
  const s = { ws: null as WebSocket | null, msgs: [] as { at: number; data: string }[], closed: null as number | null, opened: 0 };
  s.ws = new WebSocket(wsUrl(id, key));
  const t0 = performance.now();
  const ready = new Promise<boolean>((res) => {
    s.ws!.onopen = () => { s.opened = performance.now() - t0; res(true); };
    s.ws!.onerror = () => res(false);
    s.ws!.onclose = (e) => { s.closed = e.code; res(false); };
  });
  s.ws.onmessage = (e) => s.msgs.push({ at: performance.now(), data: String(e.data) });
  s.ws.addEventListener('close', (e) => { s.closed = e.code; });
  return { s, ready, close: () => { try { s.ws?.close(1000); } catch { /* gone */ } } };
};

const until = async (cond: () => boolean, ms: number) => { const t = performance.now(); while (!cond() && performance.now() - t < ms) await sleep(25); return cond(); };

export default function SelfTest() {
  const [lines, setLines] = useState<Line[]>([]);
  const [running, setRunning] = useState(false);
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(0);
  const [copied, setCopied] = useState(false);
  const out = useRef<Line[]>([]);
  const add = (ok: boolean | null, text: string) => { out.current = [...out.current, { ok, text }]; setLines(out.current); };

  const run = async () => {
    out.current = []; setLines([]); setRunning(true); setCopied(false);
    const realFetch = window.fetch;
    const seen: string[] = [];
    let fetches = 0;
    window.fetch = ((...a: Parameters<typeof fetch>) => { fetches++; seen.push(String(a[0] instanceof Request ? a[0].url : a[0]).replace(location.origin, '')); return realFetch(...a); }) as typeof fetch;
    let job: { jobId: string; producerKey: string; talentKey: string } | null = null;
    const socks: Array<() => void> = [];
    try {
      add(null, `Address: ${location.origin}`);
      const t0 = performance.now();
      const p = await ping();
      if (!p) { add(false, 'The jobs service did not answer.'); return; }
      add(true, `Service answers (${Math.round(performance.now() - t0)} ms). Create code needed: ${p.createRequiresCode ? 'yes' : 'no'}.`);
      if (p.createRequiresCode && !code.trim()) { add(false, 'This server needs a create code. Type it in the box and press Run again.'); return; }

      try {
        const r = await realFetch('/api/jobs/_status', { cache: 'no-store' });
        const b = await r.json() as { mode?: string; totalBytes?: number; limitBytes?: number };
        add(r.ok && b.mode !== undefined, b.mode === 'unguarded' ? 'Storage guard: not configured on this server.' : `Storage guard: ${b.mode}, ${b.totalBytes} of ${b.limitBytes} bytes used.`);
      } catch { add(false, 'Storage status could not be read.'); }

      job = await createJob({ title: 'Self-test (delete me)', script: 'Test', notes: '', producer: 'Self-test' }, code.trim() || undefined);
      add(true, 'Test job created.');
      const client = await createClientLink(job.jobId, job.producerKey);

      const prod = sock(job.jobId, job.producerKey), talent = sock(job.jobId, job.talentKey), cli = sock(job.jobId, client.clientKey);
      socks.push(prod.close, talent.close, cli.close);
      const [a, b, c] = await Promise.all([prod.ready, talent.ready, cli.ready]);
      add(a && b && c, a && b && c ? `Live connections open (producer ${Math.round(prod.s.opened)} ms, talent ${Math.round(talent.s.opened)} ms, client ${Math.round(cli.s.opened)} ms).` : `Live connection failed (producer ${a}, talent ${b}, client ${c}). Pages will fall back to polling.`);

      if (a && b && c) {
        // 1. Talent posts: the producer should hear at once, the client should not.
        const before = prod.s.msgs.length, sentAt = performance.now();
        await postMessage(job.jobId, job.talentKey, 'Self-test', 'hello');
        const heard = await until(() => prod.s.msgs.length > before, 5000);
        const ms = heard ? Math.round(prod.s.msgs[before].at - sentAt) : 0;
        add(heard && ms < 2000, heard ? `Producer is told of a talent message in ${ms} ms.` : 'Producer was NOT told within 5 s.');
        await sleep(1500);
        add(cli.s.msgs.length === 0, cli.s.msgs.length === 0 ? 'Client is not told about the talent thread (correct).' : 'Client was told about the talent thread (wrong).');

        // 2. Replacing the client link closes the old connection with 4001.
        await createClientLink(job.jobId, job.producerKey);
        const closed = await until(() => cli.s.closed !== null, 5000);
        add(closed && cli.s.closed === 4001, closed ? `Old client connection closed with code ${cli.s.closed} (expected 4001).` : 'Old client connection stayed open after the link changed.');

        // 3. ping/pong answered by the runtime
        const pingAt = performance.now(), n0 = talent.s.msgs.length;
        talent.s.ws?.send('ping');
        const pong = await until(() => talent.s.msgs.length > n0 && talent.s.msgs[n0].data === 'pong', 3000);
        add(pong, pong ? `Ping answered in ${Math.round(talent.s.msgs[n0].at - pingAt)} ms.` : 'Ping was not answered.');
      }

      // 4. Idle: pages open, nothing happening. Count requests.
      const f0 = fetches, s0 = seen.length, m0 = prod.s.msgs.length + talent.s.msgs.length;
      for (let i = IDLE_SECONDS; i > 0; i--) { setLeft(i); await sleep(1000); }
      setLeft(0);
      const idleFetches = fetches - f0, idleMsgs = prod.s.msgs.length + talent.s.msgs.length - m0;
      add(idleFetches <= 1, `Idle ${IDLE_SECONDS} s with two live connections open: ${idleFetches} requests from this page, ${idleMsgs} live messages${idleFetches ? ` (${seen.slice(s0).join(', ')})` : ''}. Page polling is measured on the real Jobs screens, not here.`);
    } catch (e) {
      add(false, `Stopped: ${e instanceof ApiError ? `${e.status} ${e.message}` : e instanceof Error ? e.message : String(e)}`);
    } finally {
      for (const c of socks) c();
      if (job) {
        try { await deleteJob(job.jobId, job.producerKey); add(true, 'Test job deleted.'); } catch (e) { add(false, `Test job NOT deleted: ${e instanceof Error ? e.message : 'unknown'}. Delete it from the Jobs panel.`); }
      }
      window.fetch = realFetch;
      setRunning(false);
    }
  };

  const report = () => [`Uuda self-test ${new Date().toISOString()}`, navigator.userAgent, ...out.current.map((l) => `${l.ok === null ? 'INFO' : l.ok ? 'PASS' : 'FAIL'}  ${l.text}`)].join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(report()); setCopied(true); } catch { setCopied(false); } };
  const verdict = lines.some((l) => l.ok === false) ? 'FAIL' : lines.length && !running ? 'PASS' : '';

  return (
    <main className="min-h-screen bg-surface-0 p-6 text-ink">
      <div className="mx-auto max-w-xl">
        <h1 className="text-lg font-semibold">Self-test</h1>
        <p className="mt-1 text-sm text-ink-dim">Checks live updates and request counts against this server. It takes about {IDLE_SECONDS + 10} seconds, makes one test job and deletes it. Keep this tab open and in front.</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Create code (only if asked)" type="password" className="h-9 rounded-md border border-line bg-surface-1 px-3 text-sm text-ink" />
          <button disabled={running} onClick={run} className="h-9 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-50">{running ? (left ? `Waiting ${left} s` : 'Running...') : 'Run'}</button>
          <button disabled={!lines.length || running} onClick={copy} className="h-9 rounded-md border border-line px-4 text-sm text-ink disabled:opacity-50">{copied ? 'Copied' : 'Copy result'}</button>
        </div>
        {verdict && <p className={`mt-4 text-base font-semibold ${verdict === 'PASS' ? 'text-ok' : 'text-danger'}`}>{verdict}</p>}
        <ul className="mt-3 space-y-1.5 text-sm">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2"><span className={`w-10 shrink-0 font-mono text-xs ${l.ok === null ? 'text-ink-dim' : l.ok ? 'text-ok' : 'text-danger'}`}>{l.ok === null ? 'INFO' : l.ok ? 'PASS' : 'FAIL'}</span><span>{l.text}</span></li>
          ))}
        </ul>
      </div>
    </main>
  );
}
