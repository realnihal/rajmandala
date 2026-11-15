import { expect } from 'vitest';
import {
  TERRITORY_IDS,
  applyAction,
  bestSet,
  createGame,
  currentPlayer,
  isConnected,
  isMonsoon,
  maxAttackDice,
  neighbors,
  territoriesOf,
} from '../src';
import type { Action, GameState, PlayerId, RuleErrorCode, TerritoryId, VictoryMode } from '../src';

export const NAMES = ['A', 'B', 'C', 'D', 'E', 'F'];

/** A game with setup finished: each player's capital is their first territory and holds all their armies. */
export function started(n: number, seed = 1, victory: VictoryMode = 'samrajya'): GameState {
  let s = createGame({ players: NAMES.slice(0, n), seed, victory }).state;
  for (const id of s.turnOrder) {
    s = applyAction(s, id, { type: 'chooseCapital', territory: territoriesOf(s, id)[0] }).state;
  }
  for (const id of s.turnOrder) {
    const cap = s.players[id].capital!;
    s = applyAction(s, id, { type: 'setupPlace', placements: { [cap]: s.players[id].setupArmies } }).state;
  }
  return s;
}

/**
 * A two-player game rearranged for a test: the player to move ("me") holds
 * exactly `mine`, the opponent ("foe") holds everything else with `foeArmies`
 * each. Both capitals are cleared unless set by the test.
 */
export function board(mine: Record<TerritoryId, number>, opts: { foeArmies?: number; phase?: GameState['phase']; round?: number } = {}) {
  const s = started(2);
  const [me, foe] = s.turnOrder;
  for (const id of TERRITORY_IDS) s.territories[id] = { owner: foe, armies: opts.foeArmies ?? 1 };
  for (const [id, armies] of Object.entries(mine)) s.territories[id] = { owner: me, armies };
  s.players[me].capital = null;
  s.players[foe].capital = null;
  s.phase = opts.phase ?? 'attack';
  s.round = opts.round ?? 1;
  s.pendingReinforcements = 0;
  return { s, me, foe };
}

export function expectRule(fn: () => unknown, code: RuleErrorCode): void {
  try {
    fn();
  } catch (e) {
    expect((e as { code?: string }).code).toBe(code);
    return;
  }
  expect.fail(`expected a "${code}" rule error`);
}

/** Small deterministic generator for the test bot, separate from the game's own RNG. */
export function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** Chooses a legal action for whoever must act next. Plays aggressively so games end. */
export function botMove(s: GameState, r: () => number): [PlayerId, Action] {
  if (s.phase === 'setup-capital') {
    const p = s.turnOrder.map((id) => s.players[id]).find((x) => x.alive && x.capital === null)!;
    return [p.id, { type: 'chooseCapital', territory: pick(r, territoriesOf(s, p.id)) }];
  }
  if (s.phase === 'setup-place') {
    const p = s.turnOrder.map((id) => s.players[id]).find((x) => x.alive && x.setupPlacement === null)!;
    const own = territoriesOf(s, p.id);
    const placements: Record<TerritoryId, number> = {};
    for (let i = 0; i < p.setupArmies; i++) {
      const t = pick(r, own);
      placements[t] = (placements[t] ?? 0) + 1;
    }
    return [p.id, { type: 'setupPlace', placements }];
  }

  const me = currentPlayer(s);
  const own = territoriesOf(s, me);
  const seaOpen = !isMonsoon(s);
  const enemyNeighbors = (t: TerritoryId) => neighbors(t, seaOpen).filter((n) => s.territories[n].owner !== me);
  const set = bestSet(s.players[me].cards);

  if (s.phase === 'occupy') {
    const o = s.pendingOccupy!;
    const max = s.territories[o.from].armies - 1;
    return [me, { type: 'occupy', armies: o.min + Math.floor(r() * (max - o.min + 1)) }];
  }
  if ((s.phase === 'reinforce' && set) || (s.phase === 'attack' && s.players[me].cards.length >= 5)) {
    return [me, { type: 'trade', cards: set! }];
  }
  if (s.pendingReinforcements > 0) {
    const front = own.filter((t) => enemyNeighbors(t).length > 0);
    const armies = r() < 0.5 ? s.pendingReinforcements : 1 + Math.floor(r() * s.pendingReinforcements);
    return [me, { type: 'place', territory: pick(r, front.length ? front : own), armies }];
  }
  if (s.phase === 'reinforce') return [me, { type: 'endPhase' }];
  if (s.phase === 'attack') {
    const options: [TerritoryId, TerritoryId][] = [];
    for (const from of own) {
      for (const to of enemyNeighbors(from)) {
        if (s.territories[from].armies > s.territories[to].armies + 1) options.push([from, to]);
      }
    }
    if (options.length === 0 || r() < 0.05) return [me, { type: 'endPhase' }];
    const [from, to] = pick(r, options);
    const dice = Math.min(maxAttackDice(s, to), s.territories[from].armies - 1);
    return [me, { type: 'attack', from, to, dice, blitz: r() < 0.7 }];
  }
  // fortify
  const sources = own.filter((t) => s.territories[t].armies > 1);
  if (sources.length && r() < 0.5) {
    const from = pick(r, sources);
    const targets = own.filter((t) => t !== from && isConnected(s, me, from, t));
    if (targets.length) {
      return [me, { type: 'fortify', from, to: pick(r, targets), armies: 1 + Math.floor(r() * (s.territories[from].armies - 1)) }];
    }
  }
  return [me, { type: 'endPhase' }];
}
