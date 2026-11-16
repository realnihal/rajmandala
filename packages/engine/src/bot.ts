import { randomPlacement } from './auto';
import { bestSet, currentPlayer, isConnected, isMonsoon, maxAttackDice, territoriesOf } from './engine';
import { REGIONS, neighbors, territory } from './map';
import type { TerritoryId } from './map';
import type { Action, GameState, PlayerId } from './types';

/**
 * How a seat is played when nobody is at it.
 * - 'play': a computer player that reinforces its front, attacks at good odds and fortifies.
 * - 'pass': the least that ends the turn legally, for a player who ran out of time.
 */
export type BotStyle = 'play' | 'pass';

const pick = <T>(xs: readonly T[], rand: () => number): T => xs[Math.floor(rand() * xs.length)];

/** True while the game is waiting for this player to do something. */
export function isAwaited(s: GameState, player: PlayerId): boolean {
  const p = s.players[player];
  if (!p || !p.alive || s.phase === 'finished') return false;
  if (s.phase === 'setup-capital') return p.capital === null;
  if (s.phase === 'setup-place') return p.setupPlacement === null;
  return currentPlayer(s) === player;
}

/** Everyone the game is waiting for: all undecided players during setup, otherwise whoever's turn it is. */
export function awaitedPlayers(s: GameState): PlayerId[] {
  return s.turnOrder.filter((id) => isAwaited(s, id));
}

/** The next action a bot takes for `player`, or null if the game is not waiting for them. */
export function botAction(s: GameState, player: PlayerId, rand: () => number, style: BotStyle = 'play'): Action | null {
  if (!isAwaited(s, player)) return null;
  const smart = style === 'play';
  const p = s.players[player];
  const own = territoriesOf(s, player);
  const seaOpen = !isMonsoon(s);
  const armies = (t: TerritoryId) => s.territories[t].armies;
  const foes = (t: TerritoryId) => neighbors(t, seaOpen).filter((n) => s.territories[n].owner !== player);
  const threat = (t: TerritoryId) => foes(t).reduce((n, f) => n + armies(f), 0);
  /** How much of a territory's region this player already holds, 0 to 1. */
  const regionShare = (t: TerritoryId) => {
    const region = REGIONS.find((r) => r.id === territory(t).region);
    return region ? region.territories.filter((x) => s.territories[x].owner === player).length / region.territories.length : 0;
  };

  if (s.phase === 'setup-capital') {
    if (!smart) return { type: 'chooseCapital', territory: pick(own, rand) };
    // The safest home: the territory with the fewest hostile neighbours.
    const safest = [...own].sort((a, b) => foes(a).length - foes(b).length || rand() - 0.5)[0];
    return { type: 'chooseCapital', territory: safest };
  }
  if (s.phase === 'setup-place') {
    const front = own.filter((t) => foes(t).length > 0);
    if (!smart || front.length === 0) return { type: 'setupPlace', placements: randomPlacement(s, player, p.setupArmies, rand) };
    const placements: Record<TerritoryId, number> = {};
    for (let i = 0; i < p.setupArmies; i++) {
      const t = pick(front, rand);
      placements[t] = (placements[t] ?? 0) + 1;
    }
    return { type: 'setupPlace', placements };
  }

  if (s.phase === 'occupy' && s.pendingOccupy) {
    const o = s.pendingOccupy;
    const max = armies(o.from) - 1;
    if (!smart) return { type: 'occupy', armies: o.min };
    // Push forward unless the territory left behind still faces an enemy.
    const stillExposed = foes(o.from).some((f) => f !== o.to);
    return { type: 'occupy', armies: stillExposed ? Math.max(o.min, Math.floor(max / 2)) : max };
  }

  const set = bestSet(p.cards);
  const mustTrade = p.cards.length >= 5;
  if (set && (mustTrade || (smart && s.phase === 'reinforce'))) return { type: 'trade', cards: set };

  if (s.pendingReinforcements > 0 && (s.phase === 'reinforce' || s.phase === 'attack')) {
    const front = own.filter((t) => foes(t).length > 0);
    if (!smart || front.length === 0) return { type: 'place', territory: pick(front.length ? front : own, rand), armies: s.pendingReinforcements };
    // Reinforce where it matters most: a nearly complete region, or the most threatened border.
    const best = [...front].sort((a, b) => regionShare(b) * 6 + threat(b) - armies(b) - (regionShare(a) * 6 + threat(a) - armies(a)))[0];
    return { type: 'place', territory: best, armies: s.pendingReinforcements };
  }
  if (s.phase === 'reinforce') return { type: 'endPhase' };

  if (s.phase === 'attack') {
    if (!smart) return { type: 'endPhase' };
    let best: { from: TerritoryId; to: TerritoryId; score: number } | null = null;
    for (const from of own) {
      if (armies(from) < 3) continue;
      for (const to of foes(from)) {
        const edge = armies(from) - armies(to);
        if (edge < 2 && armies(from) < armies(to) * 2) continue;
        const score = edge + regionShare(to) * 5 + (s.territories[to].owner === 'neutral' ? -1 : 0) + rand();
        if (!best || score > best.score) best = { from, to, score };
      }
    }
    if (!best) return { type: 'endPhase' };
    const dice = Math.min(maxAttackDice(s, best.to, best.from), armies(best.from) - 1);
    return { type: 'attack', from: best.from, to: best.to, dice, blitz: true };
  }

  if (s.phase === 'fortify') {
    if (smart) {
      // Bring idle armies from behind the lines up to the weakest connected border.
      const idle = own.filter((t) => armies(t) > 1 && foes(t).length === 0).sort((a, b) => armies(b) - armies(a))[0];
      if (idle) {
        const front = own
          .filter((t) => t !== idle && foes(t).length > 0 && isConnected(s, player, idle, t))
          .sort((a, b) => threat(b) - armies(b) - (threat(a) - armies(a)))[0];
        if (front) return { type: 'fortify', from: idle, to: front, armies: armies(idle) - 1 };
      }
    }
    return { type: 'endPhase' };
  }
  return null;
}
