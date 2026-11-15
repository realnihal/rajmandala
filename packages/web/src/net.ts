import { PROTOCOL_VERSION } from '@rajmandala/server';
import type { ClientMsg, ServerMsg } from '@rajmandala/server';
import type { Action } from '@rajmandala/engine';

export type NetStatus = 'connecting' | 'open' | 'reconnecting';

/**
 * Where the game server lives. Empty in development, where the server runs on
 * the same address as the page; set at build time (VITE_API_BASE) when the
 * page is hosted somewhere else, such as GitHub Pages.
 */
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '');

export const apiUrl = (path: string): string => `${API_BASE}${path}`;

function socketUrl(path: string): string {
  const url = new URL(apiUrl(path), location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

const PING_EVERY = 20_000;
const PONG_WITHIN = 10_000;
const MAX_BACKOFF = 15_000;

function stored(key: string, make: () => string): string {
  try {
    const have = localStorage.getItem(key);
    if (have) return have;
    const fresh = make();
    localStorage.setItem(key, fresh);
    return fresh;
  } catch {
    return make();
  }
}

const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The secret that owns this browser's seat. `slot` gives a second identity in
 * the same browser, for trying a multiplayer game alone (add ?guest=2 to the link).
 */
export function identityKey(slot = ''): string {
  return stored(`rajmandala-key${slot ? `-${slot}` : ''}`, randomHex);
}
export function savedName(slot = ''): string {
  try {
    return localStorage.getItem(`rajmandala-name${slot ? `-${slot}` : ''}`) ?? '';
  } catch {
    return '';
  }
}
export function saveName(name: string, slot = ''): void {
  try {
    localStorage.setItem(`rajmandala-name${slot ? `-${slot}` : ''}`, name);
  } catch {
    /* not remembered; the name still works for this visit */
  }
}

export interface RoomSocket {
  send(msg: ClientMsg): void;
  /** Sends a game action with a unique id, resent after a reconnect until the server answers it. */
  action(action: Action): void;
  close(): void;
}

/**
 * A connection to a room that looks after itself: it says hello, notices a
 * dead socket with a ping, reconnects with backoff, and resends any action
 * the server has not yet answered. Resends are safe because the server
 * applies each action id once.
 */
export function openRoom(
  code: string,
  hello: { key: string; name: string },
  onMessage: (msg: ServerMsg) => void,
  onStatus: (status: NetStatus) => void,
): RoomSocket {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  let pongDue: ReturnType<typeof setTimeout> | undefined;
  const unanswered = new Map<string, ClientMsg>();

  const raw = (msg: ClientMsg) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  function connect() {
    if (closed) return;
    clearTimeout(retry);
    const sock = new WebSocket(socketUrl(`/api/rooms/${code}/ws`));
    ws = sock;
    sock.onopen = () => {
      attempt = 0;
      onStatus('open');
      raw({ t: 'hello', v: PROTOCOL_VERSION, key: hello.key, name: hello.name });
      for (const msg of unanswered.values()) raw(msg);
      clearInterval(ping);
      ping = setInterval(() => {
        if (sock.readyState !== WebSocket.OPEN) return;
        sock.send('ping');
        clearTimeout(pongDue);
        // No answer means the socket is dead even if the browser still calls it open.
        pongDue = setTimeout(() => sock.close(), PONG_WITHIN);
      }, PING_EVERY);
    };
    sock.onmessage = (e) => {
      if (e.data === 'pong') return clearTimeout(pongDue);
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data as string) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'state' && msg.ack) unanswered.delete(msg.ack);
      if (msg.t === 'error' && msg.id) unanswered.delete(msg.id);
      onMessage(msg);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      clearInterval(ping);
      clearTimeout(pongDue);
      if (closed) return;
      onStatus('reconnecting');
      const wait = Math.min(MAX_BACKOFF, 500 * 2 ** attempt++) * (0.75 + Math.random() * 0.5);
      retry = setTimeout(connect, wait);
    };
  }

  // Phones drop sockets in the background and on network changes: try again the moment we are back.
  const wake = () => {
    if (closed || document.visibilityState === 'hidden') return;
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      attempt = 0;
      connect();
    }
  };
  window.addEventListener('online', wake);
  document.addEventListener('visibilitychange', wake);

  onStatus('connecting');
  connect();

  return {
    send: raw,
    action(action) {
      const msg: ClientMsg = { t: 'action', id: crypto.randomUUID(), action };
      unanswered.set(msg.id, msg);
      raw(msg);
    },
    close() {
      closed = true;
      clearTimeout(retry);
      clearInterval(ping);
      clearTimeout(pongDue);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      ws?.close();
    },
  };
}
