/**
 * Temporary feasibility check for the streaming-audio rebuild.
 * Floating button (bottom-left) opens a panel that tests, in the real environment:
 * private file storage (OPFS) availability/quota/speed, and chunked MP3 decoding to disk.
 * Throwaway: remove this folder and the mount in main.tsx after the results are in.
 */
import { useRef, useState } from 'react';

type Json = Record<string, unknown>;

function makeWorker(): Worker {
  return new Worker(new URL('./streamingWorker.js', import.meta.url), { type: 'module' });
}

function runWorker(msg: Json, onProgress: (t: string) => void): Promise<Json> {
  return new Promise((resolve) => {
    let w: Worker;
    try { w = makeWorker(); } catch (e) { resolve({ error: 'worker could not start: ' + (e as Error).message }); return; }
    w.onmessage = (ev: MessageEvent) => {
      if (ev.data.type === 'progress') onProgress(ev.data.text);
      else if (ev.data.type === 'result') { onProgress('finished'); w.terminate(); resolve(ev.data.res); }
    };
    w.onerror = (ev) => { w.terminate(); resolve({ error: 'worker error: ' + (ev.message || 'unknown (worker may be blocked)') }); };
    w.postMessage(msg);
  });
}

async function checkEnvironment(): Promise<Json> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const e: Json = {
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    inIframe: window.top !== window,
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    deviceMemoryGB: nav.deviceMemory ?? 'n/a',
    cpuThreads: navigator.hardwareConcurrency,
    opfsApi: !!(navigator.storage && navigator.storage.getDirectory),
    webCodecsAudioDecoder: typeof (window as unknown as { AudioDecoder?: unknown }).AudioDecoder !== 'undefined',
  };
  try {
    const est = await navigator.storage.estimate();
    e.storageQuotaGB = +((est.quota ?? 0) / 1073741824).toFixed(1);
    e.storageUsedGB = +((est.usage ?? 0) / 1073741824).toFixed(2);
  } catch (x) { e.storageEstimate = 'failed: ' + (x as Error).message; }
  try { e.persistent = await navigator.storage.persisted(); } catch { /* ignore */ }
  try { await navigator.storage.getDirectory(); e.opfsRootOpen = true; }
  catch (x) { e.opfsRootOpen = 'FAILED: ' + (x as Error).name + ': ' + (x as Error).message; }
  try { makeWorker().terminate(); e.workerCanStart = true; } catch (x) { e.workerCanStart = 'FAILED: ' + (x as Error).message; }
  const AD = (window as unknown as { AudioDecoder?: { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> } }).AudioDecoder;
  if (AD) {
    const support: Json = {};
    const tests: Array<[string, Json]> = [
      ['mp3', { codec: 'mp3', sampleRate: 48000, numberOfChannels: 2 }],
      ['aac', { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 }],
      ['opus', { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 }],
      ['flac', { codec: 'flac', sampleRate: 48000, numberOfChannels: 2 }],
    ];
    for (const [name, cfg] of tests) {
      try { support[name] = !!(await AD.isConfigSupported(cfg)).supported; } catch { support[name] = 'error'; }
    }
    e.codecSupport = support;
  }
  return e;
}

const box: React.CSSProperties = { border: '1px solid #3f3f46', borderRadius: 8, padding: 12, margin: '10px 0', background: '#121216' };
const btn: React.CSSProperties = { background: '#00f0ff', color: '#001417', border: 0, borderRadius: 6, padding: '8px 12px', fontWeight: 600, cursor: 'pointer' };
const pre: React.CSSProperties = { background: '#07070a', borderRadius: 6, padding: 10, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, margin: '8px 0 0', maxHeight: 260 };

export default function StreamingCheck() {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Json>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState<Record<string, string>>({});
  const [freeze, setFreeze] = useState('');
  const [size, setSize] = useState('1024');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: Json) => setResults((r) => ({ ...r, [k]: v }));

  const runEnv = async () => { setBusy('env'); set('environment', await checkEnvironment()); setBusy(null); };
  const runStorage = async () => {
    setBusy('storage');
    set('storageTest', await runWorker({ type: 'opfs', sizeMB: +size }, (t) => setProg((p) => ({ ...p, storage: t }))));
    setBusy(null);
  };
  const runDecode = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { setNote('Choose an MP3 file first.'); return; }
    setNote(''); setBusy('decode');
    let last = performance.now(), worst = 0;
    const hb = setInterval(() => {
      const n = performance.now(); worst = Math.max(worst, n - last - 50); last = n;
      setFreeze('page stayed responsive: worst pause ' + Math.round(worst) + ' ms');
    }, 50);
    const res = await runWorker({ type: 'decode', file }, (t) => setProg((p) => ({ ...p, decode: t })));
    clearInterval(hb);
    // Third opinion on the cross-checked seconds: the browser's own whole-clip decoder, on just those bytes.
    const checks = (res as { crossChecks?: Array<Record<string, unknown>> }).crossChecks;
    if (checks) {
      for (const c of checks) {
        try {
          const [a, b] = c.bytes as [number, number];
          const ac = new AudioContext();
          const ab = await ac.decodeAudioData(await file.slice(a, b).arrayBuffer());
          const out: number[] = [];
          for (let ch = 0; ch < ab.numberOfChannels; ch++) {
            const d = ab.getChannelData(ch);
            for (let i = 0; i < d.length; i++) {
              const sec = Math.floor(i / ab.sampleRate); const v = Math.abs(d[i]);
              if (out[sec] === undefined || v > out[sec]) out[sec] = v;
            }
          }
          c.decodeAudioDataLoudestPerSecond = out.map((v) => +v.toFixed(4));
          await ac.close();
        } catch (e) { c.decodeAudioDataError = (e as Error).name + ': ' + (e as Error).message; }
      }
    }
    set('decodeTest', { ...res, worstPageFreezeMs: Math.round(worst) });
    setBusy(null);
  };
  const copy = async () => {
    const text = JSON.stringify(results, null, 2);
    try { await navigator.clipboard.writeText(text); setNote('Copied. Paste it to Claude.'); }
    catch { setNote('Copy was blocked. Select the text below and copy it.'); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{ ...btn, position: 'fixed', left: 12, bottom: 40, zIndex: 99999, opacity: 0.85 }}>
        Streaming check
      </button>
    );
  }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: '#0b0b10', color: '#e4e4e7', overflow: 'auto', padding: 16, font: '14px/1.5 system-ui,sans-serif' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 18 }}>Uuda streaming check</b>
          <button onClick={() => setOpen(false)} style={{ ...btn, background: '#27272a', color: '#e4e4e7' }}>Close</button>
        </div>
        <p style={{ color: '#a1a1aa' }}>Throwaway test. It writes temporary files to this browser's private storage and deletes them at the end. Run 1, 2 and 3, then press Copy results and paste them to Claude.</p>

        <div style={box}><b>1. Environment</b><br /><br />
          <button style={btn} disabled={!!busy} onClick={runEnv}>Check environment</button>
          {results.environment !== undefined && <pre style={pre}>{JSON.stringify(results.environment, null, 2)}</pre>}
        </div>

        <div style={box}><b>2. Storage speed and space</b><br /><br />
          Test size{' '}
          <select value={size} onChange={(e) => setSize(e.target.value)} style={{ ...btn, background: '#27272a', color: '#e4e4e7' }}>
            <option value="256">256 MB</option><option value="1024">1 GB</option><option value="2048">2 GB</option><option value="4096">4 GB</option>
          </select>{' '}
          <button style={btn} disabled={!!busy} onClick={runStorage}>Run storage test</button>
          <div style={{ color: '#00f0ff', fontSize: 12 }}>{busy === 'storage' ? prog.storage : ''}</div>
          {results.storageTest !== undefined && <pre style={pre}>{JSON.stringify(results.storageTest, null, 2)}</pre>}
        </div>

        <div style={box}><b>3. Decode an MP3 in chunks</b><br />
          Pick your long MP3 (the 1 h 27 min one). It is read in pieces and never loaded whole.<br /><br />
          <input type="file" ref={fileRef} accept=".mp3,audio/mpeg" />{' '}
          <button style={btn} disabled={!!busy} onClick={runDecode}>Run decode test</button>
          <div style={{ color: '#00f0ff', fontSize: 12 }}>{busy === 'decode' ? prog.decode : ''}</div>
          <div style={{ color: '#00f0ff', fontSize: 12 }}>{busy === 'decode' ? freeze : ''}</div>
          {results.decodeTest !== undefined && <pre style={pre}>{JSON.stringify(results.decodeTest, null, 2)}</pre>}
        </div>

        <div style={box}>
          <button style={btn} onClick={copy}>Copy results</button>{' '}
          <span style={{ color: '#00f0ff', fontSize: 12 }}>{note}</span>
        </div>
      </div>
    </div>
  );
}
