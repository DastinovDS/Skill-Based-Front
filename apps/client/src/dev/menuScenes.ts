/**
 * The screens before a match as dev scenes (`/?menu=<id>`, #471): the real components with fixed
 * data and no server, so `mise run shots` can show every state of the start menu (the reference
 * test of the map does not cover them). The list is shared with `visual/scenes.ts`;
 * `sceneList.test.ts` keeps the two in step.
 */
import type { QueueStatus } from '../api/http.ts';
import type { Calibration, MatchEndMsg, UnratedReason } from '../protocol.gen.ts';
import type { MatchSummary } from '../app/matchSummary.ts';
import { BOARD_SCENE_IDS } from './boardScenes.ts';

/**
 * The Dock screens (lobby, invite, bot; #473, `DevDock.svelte`): the real screens with a fake API.
 * A scene that needs a click to reach its state (joining, a failed create) is clicked by
 * `visual/shots.spec.ts`; the table `DOCK_ACTIONS` says which button.
 */
export const DOCK_SCENE_IDS = [
  'lobby-list',
  'lobby-many',
  'lobby-loading',
  'lobby-empty',
  'lobby-joining',
  'lobby-taken',
  'lobby-network',
  'lobby-guest',
  'lobby-banned',
  'create-private',
  'create-public',
  'create-nomaps',
  'create-error',
  'invite-link',
  'invite-public',
  'invite-joined',
  'invite-opp-ready',
  'invite-you-ready',
  'invite-starting',
  'invite-banned',
  'bot-choose',
  'bot-rated',
  'bot-starting',
  'bot-error',
  'password-set',
  'password-change',
  'howto',
] as const;

export const MENU_SCENE_IDS = [
  'welcome',
  'welcome-notice',
  'welcome-invited',
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
  ...DOCK_SCENE_IDS,
  'result-guest',
  'result-calibration',
  'result-limit',
  'result-defeat',
  'result-draw',
  'result-forfeit',
  'result-disconnect',
  'result-rated',
  'boot',
  'exit-rated',
  'match-loading-map',
  'match-loading-connect',
  'match-loading-frame',
  'match-error-map',
  'crash',
  ...BOARD_SCENE_IDS,
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

const ended: MatchEndMsg = {
  type: 'match_end',
  tick: 6000,
  reason: 'timer',
  winner: 0,
  vp: [9, 7],
  rating: null,
  rated: false,
  unrated_reason: null,
  calibration: null,
  stats: { units_lost: 14, charges_delivered: 236 },
};

const unrated = (reason: UnratedReason): MatchEndMsg => ({
  ...ended,
  unrated_reason: reason,
});

/** The result screens of DEC-34 (`?menu=result-*`): why a match did not change the rating. */
export const RESULT_SCENES: Readonly<Record<string, MatchEndMsg>> = {
  'result-guest': unrated('guest'),
  'result-calibration': { ...ended, rated: true, calibration: { played: 3, total: 5 } },
  'result-limit': unrated('opponent_limit'),
  // The outcomes and reasons of the result screen (#593): the scenes play as player 0.
  'result-defeat': { ...ended, reason: 'capital_captured', winner: 1, vp: [5, 11] },
  'result-draw': { ...ended, reason: 'double_defeat', winner: null, vp: [8, 8] },
  'result-forfeit': { ...ended, reason: 'forfeit', vp: [4, 6] },
  'result-disconnect': { ...ended, reason: 'disconnect', winner: 1, vp: [7, 3] },
  'result-rated': { ...ended, rated: true, rating: { before: 1466, after: 1480 } },
};

/** What the client knows of its own side at the end of the result scenes (#596). */
export const RESULT_SUMMARY: MatchSummary = {
  nicks: { mine: 'Danya', enemy: 'Marta' },
  cities: 4,
  vpPeak: 9,
};

export function isDockScene(id: string): boolean {
  return DOCK_SCENE_IDS.some((known) => known === id);
}
