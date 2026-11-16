import type { TerritoryId } from './map';

export type PlayerId = string;
export type Owner = PlayerId | 'neutral';
/** A territory id, or 'RATHA1' / 'RATHA2' for the two wild cards. */
export type CardId = string;
export type VictoryMode = 'samrajya' | 'digvijaya' | 'capitals';

export type Phase =
  | 'setup-capital' // every player secretly picks a capital
  | 'setup-place' // every player secretly places starting armies
  | 'reinforce'
  | 'attack'
  | 'occupy' // attacker must move armies into a territory just captured
  | 'fortify'
  | 'reward' // experimental: the player chooses what they earned for capturing this turn
  | 'finished';

export interface PlayerState {
  id: PlayerId;
  cards: CardId[];
  capital: TerritoryId | null;
  alive: boolean;
  /** Armies still to be placed during setup. */
  setupArmies: number;
  /** Submitted but not yet revealed setup placement. */
  setupPlacement: Record<TerritoryId, number> | null;
  /** True once the seat has been surrendered. */
  surrendered: boolean;
  /** Experimental: a territory to capture for a one-off army bonus. */
  goal?: { target: TerritoryId; bonus: number } | null;
}

/**
 * Experimental rule set: instead of always drawing a card for capturing a territory,
 * the player chooses one reward. Present only in games created with `rewards`.
 */
export interface RewardRules {
  /** Added to the defender's best die in a territory with a fort. */
  fort: number;
  /** Added to the attacker's best die when attacking out of a territory with a cannon. */
  cannon: number;
  /** Armies for completing a goal. */
  goal: number;
}
export type RewardChoice = 'card' | 'fort' | 'cannon' | 'goal';

export interface TerritoryState {
  owner: Owner;
  armies: number;
}

export interface PendingOccupy {
  from: TerritoryId;
  to: TerritoryId;
  /** Minimum armies that must move in: the dice rolled in the winning roll. */
  min: number;
  /** Bonus armies added on arrival for capturing a capital from its owner. */
  capitalBonus: number;
}

export interface GameState {
  rulesVersion: number;
  victory: VictoryMode;
  phase: Phase;
  /** 0 during setup; the first round is 1. Every fourth round is a Monsoon. */
  round: number;
  turnOrder: PlayerId[];
  turnIndex: number;
  players: Record<PlayerId, PlayerState>;
  territories: Record<TerritoryId, TerritoryState>;
  pendingReinforcements: number;
  pendingOccupy: PendingOccupy | null;
  conqueredThisTurn: boolean;
  deck: CardId[];
  discard: CardId[];
  winner: PlayerId | null;
  /** RNG state. Server-only; never sent to clients. */
  rng: number;
  /** Experimental reward-choice rules; absent in a normal game. */
  rewards?: RewardRules;
  forts?: TerritoryId[];
  cannons?: TerritoryId[];
}

/** The public part of a game that both the full state and a player's view have. */
export interface BoardLike {
  round: number;
  turnOrder: PlayerId[];
  turnIndex: number;
  territories: Record<TerritoryId, TerritoryState>;
  players: Record<PlayerId, { capital: TerritoryId | null }>;
}

export type Action =
  | { type: 'chooseCapital'; territory: TerritoryId }
  | { type: 'setupPlace'; placements: Record<TerritoryId, number> }
  | { type: 'place'; territory: TerritoryId; armies: number }
  | { type: 'trade'; cards: [CardId, CardId, CardId] }
  | { type: 'attack'; from: TerritoryId; to: TerritoryId; dice: number; blitz?: boolean }
  | { type: 'occupy'; armies: number }
  | { type: 'fortify'; from: TerritoryId; to: TerritoryId; armies: number }
  | { type: 'endPhase' }
  /** Experimental. `territory` is where a fort or cannon goes. */
  | { type: 'reward'; choice: RewardChoice; territory?: TerritoryId }
  | { type: 'surrender' };

export type GameEvent =
  | { type: 'gameCreated'; turnOrder: PlayerId[] }
  | { type: 'capitalChosen'; player: PlayerId }
  | { type: 'capitalsRevealed'; capitals: Record<PlayerId, TerritoryId> }
  | { type: 'setupSubmitted'; player: PlayerId }
  | { type: 'setupRevealed' }
  | { type: 'roundStarted'; round: number; monsoon: boolean; monsoonNext: boolean }
  | { type: 'turnStarted'; player: PlayerId; reinforcements: number }
  | { type: 'phaseChanged'; phase: Phase }
  | { type: 'armiesPlaced'; player: PlayerId; territory: TerritoryId; armies: number }
  | { type: 'cardsTraded'; player: PlayerId; cards: CardId[]; armies: number; bonusTerritories: TerritoryId[] }
  | {
      type: 'diceRolled';
      from: TerritoryId;
      to: TerritoryId;
      attack: number[];
      defence: number[];
      rerolled: boolean;
      attackerLost: number;
      defenderLost: number;
    }
  | { type: 'territoryCaptured'; territory: TerritoryId; by: PlayerId; from: Owner; capital: boolean }
  | { type: 'territoryOccupied'; from: TerritoryId; to: TerritoryId; armies: number; capitalBonus: number }
  | { type: 'playerEliminated'; player: PlayerId; by: PlayerId; cardsTaken: number }
  | { type: 'playerSurrendered'; player: PlayerId }
  | { type: 'fortified'; from: TerritoryId; to: TerritoryId; armies: number }
  | { type: 'cardDrawn'; player: PlayerId; card: CardId }
  | { type: 'rewardTaken'; player: PlayerId; choice: RewardChoice; territory?: TerritoryId }
  | { type: 'goalMet'; player: PlayerId; territory: TerritoryId; armies: number }
  | { type: 'gameWon'; player: PlayerId; mode: VictoryMode | 'last-standing' };

export interface Result {
  state: GameState;
  events: GameEvent[];
}

export type RuleErrorCode =
  | 'game-over'
  | 'unknown-player'
  | 'not-your-turn'
  | 'wrong-phase'
  | 'invalid-action'
  | 'not-owner'
  | 'not-adjacent'
  | 'not-connected'
  | 'too-few-armies'
  | 'too-many-dice'
  | 'must-trade'
  | 'must-place'
  | 'invalid-set';

/** Thrown when an action breaks a rule. The state passed in is never modified. */
export class RuleError extends Error {
  constructor(
    public code: RuleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuleError';
  }
}
