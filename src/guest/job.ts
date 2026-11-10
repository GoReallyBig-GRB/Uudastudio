/**
 * A guest recording job: what the producer sends a voice talent. The whole job travels inside the link (after the # sign), so
 * the talent page needs no server and no sign-in. Pure functions, unit-tested.
 */

import { spokenText } from './scriptFormat';

export interface GuestJob {
  /** Format version, so old links keep working */
  v: 1;
  /** Short name of the job, shown on the page and in the file name */
  title: string;
  /** The script. Text in [square brackets] is a director's note: shown in a different style and never counted as words to read. */
  script: string;
  /** Producer's target length in seconds, if any */
  targetSeconds?: number;
  /** Who is asking, shown to the talent */
  producer?: string;
  /** Who will record it, so the page never asks for a name */
  talent?: string;
}

export const MAX_TITLE = 80;
export const MAX_SCRIPT = 12000;
export const MAX_PRODUCER = 60;
/** Links longer than this are unreliable in some chat and mail apps */
export const LINK_WARN_LENGTH = 8000;
/** Reading pace used for the estimate, words per second (about 150 words a minute) */
export const WORDS_PER_SECOND = 2.5;
export const JOIN_HASH_PREFIX = '#/join/';

export interface ScriptSegment {
  kind: 'speech' | 'note';
  text: string;
}

/** Splits a script into spoken text and bracketed director notes, in order. An unclosed bracket is treated as speech. */
export const parseScript = (script: string): ScriptSegment[] => {
  const out: ScriptSegment[] = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(script)) !== null) {
    if (m.index > last) out.push({ kind: 'speech', text: script.slice(last, m.index) });
    out.push({ kind: 'note', text: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < script.length) out.push({ kind: 'speech', text: script.slice(last) });
  return out.filter((s) => s.text.length > 0);
};

/** Words the talent has to read: notes are not counted */
export const countWords = (script: string): number => spokenText(script).match(/\S+/g)?.length ?? 0;

export const estimateSeconds = (script: string, wordsPerSecond = WORDS_PER_SECOND): number => countWords(script) / wordsPerSecond;

const toBase64Url = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromBase64Url = (text: string): Uint8Array => {
  const b = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};

/** Trims and limits a job so a link is always valid */
export const cleanJob = (job: Partial<GuestJob>): GuestJob => {
  const target = typeof job.targetSeconds === 'number' && Number.isFinite(job.targetSeconds) && job.targetSeconds > 0 ? Math.min(Math.round(job.targetSeconds), 6 * 3600) : undefined;
  const producer = (job.producer ?? '').trim().slice(0, MAX_PRODUCER);
  return {
    v: 1,
    title: (job.title ?? '').trim().slice(0, MAX_TITLE) || 'Voice recording',
    script: (job.script ?? '').slice(0, MAX_SCRIPT),
    ...(target ? { targetSeconds: target } : {}),
    ...(producer ? { producer } : {}),
    ...((job.talent ?? '').trim() ? { talent: (job.talent ?? '').trim().slice(0, MAX_PRODUCER) } : {}),
  };
};

export const encodeJob = (job: GuestJob): string => toBase64Url(new TextEncoder().encode(JSON.stringify(cleanJob(job))));

/** Reads a job back from the part of a link after #/join/. Returns null for anything that is not a valid job. */
export const decodeJob = (token: string): GuestJob | null => {
  try {
    const raw = JSON.parse(new TextDecoder().decode(fromBase64Url(token.trim()))) as Partial<GuestJob>;
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || typeof raw.script !== 'string') return null;
    return cleanJob(raw);
  } catch {
    return null;
  }
};

/** The full link for a job; `base` is the app's address without any # part */
export const jobLink = (job: GuestJob, base: string): string => `${base.replace(/#.*$/, '')}${JOIN_HASH_PREFIX}${encodeJob(job)}`;

/** The job in the current address, or null when the address is not a guest link */
export const jobFromHash = (hash: string): GuestJob | null => (hash.startsWith(JOIN_HASH_PREFIX) ? decodeJob(hash.slice(JOIN_HASH_PREFIX.length)) : null);
export const isJoinHash = (hash: string): boolean => hash.startsWith(JOIN_HASH_PREFIX);

/** "0:42" or "1:05:09" */
export const formatClock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};
