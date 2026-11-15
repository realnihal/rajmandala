import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_OPTIONS, RoomCore, newRoom, validOptions } from '@rajmandala/server';
import type { ClientMsg, Outcome, RoomData, RoomOptions } from '@rajmandala/server';

/** Room codes avoid characters that look alike (0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_MESSAGE_BYTES = 16 * 1024;
const STORAGE_KEY = 'room';

interface Attachment {
  /** Stable id for this socket, kept across hibernation. */
  conn: string;
  seat: string | null;
}

/**
 * One game room. All rules live in RoomCore; this class only stores the
 * room, holds the WebSockets, and delivers what RoomCore says to send.
 */
export class GameRoom extends DurableObject {
  private core: RoomCore | null = null;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    // Answered by the runtime without waking the room, so idle rooms can hibernate.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      const data = await ctx.storage.get<RoomData>(STORAGE_KEY);
      if (!data) return;
      this.core = new RoomCore(data);
      // Sockets survive hibernation; tell the rebuilt room who is on each one.
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (a) this.core.attach(a.conn, a.seat);
      }
    });
  }

  /** Creates the room. Returns false if this code is already in use. */
  async create(code: string, options: RoomOptions): Promise<boolean> {
    if (this.core) return false;
    const data = newRoom(code, options);
    await this.ctx.storage.put(STORAGE_KEY, data);
    this.core = new RoomCore(data);
    return true;
  }

  async exists(): Promise<boolean> {
    return this.core !== null;
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.core) return new Response('No such room', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ conn: crypto.randomUUID(), seat: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!this.core || !a) return ws.close(1011, 'Room unavailable');
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return ws.close(1009, 'Message too large');
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return ws.close(1007, 'Messages must be JSON');
    }
    const out = this.core.handle(a.conn, msg, {
      seed: () => crypto.getRandomValues(new Uint32Array(1))[0],
      rand: Math.random,
    });
    await this.deliver(out);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.gone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.gone(ws);
  }

  private async gone(ws: WebSocket): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (this.core && a) await this.deliver(this.core.disconnect(a.conn));
  }

  /** Saves first, then sends: nobody is told about a change that is not yet stored. */
  private async deliver(out: Outcome): Promise<void> {
    const core = this.core!;
    if (out.persist) await this.ctx.storage.put(STORAGE_KEY, core.data);
    const sockets = new Map<string, WebSocket>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a) continue;
      sockets.set(a.conn, ws);
      // Seats change on join, kick and leave; keep each socket's record current.
      const seat = core.seatOf(a.conn);
      if (seat !== a.seat) ws.serializeAttachment({ conn: a.conn, seat } satisfies Attachment);
    }
    for (const { to, msg } of out.send) {
      try {
        sockets.get(to)?.send(JSON.stringify(msg));
      } catch {
        // The socket closed between the read and the send; its close handler tidies up.
      }
    }
  }
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** The calling site, if it may use this server: this site itself, a listed site, or a local dev server. */
function allowedOrigin(request: Request, env: Cloudflare.Env): string | null {
  const origin = request.headers.get('Origin');
  if (!origin) return null;
  const listed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  return origin === new URL(request.url).origin || listed.includes(origin) || LOCAL_ORIGIN.test(origin) ? origin : null;
}

function withCors(response: Response, origin: string | null): Response {
  if (!origin) return response;
  const out = new Response(response.body, response);
  out.headers.set('Access-Control-Allow-Origin', origin);
  out.headers.set('Vary', 'Origin');
  return out;
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    const origin = allowedOrigin(request, env);

    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST',
          'Access-Control-Allow-Headers': 'content-type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    // Browsers always name the calling site on a WebSocket; refuse sites that are not ours.
    if (request.headers.get('Upgrade') === 'websocket') {
      if (request.headers.has('Origin') && !origin) return new Response('Origin not allowed', { status: 403 });
      const ws = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/ws$/);
      return ws ? ctx.exports.GameRoom.getByName(ws[1]).fetch(request) : new Response('Not found', { status: 404 });
    }
    return withCors(await api(request, url, ctx), origin);
  },
} satisfies ExportedHandler<Cloudflare.Env>;

async function api(request: Request, url: URL, ctx: ExecutionContext): Promise<Response> {
  {
    const rooms = ctx.exports.GameRoom;

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { options?: unknown } | null;
      const options = validOptions(body?.options) ? body.options : DEFAULT_OPTIONS;
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        if (await rooms.getByName(code).create(code, options)) return Response.json({ code });
      }
      return new Response('Could not allocate a room code', { status: 503 });
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})$/);
    if (match && request.method === 'GET') {
      return (await rooms.getByName(match[1]).exists()) ? Response.json({ code: match[1] }) : new Response('No such room', { status: 404 });
    }
    return new Response('Not found', { status: 404 });
  }
}
