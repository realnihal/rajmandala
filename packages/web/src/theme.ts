/** One line colour per region; the land itself is always the colour of whoever holds it. */
export const REGION_LINE: Record<string, string> = {
  north: '#1f4e8c',
  gangetic: '#b08900',
  west: '#b3420f',
  central: '#2f6b1c',
  south: '#8a2a74',
  northeast: '#0f7265',
  // Mumbai
  western: '#b3420f',
  eastern: '#0f7265',
};
export const OUTPOST_LINE = '#55617a';

/**
 * The colours players choose from. The first six are the colour-blind-safe Okabe–Ito set;
 * violet and olive are added so there is still a choice at a full table.
 */
export const PLAYER_COLORS: { name: string; fill: string; text: string }[] = [
  { name: 'Blue', fill: '#0072b2', text: '#ffffff' },
  { name: 'Vermilion', fill: '#d55e00', text: '#ffffff' },
  { name: 'Green', fill: '#009e73', text: '#ffffff' },
  { name: 'Pink', fill: '#cc79a7', text: '#1d1a17' },
  { name: 'Orange', fill: '#e69f00', text: '#1d1a17' },
  { name: 'Sky', fill: '#56b4e9', text: '#1d1a17' },
  { name: 'Violet', fill: '#6f4aa5', text: '#ffffff' },
  { name: 'Olive', fill: '#8f8a1c', text: '#ffffff' },
];
/** A player's colour: the one they chose, or the one their seat has always had. */
export function colorIndex(colors: Record<string, number> | undefined, player: string): number {
  return colors?.[player] ?? Number(player.slice(1)) - 1;
}
export const NEUTRAL_COLOR = { fill: '#9a948b', text: '#ffffff' };

/** Hand adjustments to where a territory's army token and name sit, in board pixels. */
export const TOKEN_NUDGE: Record<string, { dx?: number; dy?: number; labelDy?: number; labelDx?: number }> = {
  HAR: { dx: -17, dy: -10 }, // clear of the Delhi token
  CAP: { labelDy: -17 }, // name above the token, clear of Rayalaseema's
  TRI: { labelDx: -14 },
  MIZ: { labelDx: 14 },
  NBN: { dx: 7, dy: 5 },
  SIK: { labelDy: -17 }, // name above the token, clear of North Bengal just below
};
