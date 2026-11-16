/** Live events on the producer's side: ordering, wording and share links. No network, no screen. */

export type EventState = 'waiting' | 'open' | 'ended';
export interface LiveParticipant { name: string; contact: string }
export interface LiveFile { id: string; name: string; mime: string; size: number; kind: 'doc' | 'audio' }
export interface LiveEvent {
  id: string; token: string; kind: 'scheduled' | 'quick'; title: string; description: string; notes: string;
  startsAt: number | null; activatedAt: number | null; endedAt: number | null; participants: LiveParticipant[];
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

export const inviteMessage = (e: Pick<LiveEvent, 'title' | 'description' | 'notes' | 'startsAt' | 'files'>, link: string, host: string): string => {
  const lines = [`${host ? `${host} invites you` : 'You are invited'} to a live session: ${e.title}`];
  lines.push(e.startsAt ? `When: ${formatWhen(e.startsAt)}` : 'Starting now');
  if (e.description) lines.push('', e.description);
  if (e.notes) lines.push('', 'Notes:', e.notes);
  if (e.files.length) lines.push('', `Materials attached on the page: ${e.files.map((f) => f.name).join(', ')}`);
  lines.push('', 'Join here:', link);
  return lines.join('\n');
};

const digits = (s: string) => s.replace(/\D/g, '');
export const whatsappUrl = (text: string, contact = ''): string => {
  const d = digits(contact);
  return `https://wa.me/${d.length >= 7 ? d : ''}?text=${encodeURIComponent(text)}`;
};
export const mailtoUrl = (subject: string, body: string, to = ''): string => `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
export const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
