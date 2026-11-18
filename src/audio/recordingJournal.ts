/**
 * Pure helpers for recording straight to disk. A take in progress lives in uuda-assets/<storeId>/ as ch0.f32 (and ch1.f32)
 * plus journal.json. meta.json is written only when the take ends cleanly, so a folder with a journal and no meta.json is a
 * recording that was cut short (crash, closed tab, dead battery) and can be recovered up to the last second written.
 */
export const JOURNAL_FILE = 'journal.json';
export const RECORDING_ID_PREFIX = 'rec-';

export interface RecordingJournal {
  storeId: string;
  sampleRate: number;
  channels: number;
  /** Date.now() when recording began */
  startedAt: number;
  name: string;
}

export const newRecordingId = (now = Date.now()): string => `${RECORDING_ID_PREFIX}${now}-${Math.random().toString(36).slice(2, 8)}`;

export function parseJournal(text: string): RecordingJournal | null {
  try {
    const j = JSON.parse(text) as Partial<RecordingJournal>;
    if (!j || typeof j.storeId !== 'string' || !j.storeId) return null;
    if (!Number.isFinite(j.sampleRate) || (j.sampleRate as number) < 8000 || (j.sampleRate as number) > 384000) return null;
    if (!Number.isInteger(j.channels) || (j.channels as number) < 1 || (j.channels as number) > 8) return null;
    return { storeId: j.storeId, sampleRate: j.sampleRate as number, channels: j.channels as number, startedAt: Number.isFinite(j.startedAt) ? (j.startedAt as number) : 0, name: typeof j.name === 'string' ? j.name : 'Recovered recording' };
  } catch { return null; }
}

/** Whole frames every channel file has in full: a cut-short write can leave the channels a few frames apart. */
export function recoverableFrames(channelFileBytes: number[]): number {
  if (channelFileBytes.length === 0) return 0;
  return Math.floor(Math.min(...channelFileBytes) / Float32Array.BYTES_PER_ELEMENT);
}

/** Bytes written per second of recording (planar float32). */
export const bytesPerSecond = (sampleRate: number, channels: number): number => sampleRate * channels * Float32Array.BYTES_PER_ELEMENT;

/** How many seconds of recording fit in the given free space, keeping a safety margin for the waveform and other files. */
export function secondsThatFit(freeBytes: number, sampleRate: number, channels: number, reserveBytes = 64 * 1024 * 1024): number {
  const usable = Math.max(0, freeBytes - reserveBytes);
  return Math.floor(usable / bytesPerSecond(sampleRate, channels));
}

/** "3 h 20 min", "45 min" for the space warning */
export function fitLabel(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A folder only counts as cut short when nothing has written to it for a while; a recording still running in another tab keeps touching it. */
export const STALE_AFTER_MS = 30_000;
export const isStale = (lastModified: number, now = Date.now()): boolean => now - lastModified > STALE_AFTER_MS;

/** Takes up to this long come back as an ordinary in-memory buffer (everything works on them); longer ones stay on disk. */
export const IN_MEMORY_TAKE_SECONDS = 10 * 60;
