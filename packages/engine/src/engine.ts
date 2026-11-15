import { OUTPOSTS, REGIONS, TERRITORY_IDS, isAdjacent, isTerritory, neighbors, territory } from './map';
import type { Suit, TerritoryId } from './map';
import { rollDie, shuffle } from './rng';
import { RuleError } from './types';
import type {
  Action,
  BoardLike,
  CardId,
  GameEvent,
  GameState,
  PlayerId,
  PlayerState,
  Result,
  RuleErrorCode,
  VictoryMode,
} from './types';

export const RULES_VERSION = 1;
export const SAMRAJYA_TARGET = 28;
export const CAPITAL_CAPTURE_BONUS = 3;
export const MONSOON_EVERY = 4;
export const WILD_CARDS: readonly CardId[] = ['RATHA1', 'RATHA2'];

const START_ARMIES: Record<number, number> = { 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 };
/** Extra starting armies per seat after the first. Set from bot simulations. */
export const SEAT_COMPENSATION = 2;
const TWO_PLAYER_TERRITORIES = 14;
const NEUTRAL_ARMIES = 2;
const SET_VALUES: Record<Suit, number> = { padati: 4, ashva: 6, gaja: 8 };
const MIXED_SET_VALUE = 10;
const OWNED_CARD_BONUS = 2;
const FORCED_TRADE_HAND = 5;

function fail(code: RuleErrorCode, message: string): never {
  throw new RuleError(code, message);
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

// ---------------------------------------------------------------- queries

export function currentPlayer(s: BoardLike): PlayerId {
  return s.turnOrder[s.turnIndex];
}

export function isMonsoon(s: BoardLike): boolean {
  return s.round > 0 && s.round % MONSOON_EVERY === 0;
}

export function territoriesOf(s: BoardLike, player: PlayerId): TerritoryId[] {
  return TERRITORY_IDS.filter((id) => s.territories[id].owner === player);
}

/** True when `id` is a capital still held by the player who chose it. */
export function isHeldCapital(s: BoardLike, id: TerritoryId): boolean {
  const owner = s.territories[id].owner;
  return owner !== 'neutral' && s.players[owner]?.capital === id;
}

/** Most dice an attacker may roll into `to` this round, before counting armies. */
export function maxAttackDice(s: BoardLike, to: TerritoryId): number {
  const mountain = territory(to).mountain;
  if (isMonsoon(s)) return mountain ? 1 : 2;
  return mountain ? 2 : 3;
}

export interface ReinforcementBreakdown {
  territories: number;
  regions: number;
  outposts: number;
  capital: number;
  total: number;
}

export function calcReinforcements(s: BoardLike, player: PlayerId): ReinforcementBreakdown {
  const owned = new Set(territoriesOf(s, player));
  const territories = Math.max(3, Math.floor(owned.size / 3));
  const regions = REGIONS.filter((r) => r.territories.every((t) => owned.has(t))).reduce((n, r) => n + r.bonus, 0);
  const outposts = OUTPOSTS.filter((t) => owned.has(t)).length;
  const cap = s.players[player].capital;
  const capital = cap !== null && owned.has(cap) ? 1 : 0;
  return { territories, regions, outposts, capital, total: territories + regions + outposts + capital };
}

/** Army value of a three-card set, or null if the cards do not form a set. */
export function setValue(cards: readonly CardId[]): number | null {
  if (cards.length !== 3 || new Set(cards).size !== 3) return null;
  const suits = cards.filter((c) => !WILD_CARDS.includes(c)).map((c) => (isTerritory(c) ? territory(c).suit : null));
  if (suits.includes(null)) return null;
  const distinct = new Set(suits);
  // One of each: the non-wild cards are all different and wilds fill the gaps.
  // This is worth more than any three of a kind, so it is checked first.
  if (distinct.size === suits.length) return MIXED_SET_VALUE;
  if (distinct.size === 1) return SET_VALUES[suits[0] as Suit];
  return null;
}

/** Finds the most valuable set in a hand, or null if there is none. */
export function bestSet(hand: readonly CardId[]): [CardId, CardId, CardId] | null {
  let best: [CardId, CardId, CardId] | null = null;
  let bestValue = 0;
  for (let i = 0; i < hand.length; i++)
    for (let j = i + 1; j < hand.length; j++)
      for (let k = j + 1; k < hand.length; k++) {
        const v = setValue([hand[i], hand[j], hand[k]]);
        if (v !== null && v > bestValue) {
          bestValue = v;
          best = [hand[i], hand[j], hand[k]];
        }
      }
  return best;
}

/** True when `to` can be reached from `from` through the player's own territories. */
export function isConnected(s: BoardLike, player: PlayerId, from: TerritoryId, to: TerritoryId): boolean {
  const seaOpen = !isMonsoon(s);
  const seen = new Set<TerritoryId>([from]);
  const stack = [from];
  while (stack.length) {
    for (const n of neighbors(stack.pop()!, seaOpen)) {
      if (seen.has(n) || s.territories[n].owner !== player) continue;
      if (n === to) return true;
      seen.add(n);
      stack.push(n);
    }
  }
  return false;
}

// ------------------------------------------------------------------ setup

export interface GameConfig {
  players: PlayerId[];
  seed: number;
  victory?: VictoryMode;
}

export function createGame(cfg: GameConfig): Result {
  const n = cfg.players.length;
  if (!(n in START_ARMIES)) throw new Error('A game needs 2 to 6 players');
  if (new Set(cfg.players).size !== n || cfg.players.includes('neutral')) throw new Error('Invalid player ids');

  const s: GameState = {
    rulesVersion: RULES_VERSION,
    victory: cfg.victory ?? 'samrajya',
    phase: 'setup-capital',
    round: 0,
    turnOrder: [],
    turnIndex: 0,
    players: {},
    territories: {},
    pendingReinforcements: 0,
    pendingOccupy: null,
    conqueredThisTurn: false,
    deck: [],
    discard: [],
    winner: null,
    rng: cfg.seed >>> 0,
  };

  s.turnOrder = shuffle(s, cfg.players);
  const dealt = shuffle(s, TERRITORY_IDS);
  dealt.forEach((id, i) => {
    if (n === 2) {
      const seat = Math.floor(i / TWO_PLAYER_TERRITORIES);
      s.territories[id] = seat < 2 ? { owner: s.turnOrder[seat], armies: 1 } : { owner: 'neutral', armies: NEUTRAL_ARMIES };
    } else {
      // Dealt from the last seat backwards, so leftovers go to players late in turn order.
      s.territories[id] = { owner: s.turnOrder[n - 1 - (i % n)], armies: 1 };
    }
  });
  for (const id of s.turnOrder) {
    s.players[id] = {
      id,
      cards: [],
      capital: null,
      alive: true,
      // Later seats get extra starting armies to offset the advantage of moving first.
      setupArmies: START_ARMIES[n] - territoriesOf(s, id).length + s.turnOrder.indexOf(id) * SEAT_COMPENSATION,
      setupPlacement: null,
      surrendered: false,
    };
  }
  s.deck = shuffle(s, [...TERRITORY_IDS, ...WILD_CARDS]);
  return { state: s, events: [{ type: 'gameCreated', turnOrder: [...s.turnOrder] }] };
}

// ----------------------------------------------------------- turn helpers

function alivePlayers(s: GameState): PlayerState[] {
  return s.turnOrder.map((id) => s.players[id]).filter((p) => p.alive);
}

function finish(s: GameState, ev: GameEvent[], player: PlayerId, mode: VictoryMode | 'last-standing'): void {
  s.phase = 'finished';
  s.winner = player;
  s.pendingReinforcements = 0;
  ev.push({ type: 'gameWon', player, mode });
}

function beginTurn(s: GameState, ev: GameEvent[]): void {
  const player = currentPlayer(s);
  s.phase = 'reinforce';
  s.conqueredThisTurn = false;
  s.pendingOccupy = null;
  s.pendingReinforcements = calcReinforcements(s, player).total;
  ev.push({ type: 'turnStarted', player, reinforcements: s.pendingReinforcements });
}

function startRound(s: GameState, ev: GameEvent[], round: number): void {
  s.round = round;
  ev.push({ type: 'roundStarted', round, monsoon: isMonsoon(s), monsoonNext: (round + 1) % MONSOON_EVERY === 0 });
}

function meetsEndOfTurnVictory(s: GameState, player: PlayerId): boolean {
  const owned = new Set(territoriesOf(s, player));
  if (s.victory === 'samrajya') return owned.size >= SAMRAJYA_TARGET;
  if (s.victory === 'capitals') {
    const own = s.players[player].capital;
    const enemy = s.turnOrder.filter((id) => id !== player && owned.has(s.players[id].capital ?? '')).length;
    return own !== null && owned.has(own) && enemy >= Math.min(2, s.turnOrder.length - 1);
  }
  return false;
}

/** Ends the current player's turn and starts the next one. `draw` is false when the player has just left the game. */
function endTurn(s: GameState, ev: GameEvent[], draw: boolean): void {
  const player = currentPlayer(s);
  if (draw && s.conqueredThisTurn) {
    if (s.deck.length === 0) {
      s.deck = shuffle(s, s.discard);
      s.discard = [];
    }
    const card = s.deck.pop();
    if (card !== undefined) {
      s.players[player].cards.push(card);
      ev.push({ type: 'cardDrawn', player, card });
    }
  }
  if (draw && meetsEndOfTurnVictory(s, player)) return finish(s, ev, player, s.victory);

  let i = s.turnIndex;
  let round = s.round;
  do {
    i += 1;
    if (i >= s.turnOrder.length) {
      i = 0;
      round += 1;
    }
  } while (!s.players[s.turnOrder[i]].alive);
  s.turnIndex = i;
  if (round !== s.round) startRound(s, ev, round);
  beginTurn(s, ev);
}

function setPhase(s: GameState, ev: GameEvent[], phase: GameState['phase']): void {
  s.phase = phase;
  ev.push({ type: 'phaseChanged', phase });
}

// ---------------------------------------------------------- setup actions

function advanceSetup(s: GameState, ev: GameEvent[]): void {
  const alive = alivePlayers(s);
  if (s.phase === 'setup-capital' && alive.every((p) => p.capital !== null)) {
    const capitals: Record<PlayerId, TerritoryId> = {};
    for (const p of alive) capitals[p.id] = p.capital!;
    ev.push({ type: 'capitalsRevealed', capitals });
    setPhase(s, ev, 'setup-place');
  }
  if (s.phase === 'setup-place' && alive.every((p) => p.setupPlacement !== null)) {
    for (const p of alive) {
      for (const [id, armies] of Object.entries(p.setupPlacement!)) s.territories[id].armies += armies;
      p.setupPlacement = null;
      p.setupArmies = 0;
    }
    ev.push({ type: 'setupRevealed' });
    s.turnIndex = s.turnOrder.findIndex((id) => s.players[id].alive);
    startRound(s, ev, 1);
    beginTurn(s, ev);
  }
}

function chooseCapital(s: GameState, ev: GameEvent[], p: PlayerState, a: Extract<Action, { type: 'chooseCapital' }>): void {
  if (s.phase !== 'setup-capital') fail('wrong-phase', 'Capitals are chosen during setup');
  if (p.capital !== null) fail('invalid-action', 'Capital already chosen');
  if (!isTerritory(a.territory) || s.territories[a.territory].owner !== p.id) fail('not-owner', 'Choose one of your own territories');
  p.capital = a.territory;
  ev.push({ type: 'capitalChosen', player: p.id });
  advanceSetup(s, ev);
}

function setupPlace(s: GameState, ev: GameEvent[], p: PlayerState, a: Extract<Action, { type: 'setupPlace' }>): void {
  if (s.phase !== 'setup-place') fail('wrong-phase', 'Starting armies are placed after capitals are revealed');
  if (p.setupPlacement !== null) fail('invalid-action', 'Starting armies already placed');
  if (typeof a.placements !== 'object' || a.placements === null) fail('invalid-action', 'Missing placements');
  let total = 0;
  const placement: Record<TerritoryId, number> = {};
  for (const [id, armies] of Object.entries(a.placements)) {
    if (!isTerritory(id) || s.territories[id].owner !== p.id) fail('not-owner', `${id} is not yours`);
    if (!isPositiveInt(armies)) fail('invalid-action', 'Army counts must be positive whole numbers');
    placement[id] = armies;
    total += armies;
  }
  if (total !== p.setupArmies) fail('invalid-action', `Place exactly ${p.setupArmies} armies`);
  p.setupPlacement = placement;
  ev.push({ type: 'setupSubmitted', player: p.id });
  advanceSetup(s, ev);
}

// ----------------------------------------------------------- turn actions

function place(s: GameState, ev: GameEvent[], p: PlayerState, a: Extract<Action, { type: 'place' }>): void {
  // Armies from a forced trade after an elimination are placed during the attack phase.
  if (s.phase !== 'reinforce' && !(s.phase === 'attack' && s.pendingReinforcements > 0)) {
    fail('wrong-phase', 'No armies to place now');
  }
  if (!isTerritory(a.territory) || s.territories[a.territory].owner !== p.id) fail('not-owner', 'Place armies on your own territory');
  if (!isPositiveInt(a.armies) || a.armies > s.pendingReinforcements) fail('invalid-action', 'Invalid army count');
  s.territories[a.territory].armies += a.armies;
  s.pendingReinforcements -= a.armies;
  ev.push({ type: 'armiesPlaced', player: p.id, territory: a.territory, armies: a.armies });
}

function trade(s: GameState, ev: GameEvent[], p: PlayerState, a: Extract<Action, { type: 'trade' }>): void {
  const forced = s.phase === 'attack' && p.cards.length >= FORCED_TRADE_HAND;
  if (s.phase !== 'reinforce' && !forced) fail('wrong-phase', 'Cards are traded at the start of your turn');
  if (!Array.isArray(a.cards) || a.cards.some((c) => !p.cards.includes(c))) fail('invalid-set', 'You do not hold those cards');
  const value = setValue(a.cards);
  if (value === null) fail('invalid-set', 'Those cards are not a set');

  p.cards = p.cards.filter((c) => !a.cards.includes(c));
  s.discard.push(...a.cards);
  s.pendingReinforcements += value;
  const bonusTerritories = a.cards.filter((c) => isTerritory(c) && s.territories[c].owner === p.id);
  for (const id of bonusTerritories) s.territories[id].armies += OWNED_CARD_BONUS;
  ev.push({ type: 'cardsTraded', player: p.id, cards: [...a.cards], armies: value, bonusTerritories });
}

function sortedRolls(s: GameState, count: number): number[] {
  return Array.from({ length: count }, () => rollDie(s)).sort((x, y) => y - x);
}

function eliminateIfDefeated(s: GameState, ev: GameEvent[], victim: PlayerId, by: PlayerState): void {
  const v = s.players[victim];
  if (!v || !v.alive || territoriesOf(s, victim).length > 0) return;
  v.alive = false;
  by.cards.push(...v.cards);
  ev.push({ type: 'playerEliminated', player: victim, by: by.id, cardsTaken: v.cards.length });
  v.cards = [];
}

function completeOccupy(s: GameState, ev: GameEvent[], armies: number): void {
  const o = s.pendingOccupy!;
  s.territories[o.from].armies -= armies;
  s.territories[o.to].armies = armies + o.capitalBonus;
  s.pendingOccupy = null;
  ev.push({ type: 'territoryOccupied', from: o.from, to: o.to, armies, capitalBonus: o.capitalBonus });
}

function attack(s: GameState, ev: GameEvent[], p: PlayerState, a: Extract<Action, { type: 'attack' }>): void {
  if (s.phase !== 'attack') fail('wrong-phase', 'You can only attack in the attack phase');
  if (p.cards.length >= FORCED_TRADE_HAND) fail('must-trade', 'Trade cards before attacking');
  if (s.pendingReinforcements > 0) fail('must-place', 'Place your armies before attacking');
  if (!isTerritory(a.from) || !isTerritory(a.to)) fail('invalid-action', 'Unknown territory');
  const from = s.territories[a.from];
  const to = s.territories[a.to];
  if (from.owner !== p.id) fail('not-owner', 'Attack from your own territory');
  if (to.owner === p.id) fail('invalid-action', 'You cannot attack yourself');
  if (!isAdjacent(a.from, a.to, !isMonsoon(s))) fail('not-adjacent', 'Those territories are not connected');
  if (from.armies < 2) fail('too-few-armies', 'You need at least 2 armies to attack');
  const limit = maxAttackDice(s, a.to);
  if (!isPositiveInt(a.dice) || a.dice > limit) fail('too-many-dice', `At most ${limit} dice here`);
  if (a.dice >= from.armies) fail('too-few-armies', 'You need more armies than dice');

  const defender = to.owner;
  for (;;) {
    const dice = a.blitz ? Math.min(limit, from.armies - 1) : a.dice;
    const attackRoll = sortedRolls(s, dice);
    let defenceRoll = sortedRolls(s, Math.min(2, to.armies));
    const reroll = isHeldCapital(s, a.to) && defenceRoll.includes(1);
    if (reroll) defenceRoll = defenceRoll.map((d) => (d === 1 ? rollDie(s) : d)).sort((x, y) => y - x);

    let attackerLost = 0;
    let defenderLost = 0;
    for (let i = 0; i < Math.min(attackRoll.length, defenceRoll.length); i++) {
      if (attackRoll[i] > defenceRoll[i]) defenderLost += 1;
      else attackerLost += 1;
    }
    from.armies -= attackerLost;
    to.armies -= defenderLost;
    ev.push({
      type: 'diceRolled',
      from: a.from,
      to: a.to,
      attack: attackRoll,
      defence: defenceRoll,
      rerolled: reroll,
      attackerLost,
      defenderLost,
    });

    if (to.armies === 0) {
      const capital = isHeldCapital(s, a.to);
      to.owner = p.id;
      s.conqueredThisTurn = true;
      s.pendingOccupy = { from: a.from, to: a.to, min: dice, capitalBonus: capital ? CAPITAL_CAPTURE_BONUS : 0 };
      ev.push({ type: 'territoryCaptured', territory: a.to, by: p.id, from: defender, capital });
      if (defender !== 'neutral') eliminateIfDefeated(s, ev, defender, p);
      if (alivePlayers(s).length === 1) {
        completeOccupy(s, ev, dice);
        return finish(s, ev, p.id, 'last-standing');
      }
      return setPhase(s, ev, 'occupy');
    }
    if (!a.blitz || from.armies < 2) return;
  }
}

function occupy(s: GameState, ev: GameEvent[], a: Extract<Action, { type: 'occupy' }>): void {
  const o = s.pendingOccupy;
  if (s.phase !== 'occupy' || !o) fail('wrong-phase', 'Nothing to occupy');
  const available = s.territories[o.from].armies - 1;
  if (!isPositiveInt(a.armies) || a.armies < o.min || a.armies > available) {
    fail('invalid-action', `Move between ${o.min} and ${available} armies`);
  }
  completeOccupy(s, ev, a.armies);
  setPhase(s, ev, 'attack');
}

function fortify(s: GameState, ev: GameEvent[], p: PlayerState, a: Extract<Action, { type: 'fortify' }>): void {
  if (s.phase !== 'fortify') fail('wrong-phase', 'You can only fortify in the fortify phase');
  if (!isTerritory(a.from) || !isTerritory(a.to) || a.from === a.to) fail('invalid-action', 'Choose two different territories');
  if (s.territories[a.from].owner !== p.id || s.territories[a.to].owner !== p.id) fail('not-owner', 'Both territories must be yours');
  if (!isConnected(s, p.id, a.from, a.to)) fail('not-connected', 'No path through your own territories');
  if (!isPositiveInt(a.armies) || a.armies >= s.territories[a.from].armies) fail('too-few-armies', 'Leave at least 1 army behind');
  s.territories[a.from].armies -= a.armies;
  s.territories[a.to].armies += a.armies;
  ev.push({ type: 'fortified', from: a.from, to: a.to, armies: a.armies });
  endTurn(s, ev, true);
}

function endPhase(s: GameState, ev: GameEvent[], p: PlayerState): void {
  if (s.phase === 'reinforce' || s.phase === 'attack') {
    if (p.cards.length >= FORCED_TRADE_HAND) fail('must-trade', 'Trade cards first');
    if (s.pendingReinforcements > 0) fail('must-place', 'Place all your armies first');
    return setPhase(s, ev, s.phase === 'reinforce' ? 'attack' : 'fortify');
  }
  if (s.phase === 'fortify') return endTurn(s, ev, true);
  fail('wrong-phase', 'This phase cannot be skipped');
}

function surrender(s: GameState, ev: GameEvent[], p: PlayerState): void {
  if (!p.alive) fail('invalid-action', 'You are no longer in the game');
  const wasTurn = s.round > 0 && currentPlayer(s) === p.id;
  if (wasTurn && s.pendingOccupy) completeOccupy(s, ev, s.pendingOccupy.min);
  for (const id of territoriesOf(s, p.id)) s.territories[id].owner = 'neutral';
  s.discard.push(...p.cards);
  p.cards = [];
  p.alive = false;
  p.surrendered = true;
  ev.push({ type: 'playerSurrendered', player: p.id });

  const alive = alivePlayers(s);
  if (alive.length === 1) return finish(s, ev, alive[0].id, 'last-standing');
  if (s.round === 0) return advanceSetup(s, ev);
  if (wasTurn) {
    s.pendingReinforcements = 0;
    endTurn(s, ev, false);
  }
}

// ------------------------------------------------------------ entry point

/**
 * Applies one action by one player. Returns the new state and the events it
 * produced, or throws a RuleError. The input state is never modified.
 */
export function applyAction(state: GameState, player: PlayerId, action: Action): Result {
  if (state.phase === 'finished') fail('game-over', 'The game is over');
  const s = clone(state);
  const ev: GameEvent[] = [];
  const p = s.players[player];
  if (!p) fail('unknown-player', 'You are not in this game');
  if (typeof action !== 'object' || action === null) fail('invalid-action', 'Malformed action');

  if (action.type === 'surrender') {
    surrender(s, ev, p);
    return { state: s, events: ev };
  }
  if (!p.alive) fail('invalid-action', 'You are no longer in the game');
  if (action.type === 'chooseCapital') {
    chooseCapital(s, ev, p, action);
    return { state: s, events: ev };
  }
  if (action.type === 'setupPlace') {
    setupPlace(s, ev, p, action);
    return { state: s, events: ev };
  }

  if (s.round === 0) fail('wrong-phase', 'The game has not started');
  if (currentPlayer(s) !== player) fail('not-your-turn', 'It is not your turn');
  switch (action.type) {
    case 'place':
      place(s, ev, p, action);
      break;
    case 'trade':
      trade(s, ev, p, action);
      break;
    case 'attack':
      attack(s, ev, p, action);
      break;
    case 'occupy':
      occupy(s, ev, action);
      break;
    case 'fortify':
      fortify(s, ev, p, action);
      break;
    case 'endPhase':
      endPhase(s, ev, p);
      break;
    default:
      fail('invalid-action', 'Unknown action');
  }
  return { state: s, events: ev };
}
