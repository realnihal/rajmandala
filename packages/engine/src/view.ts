import type { TerritoryId } from './map';
import type { CardId, GameState, PlayerId, PlayerState } from './types';

export interface PlayerView extends Omit<PlayerState, 'cards' | 'setupPlacement'> {
  /** The viewer's own hand; null for everyone else. */
  cards: CardId[] | null;
  cardCount: number;
  /** True once this player has picked a capital, even while the choice itself is hidden. */
  capitalChosen: boolean;
  setupSubmitted: boolean;
  setupPlacement: Record<TerritoryId, number> | null;
}

export interface GameView extends Omit<GameState, 'rng' | 'deck' | 'players'> {
  deckCount: number;
  players: Record<PlayerId, PlayerView>;
}

/**
 * What one player (or a spectator, with `viewer` null) is allowed to see.
 * Hidden: the RNG state, the deck order, other players' hands, and other
 * players' capital and starting placement until they are revealed.
 * `revealAll` shows every hand and choice, for players sharing one screen.
 */
export function viewFor(state: GameState, viewer: PlayerId | null, opts: { revealAll?: boolean } = {}): GameView {
  const { rng: _rng, deck, players, ...rest } = JSON.parse(JSON.stringify(state)) as GameState;
  const views: Record<PlayerId, PlayerView> = {};
  for (const p of Object.values(players)) {
    const own = p.id === viewer || opts.revealAll === true;
    views[p.id] = {
      ...p,
      cards: own ? p.cards : null,
      cardCount: p.cards.length,
      capital: own || state.phase !== 'setup-capital' ? p.capital : null,
      capitalChosen: p.capital !== null,
      setupSubmitted: p.setupPlacement !== null,
      setupPlacement: own ? p.setupPlacement : null,
    };
  }
  return { ...rest, deckCount: deck.length, players: views };
}
