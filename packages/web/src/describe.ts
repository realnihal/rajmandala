import { territory } from '@rajmandala/engine';
import type { GameEvent } from '@rajmandala/engine';

const PHASE_NAMES: Record<string, string> = {
  'setup-place': 'placing starting armies',
  reinforce: 'reinforce',
  attack: 'attack',
  occupy: 'occupy',
  fortify: 'fortify',
};

/** One line of log text for an event, or null for events not worth showing. */
export function describe(e: GameEvent, name: (id: string) => string): string | null {
  const t = (id: string) => territory(id).name;
  switch (e.type) {
    case 'capitalsRevealed':
      return `Capitals revealed: ${Object.entries(e.capitals)
        .map(([p, c]) => `${name(p)} at ${t(c)}`)
        .join(', ')}.`;
    case 'roundStarted':
      return e.monsoon
        ? `Round ${e.round} — Monsoon. Sea routes and river crossings are closed, and attacks roll fewer dice.`
        : `Round ${e.round}${e.monsoonNext ? ' — Monsoon arrives next round.' : '.'}`;
    case 'turnStarted':
      return `${name(e.player)}'s turn: ${e.reinforcements} armies to place.`;
    case 'cardsTraded':
      return `${name(e.player)} traded a set for ${e.armies} armies${
        e.bonusTerritories.length ? ` (+2 on ${e.bonusTerritories.map(t).join(', ')})` : ''
      }.`;
    case 'territoryCaptured':
      return `${name(e.by)} captured ${t(e.territory)} from ${name(e.from)}${e.capital ? ' — a capital! +3 armies' : ''}.`;
    case 'playerEliminated':
      return `${name(e.player)} was eliminated by ${name(e.by)}${e.cardsTaken ? `, who took ${e.cardsTaken} cards` : ''}.`;
    case 'playerSurrendered':
      return `${name(e.player)} surrendered.`;
    case 'fortified':
      return `Moved ${e.armies} from ${t(e.from)} to ${t(e.to)}.`;
    case 'cardDrawn':
      return `${name(e.player)} drew a card.`;
    case 'gameWon':
      return `${name(e.player)} wins the game.`;
    default:
      return null;
  }
}

export function phaseName(phase: string): string {
  return PHASE_NAMES[phase] ?? phase;
}
