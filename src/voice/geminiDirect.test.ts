import { describe, expect, it } from 'bun:test';
import { explainGeminiFailure, pcmToWav, synthesizeWithOwnKey } from './geminiDirect';

const pcmB64 = (n: number) => btoa(String.fromCharCode(...new Uint8Array(n).fill(3)));
const ok = (n = 4800) => async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcmB64(n) } }] } }] }), { status: 200 });
const fail = (status: number, message: string) => async () => new Response(JSON.stringify({ error: { message } }), { status });
const req = (fetchImpl: typeof fetch) => ({ key: 'secret-key', script: 'Hello', voiceName: 'Zephyr', modelId: 'm', fetchImpl });

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
