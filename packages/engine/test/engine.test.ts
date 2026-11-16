import { describe, expect, it } from 'vitest';
import {
  LAND_EDGES,
  MAPS,
  awaitedPlayers,
  botAction,
  samrajyaTarget,
  selectMap,
  REGIONS,
  SEAT_COMPENSATION,
  SEA_EDGES,
  TERRITORIES,
  TERRITORY_IDS,
  applyAction,
  calcReinforcements,
  createGame,
  currentPlayer,
  isConnected,
  isMonsoon,
  maxAttackDice,
  neighbors,
  setValue,
  territoriesOf,
  validateMap,
  viewFor,
} from '../src';
import type { Action, GameEvent, GameState, PlayerId, VictoryMode } from '../src';
import { NAMES, board, botMove, expectRule, lcg, started } from './helpers';

const START = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 } as Record<number, number>;
const armiesOf = (s: GameState, p: PlayerId) => territoriesOf(s, p).reduce((n, t) => n + s.territories[t].armies, 0);
const events = (evs: GameEvent[], type: GameEvent['type']) => evs.filter((e) => e.type === type);
const northIds = REGIONS.find((r) => r.id === 'north')!.territories;

describe('map', () => {
  it('passes validation', () => {
    expect(validateMap()).toEqual([]);
  });
  it('has 43 territories, 79 land borders, 6 sea routes and six regions', () => {
    expect(TERRITORIES).toHaveLength(43);
    expect(LAND_EDGES).toHaveLength(79);
    expect(SEA_EDGES).toHaveLength(6);
    expect(REGIONS.map((r) => [r.id, r.territories.length, r.bonus])).toEqual([
      ['north', 7, 4],
      ['gangetic', 6, 5],
      ['west', 5, 3],
      ['central', 6, 7],
      ['south', 8, 5],
      ['northeast', 9, 3],
    ]);
  });
});

describe('setup (2.2)', () => {
  it.each([2, 3, 4, 5, 6])('deals territories and armies for %i players', (n) => {
    const s0 = createGame({ players: NAMES.slice(0, n), seed: 7 }).state;
    const counts = s0.turnOrder.map((p) => territoriesOf(s0, p).length);
    if (n === 2) {
      expect(counts).toEqual([14, 14]);
      const neutral = TERRITORY_IDS.filter((t) => s0.territories[t].owner === 'neutral');
      expect(neutral).toHaveLength(15);
      expect(neutral.every((t) => s0.territories[t].armies === 2)).toBe(true);
    } else {
      expect(counts.reduce((a, b) => a + b)).toBe(43);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      // Leftover territories go to the players last in turn order.
      expect(counts).toEqual([...counts].sort((a, b) => a - b));
    }
    const s = started(n, 7);
    // Each seat after the first starts with SEAT_COMPENSATION more armies.
    s.turnOrder.forEach((p, i) => expect(armiesOf(s, p)).toBe(START[n] + i * SEAT_COMPENSATION));
    expect(s.phase).toBe('reinforce');
    expect(s.round).toBe(1);
    expect(s.deck).toHaveLength(45);
  });

  it('is reproducible from the seed', () => {
    expect(started(4, 99)).toEqual(started(4, 99));
    expect(started(4, 99)).not.toEqual(started(4, 100));
  });

  it('rejects bad player counts', () => {
    expect(() => createGame({ players: ['A'], seed: 1 })).toThrow();
    expect(() => createGame({ players: [...NAMES, 'G'], seed: 1 })).toThrow();
    expect(() => createGame({ players: ['A', 'A'], seed: 1 })).toThrow();
  });

  it('keeps capitals and placements hidden until everyone has chosen', () => {
    let s = createGame({ players: ['A', 'B', 'C'], seed: 3 }).state;
    const a = territoriesOf(s, 'A')[0];
    s = applyAction(s, 'A', { type: 'chooseCapital', territory: a }).state;
    expect(viewFor(s, 'B').players.A.capital).toBeNull();
    expect(viewFor(s, 'A').players.A.capital).toBe(a);
    expectRule(() => applyAction(s, 'A', { type: 'chooseCapital', territory: a }), 'invalid-action');
    expectRule(() => applyAction(s, 'B', { type: 'chooseCapital', territory: a }), 'not-owner');
    s = applyAction(s, 'B', { type: 'chooseCapital', territory: territoriesOf(s, 'B')[0] }).state;
    const r = applyAction(s, 'C', { type: 'chooseCapital', territory: territoriesOf(s, 'C')[0] });
    s = r.state;
    expect(s.phase).toBe('setup-place');
    expect(events(r.events, 'capitalsRevealed')).toHaveLength(1);
    expect(viewFor(s, 'B').players.A.capital).toBe(a);

    expectRule(() => applyAction(s, 'A', { type: 'setupPlace', placements: { [a]: 5 } }), 'invalid-action');
    s = applyAction(s, 'A', { type: 'setupPlace', placements: { [a]: s.players.A.setupArmies } }).state;
    expect(s.territories[a].armies).toBe(1); // not applied until all have placed
    expect(viewFor(s, 'B').players.A.setupPlacement).toBeNull();
    expect(viewFor(s, 'B').players.A.setupSubmitted).toBe(true);
  });

  it('never exposes the RNG state, the deck or other hands in a view', () => {
    const s = started(3);
    s.players[s.turnOrder[0]].cards = ['DEL', 'PUN'];
    const v = viewFor(s, s.turnOrder[1]) as unknown as Record<string, unknown>;
    expect(v.rng).toBeUndefined();
    expect(v.deck).toBeUndefined();
    expect(v.deckCount).toBe(45);
    const seen = viewFor(s, s.turnOrder[1]).players[s.turnOrder[0]];
    expect(seen.cards).toBeNull();
    expect(seen.cardCount).toBe(2);
    expect(viewFor(s, null).players[s.turnOrder[0]].cards).toBeNull();
  });
});

describe('reinforcements (2.4)', () => {
  it('gives a minimum of 3', () => {
    const { s, me } = board({ DEL: 1, HAR: 1 });
    expect(calcReinforcements(s, me)).toEqual({ territories: 3, regions: 0, outposts: 0, capital: 0, total: 3 });
  });
  it('gives one per three territories, rounded down', () => {
    const { s, foe } = board({ DEL: 1, HAR: 1 }); // foe holds 40
    expect(calcReinforcements(s, foe).territories).toBe(13);
  });
  it('adds region, outpost and capital bonuses', () => {
    const mine = Object.fromEntries([...northIds, 'AND', 'LAK'].map((t) => [t, 1]));
    const { s, me } = board(mine);
    s.players[me].capital = 'DEL';
    expect(calcReinforcements(s, me)).toEqual({ territories: 3, regions: 4, outposts: 2, capital: 1, total: 10 });
    s.territories.LAD.owner = s.turnOrder[1];
    expect(calcReinforcements(s, me).regions).toBe(0);
  });
  it('requires all armies to be placed before attacking', () => {
    const { s, me } = board({ DEL: 3 }, { phase: 'reinforce' });
    s.pendingReinforcements = 3;
    expectRule(() => applyAction(s, me, { type: 'endPhase' }), 'must-place');
    expectRule(() => applyAction(s, me, { type: 'place', territory: 'DEL', armies: 4 }), 'invalid-action');
    expectRule(() => applyAction(s, me, { type: 'place', territory: 'HAR', armies: 1 }), 'not-owner');
    const s2 = applyAction(s, me, { type: 'place', territory: 'DEL', armies: 3 }).state;
    expect(s2.territories.DEL.armies).toBe(6);
    expect(applyAction(s2, me, { type: 'endPhase' }).state.phase).toBe('attack');
  });
});

describe('cards (2.8)', () => {
  // padati: HIM UTK PUR · ashva: JNK PUN BRJ · gaja: LAD DEL AWD
  it('values sets', () => {
    expect(setValue(['HIM', 'UTK', 'PUR'])).toBe(4);
    expect(setValue(['JNK', 'PUN', 'BRJ'])).toBe(6);
    expect(setValue(['LAD', 'DEL', 'AWD'])).toBe(8);
    expect(setValue(['HIM', 'JNK', 'LAD'])).toBe(10);
    expect(setValue(['HIM', 'UTK', 'JNK'])).toBeNull();
    expect(setValue(['HIM', 'HIM', 'HIM'])).toBeNull();
    expect(setValue(['HIM', 'UTK'])).toBeNull();
  });
  it('lets a Ratha stand in for any suit', () => {
    expect(setValue(['LAD', 'DEL', 'RATHA1'])).toBe(8);
    expect(setValue(['HIM', 'JNK', 'RATHA1'])).toBe(10);
    expect(setValue(['HIM', 'RATHA1', 'RATHA2'])).toBe(10);
  });
  it('trades a set for armies, plus 2 on each traded territory you hold', () => {
    const { s, me } = board({ DEL: 1, LAD: 1 }, { phase: 'reinforce' });
    s.players[me].cards = ['LAD', 'DEL', 'AWD', 'HIM'];
    expectRule(() => applyAction(s, me, { type: 'trade', cards: ['LAD', 'DEL', 'HIM'] }), 'invalid-set');
    expectRule(() => applyAction(s, me, { type: 'trade', cards: ['LAD', 'DEL', 'BIH'] }), 'invalid-set');
    const s2 = applyAction(s, me, { type: 'trade', cards: ['LAD', 'DEL', 'AWD'] }).state;
    expect(s2.pendingReinforcements).toBe(8);
    expect(s2.territories.DEL.armies).toBe(3);
    expect(s2.territories.LAD.armies).toBe(3);
    expect(s2.territories.AWD.armies).toBe(1);
    expect(s2.players[me].cards).toEqual(['HIM']);
    expect(s2.discard).toEqual(['LAD', 'DEL', 'AWD']);
  });
  it('forces a trade with 5 or more cards', () => {
    const { s, me } = board({ DEL: 1 }, { phase: 'reinforce' });
    s.players[me].cards = ['LAD', 'DEL', 'AWD', 'HIM', 'UTK'];
    expectRule(() => applyAction(s, me, { type: 'endPhase' }), 'must-trade');
  });
  it('draws one card at the end of a turn only if a territory was captured', () => {
    const { s, me } = board({ DEL: 5 }, { phase: 'fortify' });
    const quiet = applyAction(s, me, { type: 'endPhase' });
    expect(events(quiet.events, 'cardDrawn')).toHaveLength(0);
    s.conqueredThisTurn = true;
    const busy = applyAction(s, me, { type: 'endPhase' });
    expect(events(busy.events, 'cardDrawn')).toHaveLength(1);
    expect(busy.state.players[me].cards).toHaveLength(1);
    expect(busy.state.deck).toHaveLength(44);
  });
  it('reshuffles the discard pile when the deck is empty', () => {
    const { s, me } = board({ DEL: 5 }, { phase: 'fortify' });
    s.conqueredThisTurn = true;
    s.discard = s.deck;
    s.deck = [];
    const r = applyAction(s, me, { type: 'endPhase' }).state;
    expect(r.deck).toHaveLength(44);
    expect(r.discard).toHaveLength(0);
  });
});

describe('attack (2.5)', () => {
  it('validates the attack', () => {
    const { s, me, foe } = board({ DEL: 5, HAR: 1 });
    expectRule(() => applyAction(s, foe, { type: 'attack', from: 'BRJ', to: 'DEL', dice: 1 }), 'not-your-turn');
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'BRJ', to: 'DEL', dice: 1 }), 'not-owner');
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'DEL', to: 'HAR', dice: 1 }), 'invalid-action');
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'DEL', to: 'KER', dice: 1 }), 'not-adjacent');
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'HAR', to: 'PUN', dice: 1 }), 'too-few-armies');
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 4 }), 'too-many-dice');
    s.territories.DEL.armies = 3;
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 3 }), 'too-few-armies');
    s.phase = 'reinforce';
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 1 }), 'wrong-phase');
  });

  it('compares dice highest to highest, with ties to the defender', () => {
    for (let seed = 0; seed < 300; seed++) {
      const { s, me } = board({ DEL: 10 }, { foeArmies: 5 });
      s.rng = seed;
      const dice = 1 + (seed % 3);
      const r = applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice });
      const e = r.events[0] as Extract<GameEvent, { type: 'diceRolled' }>;
      expect(e.attack).toHaveLength(dice);
      expect(e.defence).toHaveLength(2);
      expect(e.attack).toEqual([...e.attack].sort((a, b) => b - a));
      let aLost = 0;
      let dLost = 0;
      for (let i = 0; i < Math.min(dice, 2); i++) e.attack[i] > e.defence[i] ? dLost++ : aLost++;
      expect([e.attackerLost, e.defenderLost]).toEqual([aLost, dLost]);
      expect(r.state.territories.DEL.armies).toBe(10 - aLost);
      expect(r.state.territories.BRJ.armies).toBe(5 - dLost);
    }
  });

  it('gives a lone defender one die', () => {
    const { s, me } = board({ DEL: 10 });
    const e = applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 3 }).events[0];
    expect((e as Extract<GameEvent, { type: 'diceRolled' }>).defence).toHaveLength(1);
  });

  it('makes the attacker occupy a captured territory with at least the dice rolled', () => {
    const { s, me } = board({ DEL: 30 });
    const r = applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 3, blitz: true });
    const cap = r.state;
    expect(cap.phase).toBe('occupy');
    expect(cap.territories.BRJ.owner).toBe(me);
    expect(cap.conqueredThisTurn).toBe(true);
    const min = cap.pendingOccupy!.min;
    const left = cap.territories.DEL.armies;
    expectRule(() => applyAction(cap, me, { type: 'attack', from: 'DEL', to: 'HAR', dice: 1 }), 'wrong-phase');
    expectRule(() => applyAction(cap, me, { type: 'endPhase' }), 'wrong-phase');
    expectRule(() => applyAction(cap, me, { type: 'occupy', armies: min - 1 }), 'invalid-action');
    expectRule(() => applyAction(cap, me, { type: 'occupy', armies: left }), 'invalid-action');
    const done = applyAction(cap, me, { type: 'occupy', armies: left - 1 }).state;
    expect(done.phase).toBe('attack');
    expect(done.territories.DEL.armies).toBe(1);
    expect(done.territories.BRJ.armies).toBe(left - 1);
  });

  it('runs a blitz until capture or until the attacker has one army', () => {
    for (let seed = 0; seed < 100; seed++) {
      const { s, me } = board({ DEL: 6 }, { foeArmies: 6 });
      s.rng = seed;
      const r = applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 3, blitz: true }).state;
      expect(r.phase === 'occupy' || r.territories.DEL.armies === 1).toBe(true);
      if (r.phase === 'occupy') expect(r.territories.DEL.armies - 1).toBeGreaterThanOrEqual(r.pendingOccupy!.min);
    }
  });
});

describe('mountains and Monsoon (2.6, 2.7)', () => {
  it('limits dice into mountains to 2', () => {
    const { s, me } = board({ PUN: 10 });
    expect(maxAttackDice(s, 'HIM')).toBe(2);
    expect(maxAttackDice(s, 'HAR')).toBe(3);
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'PUN', to: 'HIM', dice: 3 }), 'too-many-dice');
    applyAction(s, me, { type: 'attack', from: 'PUN', to: 'HIM', dice: 2 });
  });
  it('does not limit dice out of mountains', () => {
    const { s, me } = board({ HIM: 10 });
    applyAction(s, me, { type: 'attack', from: 'HIM', to: 'PUN', dice: 3 });
  });
  it('makes every fourth round a Monsoon with fewer dice', () => {
    const { s, me } = board({ PUN: 10 }, { round: 4 });
    expect(isMonsoon(s)).toBe(true);
    expect([3, 5, 8, 12].map((round) => isMonsoon({ ...s, round }))).toEqual([false, false, true, true]);
    expect(maxAttackDice(s, 'HAR')).toBe(2);
    expect(maxAttackDice(s, 'HIM')).toBe(1);
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'PUN', to: 'HAR', dice: 3 }), 'too-many-dice');
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'PUN', to: 'HIM', dice: 2 }), 'too-many-dice');
  });
  it('closes sea routes during the Monsoon', () => {
    const open = board({ KER: 10 });
    applyAction(open.s, open.me, { type: 'attack', from: 'KER', to: 'LAK', dice: 1 });
    const dry = board({ KER: 10, LAK: 3 });
    const wet = board({ KER: 10, LAK: 3, KON: 2 }, { round: 4 });
    expectRule(() => applyAction(wet.s, wet.me, { type: 'attack', from: 'LAK', to: 'KON', dice: 1 }), 'invalid-action');
    wet.s.territories.KON.owner = wet.foe;
    expectRule(() => applyAction(wet.s, wet.me, { type: 'attack', from: 'LAK', to: 'KON', dice: 1 }), 'not-adjacent');
    expect(isConnected(wet.s, wet.me, 'KER', 'LAK')).toBe(false);
    expect(isConnected(dry.s, dry.me, 'KER', 'LAK')).toBe(true);
  });
  it('announces the Monsoon a round ahead', () => {
    const { s, me, foe } = board({ DEL: 5 }, { phase: 'fortify', round: 2 });
    s.victory = 'digvijaya'; // the opponent holds most of the map; keep the game going
    s.turnIndex = 1; // last seat, so ending the turn starts round 3
    const r = applyAction(s, foe, { type: 'endPhase' });
    expect(events(r.events, 'roundStarted')[0]).toEqual({ type: 'roundStarted', round: 3, monsoon: false, monsoonNext: true });
    expect(currentPlayer(r.state)).toBe(me);
  });
});

describe('capitals (2.6)', () => {
  it('lets the owner of a capital re-roll 1s, and only the owner', () => {
    const ones = (held: boolean) => {
      let n = 0;
      let rerolls = 0;
      for (let seed = 0; seed < 1500; seed++) {
        const { s, me, foe } = board({ DEL: 10 }, { foeArmies: 5 });
        s.rng = seed;
        if (held) s.players[foe].capital = 'BRJ';
        else s.players[me].capital = 'BRJ'; // a capital not held by its owner gets no re-roll
        const e = applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 3 }).events[0] as Extract<
          GameEvent,
          { type: 'diceRolled' }
        >;
        n += e.defence.filter((d) => d === 1).length;
        if (e.rerolled) rerolls++;
      }
      return { rate: n / 3000, rerolls };
    };
    const plain = ones(false);
    const capital = ones(true);
    expect(plain.rerolls).toBe(0);
    expect(plain.rate).toBeGreaterThan(0.13); // about 1/6
    expect(capital.rerolls).toBeGreaterThan(300);
    expect(capital.rate).toBeLessThan(0.06); // about 1/36
  });

  it('gives 3 armies for capturing a capital from its owner, and stops its +1', () => {
    const { s, me, foe } = board({ DEL: 40 });
    s.players[foe].capital = 'BRJ';
    expect(calcReinforcements(s, foe).capital).toBe(1);
    let r = applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 3, blitz: true }).state;
    expect(r.pendingOccupy!.capitalBonus).toBe(3);
    const min = r.pendingOccupy!.min;
    r = applyAction(r, me, { type: 'occupy', armies: min }).state;
    expect(r.territories.BRJ.armies).toBe(min + 3);
    expect(calcReinforcements(r, foe).capital).toBe(0);
    expect(calcReinforcements(r, me).capital).toBe(0);
  });
});

describe('fortify (2.9)', () => {
  it('moves armies along a chain of own territories and ends the turn', () => {
    const { s, me, foe } = board({ PUN: 5, HAR: 1, DEL: 1, KER: 4 }, { phase: 'fortify' });
    expectRule(() => applyAction(s, me, { type: 'fortify', from: 'PUN', to: 'KER', armies: 1 }), 'not-connected');
    expectRule(() => applyAction(s, me, { type: 'fortify', from: 'PUN', to: 'DEL', armies: 5 }), 'too-few-armies');
    expectRule(() => applyAction(s, me, { type: 'fortify', from: 'PUN', to: 'BRJ', armies: 1 }), 'not-owner');
    expectRule(() => applyAction(s, me, { type: 'fortify', from: 'PUN', to: 'PUN', armies: 1 }), 'invalid-action');
    const r = applyAction(s, me, { type: 'fortify', from: 'PUN', to: 'DEL', armies: 4 }).state;
    expect(r.territories.PUN.armies).toBe(1);
    expect(r.territories.DEL.armies).toBe(5);
    expect(currentPlayer(r)).toBe(foe);
    expect(r.phase).toBe('reinforce');
    expect(r.pendingReinforcements).toBe(calcReinforcements(r, foe).total);
  });
  it('can be skipped', () => {
    const { s, me, foe } = board({ PUN: 5 });
    let r = applyAction(s, me, { type: 'endPhase' }).state;
    expect(r.phase).toBe('fortify');
    r = applyAction(r, me, { type: 'endPhase' }).state;
    expect(currentPlayer(r)).toBe(foe);
  });
});

describe('elimination and victory (2.1, 2.5)', () => {
  it('ends the game when one player is left', () => {
    const { s, me } = board(Object.fromEntries(TERRITORY_IDS.filter((t) => t !== 'LAK').map((t) => [t, 20])));
    const r = applyAction(s, me, { type: 'attack', from: 'KER', to: 'LAK', dice: 3, blitz: true });
    expect(r.state.phase).toBe('finished');
    expect(r.state.winner).toBe(me);
    expect(r.state.territories.LAK.armies).toBeGreaterThan(0);
    expect(events(r.events, 'playerEliminated')).toHaveLength(1);
    expectRule(() => applyAction(r.state, me, { type: 'endPhase' }), 'game-over');
  });

  it('hands over the loser\'s cards and forces an immediate trade at 5 or more', () => {
    const s = started(3, 1, 'digvijaya');
    const [me, victim, other] = s.turnOrder;
    for (const t of TERRITORY_IDS) s.territories[t] = { owner: other, armies: 1 };
    s.territories.KER = { owner: me, armies: 30 };
    s.territories.LAK = { owner: victim, armies: 1 };
    s.phase = 'attack';
    s.pendingReinforcements = 0;
    s.players[me].cards = ['HIM', 'UTK'];
    s.players[victim].cards = ['PUR', 'JNK', 'LAD'];
    let r = applyAction(s, me, { type: 'attack', from: 'KER', to: 'LAK', dice: 3, blitz: true }).state;
    expect(r.players[victim].alive).toBe(false);
    expect(r.players[victim].cards).toEqual([]);
    expect(r.players[me].cards).toHaveLength(5);
    r = applyAction(r, me, { type: 'occupy', armies: 3 }).state;
    expectRule(() => applyAction(r, me, { type: 'attack', from: 'KER', to: 'MYS', dice: 3 }), 'must-trade');
    expectRule(() => applyAction(r, me, { type: 'endPhase' }), 'must-trade');
    r = applyAction(r, me, { type: 'trade', cards: ['HIM', 'UTK', 'PUR'] }).state;
    expectRule(() => applyAction(r, me, { type: 'attack', from: 'KER', to: 'MYS', dice: 3 }), 'must-place');
    r = applyAction(r, me, { type: 'place', territory: 'KER', armies: 4 }).state;
    applyAction(r, me, { type: 'attack', from: 'KER', to: 'MYS', dice: 3 });
    // The eliminated player is skipped in turn order.
    r = applyAction(applyAction(r, me, { type: 'endPhase' }).state, me, { type: 'endPhase' }).state;
    expect(currentPlayer(r)).toBe(other);
    r = applyAction(r, other, { type: 'place', territory: 'DEL', armies: r.pendingReinforcements }).state;
    for (let i = 0; i < 3; i++) r = applyAction(r, other, { type: 'endPhase' }).state;
    expect(currentPlayer(r)).toBe(me);
    expect(r.round).toBe(2);
  });

  it('Samrajya: wins with 28 territories at the end of your own turn', () => {
    const ids = TERRITORY_IDS.slice(0, 28);
    const win = board(Object.fromEntries(ids.map((t) => [t, 2])), { phase: 'fortify' });
    const r = applyAction(win.s, win.me, { type: 'endPhase' });
    expect(r.state.winner).toBe(win.me);
    expect(events(r.events, 'gameWon')[0]).toMatchObject({ mode: 'samrajya' });

    const short = board(Object.fromEntries(ids.slice(0, 27).map((t) => [t, 2])), { phase: 'fortify' });
    expect(applyAction(short.s, short.me, { type: 'endPhase' }).state.winner).toBeNull();

    // Holding 28 on someone else's turn is not a win; digvijaya ignores the count.
    const dig = board(Object.fromEntries(ids.map((t) => [t, 2])), { phase: 'fortify' });
    dig.s.victory = 'digvijaya';
    expect(applyAction(dig.s, dig.me, { type: 'endPhase' }).state.winner).toBeNull();
  });

  it('Capitals: wins holding your own capital and two enemy capitals', () => {
    const s = started(4, 5, 'capitals');
    const [me, b, c, d] = s.turnOrder;
    const set = (holdOwn: boolean, enemyHeld: number) => {
      const x: GameState = JSON.parse(JSON.stringify(s));
      for (const t of TERRITORY_IDS) x.territories[t] = { owner: d, armies: 1 };
      Object.assign(x.players[me], { capital: 'DEL' });
      Object.assign(x.players[b], { capital: 'KER' });
      Object.assign(x.players[c], { capital: 'ASM' });
      Object.assign(x.players[d], { capital: 'BIH' });
      x.territories.KER.owner = b;
      x.territories.ASM.owner = c;
      x.territories.PUN.owner = me;
      if (holdOwn) x.territories.DEL.owner = me;
      if (enemyHeld >= 1) x.territories.KER.owner = me;
      if (enemyHeld >= 2) x.territories.ASM.owner = me;
      x.territories.MEG.owner = b;
      x.territories.SIK.owner = c;
      x.phase = 'fortify';
      return applyAction(x, me, { type: 'endPhase' }).state.winner;
    };
    expect(set(true, 2)).toBe(me);
    expect(set(true, 1)).toBeNull();
    expect(set(false, 2)).toBeNull();
  });
});

describe('surrender (2.10)', () => {
  it('turns the player\'s territories neutral and passes the turn', () => {
    const s = started(3);
    const [a, b, c] = s.turnOrder;
    const held = territoriesOf(s, a);
    const r = applyAction(s, a, { type: 'surrender' }).state;
    expect(held.every((t) => r.territories[t].owner === 'neutral')).toBe(true);
    expect(r.players[a].alive).toBe(false);
    expect(currentPlayer(r)).toBe(b);
    expect(r.phase).toBe('reinforce');
    expectRule(() => applyAction(r, a, { type: 'endPhase' }), 'invalid-action');
    const end = applyAction(r, c, { type: 'surrender' }).state;
    expect(end.winner).toBe(b);
  });
  it('works during setup without stalling the game', () => {
    let s = createGame({ players: ['A', 'B', 'C'], seed: 2 }).state;
    s = applyAction(s, 'A', { type: 'chooseCapital', territory: territoriesOf(s, 'A')[0] }).state;
    s = applyAction(s, 'B', { type: 'chooseCapital', territory: territoriesOf(s, 'B')[0] }).state;
    s = applyAction(s, 'C', { type: 'surrender' }).state;
    expect(s.phase).toBe('setup-place');
  });
});

describe('engine guarantees', () => {
  it('never modifies the state it is given, even when an action fails', () => {
    const { s, me } = board({ DEL: 10 });
    const before = JSON.stringify(s);
    applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 3, blitz: true });
    expectRule(() => applyAction(s, me, { type: 'attack', from: 'DEL', to: 'KER', dice: 3 }), 'not-adjacent');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('rejects malformed input without crashing', () => {
    const { s, me } = board({ DEL: 10 });
    const bad = [
      null,
      {},
      { type: 'nope' },
      { type: 'attack' },
      { type: 'attack', from: 'DEL', to: 'BRJ', dice: 1.5 },
      { type: 'attack', from: 'DEL', to: 'BRJ', dice: -1 },
      { type: 'attack', from: '__proto__', to: 'BRJ', dice: 1 },
      { type: 'place', territory: 'DEL', armies: '3' },
      { type: 'trade', cards: 'abc' },
      { type: 'occupy', armies: 1 },
    ];
    for (const a of bad) expect(() => applyAction(s, me, a as unknown as Action)).toThrow(/./);
    for (const a of bad) {
      try {
        applyAction(s, me, a as unknown as Action);
      } catch (e) {
        expect((e as Error).name).toBe('RuleError');
      }
    }
    expectRule(() => applyAction(s, 'ghost', { type: 'endPhase' }), 'unknown-player');
  });
});

describe('whole games under random legal play', () => {
  const cases: [number, VictoryMode, number][] = [];
  for (const n of [2, 3, 4, 5, 6]) for (const mode of ['samrajya', 'digvijaya', 'capitals'] as VictoryMode[]) cases.push([n, mode, n * 31]);

  function check(s: GameState): void {
    let cards = s.deck.length + s.discard.length;
    for (const p of Object.values(s.players)) {
      cards += p.cards.length;
      if (!p.alive) expect(p.cards).toHaveLength(0);
    }
    expect(cards).toBe(45);
    expect(s.pendingReinforcements).toBeGreaterThanOrEqual(0);
    for (const t of TERRITORY_IDS) {
      const { owner, armies } = s.territories[t];
      expect(Number.isInteger(armies)).toBe(true);
      expect(armies).toBeGreaterThanOrEqual(s.pendingOccupy?.to === t ? 0 : 1);
      if (owner !== 'neutral') expect(s.players[owner].alive).toBe(true);
    }
  }

  it.each(cases)('%i players, %s: reaches a winner with every invariant intact', (n, mode, seed) => {
    const r = lcg(seed);
    let s = createGame({ players: NAMES.slice(0, n), seed, victory: mode }).state;
    const log: [PlayerId, Action][] = [];
    for (let i = 0; i < 400_000 && s.phase !== 'finished'; i++) {
      const [player, action] = botMove(s, r);
      log.push([player, action]);
      s = applyAction(s, player, action).state;
      if (i % 25 === 0) check(s);
    }
    check(s);
    expect(s.phase).toBe('finished');
    expect(s.winner).not.toBeNull();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);

    // Replaying the action log from the same seed gives the identical game.
    let replay = createGame({ players: NAMES.slice(0, n), seed, victory: mode }).state;
    for (const [player, action] of log) replay = applyAction(replay, player, action).state;
    expect(replay).toEqual(s);
  });
});

describe('the Siliguri corridor and the walls (map)', () => {
  it('makes North Bengal the only way into the Northeast', () => {
    const northeast = new Set(REGIONS.find((r) => r.id === 'northeast')!.territories);
    const ways = LAND_EDGES.filter(([a, b]) => northeast.has(a) !== northeast.has(b)).map((e) => [...e].sort().join('-'));
    expect(ways.sort()).toEqual(['BEN-NBN', 'BIH-NBN']);
  });
  it('cannot be crossed where a range or forest stands', () => {
    const { s, me } = board({ PUR: 9, AWD: 9, GUJ: 9, TEL: 9 });
    for (const [from, to] of [['PUR', 'CHH'], ['AWD', 'MAL'], ['GUJ', 'DSH'], ['TEL', 'CHH']]) {
      expectRule(() => applyAction(s, me, { type: 'attack', from, to, dice: 1 }), 'not-adjacent');
    }
    applyAction(s, me, { type: 'attack', from: 'PUR', to: 'MHK', dice: 1 }); // the way round is open
  });
});

describe('more than one map', () => {
  it('has a valid Mumbai map, a smaller quick game', () => {
    selectMap('mumbai');
    expect(validateMap()).toEqual([]);
    expect(TERRITORIES).toHaveLength(32);
    expect(samrajyaTarget()).toBe(MAPS.mumbai.data.samrajya);
    selectMap('india');
    expect(TERRITORIES).toHaveLength(43);
    expect(samrajyaTarget()).toBe(28);
  });

  it.each([2, 3, 4, 6])('plays a whole %i-player game on Mumbai, with armies scaled to the map', (n) => {
    let s = createGame({ players: NAMES.slice(0, n), seed: n * 13, map: 'mumbai' }).state;
    expect(s.map).toBe('mumbai');
    expect(Object.keys(s.territories)).toHaveLength(32);
    if (n === 2) expect(territoriesOf(s, s.turnOrder[0])).toHaveLength(10);
    const rand = lcg(n);
    for (let i = 0; i < 60_000 && s.phase !== 'finished'; i++) {
      const p = awaitedPlayers(s)[0];
      s = applyAction(s, p, botAction(s, p, rand, 'play')!).state;
    }
    expect(s.phase).toBe('finished');
    selectMap('india');
  });

  it('has a valid Hyderabad map, where the Musi is a river', () => {
    selectMap('hyderabad');
    expect(validateMap()).toEqual([]);
    expect(TERRITORIES).toHaveLength(34);
    expect(samrajyaTarget()).toBe(MAPS.hyderabad.data.samrajya);
    let s = createGame({ players: NAMES.slice(0, 2), seed: 3, map: 'hyderabad' }).state;
    // Across the river an attacker rolls one die fewer, and in the Monsoon cannot cross at all.
    expect(maxAttackDice(s, 'ABD', 'CHA')).toBe(2);
    expect(maxAttackDice(s, 'ABD', 'MEH')).toBe(3);
    expect(neighbors('CHA', true)).toContain('ABD');
    expect(neighbors('CHA', false)).not.toContain('ABD');
    // The river never cuts the city in two: the ends of it can be walked around.
    const reached = new Set(['CHA']);
    const stack = ['CHA'];
    while (stack.length) for (const n of neighbors(stack.pop()!, false)) if (!reached.has(n)) reached.add(n), stack.push(n);
    expect(reached.size).toBe(34);
    const rand = lcg(5);
    for (let i = 0; i < 60_000 && s.phase !== 'finished'; i++) {
      const p = awaitedPlayers(s)[0];
      s = applyAction(s, p, botAction(s, p, rand, 'play')!).state;
    }
    expect(s.phase).toBe('finished');
    selectMap('india');
  });

  it('keeps games on different maps apart when they are played side by side', () => {
    let india = started(3, 4);
    let city = createGame({ players: NAMES.slice(0, 3), seed: 4, map: 'mumbai' }).state;
    const rand = lcg(9);
    // Alternate one move in each game, as a server with two rooms would.
    for (let i = 0; i < 300; i++) {
      for (const game of ['india', 'city'] as const) {
        const s = game === 'india' ? india : city;
        if (s.phase === 'finished') continue;
        const p = awaitedPlayers(s)[0];
        const next = applyAction(s, p, botAction(s, p, rand, 'play')!).state;
        if (game === 'india') india = next;
        else city = next;
      }
    }
    expect(Object.keys(india.territories)).toHaveLength(43);
    expect(Object.keys(city.territories)).toHaveLength(32);
    expect(Object.keys(MAPS)).toEqual(['india', 'mumbai', 'hyderabad']);
    selectMap('india');
  });
});
