import { describe, expect, it } from 'vitest';
import { applyAction, botAction, createGame, territoriesOf } from '@rajmandala/engine';
import type { Action, GameState, PlayerId } from '@rajmandala/engine';
import { botMove, lcg } from '../../engine/test/helpers';
import { PROTOCOL_VERSION, RoomCore, newRoom } from '../src';
import type { ClientMsg, Outcome, RoomData, ServerMsg } from '../src';

let clock = 1_000_000;
const chance = { seed: () => 12345, rand: lcg(7), now: () => clock };
const key = (n: number) => `secret-key-number-${n}`.padEnd(24, 'x');
type State = Extract<ServerMsg, { t: 'state' }>;

/** A room plus a record of the last message each connection received. */
function table(data: RoomData = newRoom('ABCDEF')) {
  let core = new RoomCore(data);
  const last = new Map<string, ServerMsg>();
  const deliver = (o: Outcome) => {
    for (const s of o.send) last.set(s.to, s.msg);
    return o;
  };
  return {
    get core() {
      return core;
    },
    send: (conn: string, msg: ClientMsg) => deliver(core.handle(conn, msg, chance)),
    tick: () => deliver(core.tick(chance)),
    join: (conn: string, n: number, name = `P${n}`) => deliver(core.handle(conn, { t: 'hello', v: PROTOCOL_VERSION, key: key(n), name }, chance)),
    drop: (conn: string) => deliver(core.disconnect(conn)),
    state: (conn: string) => last.get(conn) as State,
    last: (conn: string) => last.get(conn)!,
    /** Simulates the room being unloaded and rebuilt from storage with its sockets still open. */
    reload(open: string[]) {
      const seats = open.map((c) => [c, core.seatOf(c)] as const);
      core = new RoomCore(JSON.parse(JSON.stringify(core.data)));
      for (const [c, seat] of seats) core.attach(c, seat);
    },
  };
}

function startedTable(players = 3, autoPlace = true, turnSeconds = 0) {
  const t = table(newRoom('ABCDEF', { victory: 'samrajya', seats: players, autoPlace, turnSeconds }));
  for (let i = 1; i <= players; i++) t.join(`c${i}`, i);
  for (let i = 2; i <= players; i++) t.send(`c${i}`, { t: 'ready', ready: true });
  t.send('c1', { t: 'start' });
  return t;
}

describe('lobby', () => {
  it('seats players in order, makes the first one host, and seats nobody twice', () => {
    const t = table();
    expect(t.join('a', 1, '  Asha  ').persist).toBe(true);
    t.join('b', 2, 'Bilal');
    t.join('a2', 1, 'Asha again'); // same person, second tab
    const s = t.state('b');
    expect(s.you).toBe('p2');
    expect(s.room.hostId).toBe('p1');
    expect(s.room.members.map((m) => [m.id, m.name, m.online])).toEqual([
      ['p1', 'Asha', true],
      ['p2', 'Bilal', true],
    ]);
    expect(t.state('a2').you).toBe('p1');
  });

  it('turns extra arrivals into spectators when the table is full', () => {
    const t = table(newRoom('ABCDEF', { victory: 'samrajya', seats: 2, autoPlace: true, turnSeconds: 0 }));
    t.join('a', 1);
    t.join('b', 2);
    t.join('c', 3);
    expect(t.state('c').you).toBeNull();
    expect(t.state('c').room.members).toHaveLength(2);
  });

  it('rejects an out-of-date client and messages before hello', () => {
    const t = table();
    t.core.handle('x', { t: 'hello', v: 0, key: key(1), name: 'Old' }, chance).send.forEach((s) => expect(s.msg).toMatchObject({ code: 'upgrade-required' }));
    expect(t.send('y', { t: 'ready', ready: true }).send[0].msg).toMatchObject({ t: 'error', code: 'no-hello' });
  });

  it('lets only the host change options, kick and start', () => {
    const t = table();
    t.join('a', 1);
    t.join('b', 2);
    const opts = { victory: 'capitals' as const, seats: 3, autoPlace: false, turnSeconds: 0 };
    expect(t.send('b', { t: 'options', options: opts }).send[0].msg).toMatchObject({ t: 'error' });
    t.send('a', { t: 'options', options: opts });
    expect(t.state('b').room.options).toEqual(opts);
    expect(t.send('a', { t: 'options', options: { ...opts, seats: 1 } }).send[0].msg).toMatchObject({ code: 'bad-options' });
    expect(t.send('b', { t: 'start' }).send[0].msg).toMatchObject({ t: 'error' });
    expect(t.send('a', { t: 'start' }).send[0].msg).toMatchObject({ code: 'not-ready' });
    t.send('a', { t: 'kick', id: 'p2' });
    expect(t.state('b').you).toBeNull();
    expect(t.state('a').room.members).toHaveLength(1);
    expect(t.send('a', { t: 'start' }).send[0].msg).toMatchObject({ code: 'not-ready' });
  });

  it('hands the host role on when the host leaves, and shows who is offline', () => {
    const t = table();
    t.join('a', 1);
    t.join('b', 2);
    t.join('c', 3);
    t.drop('b');
    expect(t.state('c').room.members.find((m) => m.id === 'p2')!.online).toBe(false);
    t.send('a', { t: 'leave' });
    expect(t.state('c').room.hostId).toBe('p2');
    expect(t.state('a').you).toBeNull();
  });
});

describe('playing', () => {
  it('starts a game and shows each player only their own secrets', () => {
    const t = startedTable(3);
    const s = t.state('c2');
    expect(s.room.status).toBe('playing');
    expect(s.game!.phase).toBe('setup-capital');
    const raw = JSON.stringify(s);
    expect(raw).not.toContain('"rng"');
    expect(raw).not.toContain('"deck"');
    expect(raw).not.toContain(key(1));

    const cap = territoriesOf(t.core.data.game!, 'p1')[0];
    t.send('c1', { t: 'action', id: 'a1', action: { type: 'chooseCapital', territory: cap } });
    expect(t.state('c1').ack).toBe('a1');
    expect(t.state('c2').ack).toBeUndefined();
    expect(t.state('c1').game!.players.p1.capital).toBe(cap);
    expect(t.state('c2').game!.players.p1.capital).toBeNull();
    expect(t.state('c2').game!.players.p1.capitalChosen).toBe(true);
  });

  it('places starting armies automatically once every capital is chosen', () => {
    const t = startedTable(3);
    for (const p of ['p1', 'p2', 'p3']) {
      t.send(`c${p[1]}`, { t: 'action', id: `cap-${p}`, action: { type: 'chooseCapital', territory: territoriesOf(t.core.data.game!, p)[0] } });
    }
    expect(t.state('c1').game!.phase).toBe('reinforce');
    expect(t.state('c1').game!.round).toBe(1);
  });

  it('answers a rule violation only to the sender and changes nothing', () => {
    const t = startedTable(2);
    const before = JSON.stringify(t.core.data);
    const theirs = territoriesOf(t.core.data.game!, 'p2')[0];
    const out = t.send('c1', { t: 'action', id: 'bad', action: { type: 'chooseCapital', territory: theirs } });
    expect(out.persist).toBe(false);
    expect(out.send).toHaveLength(1);
    expect(out.send[0]).toMatchObject({ to: 'c1', msg: { t: 'error', code: 'not-owner', id: 'bad' } });
    expect(JSON.stringify(t.core.data)).toBe(before);
  });

  it('applies a resent action only once', () => {
    const t = startedTable(2);
    const msg: ClientMsg = { t: 'action', id: 'once', action: { type: 'chooseCapital', territory: territoriesOf(t.core.data.game!, 'p1')[0] } };
    t.send('c1', msg);
    const seq = t.core.data.seq;
    const again = t.send('c1', msg);
    expect(again.persist).toBe(false);
    expect(again.send).toHaveLength(1);
    expect(again.send[0].msg).toMatchObject({ t: 'state', ack: 'once', events: [] });
    expect(t.core.data.seq).toBe(seq);
  });

  it('keeps spectators and strangers from playing', () => {
    const t = startedTable(2);
    t.join('late', 9);
    expect(t.state('late').you).toBeNull();
    expect(t.state('late').game!.phase).toBe('setup-capital');
    expect(t.send('late', { t: 'action', id: 'x', action: { type: 'endPhase' } }).send[0].msg).toMatchObject({ code: 'not-seated' });
  });

  it('gives a returning player their seat and the current game', () => {
    const t = startedTable(2);
    t.drop('c2');
    expect(t.state('c1').room.members[1].online).toBe(false);
    t.join('c2-new', 2);
    expect(t.state('c2-new').you).toBe('p2');
    expect(t.state('c2-new').game).not.toBeNull();
    expect(t.state('c1').room.members[1].online).toBe(true);
  });

  it('hides a drawn card from everyone but the player who drew it', () => {
    const t = startedTable(2);
    const g = t.core.data.game!;
    for (const p of ['p1', 'p2']) t.send(`c${p[1]}`, { t: 'action', id: `cap-${p}`, action: { type: 'chooseCapital', territory: territoriesOf(g, p)[0] } });
    const game = t.core.data.game!;
    const me = game.turnOrder[game.turnIndex];
    game.phase = 'fortify';
    game.pendingReinforcements = 0;
    game.conqueredThisTurn = true;
    const other = me === 'p1' ? 'p2' : 'p1';
    t.send(`c${me[1]}`, { t: 'action', id: 'end', action: { type: 'endPhase' } });
    const drawnFor = (conn: string) => t.state(conn).events.find((e) => e.type === 'cardDrawn') as { card: string };
    expect(drawnFor(`c${me[1]}`).card).not.toBe('');
    expect(drawnFor(`c${other[1]}`).card).toBe('');
  });
});

describe('stability', () => {
  it.each([2, 4, 6])('plays a whole %i-player game through dropped connections, resends and reloads', (players) => {
    const t = startedTable(players, false);
    const r = lcg(players * 101);
    const conn: Record<PlayerId, string> = {};
    for (let i = 1; i <= players; i++) conn[`p${i}`] = `c${i}`;
    let clean: GameState = createGame({ players: Object.keys(conn), seed: chance.seed(), victory: 'samrajya' }).state;
    let generation = 0;
    let resent = 0;
    let dropped = 0;

    for (let step = 0; step < 300_000 && t.core.data.status === 'playing'; step++) {
      const [player, action] = botMove(t.core.data.game!, r) as [PlayerId, Action];
      // A dropped connection: the player comes back on a new socket and is told where the game is.
      if (r() < 0.02) {
        t.drop(conn[player]);
        conn[player] = `c${player[1]}-${++generation}`;
        t.join(conn[player], Number(player[1]));
        expect(t.state(conn[player]).you).toBe(player);
        dropped++;
      }
      // The room is unloaded and rebuilt from what it stored.
      if (r() < 0.01) t.reload(Object.values(conn));

      const msg: ClientMsg = { t: 'action', id: `s${step}`, action };
      const out = t.send(conn[player], msg);
      expect(out.persist).toBe(true);
      clean = applyAction(clean, player, action).state;
      // The same message arrives again, as after a reconnect.
      if (r() < 0.1) {
        expect(t.send(conn[player], msg).persist).toBe(false);
        resent++;
      }
    }

    expect(t.core.data.status).toBe('finished');
    expect(resent).toBeGreaterThan(0);
    expect(dropped).toBeGreaterThan(0);
    // Faults changed nothing: the room's game equals a clean replay of the same actions.
    expect(t.core.data.game).toEqual(clean);
    const winner = clean.winner!;
    expect(t.state(conn[winner]).game!.winner).toBe(winner);
  });

  it('returns to the lobby for a rematch with everyone still seated', () => {
    const t = startedTable(2);
    t.core.data.status = 'finished';
    expect(t.send('c2', { t: 'rematch' }).send[0].msg).toMatchObject({ t: 'error' });
    t.send('c1', { t: 'rematch' });
    const s = t.state('c2');
    expect(s.room.status).toBe('lobby');
    expect(s.game).toBeNull();
    expect(s.room.members).toHaveLength(2);
  });
});

describe('timers and bots', () => {
  it('plays a turn for a player who runs out of time, and hands the seat to a bot after three', () => {
    const t = startedTable(2, true, 60);
    for (const p of ['p1', 'p2']) t.send(`c${p[1]}`, { t: 'action', id: `cap-${p}`, action: { type: 'chooseCapital', territory: territoriesOf(t.core.data.game!, p)[0] } });
    const g = () => t.core.data.game!;
    const slow = g().turnOrder[g().turnIndex];
    const other = slow === 'p1' ? 'p2' : 'p1';
    const start = clock;
    expect(t.state('c1').deadline).toBe(start + 60_000);
    expect(t.core.nextWake()).toBe(start + 60_000);

    clock = start + 30_000;
    expect(t.tick().persist).toBe(false); // not yet
    clock = start + 60_000;
    expect(t.tick().persist).toBe(true);
    expect(g().turnOrder[g().turnIndex]).toBe(other);
    expect(t.core.data.members.find((m) => m.id === slow)!.missed).toBe(1);

    // The other player plays normally; the slow one misses twice more.
    for (let miss = 2; miss <= 3; miss++) {
      for (let i = 0; g().turnOrder[g().turnIndex] === other && i < 20; i++) {
        t.send(`c${other[1]}`, { t: 'action', id: `o${miss}-${i}`, action: botAction(g(), other, chance.rand, 'pass')! });
      }
      clock = t.core.data.deadline!;
      t.tick();
    }
    const seat = () => t.state('c1').room.members.find((m) => m.id === slow)!;
    expect(seat().bot).toBe(true);
    // A bot now plays the seat, one move per wake-up.
    clock = t.core.nextWake()!;
    expect(t.tick().persist).toBe(true);

    // The player returns and takes the seat back.
    t.join(`c${slow[1]}-back`, Number(slow[1]));
    expect(seat().bot).toBe(false);
    expect(t.core.data.members.find((m) => m.id === slow)!.missed).toBe(0);
  });

  it('lets the host add computer players, which play a whole game by themselves', () => {
    const t = table(newRoom('ABCDEF', { victory: 'samrajya', seats: 3, autoPlace: true, turnSeconds: 0 }));
    t.join('a', 1);
    t.send('a', { t: 'addBot' });
    t.send('a', { t: 'addBot' });
    expect(t.state('a').room.members.map((m) => [m.bot, m.ready])).toEqual([[false, false], [true, true], [true, true]]);
    expect(t.core.handle('a', { t: 'addBot' }, chance).send[0].msg).toMatchObject({ t: 'error' }); // the table is full
    t.send('a', { t: 'start' });
    expect(t.state('a').room.status).toBe('playing');
    // The human surrenders; the two bots finish the game between them.
    t.send('a', { t: 'action', id: 'quit', action: { type: 'surrender' } });
    for (let i = 0; i < 20_000 && t.core.data.status === 'playing'; i++) {
      clock = t.core.nextWake() ?? clock;
      t.tick();
    }
    expect(t.core.data.status).toBe('finished');
    expect(['p2', 'p3']).toContain(t.core.data.game!.winner);
  });

  it('carries chat between seated players, with a limit on speed', () => {
    const t = startedTable(2);
    t.join('watcher', 9);
    t.send('c1', { t: 'chat', text: '  hello   there  ' });
    expect(t.state('c2').chat).toMatchObject([{ from: 'p1', name: 'P1', text: 'hello there' }]);
    expect(t.send('c1', { t: 'chat', text: 'again' }).send[0].msg).toMatchObject({ code: 'slow-down' });
    expect(t.send('watcher', { t: 'chat', text: 'hi' }).send[0].msg).toMatchObject({ t: 'error' });
    clock += 1000;
    t.send('c1', { t: 'chat', text: 'x'.repeat(500) });
    expect(t.state('c2').chat[1].text).toHaveLength(200);
  });

  it('expires only when empty and long idle', () => {
    const t = startedTable(2);
    const day = 86_400_000;
    expect(t.core.expired(clock + 30 * day)).toBe(false); // people are connected
    t.drop('c1');
    t.drop('c2');
    expect(t.core.expired(clock + day)).toBe(false); // a game in progress is kept for a week
    expect(t.core.expired(clock + 8 * day)).toBe(true);
  });
});

describe('watching an attack being lined up', () => {
  it("passes the current player's chosen attack to everyone else and to nobody when it is not their turn", () => {
    const t = startedTable(3);
    for (const p of ['p1', 'p2', 'p3']) t.send(`c${p[1]}`, { t: 'action', id: `cap-${p}`, action: { type: 'chooseCapital', territory: territoriesOf(t.core.data.game!, p)[0] } });
    const g = t.core.data.game!;
    const me = g.turnOrder[g.turnIndex];
    const other = g.turnOrder[(g.turnIndex + 1) % 3];
    const seq = t.core.data.seq;

    const out = t.send(`c${me[1]}`, { t: 'aim', from: 'DEL', to: 'HAR' });
    expect(out.persist).toBe(false);
    expect(out.send.map((s) => s.to).sort()).toEqual(['c1', 'c2', 'c3'].filter((c) => c !== `c${me[1]}`));
    expect(out.send[0].msg).toEqual({ t: 'aim', player: me, from: 'DEL', to: 'HAR' });
    expect(t.core.data.seq).toBe(seq);

    expect(t.send(`c${me[1]}`, { t: 'aim', from: null, to: null }).send[0].msg).toEqual({ t: 'aim', player: me, from: null, to: null });
    expect(t.send(`c${other[1]}`, { t: 'aim', from: 'DEL', to: 'HAR' }).send).toHaveLength(0);
    expect(t.send(`c${me[1]}`, { t: 'aim', from: 'NOPE', to: 'HAR' }).send[0].msg).toMatchObject({ t: 'error' });
  });
});

describe('colours', () => {
  it('gives every player a different colour and lets them change to a free one before the game', () => {
    const t = table();
    t.join('a', 1);
    t.join('b', 2);
    t.send('a', { t: 'addBot' });
    const colours = () => t.state('a').room.members.map((m) => m.color);
    expect(new Set(colours()).size).toBe(3);

    t.send('b', { t: 'color', color: 6 });
    expect(colours()[1]).toBe(6);
    expect(t.send('a', { t: 'color', color: 6 }).send[0].msg).toMatchObject({ t: 'error', code: 'taken' });
    expect(t.send('a', { t: 'color', color: 99 }).send[0].msg).toMatchObject({ t: 'error' });
    // A colour someone gave up is free again, and a newcomer never gets one in use.
    t.send('a', { t: 'color', color: 1 });
    t.join('c', 3);
    expect(new Set(t.state('c').room.members.map((m) => m.color)).size).toBe(4);

    t.send('b', { t: 'ready', ready: true });
    t.send('c', { t: 'ready', ready: true });
    t.send('a', { t: 'start' });
    expect(t.send('b', { t: 'color', color: 7 }).send[0].msg).toMatchObject({ t: 'error', code: 'not-allowed' });
  });
});
