import { describe, expect, it } from 'vitest';
import { cleanTail, explainGeminiFailure, pcmToWav, synthesizeWithOwnKey } from './geminiDirect';

const pcmB64 = (n: number) => btoa(String.fromCharCode(...new Uint8Array(n).fill(3)));
const ok = (n = 4800) => async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcmB64(n) } }] } }] }), { status: 200 });
const fail = (status: number, message: string) => async () => new Response(JSON.stringify({ error: { message } }), { status });
const req = (fetchImpl: typeof fetch) => ({ key: 'secret-key', script: 'Hello', voiceName: 'Zephyr', modelId: 'm', fetchImpl });

const RATE = 24000;
const tone = (secs: number, amp = 8000) => Array.from({ length: Math.round(secs * RATE) }, (_, i) => Math.round(Math.sin(i * 0.05) * amp));
const noise = (secs: number) => Array.from({ length: Math.round(secs * RATE) }, (_, i) => (i % 2 ? 20000 : -20000));
const quiet = (secs: number) => new Array(Math.round(secs * RATE)).fill(0);
const toPcm = (samples: number[]) => { const b = new Uint8Array(samples.length * 2); const v = new DataView(b.buffer); samples.forEach((x, i) => v.setInt16(i * 2, x, true)); return b; };

describe('static at the end of a voice clip', () => {
  it('cuts a noise burst that follows a gap after the speech', () => {
    const out = cleanTail(toPcm([...tone(1), ...quiet(0.1), ...noise(0.15)]), RATE);
    expect(out.length / 2 / RATE).toBeLessThan(1.05);
    expect(out.length / 2 / RATE).toBeGreaterThan(0.95);
  });
  it('keeps real speech that ends without a burst, and fades its last 30 ms', () => {
    const out = cleanTail(toPcm([...tone(1), ...quiet(0.1)]), RATE);
    expect(out.length / 2 / RATE).toBeGreaterThan(1.0);
    const last = new DataView(out.buffer, out.byteOffset).getInt16(out.length - 2, true);
    expect(Math.abs(last)).toBeLessThan(200);
  });
  it('does not cut a short voiced word after a pause', () => {
    const out = cleanTail(toPcm([...tone(1), ...quiet(0.1), ...tone(0.2)]), RATE);
    expect(out.length / 2 / RATE).toBeGreaterThan(1.25);
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
