import { describe, expect, it } from 'vitest';
import { applyAction, awaitedPlayers, botAction, createGame, isMonsoon, neighbors, territoriesOf } from '../src';
import type { Action, GameState, PlayerId, RewardChoice, RewardRules } from '../src';
import { NAMES, board, lcg } from './helpers';

/**
 * Experiment: a choice of reward (card, fort, cannon or goal) instead of an automatic card.
 *   REWARDS=400 npx vitest run rewards --disable-console-intercept
 */
type Pref = RewardChoice | 'mix';
const DEFAULT: RewardRules = { fort: 1, cannon: 1, goal: 5 };

/** How a bot with a given preference spends its reward. */
/** Most forts one player keeps; beyond it they take a card. Infinity means no limit. */
let fortCap = Infinity;

function chooseReward(s: GameState, player: PlayerId, pref: Pref): Action {
  const own = territoriesOf(s, player);
  const seaOpen = !isMonsoon(s);
  const threat = (t: string) => neighbors(t, seaOpen).filter((n) => s.territories[n].owner !== player).reduce((n, f) => n + s.territories[f].armies, 0);
  const fortSite = () => {
    const free = own.filter((t) => !s.forts!.includes(t) && threat(t) > 0);
    const cap = s.players[player].capital;
    if (cap && free.includes(cap)) return cap;
    return free.sort((a, b) => threat(b) - threat(a))[0];
  };
  const cannonSite = () => own.filter((t) => !s.cannons!.includes(t) && threat(t) > 0).sort((a, b) => s.territories[b].armies - s.territories[a].armies)[0];
  const card: Action = { type: 'reward', choice: 'card' };

  let want: RewardChoice = pref === 'mix' ? 'card' : pref;
  if (pref === 'mix') {
    const cap = s.players[player].capital;
    if (cap && own.includes(cap) && !s.forts!.includes(cap) && threat(cap) > 0) want = 'fort';
    else if (!s.players[player].goal) want = 'goal';
    else if (cannonSite() && s.cannons!.filter((t) => own.includes(t)).length < 2) want = 'cannon';
  }
  if (want === 'fort') {
    const t = s.forts!.filter((f) => own.includes(f)).length < fortCap ? fortSite() : undefined;
    return t ? { type: 'reward', choice: 'fort', territory: t } : card;
  }
  if (want === 'cannon') {
    const t = cannonSite();
    return t ? { type: 'reward', choice: 'cannon', territory: t } : card;
  }
  if (want === 'goal') return s.players[player].goal ? card : { type: 'reward', choice: 'goal' };
  return card;
}

interface Tally {
  winner: PlayerId | null;
  order: PlayerId[];
  rounds: number;
  attacks: number;
  captures: number;
  eliminations: number;
  goalsMet: number;
  finished: boolean;
}

function play(n: number, seed: number, rules: RewardRules | undefined, prefOf: (seat: number) => Pref): Tally {
  const rand = lcg(seed);
  let s: GameState = createGame({ players: NAMES.slice(0, n), seed, rewards: rules }).state;
  const tally: Tally = { winner: null, order: s.turnOrder, rounds: 0, attacks: 0, captures: 0, eliminations: 0, goalsMet: 0, finished: false };
  for (let i = 0; i < 60_000 && s.phase !== 'finished'; i++) {
    const p = awaitedPlayers(s)[0];
    const action = s.phase === 'reward' ? chooseReward(s, p, prefOf(s.turnOrder.indexOf(p))) : botAction(s, p, rand, 'play')!;
    if (action.type === 'attack') tally.attacks++;
    const r = applyAction(s, p, action);
    for (const e of r.events) {
      if (e.type === 'territoryCaptured') tally.captures++;
      if (e.type === 'playerEliminated') tally.eliminations++;
      if (e.type === 'goalMet') tally.goalsMet++;
    }
    s = r.state;
  }
  tally.winner = s.winner;
  tally.rounds = s.round;
  tally.finished = s.phase === 'finished';
  return tally;
}

describe('reward choice (experimental)', () => {
  it('a fort lifts the defender and a cannon the attacker', () => {
    const lossRate = (mod: 'none' | 'fort' | 'cannon') => {
      let attacker = 0;
      let defender = 0;
      for (let seed = 0; seed < 2000; seed++) {
        const { s, me } = board({ DEL: 10 }, { foeArmies: 5 });
        s.rng = seed;
        s.rewards = DEFAULT;
        s.forts = mod === 'fort' ? ['BRJ'] : [];
        s.cannons = mod === 'cannon' ? ['DEL'] : [];
        const e = applyAction(s, me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 3 }).events[0] as { attackerLost: number; defenderLost: number };
        attacker += e.attackerLost;
        defender += e.defenderLost;
      }
      return defender / (attacker + defender);
    };
    const plain = lossRate('none');
    expect(lossRate('fort')).toBeLessThan(plain - 0.05);
    expect(lossRate('cannon')).toBeGreaterThan(plain + 0.05);
  });

  it('offers the reward instead of a card, and destroys works on capture', () => {
    const { s, me, foe } = board({ DEL: 30 }, { phase: 'fortify' });
    s.rewards = DEFAULT;
    s.forts = ['BRJ'];
    s.cannons = [];
    s.conqueredThisTurn = true;
    let r = applyAction(s, me, { type: 'endPhase' }).state;
    expect(r.phase).toBe('reward');
    expect(r.players[me].cards).toHaveLength(0);
    r = applyAction(r, me, { type: 'reward', choice: 'cannon', territory: 'DEL' }).state;
    expect(r.cannons).toEqual(['DEL']);
    expect(r.turnOrder[r.turnIndex]).toBe(foe);

    const fight = board({ DEL: 60 });
    fight.s.rewards = DEFAULT;
    fight.s.forts = ['BRJ'];
    fight.s.cannons = [];
    const after = applyAction(fight.s, fight.me, { type: 'attack', from: 'DEL', to: 'BRJ', dice: 3, blitz: true }).state;
    if (after.territories.BRJ.owner === fight.me) expect(after.forts).toEqual([]);
  });

  it.runIf(process.env.REWARDS)('simulation', () => {
    const games = Number(process.env.REWARDS) || 300;
    const pct = (x: number, of: number) => `${((100 * x) / of).toFixed(0)}%`;
    const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);

    console.log('\n=== 1. Everyone makes the same choice');
    for (const n of [3, 4, 6]) {
      for (const pref of ['card', 'fort', 'cannon', 'goal', 'mix'] as Pref[]) {
        const runs = Array.from({ length: games }, (_, g) => play(n, g * 7919 + n, DEFAULT, () => pref));
        const done = runs.filter((r) => r.finished);
        const rounds = sorted(done.map((r) => r.rounds));
        const sum = (f: (r: Tally) => number) => done.reduce((a, r) => a + f(r), 0);
        console.log(
          `${n}p all-${pref.padEnd(6)} | rounds avg ${(sum((r) => r.rounds) / done.length).toFixed(1).padStart(5)} p90 ${String(rounds[Math.floor(done.length * 0.9)]).padStart(3)} | unfinished ${games - done.length} | attacks won ${pct(sum((r) => r.captures), sum((r) => r.attacks))} | captures/round ${(sum((r) => r.captures) / sum((r) => r.rounds)).toFixed(1)} | first seat wins ${pct(done.filter((r) => r.winner === r.order[0]).length, done.length)}${pref === 'goal' || pref === 'mix' ? ` | goals met/game ${(sum((r) => r.goalsMet) / done.length).toFixed(1)}` : ''}`,
        );
      }
    }

    console.log('\n=== 1b. Everyone builds forts, with a limit on forts per player');
    for (const cap of [1, 2, 3]) {
      fortCap = cap;
      for (const n of [4, 6]) {
        const done = Array.from({ length: games }, (_, g) => play(n, g * 7919 + n, DEFAULT, () => 'fort')).filter((r) => r.finished);
        const rounds = sorted(done.map((r) => r.rounds));
        console.log(`${n}p forts capped at ${cap} | rounds avg ${(done.reduce((a, r) => a + r.rounds, 0) / done.length).toFixed(1)} p90 ${rounds[Math.floor(done.length * 0.9)]}`);
      }
    }
    fortCap = Infinity;
    if (process.env.REWARDS_ONLY === 'caps') return;

    console.log('\n=== 2. One player of each kind at a four-player table (fair share 25%)');
    const kinds: Pref[] = ['card', 'fort', 'cannon', 'goal'];
    const table = (label: string, rules: RewardRules, who: Pref[] = kinds) => {
      const wins: Record<string, number> = Object.fromEntries(who.map((k) => [k, 0]));
      let finished = 0;
      let rounds = 0;
      for (let g = 0; g < games; g++) {
        // Rotate who sits where, so no kind benefits from seat order.
        const r = play(4, g * 104729 + 17, rules, (seat) => who[(seat + g) % who.length]);
        if (!r.finished) continue;
        finished++;
        rounds += r.rounds;
        wins[who[(r.order.indexOf(r.winner!) + g) % who.length]]++;
      }
      console.log(`${label.padEnd(34)} | ${who.map((k) => `${k} ${pct(wins[k], finished).padStart(4)}`).join('  ')} | rounds ${(rounds / finished).toFixed(1)}`);
    };
    table('fort +1, cannon +1, goal 5', DEFAULT);
    table('goal 3', { ...DEFAULT, goal: 3 });
    table('goal 8', { ...DEFAULT, goal: 8 });
    table('fort +2', { ...DEFAULT, fort: 2 });
    table('cannon +2', { ...DEFAULT, cannon: 2 });
    table('fort +2, cannon +2', { ...DEFAULT, fort: 2, cannon: 2 });

    console.log('\n=== 3. A player who mixes rewards against three who only take cards (fair share 25%)');
    table('mix vs cards', DEFAULT, ['mix', 'card', 'card', 'card']);
  }, 3_600_000);
});
