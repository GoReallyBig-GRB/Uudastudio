/* Uuda streaming feasibility spike: worker side. Throwaway test code, not part of the app. */
const post = (m) => self.postMessage(m);
const MB = 1024 * 1024;
let SKIP_PEAKS = false;

async function spikeDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('uuda-spike', { create: true });
}
async function wipe() {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('uuda-spike', { recursive: true }); } catch (e) { /* nothing to remove */ }
}

/* ---------- Test 2: write / read speed and quota ---------- */
async function opfsTest({ sizeMB }) {
  const res = { sizeMBRequested: sizeMB };
  await wipe();
  const dir = await spikeDir();
  const fh = await dir.getFileHandle('speed.bin', { create: true });
  let h;
  try { h = await fh.createSyncAccessHandle(); res.syncAccessHandle = 'ok'; }
  catch (e) { res.syncAccessHandle = 'FAILED: ' + e.name + ': ' + e.message; post({ type: 'result', test: 'opfs', res }); return; }
  const chunk = new Uint8Array(4 * MB);
  for (let i = 0; i < chunk.length; i += 4096) chunk[i] = (i / 4096) & 255;
  let written = 0;
  const t0 = performance.now();
  try {
    while (written < sizeMB * MB) {
      h.write(chunk, { at: written });
      written += chunk.length;
      if ((written / chunk.length) % 16 === 0) post({ type: 'progress', text: 'written ' + Math.round(written / MB) + ' MB' });
    }
    h.flush();
  } catch (e) {
    res.writeError = e.name + ': ' + e.message;
  }
  const t1 = performance.now();
  res.writtenMB = Math.round(written / MB);
  res.writeSeconds = +((t1 - t0) / 1000).toFixed(2);
  res.writeMBps = +(res.writtenMB / Math.max(0.001, (t1 - t0) / 1000)).toFixed(0);
  // random 1 s-sized reads (192 KB ~ 1 s of 48k stereo float32 is 384 KB; use 384 KB)
  const rb = new Uint8Array(384 * 1024);
  let reads = 0;
  const r0 = performance.now();
  for (let i = 0; i < 200 && written > rb.length; i++) {
    const at = Math.floor(Math.random() * (written - rb.length));
    h.read(rb, { at });
    reads++;
  }
  const r1 = performance.now();
  res.randomReads = reads;
  res.msPerRandomRead = +((r1 - r0) / Math.max(1, reads)).toFixed(3);
  h.close();
  await wipe();
  post({ type: 'result', test: 'opfs', res });
}

/* ---------- MP3 frame parser ---------- */
const BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function parseHeader(b, i) {
  if (b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) return null;
  const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3;
  if (ver === 1 || layer !== 1) return null; // need MPEG1/2/2.5 Layer III
  const br = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3;
  if (br === 0 || br === 15 || sri === 3) return null;
  const pad = (b[i + 2] >> 1) & 1;
  const channels = ((b[i + 3] >> 6) & 3) === 3 ? 1 : 2;
  const bitrate = (ver === 3 ? BR_V1 : BR_V2)[br] * 1000;
  const sampleRate = SR[ver][sri];
  const spf = ver === 3 ? 1152 : 576;
  const size = Math.floor((ver === 3 ? 144 : 72) * bitrate / sampleRate) + pad;
  return { size, sampleRate, channels, spf, bitrate };
}
async function id3Skip(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    return 10 + ((head[6] & 127) << 21 | (head[7] & 127) << 14 | (head[8] & 127) << 7 | (head[9] & 127));
  }
  return 0;
}
function concat(a, b) { if (!a.length) return b; const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; }

/* ---------- Test 3: chunked MP3 decode to disk ---------- */
async function decodeOnce(file, { group, skipMeta, maxBytes }) {
  const res = {};
  const diag = { group, skipMeta };
  await wipe();
  const dir = await spikeDir();
  let handles = [], offsets = [];
  let decoder = null, cfg = null, decodedFrames = 0, outputs = 0, errorMsg = null;
  const BASE = 4096;
  let peakMins = [], peakMaxs = [], pMin = Infinity, pMax = -Infinity, pCount = 0;
  let heapPeak = 0;
  const sampleHeap = () => { try { const u = performance.memory && performance.memory.usedJSHeapSize; if (u && u > heapPeak) heapPeak = u; } catch (e) {} };
  const setErr = (m) => { if (!errorMsg) errorMsg = m; };

  async function openOutputs(channels) {
    for (let c = 0; c < channels; c++) {
      const fh = await dir.getFileHandle('ch' + c + '.f32', { create: true });
      handles.push(await fh.createSyncAccessHandle());
      offsets.push(0);
    }
  }
  const tmp = [];
  function onAudio(ad) {
    outputs++;
    const frames = ad.numberOfFrames, ch = Math.min(ad.numberOfChannels, handles.length);
    for (let c = 0; c < ch; c++) {
      if (!tmp[c] || tmp[c].length < frames) tmp[c] = new Float32Array(frames);
      ad.copyTo(tmp[c], { planeIndex: c, format: 'f32-planar' });
      handles[c].write(new Uint8Array(tmp[c].buffer, 0, frames * 4), { at: offsets[c] });
      offsets[c] += frames * 4;
    }
    for (let i = 0; i < frames; i++) {
      let v = 0; for (let c = 0; c < ch; c++) v += tmp[c][i];
      v /= ch;
      if (v < pMin) pMin = v; if (v > pMax) pMax = v;
      if (++pCount === BASE) { peakMins.push(pMin); peakMaxs.push(pMax); pMin = Infinity; pMax = -Infinity; pCount = 0; }
    }
    decodedFrames += frames;
    ad.close();
    if (outputs % 400 === 0) sampleHeap();
  }

  const t0 = performance.now();
  const startPos = await id3Skip(file);
  diag.id3Bytes = startPos;
  let pos = startPos;
  const endPos = Math.min(file.size, startPos + maxBytes);
  const SLICE = 4 * MB;
  let carry = new Uint8Array(0), frameIdx = 0, mp3Frames = 0;
  let grpStart = -1, grpFrames = 0, grpTs = 0, firstSeen = false;
  function flushGroup(data, end) {
    if (grpStart < 0 || grpFrames === 0) return;
    decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: grpTs, data: data.subarray(grpStart, end) }));
    grpStart = -1; grpFrames = 0;
  }
  const hex = (u8) => Array.from(u8).map((x) => x.toString(16).padStart(2, '0')).join(' ');
  try {
    while (pos < endPos && !errorMsg) {
      const slice = new Uint8Array(await file.slice(pos, Math.min(endPos, pos + SLICE)).arrayBuffer());
      pos += slice.length;
      const data = concat(carry, slice);
      let i = 0;
      while (i + 4 <= data.length && !errorMsg) {
        const h = parseHeader(data, i);
        if (!h) { if (grpStart >= 0) flushGroup(data, i); i++; continue; }
        if (i + h.size + 4 <= data.length && !parseHeader(data, i + h.size) && pos < endPos) { if (grpStart >= 0) flushGroup(data, i); i++; continue; } // false sync
        if (i + h.size > data.length) break;
        if (!firstSeen) {
          firstSeen = true;
          diag.firstFrameHex = hex(data.subarray(i, i + 24));
          const probe = new TextDecoder('latin1').decode(data.subarray(i, Math.min(i + 64, i + h.size)));
          diag.firstFrameIsXingInfoVbri = /Xing|Info|VBRI/.test(probe);
          if (skipMeta && diag.firstFrameIsXingInfoVbri) { diag.metaFrameSkipped = true; i += h.size; continue; }
        }
        if (!decoder) {
          cfg = { codec: 'mp3', sampleRate: h.sampleRate, numberOfChannels: h.channels };
          const sup = await AudioDecoder.isConfigSupported(cfg);
          res.decoderSupported = !!sup.supported;
          if (!sup.supported) { setErr('AudioDecoder does not support mp3 here'); break; }
          res.sampleRate = h.sampleRate; res.channels = h.channels; res.bitrateKbps = h.bitrate / 1000;
          await openOutputs(h.channels);
          decoder = new AudioDecoder({ output: onAudio, error: (e) => { setErr('decoder error: ' + e.name + ': ' + e.message); } });
          decoder.configure(cfg);
        }
        if (decoder.state === 'closed') { setErr('decoder closed after ' + mp3Frames + ' frames'); break; }
        if (grpStart < 0) { grpStart = i; grpFrames = 0; grpTs = Math.round(frameIdx * h.spf / h.sampleRate * 1e6); }
        grpFrames++; frameIdx += 1; mp3Frames++;
        i += h.size;
        if (grpFrames >= group) flushGroup(data, i);
        if (decoder.decodeQueueSize > 300) await new Promise((r) => setTimeout(r, 0));
      }
      if (grpStart >= 0 && !errorMsg) flushGroup(data, i);
      carry = data.slice(i);
      post({ type: 'progress', text: (maxBytes === Infinity ? 'decoding: ' : 'probing: ') + 'read ' + Math.round(pos / MB) + ' / ' + Math.round(file.size / MB) + ' MB, decoded ' + Math.round(decodedFrames / (cfg ? cfg.sampleRate : 48000) / 60) + ' min' });
    }
    if (decoder && !errorMsg) await decoder.flush();
  } catch (e) { setErr(e.name + ': ' + e.message); }
  const t1 = performance.now();
  if (pCount > 0) { peakMins.push(pMin); peakMaxs.push(pMax); }
  sampleHeap();
  res.error = errorMsg;
  res.mp3Frames = mp3Frames;
  res.decodedFrames = decodedFrames;
  res.decodedMinutes = cfg ? +(decodedFrames / cfg.sampleRate / 60).toFixed(2) : 0;
  res.expectedMinutes = cfg ? +(mp3Frames * (cfg.sampleRate < 32000 ? 576 : 1152) / cfg.sampleRate / 60).toFixed(2) : 0;
  res.decodeSeconds = +((t1 - t0) / 1000).toFixed(1);
  res.xRealtime = cfg ? +((decodedFrames / cfg.sampleRate) / ((t1 - t0) / 1000)).toFixed(0) : 0;
  res.outputMB = +(offsets.reduce((a, b) => a + b, 0) / MB).toFixed(0);
  res.peakLevelBuckets = peakMins.length;
  res.workerHeapPeakMB = heapPeak ? +(heapPeak / MB).toFixed(0) : 'n/a';
  res.diag = diag;

  // Read back: 100 evenly spaced 1 s windows + silence check
  if (handles.length && decodedFrames > 0 && !errorMsg && maxBytes === Infinity) {
    const sr = cfg.sampleRate, win = new Float32Array(sr);
    const totalSec = Math.floor(decodedFrames / sr);
    const stats = handles.map(() => ({ silent: 0, seconds: [] }));
    let bothSilent = 0, eitherHasSound = 0;
    const bothSilentAt = [];
    const r0 = performance.now();
    for (let k = 0; k < 100; k++) {
      const sec = Math.min(totalSec - 1, Math.floor((k + 0.5) * totalSec / 100));
      let any = false;
      handles.forEach((h, c) => {
        h.read(new Uint8Array(win.buffer), { at: sec * sr * 4 });
        let m = 0; for (let i = 0; i < win.length; i++) { const a = Math.abs(win[i]); if (a > m) m = a; }
        if (m > 0.0005) any = true;
        else { stats[c].silent++; if (stats[c].seconds.length < 12) stats[c].seconds.push(sec); }
      });
      if (any) eitherHasSound++; else { bothSilent++; if (bothSilentAt.length < 12) bothSilentAt.push(sec); }
    }
    res.randomReadMsEach = +((performance.now() - r0) / 200).toFixed(2);
    res.windowsWithSoundInAnyChannelOf100 = eitherHasSound;
    res.windowsSilentInBothChannels = bothSilent;
    res.bothChannelsSilentAtSeconds = bothSilentAt;
    res.perChannelSilentWindows = stats.map((x, c) => ({ channel: c === 0 ? 'left' : 'right', silentWindows: x.silent, atSeconds: x.seconds }));
  }
  try { decoder && decoder.state !== 'closed' && decoder.close(); } catch (e) {}
  handles.forEach((h) => { try { h.close(); } catch (e) {} });
  await wipe();
  return res;
}

async function decodeTest({ file }) {
  const base = { fileName: file.name, fileMB: +(file.size / MB).toFixed(1) };
  if (typeof AudioDecoder === 'undefined') { post({ type: 'result', test: 'decode', res: { ...base, error: 'AudioDecoder (WebCodecs) not available in workers here' } }); return; }
  // Probe several ways of feeding the decoder on the first 2 MB; use the first that works for the full file.
  const strategies = [
    { group: 1, skipMeta: true }, { group: 1, skipMeta: false },
    { group: 32, skipMeta: true }, { group: 32, skipMeta: false },
  ];
  const attempts = [];
  let chosen = null;
  for (const st of strategies) {
    const r = await decodeOnce(file, { ...st, maxBytes: 2 * MB });
    const ok = !r.error && r.decodedFrames > 0;
    attempts.push({ ...st, ok, error: r.error, decodedFrames: r.decodedFrames, diag: r.diag });
    if (ok) { chosen = st; break; }
  }
  if (!chosen) { post({ type: 'result', test: 'decode', res: { ...base, error: 'no way of feeding the decoder worked', attempts } }); return; }
  const full = await decodeOnce(file, { ...chosen, maxBytes: Infinity });
  post({ type: 'result', test: 'decode', res: { ...base, strategy: chosen, ...full, attempts } });
}

self.onmessage = async (e) => {
  try {
    if (e.data.type === 'opfs') await opfsTest(e.data);
    else if (e.data.type === 'decode') await decodeTest(e.data);
  } catch (err) {
    post({ type: 'result', test: e.data.type, res: { error: err.name + ': ' + err.message } });
  }
};
