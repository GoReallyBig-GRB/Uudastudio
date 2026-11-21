import { DurableObject } from 'cloudflare:workers';
import { RoomHost, type HostSocket, type HostState } from './roomHost';
import type { Role } from './room';

/**
 * One live room per event. Sockets use the hibernation API, so a quiet room costs nothing. Audio never passes through here: only who is
 * present, call signalling, cues and the start/stop moments. The behaviour is in roomHost.ts and room.ts, where it is tested.
 */
export class LiveRoom extends DurableObject {
  private host: RoomHost;
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    // Answered by the runtime without waking this object, so an open page costs nothing between events
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    this.host = new RoomHost(ctx as unknown as HostState, () => { const p = new WebSocketPair(); return { client: p[0] as unknown as HostSocket, server: p[1] as unknown as HostSocket }; });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    const role: Role = request.headers.get('x-room-role') === 'producer' ? 'producer' : 'guest';
    const opened = Number(request.headers.get('x-room-opened-at'));
    const client = await this.host.connect(role, request.headers.get('x-room-name') ?? '', Date.now(), Number.isFinite(opened) && opened > 0 ? opened : null, request.headers.get('x-room-mode') === 'broadcast' ? 'broadcast' : 'conversation', request.headers.get('x-room-resume') ?? '');
    return new Response(null, { status: 101, webSocket: client as unknown as WebSocket });
  }

  async alarm(): Promise<void> { await this.host.alarm(Date.now()); }
  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> { await this.host.message(ws as unknown as HostSocket, data, Date.now()); }
  async webSocketClose(ws: WebSocket, code: number): Promise<void> { this.host.closed(ws as unknown as HostSocket, code); }
  async webSocketError(ws: WebSocket): Promise<void> { this.host.closed(ws as unknown as HostSocket, 1011); }
}
