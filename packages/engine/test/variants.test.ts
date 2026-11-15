import { describe, expect, it } from 'vitest';
import { BASE_MAP, REGIONS, applyAction, awaitedPlayers, botAction, createGame, loadMap, validateMap } from '../src';
import type { GameState, MapData } from '../src';
import { NAMES, lcg } from './helpers';

/**
 * Compares map variants by playing bot-vs-bot games on each.
 *   VARIANTS=500 npx vitest run variants --disable-console-intercept
 */
const clone = (m: MapData): MapData => JSON.parse(JSON.stringify(m));
const without = (edges: [string, string][], drop: string[]) => edges.filter(([a, b]) => !drop.includes(`${a}-${b}`) && !drop.includes(`${b}-${a}`));

/** Removes borders, as if a range or forest stood in the way. */
function withWalls(m: MapData, walls: string[]): MapData {
  const v = clone(m);
  v.land = without(v.land, walls);
  return v;
}
function withRiver(m: MapData, edge: [string, string]): MapData {
  const v = clone(m);
  v.rivers = [...(v.rivers ?? []), edge];
  return v;
}
function withBonus(m: MapData, region: string, bonus: number): MapData {
  const v = clone(m);
  v.regions.find((r) => r.id === region)!.bonus = bonus;
  return v;
}

// Add candidates here. The Bengal split and the four Central walls were adopted from an earlier run.
const VARIANTS: [string, MapData][] = [
  ['A  current map', BASE_MAP],
  ['B  river between North Bengal and Assam', withRiver(BASE_MAP, ['NBN', 'ASM'])],
  ['C  one more wall: Jharkhand-Chhattisgarh', withWalls(BASE_MAP, ['JHA-CHH'])],
  ['D  Northeast bonus 2', withBonus(BASE_MAP, 'northeast', 2)],
];

function play(n: number, seed: number): { first: GameState; last: GameState } {
  const rand = lcg(seed);
  const first = createGame({ players: NAMES.slice(0, n), seed }).state;
  let s = first;
  for (let i = 0; i < 80_000 && s.phase !== 'finished'; i++) {
    const p = awaitedPlayers(s)[0];
    s = applyAction(s, p, botAction(s, p, rand, 'play')!).state;
  }
  return { first, last: s };
}

describe('map variants', () => {
  it('the variants are well-formed maps', () => {
    for (const [name, map] of VARIANTS) {
      loadMap(map);
      // Card suits are uneven with a 43rd territory; everything else must hold.
      expect(validateMap().filter((p) => !p.startsWith('card suits')), name).toEqual([]);
    }
    loadMap(BASE_MAP);
  });

  it.runIf(process.env.VARIANTS)('comparison', () => {
    const games = Number(process.env.VARIANTS) || 300;
    for (const [name, map] of VARIANTS) {
      loadMap(map);
      console.log(`\n=== ${name}`);
      for (const n of [3, 4, 6]) {
        const regionWins: Record<string, number> = Object.fromEntries(REGIONS.map((r) => [r.id, 0]));
        let rounds = 0;
        let unfinished = 0;
        const lengths: number[] = [];
        for (let g = 0; g < games; g++) {
          const { first, last } = play(n, g * 7919 + n);
          if (last.phase !== 'finished') {
            unfinished++;
            continue;
          }
          rounds += last.round;
          lengths.push(last.round);
          for (const r of REGIONS) {
            const counts = first.turnOrder.map((p) => r.territories.filter((t) => first.territories[t].owner === p).length);
            if (first.turnOrder[counts.indexOf(Math.max(...counts))] === last.winner) regionWins[r.id]++;
          }
        }
        const done = games - unfinished;
        lengths.sort((a, b) => a - b);
        const pct = (w: number) => `${((100 * w) / done).toFixed(0)}%`.padStart(4);
        const spread = Math.max(...Object.values(regionWins)) - Math.min(...Object.values(regionWins));
        console.log(
          `${n}p fair ${(100 / n).toFixed(0)}% | rounds avg ${(rounds / done).toFixed(1)} p90 ${lengths[Math.floor(done * 0.9)]} | best-placed starter wins: ` +
            REGIONS.map((r) => `${r.id.slice(0, 5)} ${pct(regionWins[r.id])}`).join('  ') +
            ` | spread ${((100 * spread) / done).toFixed(0)} pts${unfinished ? ` | ${unfinished} unfinished` : ''}`,
        );
      }
    }
    loadMap(BASE_MAP);
  }, 1_800_000);
});
