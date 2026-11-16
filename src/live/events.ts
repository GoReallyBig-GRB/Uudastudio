/** Live events on the producer's side: ordering, wording and share links. No network, no screen. */
import { parseBlocks } from '../guest/scriptFormat';

export type EventState = 'waiting' | 'open' | 'ended';
/** whatsapp is digits with the country code first; email is separate */
export interface LiveParticipant { name: string; whatsapp: string; email: string }
export interface LiveFile { id: string; name: string; mime: string; size: number; kind: 'doc' | 'audio' }
export interface LiveEvent {
  id: string; token: string; kind: 'scheduled' | 'quick'; title: string; description: string; notes: string;
  startsAt: number | null; durationMin: number | null; activatedAt: number | null; endedAt: number | null; participants: LiveParticipant[];
  state: EventState; files: LiveFile[]; createdAt: number;
}

export const FILE_CAP_BYTES = 1_000_000;
export const FILE_CAP_COUNT = 3;

const whenOf = (e: LiveEvent) => e.startsAt ?? e.activatedAt ?? e.createdAt;

/** Live now first, then upcoming by time (the next one on top), then past ones, latest first */
export const orderEvents = (events: LiveEvent[]): LiveEvent[] => {
  const rank = (e: LiveEvent) => (e.state === 'open' ? 0 : e.state === 'waiting' ? 1 : 2);
  return [...events].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? whenOf(b) - whenOf(a) : whenOf(a) - whenOf(b)));
};
export const upcomingEvents = (events: LiveEvent[]): LiveEvent[] => orderEvents(events).filter((e) => e.state !== 'ended');

/** The state as the clock says it now, without asking the server again */
export const stateNow = (e: LiveEvent, now: number): EventState => {
  if (e.endedAt) return 'ended';
  if (e.activatedAt) return 'open';
  if (e.startsAt === null) return 'waiting';
  if (now >= e.startsAt + 12 * 3600_000) return 'ended';
  return now >= e.startsAt ? 'open' : 'waiting';
};

export const joinLink = (origin: string, token: string): string => `${origin.replace(/#.*$/, '').replace(/\/$/, '')}/#/live/${token}`;
export const LIVE_PREFIX = '#/live/';
export const parseLiveHash = (hash: string): string | null => {
  if (!hash.startsWith(LIVE_PREFIX)) return null;
  const t = hash.slice(LIVE_PREFIX.length);
  return /^[A-Za-z0-9_-]{16,64}$/.test(t) ? t : null;
};
export const isLiveHash = (hash: string): boolean => hash.startsWith(LIVE_PREFIX);

export const linksIn = (text: string): string[] => {
  const found = text.match(/https?:\/\/[^\s<>"')]+/g) ?? [];
  return [...new Set(found.map((u) => u.replace(/[.,;:!?]+$/, '')))];
};

export const formatWhen = (ms: number, locale?: string): string =>
  new Date(ms).toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const countdown = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return 'in under a minute';
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `in ${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim();
  return `in ${Math.floor(h / 24)} days`;
};

/** The notes as plain text for a message: formatting marks removed, lists kept */
export const markupToPlain = (markup: string): string =>
  parseBlocks(markup).map((b) => {
    if (b.type === 'blank') return '';
    const text = b.runs.map((r) => (r.note ? `[${r.text}]` : r.text)).join('');
    if (b.type === 'heading') return text;
    const pad = '  '.repeat(b.indent);
    return b.type === 'item' ? `${pad}${b.marker} ${text}` : `${pad}${text}`;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();

export const durationLabel = (min: number): string => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);

/** "WAT, UTC+1" for the person's own zone */
export const zoneLabel = (at: number, locale?: string): string => {
  const parts = new Intl.DateTimeFormat(locale, { timeZoneName: 'short', hour: 'numeric' }).formatToParts(at);
  const short = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const off = -new Date(at).getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-'; const h = Math.floor(Math.abs(off) / 60); const m = Math.abs(off) % 60;
  const utc = `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
  return short && short !== utc && !short.startsWith('GMT') ? `${short}, ${utc}` : utc;
};

/** Date and time on separate lines of the invite: "Friday, 20 November 2026" and "2:00 PM (WAT, UTC+1)" */
export const whenParts = (ms: number, locale?: string): { date: string; time: string } => ({
  date: new Date(ms).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  time: `${new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })} (${zoneLabel(ms, locale)})`,
});

export const inviteMessage = (e: Pick<LiveEvent, 'title' | 'description' | 'notes' | 'startsAt' | 'durationMin' | 'files'>, link: string, host: string): string => {
  const out: string[] = [`${host || 'Your host'} invites you to a live session on Uuda Studio.`, ''];
  out.push(`Title: ${e.title}`);
  if (e.description) out.push(`Description: ${e.description}`);
  out.push('');
  if (e.startsAt) {
    const w = whenParts(e.startsAt);
    out.push('When:', `  Date: ${w.date}`, `  Time: ${w.time}`);
    if (e.durationMin) out.push(`  Duration: ${durationLabel(e.durationMin)}`);
  } else {
    out.push('When: starting now');
    if (e.durationMin) out.push(`Duration: ${durationLabel(e.durationMin)}`);
  }
  const notes = markupToPlain(e.notes);
  if (notes) out.push('', 'Notes:', notes);
  if (e.files.length) out.push('', `Materials: ${e.files.map((f) => f.name).join(', ')} (download them on the join page)`);
  out.push('', 'Join:', link);
  return out.join('\n');
};

const digits = (s: string) => s.replace(/\D/g, '');
export const whatsappUrl = (text: string, number = ''): string => {
  const d = digits(number);
  return `https://wa.me/${d.length >= 8 ? d : ''}?text=${encodeURIComponent(text)}`;
};
export const mailtoUrl = (subject: string, body: string, to = ''): string => `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
