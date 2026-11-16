/**
 * Live events: the rules, with no storage and no network, so they can be tested alone.
 * An event is a room the producer opens for live guests. Its link works from the scheduled time, or when the producer opens it.
 */
export const LIMITS = {
  title: 120,
  description: 1000,
  notes: 8000,
  participants: 20,
  participantText: 120,
  events: 100,
  files: 3,
  /** One file. D1 keeps a file inside one row, so the cap is about a minute of mp3 or a short document. */
  fileBytes: 1_000_000,
  /** A scheduled event that nobody opened closes this long after it was due */
  openMs: 12 * 3600_000,
} as const;

/** whatsapp is digits only, country code first (E.164 without the plus) */
export interface Participant { name: string; whatsapp: string; email: string }
export interface LiveEventRow {
  id: string; userId: string; token: string; kind: 'scheduled' | 'quick';
  title: string; description: string; notes: string;
  startsAt: number | null; durationMin: number | null; activatedAt: number | null; endedAt: number | null;
  participants: Participant[]; hostName: string; createdAt: number; updatedAt: number;
}
export interface FileMeta { id: string; name: string; mime: string; size: number; kind: 'doc' | 'audio' }
export type EventState = 'waiting' | 'open' | 'ended';

export interface EventInput { kind: 'scheduled' | 'quick'; title: string; description: string; notes: string; startsAt: number | null; durationMin: number | null; participants: Participant[] }

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');

export const validateEvent = (body: unknown, now: number): { ok: true; value: EventInput } | { ok: false; error: string } => {
  if (!body || typeof body !== 'object') return { ok: false, error: 'An event is required.' };
  const b = body as Record<string, unknown>;
  const kind = b.kind === 'quick' ? 'quick' : 'scheduled';
  const title = clean(b.title, LIMITS.title) || (kind === 'quick' ? 'Quick event' : '');
  if (!title) return { ok: false, error: 'Give the event a title.' };
  let startsAt: number | null = null;
  if (kind === 'scheduled') {
    const t = Number(b.startsAt);
    if (!Number.isFinite(t) || t <= 0) return { ok: false, error: 'Pick a date and time for the event.' };
    if (t > now + 5 * 366 * 86400_000) return { ok: false, error: 'That date is too far ahead.' };
    startsAt = Math.round(t);
  }
  const raw = Array.isArray(b.participants) ? b.participants : [];
  const participants: Participant[] = [];
  for (const p of raw.slice(0, LIMITS.participants)) {
    const o = (p ?? {}) as Record<string, unknown>;
    const name = clean(o.name, LIMITS.participantText);
    // Older events kept one 'contact' box: an address with @ is an email, anything else a WhatsApp number
    const legacy = clean(o.contact, LIMITS.participantText);
    const email = clean(o.email, LIMITS.participantText) || (legacy.includes('@') ? legacy : '');
    const whatsapp = (typeof o.whatsapp === 'string' ? o.whatsapp : legacy.includes('@') ? '' : legacy).replace(/\D/g, '').slice(0, 15);
    if (!name) continue;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: `${name}: that email address does not look right.` };
    if (whatsapp && whatsapp.length < 8) return { ok: false, error: `${name}: the WhatsApp number is too short. Include the country code.` };
    participants.push({ name, whatsapp, email });
  }
  let durationMin: number | null = null;
  if (b.durationMin !== null && b.durationMin !== undefined && b.durationMin !== '') {
    const d = Math.round(Number(b.durationMin));
    if (!Number.isFinite(d) || d < 5 || d > 720) return { ok: false, error: 'A session lasts between 5 minutes and 12 hours.' };
    durationMin = d;
  }
  return { ok: true, value: { kind, title, description: clean(b.description, LIMITS.description), notes: clean(b.notes, LIMITS.notes), startsAt, durationMin, participants } };
};

/** Waiting until the time comes or the producer opens it; open until the producer ends it (or 12 hours after the due time) */
export const stateOf = (e: Pick<LiveEventRow, 'startsAt' | 'activatedAt' | 'endedAt'>, now: number): EventState => {
  if (e.endedAt) return 'ended';
  if (e.activatedAt) return 'open';
  if (e.startsAt === null) return 'waiting';
  if (now >= e.startsAt + LIMITS.openMs) return 'ended';
  return now >= e.startsAt ? 'open' : 'waiting';
};

const DOC = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'md', 'odt', 'ppt', 'pptx', 'xls', 'xlsx', 'csv'];
const AUDIO = ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'];
export const fileKindOf = (name: string): 'doc' | 'audio' | null => {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return AUDIO.includes(ext) ? 'audio' : DOC.includes(ext) ? 'doc' : null;
};
export const cleanFileName = (name: string): string => name.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').trim().slice(0, 100);

export const randomId = (bytes: number): string => {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  let s = ''; for (const x of a) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
