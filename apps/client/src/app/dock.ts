/**
 * What the "Dock" screens (lobby, invite, bot; #473, variant D of docs/design/mockups/lobby-invite-bot.html)
 * need from the app besides their own data: who the player is, the queue lock, the pool maps and
 * the way to the other modes. One object, built once in RootApp, so each screen takes one prop.
 */
import type { Calibration, MapFile } from '../protocol.gen.ts';
import type { MapCache } from './mapCache.svelte.ts';

/** The three modes of the rail; the screen that is open marks its own row. */
export type DockMode = 'bot' | 'friend' | 'lobby';

export interface DockContext {
  nick: string;
  hasPassword: boolean;
  /** Calibration progress of the account (DEC-34), null for a guest or once it is over. */
  calibration: Calibration | null;
  /** The queue is locked until this time (ms since the epoch), or null (DEC-34). */
  banUntil: number | null;
  /** The clock of the ban countdown; tests pass their own. */
  now?: () => number;
  /** The pool map drawn behind the screen (null: the plain dark page). */
  map: MapFile | null;
  /** The pool: the list for the choice and the files for the thumbnails. */
  maps: MapCache;
  /** The rail: "Play a bot", "Invite a friend", "Open matches" and the way back to the menu. */
  onbot: () => void;
  oncreate: () => void;
  onlobby: () => void;
  onmenu: () => void;
  onpassword: () => void;
  onlogout: () => void;
}
