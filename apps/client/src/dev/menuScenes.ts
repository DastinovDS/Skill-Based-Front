/**
 * The screens before a match as dev scenes (`/?menu=<id>`, #471): the real components with fixed
 * data and no server, so `mise run shots` can show every state of the start menu (the reference
 * test of the map does not cover them). The list is shared with `visual/scenes.ts`;
 * `sceneList.test.ts` keeps the two in step.
 */
import type { QueueStatus } from '../api/http.ts';
import type { Calibration } from '../protocol.gen.ts';

export const MENU_SCENE_IDS = [
  'welcome',
  'welcome-notice',
  'menu-guest',
  'menu-calibration',
  'menu-ranked',
  'menu-resume',
  'menu-banned',
  'menu-error',
  'queue-search',
  'queue-long',
  'queue-found',
  'queue-confirmed',
] as const;

export type MenuSceneId = (typeof MENU_SCENE_IDS)[number];

export function isMenuScene(id: string | null): id is MenuSceneId {
  return MENU_SCENE_IDS.some((known) => known === id);
}

export const CALIBRATION: Calibration = { played: 2, total: 5 };
/** The ban of the `menu-banned` scene: 4:47 left, frozen (the scene clock does not move). */
export const BAN_SECONDS = 287;

const searching: QueueStatus = {
  state: 'searching',
  waited_s: 14,
  queue_size: 1,
  bot_offer: false,
  you_confirmed: false,
  opponent_confirmed: false,
};

export const QUEUE_SCENES: Readonly<Record<string, QueueStatus>> = {
  'queue-search': searching,
  'queue-long': { ...searching, waited_s: 62, bot_offer: true },
  'queue-found': {
    ...searching,
    state: 'found',
    opponent_nick: 'Vega',
    confirm_in_s: 10.4,
  },
  'queue-confirmed': {
    ...searching,
    state: 'found',
    opponent_nick: 'Vega',
    confirm_in_s: 5.2,
    you_confirmed: true,
  },
};
