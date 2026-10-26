/* Uuda streaming feasibility spike: page side. Throwaway test code. */
const results = {};
const $ = (id) => document.getElementById(id);
const show = (id, o) => { $(id).textContent = JSON.stringify(o, null, 2); };
function worker() { return new Worker(new URL('worker.js', location.href)); }

async function env() {
  const e = {
    userAgent: navigator.userAgent,
    secureContext: window.isSecureContext,
    inIframe: window.top !== window,
    crossOriginIsolated: window.crossOriginIsolated,
    sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    deviceMemoryGB: navigator.deviceMemory || 'n/a',
    cpuThreads: navigator.hardwareConcurrency,
    opfsApi: !!(navigator.storage && navigator.storage.getDirectory),
    webCodecsAudioDecoder: typeof AudioDecoder !== 'undefined',
  };
  try {
    const est = await navigator.storage.estimate();
    e.storageQuotaGB = +(est.quota / 1073741824).toFixed(1);
    e.storageUsedGB = +(est.usage / 1073741824).toFixed(2);
  } catch (x) { e.storageEstimate = 'failed: ' + x.message; }
  try { e.persistent = await navigator.storage.persisted(); } catch (x) {}
  try { const root = await navigator.storage.getDirectory(); e.opfsRootOpen = !!root; } catch (x) { e.opfsRootOpen = 'FAILED: ' + x.name + ': ' + x.message; }
  try { const w = worker(); w.terminate(); e.workerCanStart = true; } catch (x) { e.workerCanStart = 'FAILED: ' + x.message; }
  if (typeof AudioDecoder !== 'undefined') {
    e.codecSupport = {};
    for (const [n, c] of [['mp3', { codec: 'mp3', sampleRate: 48000, numberOfChannels: 2 }], ['aac', { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 }], ['opus', { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 }], ['flac', { codec: 'flac', sampleRate: 48000, numberOfChannels: 2 }]]) {
      try { e.codecSupport[n] = (await AudioDecoder.isConfigSupported(c)).supported; } catch (x) { e.codecSupport[n] = 'error'; }
    }
  }
  return e;
}

$('b1').onclick = async () => { results.environment = await env(); show('o1', results.environment); };

function runWorker(msg, progressEl) {
  return new Promise((resolve) => {
    const w = worker();
    w.onmessage = (ev) => {
      if (ev.data.type === 'progress') progressEl.textContent = ev.data.text;
      else if (ev.data.type === 'result') { progressEl.textContent = 'finished'; w.terminate(); resolve(ev.data.res); }
    };
    w.onerror = (ev) => { w.terminate(); resolve({ error: 'worker error: ' + (ev.message || 'unknown (worker may be blocked)') }); };
    w.postMessage(msg);
  });
}

$('b2').onclick = async () => {
  $('b2').disabled = true; $('o2').textContent = 'running...';
  results.storageTest = await runWorker({ type: 'opfs', sizeMB: +$('size').value }, $('s2'));
  show('o2', results.storageTest); $('b2').disabled = false;
};

$('b3').onclick = async () => {
  const file = $('f').files[0];
  if (!file) { $('o3').textContent = 'Choose an MP3 file first.'; return; }
  $('b3').disabled = true; $('o3').textContent = 'running...';
  // Heartbeat: how long the page was frozen at worst while decoding ran.
  let last = performance.now(), worst = 0;
  const hb = setInterval(() => { const n = performance.now(); worst = Math.max(worst, n - last - 50); last = n; $('hb').textContent = 'page stayed responsive: worst pause ' + Math.round(worst) + ' ms'; }, 50);
  results.decodeTest = await runWorker({ type: 'decode', file }, $('s3'));
  clearInterval(hb);
  results.decodeTest.worstPageFreezeMs = Math.round(worst);
  show('o3', results.decodeTest); $('b3').disabled = false;
};

$('copy').onclick = async () => {
  const text = JSON.stringify(results, null, 2);
  try { await navigator.clipboard.writeText(text); $('cs').textContent = 'copied'; }
  catch (e) { $('cs').textContent = 'copy blocked, select the text below'; $('o3').textContent = text; }
};
