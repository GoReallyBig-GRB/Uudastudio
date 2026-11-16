/**
 * Voice generation straight from the browser with the person's own Gemini key.
 * The key goes to Google and nowhere else: Uuda's servers never see it.
 */

import { asSpoken } from './pronounce';

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
export { SAMPLE_SCRIPT as AUDITION_SENTENCE } from './sampleScript';

export interface GeminiSpeechRequest {
  key: string;
  script: string;
  voiceName: string;
  modelId: string;
  instruction?: string;
  signal?: AbortSignal;
  /** Fewer tries for a quick audition */
  attempts?: number;
  fetchImpl?: typeof fetch;
}

/**
 * What Gemini sends back is either raw 16-bit PCM or a complete WAV file (the newer speech models send a file).
 * A file's header and any trailing metadata must not be played as sound: they are heard as a click at the start and a burst of static at the end.
 */
export function readAudioPayload(bytes: Uint8Array, mime: string): { pcm: Uint8Array; rate: number; channels: number } {
  const tag = (at: number) => String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
  if (bytes.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WAVE') {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let rate = 0; let channels = 1; let bits = 16; let format = 1;
    let at = 12;
    while (at + 8 <= bytes.length) {
      const id = tag(at); const size = v.getUint32(at + 4, true);
      if (id === 'fmt ' && at + 24 <= bytes.length) { format = v.getUint16(at + 8, true); channels = v.getUint16(at + 10, true); rate = v.getUint32(at + 12, true); bits = v.getUint16(at + 22, true); }
      if (id === 'data') {
        if (!rate || bits !== 16 || (format !== 1 && format !== 0xfffe)) throw new Error('Gemini sent audio in a format Uuda cannot read.');
        const end = Math.min(bytes.length, at + 8 + size);
        return { pcm: bytes.subarray(at + 8, end - ((end - at - 8) % (2 * Math.max(1, channels)))), rate, channels: Math.max(1, channels) };
      }
      at += 8 + size + (size % 2);
    }
    throw new Error('Gemini sent an audio file without sound in it.');
  }
  const rate = Number(/rate=(\d+)/.exec(mime)?.[1]) || 24000;
  return { pcm: bytes.subarray(0, bytes.length - (bytes.length % 2)), rate, channels: 1 };
}

/** A 5 ms fade in and a 30 ms fade out, so a clip never starts or ends on a step in the signal */
export function softenEdges(pcm: Uint8Array, rate: number, channels = 1): Uint8Array {
  const out = new Uint8Array(pcm);
  const dv = new DataView(out.buffer);
  const frames = Math.floor(out.length / (2 * channels));
  const ramp = (from: number, n: number, up: boolean) => {
    for (let i = 0; i < n; i++) {
      const g = up ? (i + 1) / n : 1 - (i + 1) / n;
      for (let c = 0; c < channels; c++) { const at = ((from + i) * channels + c) * 2; dv.setInt16(at, Math.round(dv.getInt16(at, true) * g), true); }
    }
  };
  const fin = Math.min(frames, Math.round(rate * 0.005)); const fout = Math.min(frames, Math.round(rate * 0.03));
  ramp(0, fin, true); ramp(frames - fout, fout, false);
  return out;
}

/** Wraps raw 16-bit mono PCM in a WAV header so any decoder can read it */
export function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1): ArrayBuffer {
  const out = new ArrayBuffer(44 + pcm.length);
  const v = new DataView(out);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * channels * 2, true);
  v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, pcm.length, true);
  new Uint8Array(out, 44).set(pcm);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Plain-words message for a refused call. Never includes the key. */
export function explainGeminiFailure(status: number, apiMessage: string): string {
  const m = apiMessage.toLowerCase();
  if (status === 400 && (m.includes('api key') || m.includes('api_key'))) return 'Google did not accept this Gemini key. Check it in Settings and paste it again.';
  if (status === 401 || status === 403) return 'Google refused this Gemini key. Check that it is active and allowed to use Gemini speech.';
  if (status === 429) return 'Your Gemini key has reached its free limit for now. Wait a minute and try again.';
  if (status === 404) return 'Google does not offer this voice model on your key. Try the other quality setting.';
  return apiMessage || `Gemini answered with an error (${status}).`;
}

export async function synthesizeWithOwnKey(req: GeminiSpeechRequest): Promise<ArrayBuffer> {
  const doFetch = req.fetchImpl ?? fetch;
  const attempts = Math.max(1, req.attempts ?? 3);
  let last: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const part: Record<string, unknown> = { text: asSpoken(req.script) };
      if (req.instruction && attempt === 1) part.speechMetadata = { style: req.instruction };
      const res = await doFetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(req.modelId)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': req.key },
        signal: req.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [part] }],
          generationConfig: {
            responseModalities: ['AUDIO'], temperature: 0, candidateCount: 1,
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voiceName } } },
          },
        }),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        const err = new Error(explainGeminiFailure(res.status, String(body?.error?.message ?? '')));
        // A key or quota problem will not fix itself on a retry
        if (res.status !== 500 && res.status !== 503) { (err as any).final = true; }
        throw err;
      }
      const audio = body?.candidates?.[0]?.content?.parts?.find((p: any) => p?.inlineData?.data)?.inlineData;
      if (!audio?.data) {
        const why = body?.candidates?.[0]?.finishReason ?? body?.promptFeedback?.blockReason ?? 'no reason given';
        throw new Error(`Gemini returned no audio (${why}).`);
      }
      const got = readAudioPayload(base64ToBytes(audio.data), String(audio.mimeType ?? ''));
      if (got.pcm.length < 2400) throw new Error('Gemini returned almost no audio.');
      return pcmToWav(softenEdges(got.pcm, got.rate, got.channels), got.rate, got.channels);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e;
      last = e instanceof Error ? e : new Error(String(e));
      if ((last as any).final) break;
    }
  }
  throw last ?? new Error('Voice generation failed.');
}
