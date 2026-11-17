import { describe, expect, it } from 'vitest';
import { explainGeminiFailure, pcmToWav, readAudioPayload, softenEdges, synthesizeWithOwnKey } from './geminiDirect';

const pcmB64 = (n: number) => btoa(String.fromCharCode(...new Uint8Array(n).fill(3)));
const ok = (n = 4800) => async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcmB64(n) } }] } }] }), { status: 200 });
const fail = (status: number, message: string) => async () => new Response(JSON.stringify({ error: { message } }), { status });
const req = (fetchImpl: typeof fetch) => ({ key: 'secret-key', script: 'Hello', voiceName: 'Zephyr', modelId: 'm', fetchImpl });

const RATE = 24000;
const toPcm = (samples: number[]) => { const b = new Uint8Array(samples.length * 2); const v = new DataView(b.buffer); samples.forEach((x, i) => v.setInt16(i * 2, x, true)); return b; };
const tone = (n: number, amp = 8000) => Array.from({ length: n }, (_, i) => Math.round(Math.sin(i * 0.05) * amp));
/** A WAV file the way the newer speech models send it: header, sound, then a metadata chunk */
const wavFile = (pcm: Uint8Array, extra = new Uint8Array(0)) => {
  const f = new Uint8Array(44 + pcm.length + extra.length); const v = new DataView(f.buffer);
  const t = (at: number, s: string) => { for (let i = 0; i < 4; i++) f[at + i] = s.charCodeAt(i); };
  t(0, 'RIFF'); v.setUint32(4, f.length - 8, true); t(8, 'WAVE'); t(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); t(36, 'data'); v.setUint32(40, pcm.length, true);
  f.set(pcm, 44); f.set(extra, 44 + pcm.length);
  return f;
};

describe('audio from Gemini: no click at the start, no static at the end', () => {
  it('plays only the sound of a WAV file, not its header or the metadata after it', () => {
    const pcm = toPcm(tone(4800));
    const meta = new Uint8Array([76, 73, 83, 84, 8, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255]); // a LIST chunk
    const got = readAudioPayload(wavFile(pcm, meta), 'audio/wav');
    expect(got.rate).toBe(RATE);
    expect(got.pcm.length).toBe(pcm.length);
    expect(Array.from(got.pcm.subarray(0, 8))).toEqual(Array.from(pcm.subarray(0, 8)));
  });
  it('reads raw PCM with the rate from its type', () => {
    const got = readAudioPayload(toPcm(tone(100)), 'audio/L16;codec=pcm;rate=16000');
    expect(got.rate).toBe(16000);
    expect(got.pcm.length).toBe(200);
  });
  it('refuses a format it cannot read instead of playing noise', () => {
    const f = wavFile(toPcm(tone(100))); new DataView(f.buffer).setUint16(34, 8, true);
    expect(() => readAudioPayload(f, 'audio/wav')).toThrow('cannot read');
  });
  it('starts and ends silent', () => {
    const out = softenEdges(toPcm(tone(RATE)), RATE);
    const v = new DataView(out.buffer);
    expect(Math.abs(v.getInt16(0, true))).toBeLessThan(100);
    expect(Math.abs(v.getInt16(out.length - 2, true))).toBeLessThan(100);
    expect(out.length).toBe(RATE * 2);
  });
});

describe('Gemini voice with the own key', () => {
  it('wraps the audio in a readable WAV file', async () => {
    const wav = new DataView(await synthesizeWithOwnKey(req(ok() as any)));
    expect(String.fromCharCode(wav.getUint8(0), wav.getUint8(1), wav.getUint8(2), wav.getUint8(3))).toBe('RIFF');
    expect(wav.getUint32(24, true)).toBe(24000);
    expect(wav.byteLength).toBe(44 + 4800);
  });
  it('sends the key to Google in a header, never in the address', async () => {
    let url = ''; let header = '';
    await synthesizeWithOwnKey(req((async (u: string, init: RequestInit) => { url = u; header = (init.headers as any)['x-goog-api-key']; return ok()(); }) as any));
    expect(url.startsWith('https://generativelanguage.googleapis.com/')).toBe(true);
    expect(url.includes('secret-key')).toBe(false);
    expect(header).toBe('secret-key');
  });
  it('does not retry a refused key and never repeats it in the message', async () => {
    let calls = 0;
    const f = (async () => { calls++; return fail(400, 'API key not valid. Please pass a valid API key.')(); }) as any;
    await expect(synthesizeWithOwnKey(req(f))).rejects.toThrow('did not accept this Gemini key');
    expect(calls).toBe(1);
  });
  it('retries a busy server and then succeeds', async () => {
    let calls = 0;
    const f = (async () => (++calls < 2 ? fail(503, 'busy')() : ok()())) as any;
    await synthesizeWithOwnKey(req(f));
    expect(calls).toBe(2);
  });
  it('explains a quota stop in plain words', () => {
    expect(explainGeminiFailure(429, '')).toContain('free limit');
  });
  it('pcmToWav writes the data length', () => {
    expect(new DataView(pcmToWav(new Uint8Array(10), 24000)).getUint32(40, true)).toBe(10);
  });
});

describe('same reading every time', () => {
  it('sends a fixed seed, and tries again without it if the service refuses the field', async () => {
    const bodies: string[] = [];
    let n = 0;
    const impl = (async (_u: unknown, init: RequestInit) => {
      bodies.push(String(init.body));
      return n++ === 0 ? new Response(JSON.stringify({ error: { message: 'Unknown name "seed": Cannot find field.' } }), { status: 400 }) : await ok()();
    }) as unknown as typeof fetch;
    const out = await synthesizeWithOwnKey(req(impl));
    expect(out.byteLength).toBeGreaterThan(0);
    expect(bodies[0]).toContain('"seed"');
    expect(bodies[1]).not.toContain('"seed"');
  });
});
