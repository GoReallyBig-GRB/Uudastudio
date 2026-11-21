/**
 * The browser's connection to a live room: opens the socket, keeps it alive, reconnects when the network blips (the local recording is
 * never touched by any of this), keeps a shared clock, and turns the server's messages into a RoomView.
 */
import { RoomClock } from './clockSync';
import { applyServerMessage, initialView, type RoomView } from './roomState';

export interface RoomClientOptions {
  token: string;
  /** Guests give a name; the producer's name comes from the account */
  name?: string;
  onView: (v: RoomView) => void;
  /** Every raw server message, for things the view does not keep (call signalling) */
  onMessage?: (m: Record<string, unknown>) => void;
  /** Replaceable for tests */
  open?: (url: string) => WebSocket;
  origin?: string;
  /** This browser's private rejoin key. Left out, one is made and kept for the tab, so a refresh or a dropped connection is the same person. */
  rejoinKey?: string;
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: typeof setInterval; clearInterval: typeof clearInterval };
}

/** Close codes the server uses to say "do not come back": removed, replaced by another tab, not allowed */
const FINAL = new Set([4000, 4001, 4002, 4003]);
export const backoffMs = (attempt: number): number => Math.min(10_000, 1000 * 2 ** Math.min(attempt, 4));
/** A spread of ±30%, so a room full of guests whose network came back together do not all knock at the same instant */
export const withJitter = (ms: number, random: () => number = Math.random): number => Math.round(ms * (0.7 + random() * 0.6));
/** A ping every few seconds. The room answers it without waking up, so it costs nothing. */
export const PING_MS = 4_000;
/** If nothing at all (not even a reply to our ping) has come in for this long, the connection is dead even though the browser has not noticed: about 10 to 14 seconds in all */
export const DEAD_AFTER_MS = 10_000;

const newKey = (): string => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
/** One key per room per tab. Not kept after the tab closes, and never sent anywhere but this room's own address. */
const keyFor = (token: string): string => {
  const slot = `uuda-rejoin:${token}`;
  try {
    const have = sessionStorage.getItem(slot);
    if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return have;
    const k = newKey();
    sessionStorage.setItem(slot, k);
    return k;
  } catch { return newKey(); } // storage blocked: still works within this page's life
};

export class RoomClient {
  readonly clock = new RoomClock();
  private ws: WebSocket | null = null;
  private view: RoomView = initialView();
  private attempt = 0;
  private closed = false;
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<number, number>();
  private lastHeard = Date.now();
  private readonly key: string;
  /** The device says it has lost its network: no need to wait for the silence to prove it */
  private onOffline = () => { const ws = this.ws; if (!this.closed && ws && this.view.connected) { try { ws.close(); } catch { /* gone */ } this.lostSilently(ws); } };
  private onOnline = () => { if (!this.closed && !this.view.connected && this.retry) { this.t.clearTimeout(this.retry); this.retry = null; this.attempt = 0; this.connect(); } };
  private t: NonNullable<RoomClientOptions['timers']>;

  constructor(private readonly o: RoomClientOptions) {
    this.t = o.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };
    this.key = o.rejoinKey ?? (o.name ? keyFor(o.token) : '');
    // The network coming back is the moment to retry, not whenever the timer happens to fire
    try { window.addEventListener('online', this.onOnline); window.addEventListener('offline', this.onOffline); } catch { /* not in a browser */ }
  }

  get state(): RoomView { return this.view; }
  private set(v: RoomView) { this.view = v; this.o.onView(v); }

  connect(): void {
    if (this.closed) return;
    const origin = this.o.origin ?? location.origin;
    const query = [this.o.name ? `name=${encodeURIComponent(this.o.name)}` : '', this.o.name && this.key ? `resume=${encodeURIComponent(this.key)}` : ''].filter(Boolean).join('&');
    const url = `${origin.replace(/^http/, 'ws')}/api/live/room/${encodeURIComponent(this.o.token)}${query ? `?${query}` : ''}`;
    const ws = (this.o.open ?? ((u) => new WebSocket(u)))(url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.lastHeard = Date.now();
      this.keepAlive = this.t.setInterval(() => {
        // A connection that died without saying so (a phone that left Wi-Fi) is closed here, which starts the usual reconnect
        if (Date.now() - this.lastHeard > DEAD_AFTER_MS) { try { ws.close(); } catch { /* gone */ } this.lostSilently(ws); return; }
        try { ws.send('ping'); } catch { /* closing */ }
      }, PING_MS);
      // Four quick readings of the clock, then one every 5 minutes (each one wakes the room's server, so more would use up the free allowance)
      let quick = 0;
      const tick = () => this.sync();
      tick();
      this.syncTimer = this.t.setInterval(() => { tick(); if (++quick === 3 && this.syncTimer) { this.t.clearInterval(this.syncTimer); this.syncTimer = this.t.setInterval(tick, 300_000); } }, 400);
    };
    ws.onmessage = (e) => {
      this.lastHeard = Date.now();
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      let m: Record<string, unknown>;
      try { m = JSON.parse(e.data) as Record<string, unknown>; } catch { return; }
      if (m.t === 'sync') {
        const sentAt = this.pending.get(Number(m.c));
        this.pending.delete(Number(m.c));
        if (sentAt !== undefined) this.clock.add({ sentAt, receivedAt: Date.now(), serverAt: Number(m.s) });
        return;
      }
      this.set(applyServerMessage(this.view, m));
      this.o.onMessage?.(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return; // a connection we already replaced
      this.stopTimers();
      this.set({ ...this.view, connected: false });
      if (this.closed) return;
      if (FINAL.has(e.code)) {
        this.closed = true;
        this.set({ ...this.view, closedReason: this.view.closedReason ?? this.view.error ?? (e.code === 4001 ? 'The room was opened in another window.' : 'You cannot join this room.') });
        return;
      }
      this.retry = this.t.setTimeout(() => { this.retry = null; this.connect(); }, withJitter(backoffMs(this.attempt++)));
    };
  }

  /** A close the browser never reported: treat it as an ordinary drop (ignore it if the socket already moved on) */
  private lostSilently(ws: WebSocket): void {
    const handler = ws.onclose;
    if (this.ws !== ws || !handler) return;
    ws.onclose = null; // the real close event may still arrive later; it must not schedule a second retry
    handler.call(ws, { code: 1006 } as CloseEvent);
  }

  private sync(): void {
    const c = Date.now();
    this.pending.set(c, c);
    if (this.pending.size > 20) this.pending.delete(this.pending.keys().next().value as number);
    this.send({ t: 'sync', c });
  }

  send(msg: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private stopTimers() {
    if (this.keepAlive) this.t.clearInterval(this.keepAlive);
    if (this.syncTimer) this.t.clearInterval(this.syncTimer);
    this.keepAlive = this.syncTimer = null;
  }

  close(): void {
    this.closed = true;
    this.stopTimers();
    try { window.removeEventListener('online', this.onOnline); window.removeEventListener('offline', this.onOffline); } catch { /* not in a browser */ }
    if (this.retry) this.t.clearTimeout(this.retry);
    try { this.ws?.close(1000, 'leaving'); } catch { /* already closed */ }
  }
}
