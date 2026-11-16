import type { Action, GameEvent, GameView, MapId, PlayerId, VictoryMode } from '@rajmandala/engine';

/** Bumped whenever a message changes shape; an old client is told to reload. */
export const PROTOCOL_VERSION = 7;

/** How many colours a player can choose from. The colours themselves belong to the screen. */
export const COLOR_COUNT = 8;

export interface RoomOptions {
  victory: VictoryMode;
  /** Seats at the table, 2 to 6. */
  seats: number;
  /** Place starting armies at random once every capital is chosen. */
  autoPlace: boolean;
  /** Seconds a player has for a turn before it is played for them; 0 means no limit. */
  turnSeconds: number;
  /** Which map the game is played on. */
  map: MapId;
}

export const TURN_SECONDS = [0, 60, 180, 86400];

export interface ChatLine {
  from: PlayerId;
  name: string;
  text: string;
  at: number;
}

export type RoomStatus = 'lobby' | 'playing' | 'finished';

export interface MemberView {
  id: PlayerId;
  name: string;
  ready: boolean;
  online: boolean;
  /** True for a computer player, and for a seat a bot is minding for an absent player. */
  bot: boolean;
  /** Which of the colours this player has chosen; no two players in a room share one. */
  color: number;
}

export interface RoomView {
  code: string;
  status: RoomStatus;
  hostId: PlayerId | null;
  options: RoomOptions;
  members: MemberView[];
}

export type ClientMsg =
  | { t: 'hello'; v: number; key: string; name: string }
  | { t: 'rename'; name: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'color'; color: number }
  | { t: 'options'; options: RoomOptions }
  | { t: 'kick'; id: PlayerId }
  | { t: 'addBot' }
  | { t: 'chat'; text: string }
  /** The attack the player is lining up, so others can watch it; nulls when they back out. */
  | { t: 'aim'; from: string | null; to: string | null }
  | { t: 'leave' }
  | { t: 'start' }
  | { t: 'rematch' }
  /** `id` is unique per action, so a resend after a dropped connection is applied only once. */
  | { t: 'action'; id: string; action: Action };

export type ServerMsg =
  | {
      t: 'state';
      /** Increases with every change to the room or the game. */
      seq: number;
      /** The seat this connection controls, or null for a spectator. */
      you: PlayerId | null;
      room: RoomView;
      game: GameView | null;
      /** When the current turn is played automatically (server clock, ms), or null if untimed. */
      deadline: number | null;
      /** The server's clock when this was sent, so the client can correct its own. */
      now: number;
      chat: ChatLine[];
      /** What just happened, for animation and the log. Empty on a resync. */
      events: GameEvent[];
      /** The action this state answers, on the sender's own connection. */
      ack?: string;
    }
  /** Another player is lining up an attack (or has backed out). Not part of the game state. */
  | { t: 'aim'; player: PlayerId; from: string | null; to: string | null }
  | { t: 'error'; code: string; message: string; id?: string };
