import { RULES_VERSION, RuleError, applyAction, awaitedPlayers, botAction, createGame, currentPlayer, isMapId, isTerritory, randomPlacement, selectMap, viewFor } from '@rajmandala/engine';
import type { Action, GameEvent, GameState, PlayerId } from '@rajmandala/engine';
import { COLOR_COUNT, PROTOCOL_VERSION, TURN_SECONDS } from './protocol';
import type { ChatLine, ClientMsg, RoomOptions, RoomStatus, RoomView, ServerMsg } from './protocol';

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
  /** True while a bot plays this seat: a computer player, or a human who stopped responding. */
  bot: boolean;
  /** Turns in a row this player let the clock run out. */
  missed: number;
  lastChat: number;
  /** Index of the colour this player plays in. */
  color: number;
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
  chat: ChatLine[];
  /** When the awaited turn is played automatically, or null. */
  deadline: number | null;
  /** What the deadline is for, so it restarts only when the awaited move changes. */
  waitingOn: string;
  /** Earliest time a bot should make its next move, leaving room for animations. */
  botAt: number;
  /** Last time anything changed, for clearing out abandoned rooms. */
  touched: number;
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
  /** The current time in milliseconds. */
  now: () => number;
}

const VICTORIES = ['samrajya', 'digvijaya', 'capitals'];
const RECENT_ACTIONS = 64;
const MISSES_BEFORE_TAKEOVER = 3;
const CHAT_KEPT = 40;
const CHAT_GAP_MS = 700;
const BOT_NAMES = ['Chanakya', 'Ashoka', 'Akbar', 'Shivaji', 'Lakshmibai', 'Tipu'];
const DAY = 86_400_000;
export const DEFAULT_OPTIONS: RoomOptions = { victory: 'samrajya', seats: 4, autoPlace: true, turnSeconds: 180, map: 'india' };

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
    typeof r.autoPlace === 'boolean' &&
    typeof r.turnSeconds === 'number' &&
    TURN_SECONDS.includes(r.turnSeconds) &&
    isMapId(r.map)
  );
}

export function newRoom(code: string, options: RoomOptions = DEFAULT_OPTIONS): RoomData {
  return {
    code,
    status: 'lobby',
    options: { ...options },
    hostId: null,
    members: [],
    game: null,
    seq: 0,
    joins: 0,
    chat: [],
    deadline: null,
    waitingOn: '',
    botAt: 0,
    touched: 0,
  };
}

export class RoomCore {
  /** Which seat each open connection controls; null is a spectator. Not persisted. */
  private conns = new Map<string, PlayerId | null>();

  constructor(public data: RoomData) {
    // A game begun on an older map or rule set cannot continue: send the table back to the lobby.
    if (data.game && data.game.rulesVersion !== RULES_VERSION) {
      data.game = null;
      data.status = 'lobby';
      data.deadline = null;
      data.waitingOn = '';
      for (const m of data.members) m.ready = m.key === '';
    }
    // Rooms stored before these fields existed are brought up to date.
    data.options.turnSeconds ??= 0;
    data.options.map ??= 'india';
    data.chat ??= [];
    data.deadline ??= null;
    data.waitingOn ??= '';
    data.botAt ??= 0;
    data.touched ??= 0;
    for (const m of data.members) {
      m.bot ??= false;
      m.missed ??= 0;
      m.lastChat ??= 0;
    }
    // Rooms from before colours could be chosen: keep the colour each seat always had.
    for (const m of data.members) m.color ??= Number(m.id.slice(1)) - 1;
  }

  /** True when nobody is connected and nothing has happened for a long time. */
  expired(now: number): boolean {
    const d = this.data;
    return this.conns.size === 0 && d.touched > 0 && now > this.expiresAt();
  }

  /** When an untouched room becomes old enough to clear: a day, or a week for a game in progress. */
  expiresAt(): number {
    const d = this.data;
    return d.touched + (d.status === 'playing' ? 7 * DAY : DAY);
  }

  /** When the room next needs waking: for a bot's move or a turn running out. */
  nextWake(): number | null {
    const d = this.data;
    if (d.status !== 'playing' || !d.game) return null;
    if (awaitedPlayers(d.game).some((p) => this.member(p)?.bot)) return d.botAt;
    return d.deadline;
  }

  /**
   * Called when the clock reaches nextWake(). A bot makes one move; or, if a
   * human has run out of time, their turn is finished for them. A player who
   * runs out three turns in a row is minded by a bot until they come back.
   */
  tick(chance: Chance): Outcome {
    const d = this.data;
    const now = chance.now();
    if (d.status !== 'playing' || !d.game) return { persist: false, send: [] };
    const awaited = awaitedPlayers(d.game);
    const bot = awaited.find((p) => this.member(p)?.bot);
    try {
      if (bot) {
        if (now < d.botAt) return { persist: false, send: [] };
        const action = botAction(d.game, bot, chance.rand, 'play');
        return action ? this.changed(chance, this.apply(bot, action, chance)) : { persist: false, send: [] };
      }
      if (d.deadline === null || now < d.deadline) return { persist: false, send: [] };
      let events: GameEvent[] = [];
      for (const p of awaited) {
        const m = this.member(p);
        if (!m) continue;
        m.missed += 1;
        if (m.missed >= MISSES_BEFORE_TAKEOVER) {
          m.bot = true;
          continue;
        }
        for (let i = 0; i < 200 && d.game && awaitedPlayers(d.game).includes(p); i++) {
          const action = botAction(d.game, p, chance.rand, 'pass');
          if (!action) break;
          events = [...events, ...this.apply(p, action, chance)];
        }
      }
      return this.changed(chance, events);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      // A bot chose something illegal. Wait before trying again rather than spinning.
      d.botAt = now + 5000;
      return { persist: false, send: [] };
    }
  }

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
    if (msg.t === 'hello') return this.hello(conn, msg, chance);
    if (!this.conns.has(conn)) return this.reject(conn, 'no-hello', 'Say hello first');

    const d = this.data;
    const me = this.member(this.seatOf(conn));
    const isHost = me !== undefined && me.id === d.hostId;
    switch (msg.t) {
      case 'rename':
        if (!me) return this.reject(conn, 'not-seated', 'You are not seated');
        me.name = cleanName(msg.name, me.name);
        return this.changed(chance);
      case 'ready':
        if (!me || d.status !== 'lobby') return this.reject(conn, 'not-allowed', 'Not possible now');
        me.ready = msg.ready === true;
        return this.changed(chance);
      case 'color': {
        if (!me || d.status !== 'lobby') return this.reject(conn, 'not-allowed', 'Colours are chosen before the game starts');
        if (!Number.isInteger(msg.color) || msg.color < 0 || msg.color >= COLOR_COUNT) return this.reject(conn, 'bad-message', 'Unknown colour');
        if (d.members.some((m) => m.id !== me.id && m.color === msg.color)) return this.reject(conn, 'taken', 'Another player has that colour');
        me.color = msg.color;
        return this.changed(chance);
      }
      case 'options':
        if (!isHost || d.status !== 'lobby') return this.reject(conn, 'not-allowed', 'Only the host can change options before the game');
        if (!validOptions(msg.options)) return this.reject(conn, 'bad-options', 'Invalid options');
        if (msg.options.seats < d.members.length) return this.reject(conn, 'bad-options', 'More players are seated than that');
        d.options = {
          victory: msg.options.victory,
          seats: msg.options.seats,
          autoPlace: msg.options.autoPlace,
          turnSeconds: msg.options.turnSeconds,
          map: msg.options.map,
        };
        return this.changed(chance);
      case 'kick':
        if (!isHost || d.status !== 'lobby' || msg.id === me!.id || !this.member(msg.id)) {
          return this.reject(conn, 'not-allowed', 'Cannot remove that player');
        }
        this.unseat(msg.id);
        return this.changed(chance);
      case 'addBot': {
        if (!isHost || d.status !== 'lobby' || d.members.length >= d.options.seats) return this.reject(conn, 'not-allowed', 'Cannot add a computer player now');
        const used = new Set(d.members.map((m) => m.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) ?? 'Computer';
        this.seat({ key: '', name, ready: true, bot: true });
        return this.changed(chance);
      }
      case 'chat': {
        const text = typeof msg.text === 'string' ? msg.text.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        const now = chance.now();
        if (!me || !text) return this.reject(conn, 'not-allowed', 'Only seated players can chat');
        if (now - me.lastChat < CHAT_GAP_MS) return this.reject(conn, 'slow-down', 'You are sending messages too quickly');
        me.lastChat = now;
        d.chat.push({ from: me.id, name: me.name, text, at: now });
        if (d.chat.length > CHAT_KEPT) d.chat.splice(0, d.chat.length - CHAT_KEPT);
        return this.changed(chance);
      }
      case 'aim': {
        // Passed straight on to everyone else; nothing is stored and the game does not change.
        const g = d.game;
        const aiming = msg.from !== null && msg.to !== null;
        if (!me || d.status !== 'playing' || !g || g.round === 0 || currentPlayer(g) !== me.id) return { persist: false, send: [] };
        selectMap(g.map);
        if (aiming && (!isTerritory(msg.from) || !isTerritory(msg.to))) return this.reject(conn, 'bad-message', 'Unknown territory');
        const from = aiming ? msg.from : null;
        const to = aiming ? msg.to : null;
        return {
          persist: false,
          send: [...this.conns.keys()].filter((c) => c !== conn).map((c) => ({ to: c, msg: { t: 'aim' as const, player: me.id, from, to } })),
        };
      }
      case 'leave':
        if (!me || d.status !== 'lobby') return this.reject(conn, 'not-allowed', 'You can only leave before the game starts');
        this.unseat(me.id);
        return this.changed(chance);
      case 'start':
        return this.start(conn, isHost, chance);
      case 'rematch':
        if (!isHost || d.status !== 'finished') return this.reject(conn, 'not-allowed', 'Only the host can start a rematch');
        d.status = 'lobby';
        d.game = null;
        for (const m of d.members) {
          m.ready = m.key === '';
          m.missed = 0;
          if (m.key !== '') m.bot = false;
        }
        return this.changed(chance);
      case 'action':
        return this.action(conn, me, msg.id, msg.action, chance);
      default:
        return this.reject(conn, 'bad-message', 'Unknown message');
    }
  }

  // ------------------------------------------------------------ handlers

  private hello(conn: string, msg: Extract<ClientMsg, { t: 'hello' }>, chance: Chance): Outcome {
    if (msg.v !== PROTOCOL_VERSION) return this.reject(conn, 'upgrade-required', 'Please reload to get the latest version');
    if (typeof msg.key !== 'string' || msg.key.length < 16 || msg.key.length > 64) return this.reject(conn, 'bad-hello', 'Invalid identity');
    const d = this.data;
    let persist = false;
    let member = d.members.find((m) => m.key === msg.key);
    if (!member && d.status === 'lobby' && d.members.length < d.options.seats) {
      member = this.seat({ key: msg.key, name: cleanName(msg.name), ready: false, bot: false });
      if (d.hostId === null) d.hostId = member.id;
      persist = true;
    }
    // A player who comes back takes their seat back from the bot that was minding it.
    if (member && (member.bot || member.missed > 0)) {
      member.bot = false;
      member.missed = 0;
      persist = true;
    }
    this.conns.set(conn, member ? member.id : null);
    return persist ? this.changed(chance) : this.broadcast(false);
  }

  private start(conn: string, isHost: boolean, chance: Chance): Outcome {
    const d = this.data;
    if (!isHost || d.status !== 'lobby') return this.reject(conn, 'not-allowed', 'Only the host can start the game');
    if (d.members.length < 2) return this.reject(conn, 'not-ready', 'A game needs at least two players');
    if (d.members.some((m) => m.id !== d.hostId && !m.ready && !m.bot)) return this.reject(conn, 'not-ready', 'Everyone must be ready');
    const created = createGame({ players: d.members.map((m) => m.id), seed: chance.seed(), victory: d.options.victory, map: d.options.map });
    d.game = created.state;
    d.status = 'playing';
    for (const m of d.members) m.recent = [];
    return this.changed(chance, created.events);
  }

  private action(conn: string, me: Member | undefined, id: unknown, action: Action, chance: Chance): Outcome {
    const d = this.data;
    if (!me) return this.reject(conn, 'not-seated', 'Spectators cannot play');
    if (typeof id !== 'string' || id.length < 1 || id.length > 64) return this.reject(conn, 'bad-message', 'Action needs an id');
    if (d.status !== 'playing' || !d.game) return this.reject(conn, 'not-playing', 'No game is in progress', id);
    // A resend of something already applied: answer with the current state and change nothing.
    if (me.recent.includes(id)) return { persist: false, send: [{ to: conn, msg: this.stateFor(conn, [], id, chance.now()) }] };

    let events: GameEvent[];
    try {
      events = this.apply(me.id, action, chance);
    } catch (e) {
      if (e instanceof RuleError) return this.reject(conn, e.code, e.message, id);
      throw e;
    }
    me.missed = 0;
    me.bot = false;
    me.recent.push(id);
    if (me.recent.length > RECENT_ACTIONS) me.recent.shift();
    return this.changed(chance, events, conn, id);
  }

  /** Applies one action to the game, with automatic starting placement. Throws RuleError and changes nothing if it is illegal. */
  private apply(player: PlayerId, action: Action, chance: Chance): GameEvent[] {
    const d = this.data;
    const r = applyAction(d.game!, player, action);
    let game: GameState = r.state;
    let events = r.events;
    if (game.phase === 'setup-place' && d.options.autoPlace) {
      for (const pid of game.turnOrder) {
        const p = game.players[pid];
        if (!p.alive || p.setupPlacement !== null) continue;
        const placed = applyAction(game, pid, { type: 'setupPlace', placements: randomPlacement(game, pid, p.setupArmies, chance.rand) });
        game = placed.state;
        events = [...events, ...placed.events];
      }
    }
    d.game = game;
    if (game.phase === 'finished') d.status = 'finished';
    return events;
  }

  private seat(who: { key: string; name: string; ready: boolean; bot: boolean }): Member {
    const d = this.data;
    const taken = new Set(d.members.map((m) => m.id));
    const id = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].find((x) => !taken.has(x))!;
    const used = new Set(d.members.map((m) => m.color));
    const color = Array.from({ length: COLOR_COUNT }, (_, i) => i).find((i) => !used.has(i)) ?? 0;
    const member: Member = { id, ...who, joined: d.joins++, recent: [], missed: 0, lastChat: 0, color };
    d.members.push(member);
    d.members.sort((a, b) => a.id.localeCompare(b.id));
    return member;
  }

  // ------------------------------------------------------------- helpers

  private member(id: PlayerId | null): Member | undefined {
    return id === null ? undefined : this.data.members.find((m) => m.id === id);
  }

  private unseat(id: PlayerId): void {
    const d = this.data;
    d.members = d.members.filter((m) => m.id !== id);
    for (const [conn, seat] of this.conns) if (seat === id) this.conns.set(conn, null);
    if (d.hostId === id) d.hostId = [...d.members].filter((m) => !m.bot).sort((a, b) => a.joined - b.joined)[0]?.id ?? null;
  }

  private reject(conn: string, code: string, message: string, id?: string): Outcome {
    return { persist: false, send: [{ to: conn, msg: { t: 'error', code, message, ...(id ? { id } : {}) } }] };
  }

  private changed(chance: Chance, events: GameEvent[] = [], ackConn?: string, ackId?: string): Outcome {
    const d = this.data;
    const now = chance.now();
    d.seq += 1;
    d.touched = now;
    // Restart the turn clock only when the game starts waiting for a different move.
    const g = d.status === 'playing' ? d.game : null;
    const waitingOn = g ? `${g.phase.startsWith('setup') ? g.phase : 'turn'}:${g.round}:${g.turnIndex}` : '';
    if (waitingOn !== d.waitingOn) {
      d.waitingOn = waitingOn;
      d.deadline = g && d.options.turnSeconds > 0 ? now + d.options.turnSeconds * 1000 : null;
    }
    // Bots wait for the dice of the last move to finish rolling on players' screens.
    const rolls = events.filter((e) => e.type === 'diceRolled').length;
    d.botAt = now + (rolls ? Math.min(7000, 1600 + rolls * 1500) : 900);
    return this.broadcast(true, events, ackConn, ackId, now);
  }

  private broadcast(persist: boolean, events: GameEvent[] = [], ackConn?: string, ackId?: string, now = Date.now()): Outcome {
    return {
      persist,
      send: [...this.conns.keys()].map((conn) => ({ to: conn, msg: this.stateFor(conn, events, conn === ackConn ? ackId : undefined, now) })),
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
      members: d.members.map((m) => ({ id: m.id, name: m.name, ready: m.ready, online: online.has(m.id) || m.key === '', bot: m.bot, color: m.color })),
    };
  }

  /** The full picture for one connection: only what that seat is allowed to see. */
  private stateFor(conn: string, events: GameEvent[], ack?: string, now = Date.now()): ServerMsg {
    const you = this.seatOf(conn);
    const d = this.data;
    return {
      t: 'state',
      seq: d.seq,
      you,
      room: this.roomView(),
      game: d.game ? viewFor(d.game, you) : null,
      deadline: d.status === 'playing' ? d.deadline : null,
      now,
      chat: d.chat,
      // A drawn card is known only to the player who drew it.
      events: events.map((e) => (e.type === 'cardDrawn' && e.player !== you ? { ...e, card: '' } : e)),
      ...(ack ? { ack } : {}),
    };
  }
}
