/**
 * Seeded random numbers (mulberry32). The generator's whole state is one
 * unsigned 32-bit integer kept on the game state, so a game is fully
 * reproducible from its seed and its action log.
 */
export interface HasRng {
  rng: number;
}

/** Advances the generator and returns a float in [0, 1). */
export function rand(s: HasRng): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function rollDie(s: HasRng): number {
  return Math.floor(rand(s) * 6) + 1;
}

/** Fisher–Yates shuffle; returns a new array. */
export function shuffle<T>(s: HasRng, items: readonly T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
