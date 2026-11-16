import { describe, expect, it } from 'vitest';
import { BASE_MAP, LAND_EDGES, REGIONS, SEA_EDGES, TERRITORY_IDS, applyAction, awaitedPlayers, botAction, createGame, loadMap, neighbors, samrajyaTarget, validateMap } from '../src';
import type { GameState, MapData } from '../src';
import { NAMES, lcg } from './helpers';
import { MUMBAI, MUMBAI_CITY } from './mumbai-map';

/**
 * Experiment: does a map of Mumbai play faster or slower than the map of India?
 *   MUMBAI=500 npx vitest run mumbai --disable-console-intercept
 */
const MAPS: [string, MapData][] = [
  ['India (current)', BASE_MAP],
  ['Mumbai and suburbs', MUMBAI],
  ['Mumbai city only', MUMBAI_CITY],
];

/** How the map is wired: links per territory, and the longest shortest path across it. */
function shape() {
  const degree = TERRITORY_IDS.map((t) => neighbors(t, true).length);
  let diameter = 0;
  for (const start of TERRITORY_IDS) {
    const dist = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const t = queue.shift()!;
      for (const n of neighbors(t, true)) if (!dist.has(n)) dist.set(n, dist.get(t)! + 1), queue.push(n);
    }
    diameter = Math.max(diameter, ...dist.values());
  }
  return {
    territories: TERRITORY_IDS.length,
    links: LAND_EDGES.length + SEA_EDGES.length,
    perTerritory: (degree.reduce((a, b) => a + b, 0) / degree.length).toFixed(1),
    deadEnds: degree.filter((d) => d === 1).length,
    diameter,
  };
}

function play(n: number, seed: number) {
  const rand = lcg(seed);
  const first = createGame({ players: NAMES.slice(0, n), seed }).state;
  let s: GameState = first;
  let captures = 0;
  for (let i = 0; i < 80_000 && s.phase !== 'finished'; i++) {
    const p = awaitedPlayers(s)[0];
    const r = applyAction(s, p, botAction(s, p, rand, 'play')!);
    captures += r.events.filter((e) => e.type === 'territoryCaptured').length;
    s = r.state;
  }
  return { first, last: s, captures };
}

describe('Mumbai map (experimental)', () => {
  it('is a well-formed map', () => {
    for (const [name, map] of MAPS.slice(1)) {
      loadMap(map);
      expect(validateMap(), name).toEqual([]);
    }
    loadMap(MUMBAI);
    expect(TERRITORY_IDS).toHaveLength(43);
    loadMap(BASE_MAP);
  });

  it.runIf(process.env.MUMBAI)('comparison with India', () => {
    const games = Number(process.env.MUMBAI) || 300;
    for (const [name, map] of MAPS) {
      loadMap(map);
      const sh = shape();
      console.log(`\n=== ${name}: ${sh.territories} territories, ${sh.links} links (${sh.perTerritory} per territory), ${sh.deadEnds} dead ends, ${sh.diameter} steps end to end, win at ${samrajyaTarget()}`);
      for (const n of [2, 3, 4, 6]) {
        const wins: Record<string, number> = Object.fromEntries(REGIONS.map((r) => [r.id, 0]));
        const rounds: number[] = [];
        let captures = 0;
        let firstSeat = 0;
        let unfinished = 0;
        for (let g = 0; g < games; g++) {
          const { first, last, captures: c } = play(n, g * 7919 + n);
          if (last.phase !== 'finished') {
            unfinished++;
            continue;
          }
          rounds.push(last.round);
          captures += c;
          if (last.winner === last.turnOrder[0]) firstSeat++;
          for (const r of REGIONS) {
            const counts = first.turnOrder.map((p) => r.territories.filter((t) => first.territories[t].owner === p).length);
            if (first.turnOrder[counts.indexOf(Math.max(...counts))] === last.winner) wins[r.id]++;
          }
        }
        rounds.sort((a, b) => a - b);
        const done = rounds.length;
        const total = rounds.reduce((a, b) => a + b, 0);
        const pct = (w: number) => `${((100 * w) / done).toFixed(0)}%`;
        console.log(
          `${n}p | rounds avg ${(total / done).toFixed(1).padStart(5)} median ${String(rounds[Math.floor(done / 2)]).padStart(2)} p90 ${String(rounds[Math.floor(done * 0.9)]).padStart(2)} | turns ${(total * n / done).toFixed(0).padStart(3)} | captures/round ${(captures / total).toFixed(1).padStart(4)} | first seat ${pct(firstSeat).padStart(3)} (fair ${(100 / n).toFixed(0)}%) | best-placed starter wins: ${REGIONS.map((r) => `${r.id} ${pct(wins[r.id])}`).join(', ')}${unfinished ? ` | ${unfinished} unfinished` : ''}`,
        );
      }
    }
    loadMap(BASE_MAP);
  }, 3_600_000);
});
