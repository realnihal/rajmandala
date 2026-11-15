import { RuleError, applyAction, createGame, randomPlacement, viewFor } from '@rajmandala/engine';
import type { Action, GameEvent, GameState, PlayerId } from '@rajmandala/engine';
import { PROTOCOL_VERSION } from './protocol';
import type { ClientMsg, RoomOptions, RoomStatus, RoomView, ServerMsg } from './protocol';

/**
 * One game table: seats, options and the game itself. This class holds all
 * the rules of a room and nothing about sockets or storage, so it can be
 * tested directly. The Durable Object around it persists `data` and delivers
 * the messages each call returns.
 */

export interface Member {
  id: PlayerId;
  /** Secret the player's browser holds; whoever presents it controls the seat. */
  key: string;
  name: string;
  ready: boolean;
  joined: number;
  /** Ids of recently applied actions, to ignore resends. */
  recent: string[];
}

/** Everything that must survive a restart. Plain JSON. */
export interface RoomData {
  code: string;
  status: RoomStatus;
  options: RoomOptions;
  hostId: PlayerId | null;
  members: Member[];
  game: GameState | null;
  seq: number;
  joins: number;
}

export interface Outcome {
  /** True when `data` changed and must be written to storage before anything is sent. */
  persist: boolean;
  send: { to: string; msg: ServerMsg }[];
}

export interface Chance {
  /** A fresh 32-bit seed for a new game. */
  seed: () => number;
  /** A float in [0, 1) for random starting placement. */
  rand: () => number;
}

const VICTORIES = ['samrajya', 'digvijaya', 'capitals'];
const RECENT_ACTIONS = 64;
export const DEFAULT_OPTIONS: RoomOptions = { victory: 'samrajya', seats: 4, autoPlace: true };

export function cleanName(name: unknown, fallback = 'Player'): string {
  const s = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 16) : '';
  return s || fallback;
}

export function validOptions(o: unknown): o is RoomOptions {
  if (typeof o !== 'object' || o === null) return false;
  const r = o as Record<string, unknown>;
  return (
    typeof r.victory === 'string' &&
    VICTORIES.includes(r.victory) &&
    typeof r.seats === 'number' &&
    Number.isInteger(r.seats) &&
    r.seats >= 2 &&
    r.seats <= 6 &&
    typeof r.autoPlace === 'boolean'
  );
}

export function newRoom(code: string, options: RoomOptions = DEFAULT_OPTIONS): RoomData {
  return { code, status: 'lobby', options: { ...options }, hostId: null, members: [], game: null, seq: 0, joins: 0 };
}

export class RoomCore {
  /** Which seat each open connection controls; null is a spectator. Not persisted. */
  private conns = new Map<string, PlayerId | null>();

  constructor(public data: RoomData) {}

  /** Re-registers a connection that was already open, after the room was reloaded from storage. */
  attach(conn: string, player: PlayerId | null): void {
    this.conns.set(conn, player && this.member(player) ? player : null);
  }

  seatOf(conn: string): PlayerId | null {
    return this.conns.get(conn) ?? null;
  }

  disconnect(conn: string): Outcome {
    if (!this.conns.delete(conn)) return { persist: false, send: [] };
    return this.broadcast(false);
  }

  handle(conn: string, msg: ClientMsg, chance: Chance): Outcome {
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return this.reject(conn, 'bad-message', 'Malformed message');
    if (msg.t === 'hello') return this.hello(conn, msg);
    if (!this.conns.has(conn)) return this.reject(conn, 'no-hello', 'Say hello first');

    const d = this.data;
    const me = this.member(this.seatOf(conn));
    const isHost = me !== undefined && me.id === d.hostId;
    switch (msg.t) {
      case 'rename':
        if (!me) return this.reject(conn, 'not-seated', 'You are not seated');
        me.name = cleanName(msg.name, me.name);
        return this.changed();
      case 'ready':
        if (!me || d.status !== 'lobby') return this.reject(conn, 'not-allowed', 'Not possible now');
        me.ready = msg.ready === true;
        return this.changed();
      case 'options':
        if (!isHost || d.status !== 'lobby') return this.reject(conn, 'not-allowed', 'Only the host can change options before the game');
        if (!validOptions(msg.options)) return this.reject(conn, 'bad-options', 'Invalid options');
        if (msg.options.seats < d.members.length) return this.reject(conn, 'bad-options', 'More players are seated than that');
        d.options = { victory: msg.options.victory, seats: msg.options.seats, autoPlace: msg.options.autoPlace };
        return this.changed();
      case 'kick':
        if (!isHost || d.status !== 'lobby' || msg.id === me!.id || !this.member(msg.id)) {
          return this.reject(conn, 'not-allowed', 'Cannot remove that player');
        }
        this.unseat(msg.id);
        return this.changed();
      case 'leave':
        if (!me || d.status !== 'lobby') return this.reject(conn, 'not-allowed', 'You can only leave before the game starts');
        this.unseat(me.id);
        return this.changed();
      case 'start':
        return this.start(conn, isHost, chance);
      case 'rematch':
        if (!isHost || d.status !== 'finished') return this.reject(conn, 'not-allowed', 'Only the host can start a rematch');
        d.status = 'lobby';
        d.game = null;
        for (const m of d.members) m.ready = false;
        return this.changed();
      case 'action':
        return this.action(conn, me, msg.id, msg.action, chance);
      default:
        return this.reject(conn, 'bad-message', 'Unknown message');
    }
  }

  // ------------------------------------------------------------ handlers

  private hello(conn: string, msg: Extract<ClientMsg, { t: 'hello' }>): Outcome {
    if (msg.v !== PROTOCOL_VERSION) return this.reject(conn, 'upgrade-required', 'Please reload to get the latest version');
    if (typeof msg.key !== 'string' || msg.key.length < 16 || msg.key.length > 64) return this.reject(conn, 'bad-hello', 'Invalid identity');
    const d = this.data;
    let persist = false;
    let member = d.members.find((m) => m.key === msg.key);
    if (!member && d.status === 'lobby' && d.members.length < d.options.seats) {
      const taken = new Set(d.members.map((m) => m.id));
      const id = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].find((x) => !taken.has(x))!;
      member = { id, key: msg.key, name: cleanName(msg.name), ready: false, joined: d.joins++, recent: [] };
      d.members.push(member);
      d.members.sort((a, b) => a.id.localeCompare(b.id));
      if (d.hostId === null) d.hostId = id;
      persist = true;
    }
    this.conns.set(conn, member ? member.id : null);
    if (persist) d.seq += 1;
    return this.broadcast(persist);
  }

  private start(conn: string, isHost: boolean, chance: Chance): Outcome {
    const d = this.data;
    if (!isHost || d.status !== 'lobby') return this.reject(conn, 'not-allowed', 'Only the host can start the game');
    if (d.members.length < 2) return this.reject(conn, 'not-ready', 'A game needs at least two players');
    if (d.members.some((m) => m.id !== d.hostId && !m.ready)) return this.reject(conn, 'not-ready', 'Everyone must be ready');
    const created = createGame({ players: d.members.map((m) => m.id), seed: chance.seed(), victory: d.options.victory });
    d.game = created.state;
    d.status = 'playing';
    for (const m of d.members) m.recent = [];
    return this.changed(created.events);
  }

  private action(conn: string, me: Member | undefined, id: unknown, action: Action, chance: Chance): Outcome {
    const d = this.data;
    if (!me) return this.reject(conn, 'not-seated', 'Spectators cannot play');
    if (typeof id !== 'string' || id.length < 1 || id.length > 64) return this.reject(conn, 'bad-message', 'Action needs an id');
    if (d.status !== 'playing' || !d.game) return this.reject(conn, 'not-playing', 'No game is in progress', id);
    // A resend of something already applied: answer with the current state and change nothing.
    if (me.recent.includes(id)) return { persist: false, send: [{ to: conn, msg: this.stateFor(conn, [], id) }] };

    let game: GameState;
    let events: GameEvent[];
    try {
      const r = applyAction(d.game, me.id, action);
      game = r.state;
      events = r.events;
      if (game.phase === 'setup-place' && d.options.autoPlace) {
        for (const pid of game.turnOrder) {
          const p = game.players[pid];
          if (!p.alive || p.setupPlacement !== null) continue;
          const placed = applyAction(game, pid, { type: 'setupPlace', placements: randomPlacement(game, pid, p.setupArmies, chance.rand) });
          game = placed.state;
          events = [...events, ...placed.events];
        }
      }
    } catch (e) {
      if (e instanceof RuleError) return this.reject(conn, e.code, e.message, id);
      throw e;
    }
    d.game = game;
    if (game.phase === 'finished') d.status = 'finished';
    me.recent.push(id);
    if (me.recent.length > RECENT_ACTIONS) me.recent.shift();
    return this.changed(events, conn, id);
  }

  // ------------------------------------------------------------- helpers

  private member(id: PlayerId | null): Member | undefined {
    return id === null ? undefined : this.data.members.find((m) => m.id === id);
  }

  private unseat(id: PlayerId): void {
    const d = this.data;
    d.members = d.members.filter((m) => m.id !== id);
    for (const [conn, seat] of this.conns) if (seat === id) this.conns.set(conn, null);
    if (d.hostId === id) d.hostId = [...d.members].sort((a, b) => a.joined - b.joined)[0]?.id ?? null;
  }

  private reject(conn: string, code: string, message: string, id?: string): Outcome {
    return { persist: false, send: [{ to: conn, msg: { t: 'error', code, message, ...(id ? { id } : {}) } }] };
  }

  private changed(events: GameEvent[] = [], ackConn?: string, ackId?: string): Outcome {
    this.data.seq += 1;
    return this.broadcast(true, events, ackConn, ackId);
  }

  private broadcast(persist: boolean, events: GameEvent[] = [], ackConn?: string, ackId?: string): Outcome {
    return {
      persist,
      send: [...this.conns.keys()].map((conn) => ({ to: conn, msg: this.stateFor(conn, events, conn === ackConn ? ackId : undefined) })),
    };
  }

  roomView(): RoomView {
    const d = this.data;
    const online = new Set(this.conns.values());
    return {
      code: d.code,
      status: d.status,
      hostId: d.hostId,
      options: d.options,
      members: d.members.map((m) => ({ id: m.id, name: m.name, ready: m.ready, online: online.has(m.id) })),
    };
  }

  /** The full picture for one connection: only what that seat is allowed to see. */
  private stateFor(conn: string, events: GameEvent[], ack?: string): ServerMsg {
    const you = this.seatOf(conn);
    const d = this.data;
    return {
      t: 'state',
      seq: d.seq,
      you,
      room: this.roomView(),
      game: d.game ? viewFor(d.game, you) : null,
      // A drawn card is known only to the player who drew it.
      events: events.map((e) => (e.type === 'cardDrawn' && e.player !== you ? { ...e, card: '' } : e)),
      ...(ack ? { ack } : {}),
    };
  }
}
