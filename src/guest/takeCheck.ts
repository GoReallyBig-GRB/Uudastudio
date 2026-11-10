/** Checks on a finished take and on the device before recording. Pure, unit-tested. */

import type { Bits } from './wavWriter';

export interface TakeIssue { id: string; text: string }

/** A take should last as long as the clock said. A shortfall means the device dropped audio (a call, a USB glitch, a busy phone). */
export const shortfallSeconds = (recordedSeconds: number, wallSeconds: number, startupAllowance = 0.5): number =>
  Math.max(0, wallSeconds - startupAllowance - recordedSeconds);

/** Runs of exact digital silence inside a take (not the first or last 0.3 s). Real rooms are never exactly silent, so a run means the signal stopped. */
export const findDropouts = (x: Float32Array, sampleRate: number, minSeconds = 0.4): { at: number; seconds: number }[] => {
  const out: { at: number; seconds: number }[] = [];
  const edge = Math.round(0.3 * sampleRate), min = Math.round(minSeconds * sampleRate);
  let run = 0;
  for (let i = edge; i < x.length - edge; i++) {
    if (x[i] === 0) run++;
    else { if (run >= min) out.push({ at: (i - run) / sampleRate, seconds: run / sampleRate }); run = 0; }
  }
  if (run >= min) out.push({ at: (x.length - edge - run) / sampleRate, seconds: run / sampleRate });
  return out;
};

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export const checkTake = (x: Float32Array, sampleRate: number, wallSeconds: number): TakeIssue[] => {
  const issues: TakeIssue[] = [];
  const recorded = x.length / sampleRate;
  const lost = shortfallSeconds(recorded, wallSeconds);
  if (lost > 1) issues.push({ id: 'missing', text: `About ${Math.round(lost)} seconds of audio are missing: the device dropped out while recording. Record again if you can.` });
  const gaps = findDropouts(x, sampleRate);
  if (gaps.length > 0) issues.push({ id: 'dropout', text: `The signal stopped for ${gaps[0].seconds.toFixed(1)} s at ${clock(gaps[0].at)}${gaps.length > 1 ? ` and ${gaps.length - 1} other place${gaps.length > 2 ? 's' : ''}` : ''}. Check the microphone connection and record again.` });
  return issues;
};

/** Reads back the header of the file we wrote, so a bad file is caught before it is sent */
export const parseWavHeader = (b: Uint8Array): { sampleRate: number; channels: number; bits: number; dataBytes: number } | null => {
  if (b.length < 44) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || tag(12) !== 'fmt ' || tag(36) !== 'data') return null;
  return { channels: v.getUint16(22, true), sampleRate: v.getUint32(24, true), bits: v.getUint16(34, true), dataBytes: v.getUint32(40, true) };
};

export const wavMatches = (header: ReturnType<typeof parseWavHeader>, blobSize: number, samples: number, sampleRate: number, bits: Bits): boolean =>
  !!header && header.channels === 1 && header.sampleRate === sampleRate && header.bits === bits && header.dataBytes === samples * (bits / 8) && blobSize === 44 + header.dataBytes;

/** Whether the device has room for a take of this length. Takes are held as chunks and again as a file, so room for about three copies is wanted. */
export const storageCheck = (est: { quota?: number; usage?: number } | undefined, seconds: number, sampleRate: number, bits: Bits): { low: boolean; freeMB: number; neededMB: number } | null => {
  if (!est || !est.quota) return null;
  const free = Math.max(0, est.quota - (est.usage ?? 0));
  const needed = (44 + seconds * sampleRate * (bits === 24 ? 4 : 2)) * 3;
  return { low: free < needed, freeMB: Math.round(free / 1048576), neededMB: Math.round(needed / 1048576) };
};
