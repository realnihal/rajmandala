import { territoriesOf } from './engine';
import type { TerritoryId } from './map';
import type { BoardLike, PlayerId } from './types';

/** Spreads `count` armies at random over a player's territories, on top of any already chosen. */
export function randomPlacement(
  s: BoardLike,
  player: PlayerId,
  count: number,
  rand: () => number = Math.random,
  base: Record<TerritoryId, number> = {},
): Record<TerritoryId, number> {
  const own = territoriesOf(s, player);
  const out = { ...base };
  for (let i = 0; i < count; i++) {
    const t = own[Math.floor(rand() * own.length)];
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}
