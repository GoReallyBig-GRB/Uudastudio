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
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout; setInterval: typeof setInterval; clearInterval: typeof clearInterval };
}

/** Close codes the server uses to say "do not come back": removed, replaced by another tab, not allowed */
const FINAL = new Set([4000, 4001, 4002, 4003]);
export const backoffMs = (attempt: number): number => Math.min(10_000, 1000 * 2 ** Math.min(attempt, 4));

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
  private t: NonNullable<RoomClientOptions['timers']>;

  constructor(private readonly o: RoomClientOptions) {
    this.t = o.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };
  }

  get state(): RoomView { return this.view; }
  private set(v: RoomView) { this.view = v; this.o.onView(v); }

  connect(): void {
    if (this.closed) return;
    const origin = this.o.origin ?? location.origin;
    const url = `${origin.replace(/^http/, 'ws')}/api/live/room/${encodeURIComponent(this.o.token)}${this.o.name ? `?name=${encodeURIComponent(this.o.name)}` : ''}`;
    const ws = (this.o.open ?? ((u) => new WebSocket(u)))(url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.keepAlive = this.t.setInterval(() => { try { ws.send('ping'); } catch { /* closing */ } }, 25_000);
      // Four quick readings of the clock, then one every 5 minutes (each one wakes the room's server, so more would use up the free allowance)
      let quick = 0;
      const tick = () => this.sync();
      tick();
      this.syncTimer = this.t.setInterval(() => { tick(); if (++quick === 3 && this.syncTimer) { this.t.clearInterval(this.syncTimer); this.syncTimer = this.t.setInterval(tick, 300_000); } }, 400);
    };
    ws.onmessage = (e) => {
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
      this.stopTimers();
      this.set({ ...this.view, connected: false });
      if (this.closed) return;
      if (FINAL.has(e.code)) {
        this.closed = true;
        this.set({ ...this.view, closedReason: this.view.closedReason ?? this.view.error ?? (e.code === 4001 ? 'The room was opened in another window.' : 'You cannot join this room.') });
        return;
      }
      this.retry = this.t.setTimeout(() => this.connect(), backoffMs(this.attempt++));
    };
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
    if (this.retry) this.t.clearTimeout(this.retry);
    try { this.ws?.close(1000, 'leaving'); } catch { /* already closed */ }
  }
}
