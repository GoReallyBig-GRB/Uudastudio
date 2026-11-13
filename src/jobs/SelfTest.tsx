import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Radio, RotateCw } from 'lucide-react';
import { Button } from '../components/ui';
import { createClientLink, createJob, deleteJob, ping, postMessage } from './api';

type Check = { name: string; passed: boolean; detail: string };
type LiveMessage = { t?: string; th?: string };

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const socketUrl = (jobId: string, key: string) => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/jobs/${encodeURIComponent(jobId)}/live?k=${encodeURIComponent(key)}`;

const openSocket = (jobId: string, key: string, onMessage: (message: LiveMessage) => void, onCount: () => void): Promise<WebSocket> => new Promise((resolve, reject) => {
  const socket = new WebSocket(socketUrl(jobId, key));
  let opened = false;
  const timeout = window.setTimeout(() => { if (!opened) { socket.close(); reject(new Error('WebSocket did not open within 10 seconds.')); } }, 10000);
  socket.addEventListener('open', () => { opened = true; window.clearTimeout(timeout); resolve(socket); }, { once: true });
  socket.addEventListener('message', (event) => {
    onCount();
    try { onMessage(JSON.parse(String(event.data)) as LiveMessage); } catch { /* count non-JSON frames too */ }
  });
  socket.addEventListener('error', () => { if (!opened) { window.clearTimeout(timeout); reject(new Error('WebSocket connection failed.')); } });
  socket.addEventListener('close', (event) => { if (!opened) { window.clearTimeout(timeout); reject(new Error(`WebSocket closed before opening (${event.code}).`)); } });
});

const closeSocket = (socket: WebSocket | null) => { if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'self-test finished'); };

/** A disposable, signed-out diagnostic for checking the live jobs API on the real Worker. */
const SelfTest: React.FC = () => {
  const [createCode, setCreateCode] = useState('');
  const [requiresCode, setRequiresCode] = useState(false);
  const [running, setRunning] = useState(false);
  const [idleSeconds, setIdleSeconds] = useState<number | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [copyState, setCopyState] = useState('');

  useEffect(() => { void ping().then((info) => { if (info) setRequiresCode(info.createRequiresCode); }); }, []);

  const run = useCallback(async () => {
    setRunning(true); setChecks([]); setIdleSeconds(null); setCopyState('');
    const results: Check[] = [];
    const record = (name: string, passed: boolean, detail: string) => {
      results.push({ name, passed, detail });
      setChecks([...results]);
    };
    const originalFetch = window.fetch;
    let fetchCount = 0;
    let producer: WebSocket | null = null;
    let talent: WebSocket | null = null;
    let client: WebSocket | null = null;
    let testJob: { jobId: string; producerKey: string; talentKey: string } | null = null;
    let messagesReceived = 0;

    window.fetch = function (...args: Parameters<typeof fetch>) {
      fetchCount++;
      return originalFetch.apply(this, args);
    };

    try {
      const pingStarted = performance.now();
      const pingResult = await ping();
      record('Jobs API ping', !!pingResult, pingResult ? `PASS response in ${Math.round(performance.now() - pingStarted)} ms; ${pingResult.temporary ? 'temporary service' : 'persistent service'}.` : 'GET /api/jobs/ping did not return a valid response.');
      if (!pingResult) throw new Error('The Jobs API is not reachable from this page.');
      setRequiresCode(pingResult.createRequiresCode);

      testJob = await createJob({ title: `Worker self-test ${new Date().toISOString().slice(0, 19)}`, producer: 'Uuda self-test', talent: 'Self-test talent', script: 'Temporary live-update diagnostic.', notes: '' }, createCode.trim() || undefined);
      record('Create disposable job', true, 'PASS; a temporary job was created.');

      let notify: ((at: number) => void) | null = null;
      producer = await openSocket(testJob.jobId, testJob.producerKey, (message) => {
        if (message.t === 'changed' && message.th === 'talent' && notify) {
          const done = notify;
          notify = null;
          done(performance.now());
        }
      }, () => { messagesReceived++; });
      record('Producer live connection', true, 'PASS; producer WebSocket opened.');
      talent = await openSocket(testJob.jobId, testJob.talentKey, () => undefined, () => { messagesReceived++; });
      record('Talent live connection', true, 'PASS; talent WebSocket opened.');

      const notified = new Promise<number>((resolve) => { notify = resolve; });
      const messageStarted = performance.now();
      await postMessage(testJob.jobId, testJob.talentKey, 'Self-test talent', `Live diagnostic ${Date.now()}`);
      const notifyAt = await Promise.race([
        notified,
        wait(10000).then(() => { throw new Error('No producer notification arrived within 10 seconds.'); }),
      ]);
      record('Message notification', true, `PASS; producer notified in ${Math.round(notifyAt - messageStarted)} ms.`);

      const firstClient = await createClientLink(testJob.jobId, testJob.producerKey);
      client = await openSocket(testJob.jobId, firstClient.clientKey, () => undefined, () => { messagesReceived++; });
      const closedForReplacement = new Promise<number>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Old client socket was not closed within 10 seconds.')), 10000);
        client!.addEventListener('close', (event) => { window.clearTimeout(timeout); resolve(event.code); }, { once: true });
      });
      const currentClient = await createClientLink(testJob.jobId, testJob.producerKey);
      const closeCode = await closedForReplacement;
      record('Replaced client link closes old socket', closeCode === 4001, `${closeCode === 4001 ? 'PASS' : 'FAIL'}; close code ${closeCode}, expected 4001.`);
      closeSocket(client); client = null;
      client = await openSocket(testJob.jobId, currentClient.clientKey, () => undefined, () => { messagesReceived++; });

      const fetchAtIdle = fetchCount;
      const messagesAtIdle = messagesReceived;
      const idleStarted = performance.now();
      for (let remaining = 60; remaining > 0; remaining--) { setIdleSeconds(remaining); await wait(1000); }
      setIdleSeconds(0);
      const idleMs = Math.round(performance.now() - idleStarted);
      const idleFetches = fetchCount - fetchAtIdle;
      const idleMessages = messagesReceived - messagesAtIdle;
      const socketsOpen = [producer, talent, client].every((socket) => socket?.readyState === WebSocket.OPEN);
      record('Live sockets remain open while idle', socketsOpen, `${socketsOpen ? 'PASS' : 'FAIL'}; producer, talent, and current client socket ${socketsOpen ? 'remained open' : 'did not all remain open'}.`);
      record('60-second idle request count', idleFetches === 0, `${idleFetches === 0 ? 'PASS' : 'FAIL'}; ${idleFetches} fetch calls in ${idleMs} ms.`);
      record('60-second idle WebSocket message count', idleMessages === 0, `${idleMessages === 0 ? 'PASS' : 'FAIL'}; ${idleMessages} messages received in ${idleMs} ms.`);
    } catch (error) {
      record('Self-test run', false, error instanceof Error ? error.message : 'The diagnostic did not finish.');
    } finally {
      closeSocket(producer); closeSocket(talent); closeSocket(client);
      if (testJob) {
        try { await deleteJob(testJob.jobId, testJob.producerKey); record('Delete disposable job', true, 'PASS; the test job was deleted.'); }
        catch (error) { record('Delete disposable job', false, error instanceof Error ? error.message : 'The temporary job could not be deleted.'); }
      }
      window.fetch = originalFetch;
      record('Total diagnostic fetch calls', true, `${fetchCount} fetch calls during the diagnostic, including setup and cleanup.`);
      setRunning(false); setIdleSeconds(null);
    }
  }, [createCode]);

  const text = checks.map((check) => `${check.passed ? 'PASS' : 'FAIL'} | ${check.name} | ${check.detail}`).join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopyState('Copied'); }
    catch { setCopyState('Copy was blocked. Select and copy the result below.'); }
  };

  return (
    <main className="min-h-dvh bg-surface-0 px-4 py-8 text-ink sm:px-6">
      <section className="mx-auto max-w-2xl space-y-5">
        <header className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Radio className="h-5 w-5" aria-hidden /></span>
          <div><p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">UUDA STUDIO · WORKER CHECK</p><h1 className="mt-1 text-xl font-semibold">Live service self-test</h1><p className="mt-1 text-sm text-ink-dim">Creates and deletes one temporary job, then checks live updates and idle traffic. Keep this tab open for about a minute.</p></div>
        </header>

        <div className="rounded-2xl border border-line bg-surface-1 p-4">
          <label htmlFor="self-test-code" className="mb-1 block text-sm font-medium">Create code {requiresCode ? <span className="text-warn">(required by this service)</span> : <span className="text-ink-faint">(leave blank unless you were given one)</span>}</label>
          <input id="self-test-code" type="password" autoComplete="off" value={createCode} onChange={(event) => setCreateCode(event.target.value)} className="h-10 w-full rounded-control border border-line-strong bg-surface-0 px-3 text-sm text-ink focus:border-accent focus:outline-none" />
          <Button className="mt-3" disabled={running} onClick={() => void run()} leftIcon={running ? <RotateCw className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}>
            {running ? idleSeconds === null ? 'Checking the service…' : `Checking idle traffic · ${idleSeconds}s left` : 'Run self-test'}
          </Button>
        </div>

        {checks.length > 0 && <section aria-label="Self-test results" className="rounded-2xl border border-line bg-surface-1 p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Results</h2><Button variant="secondary" size="sm" onClick={() => void copy()} leftIcon={<Copy className="h-3.5 w-3.5" />}>Copy results</Button></div>
          <ol className="space-y-2 text-sm">
            {checks.map((check, index) => <li key={`${check.name}-${index}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2"><span className={`font-semibold ${check.passed ? 'text-ok' : 'text-danger'}`}>{check.passed ? 'PASS' : 'FAIL'}</span><span><span className="font-medium">{check.name}</span><span className="block whitespace-pre-wrap text-xs text-ink-dim">{check.detail}</span></span></li>)}
          </ol>
          {copyState && <p role="status" className="mt-2 text-xs text-ink-dim">{copyState}</p>}
          <label htmlFor="self-test-result" className="sr-only">Copyable plain-text results</label>
          <textarea id="self-test-result" readOnly value={text} rows={Math.min(12, Math.max(4, checks.length))} className="mt-4 w-full rounded-control border border-line bg-surface-0 p-3 font-mono text-xs text-ink" />
          <p className="mt-2 text-xs text-ink-dim">Open the staging service while signed out, run this check, then send the copied result to the project owner. The diagnostic deletes its temporary job before finishing.</p>
        </section>}
      </section>
    </main>
  );
};

export default SelfTest;
