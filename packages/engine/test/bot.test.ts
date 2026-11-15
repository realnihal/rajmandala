import { describe, expect, it } from 'vitest';
import { REGIONS, applyAction, awaitedPlayers, botAction, createGame, currentPlayer, territoriesOf } from '../src';
import type { GameState, VictoryMode } from '../src';
import { NAMES, lcg, started } from './helpers';

/** Plays a whole game with bots in every seat. */
function botGame(n: number, seed: number, victory: VictoryMode = 'samrajya') {
  const rand = lcg(seed);
  let s: GameState = createGame({ players: NAMES.slice(0, n), seed, victory }).state;
  let steps = 0;
  for (; steps < 60_000 && s.phase !== 'finished'; steps++) {
    const player = awaitedPlayers(s)[0];
    const action = botAction(s, player, rand, 'play');
    expect(action).not.toBeNull();
    s = applyAction(s, player, action!).state;
  }
  return { s, steps };
}

describe('bot', () => {
  it.each([2, 3, 4, 5, 6])('finishes a %i-player game against other bots', (n) => {
    const { s } = botGame(n, n * 17);
    expect(s.phase).toBe('finished');
    expect(s.winner).not.toBeNull();
  });

  it('does nothing when the game is not waiting for that player', () => {
    const s = started(3);
    const waiting = s.turnOrder.find((p) => p !== currentPlayer(s))!;
    expect(botAction(s, waiting, Math.random)).toBeNull();
  });

  it("ends a timed-out player's turn without attacking", () => {
    let s = started(4, 9);
    const player = currentPlayer(s);
    const held = territoriesOf(s, player).length;
    const rand = lcg(3);
    let steps = 0;
    for (; currentPlayer(s) === player && steps < 50; steps++) {
      const action = botAction(s, player, rand, 'pass')!;
      expect(action.type).not.toBe('attack');
      s = applyAction(s, player, action).state;
    }
    expect(steps).toBeLessThan(10);
    expect(currentPlayer(s)).not.toBe(player);
    expect(territoriesOf(s, player)).toHaveLength(held);
    expect(s.pendingReinforcements).toBeGreaterThan(0); // the next player's armies, not leftovers
  });

  // Run with: SIM=400 npx vitest run bot   (number of games per table size)
  it.runIf(process.env.SIM)('balance report', () => {
    const games = Number(process.env.SIM) || 200;
    for (const n of [2, 3, 4, 6]) {
      const seatWins = Array(n).fill(0) as number[];
      const regionWins: Record<string, [number, number]> = Object.fromEntries(REGIONS.map((r) => [r.id, [0, 0]]));
      let rounds = 0;
      for (let g = 0; g < games; g++) {
        const first = createGame({ players: NAMES.slice(0, n), seed: g * 7919 + n }).state;
        const { s } = botGame(n, g * 7919 + n);
        seatWins[s.turnOrder.indexOf(s.winner!)]++;
        rounds += s.round;
        // Did starting with the most territory in a region help?
        for (const r of REGIONS) {
          const counts = first.turnOrder.map((p) => r.territories.filter((t) => first.territories[t].owner === p).length);
          const top = first.turnOrder[counts.indexOf(Math.max(...counts))];
          regionWins[r.id][1]++;
          if (top === s.winner) regionWins[r.id][0]++;
        }
      }
      console.log(
        `${n} players, ${games} games: avg ${(rounds / games).toFixed(1)} rounds | wins by seat ${seatWins.map((w) => `${((100 * w) / games).toFixed(0)}%`).join(' ')} (fair ${(100 / n).toFixed(0)}%) | win rate of the best-placed starter per region: ${Object.entries(regionWins).map(([id, [w, t]]) => `${id} ${((100 * w) / t).toFixed(0)}%`).join(', ')}`,
      );
    }
  }, 600_000);
});
