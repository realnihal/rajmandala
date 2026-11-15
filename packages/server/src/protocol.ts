import type { Action, GameEvent, GameView, PlayerId, VictoryMode } from '@rajmandala/engine';

/** Bumped whenever a message changes shape; an old client is told to reload. */
export const PROTOCOL_VERSION = 1;

export interface RoomOptions {
  victory: VictoryMode;
  /** Seats at the table, 2 to 6. */
  seats: number;
  /** Place starting armies at random once every capital is chosen. */
  autoPlace: boolean;
}

export type RoomStatus = 'lobby' | 'playing' | 'finished';

export interface MemberView {
  id: PlayerId;
  name: string;
  ready: boolean;
  online: boolean;
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
  | { t: 'options'; options: RoomOptions }
  | { t: 'kick'; id: PlayerId }
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
      /** What just happened, for animation and the log. Empty on a resync. */
      events: GameEvent[];
      /** The action this state answers, on the sender's own connection. */
      ack?: string;
    }
  | { t: 'error'; code: string; message: string; id?: string };
