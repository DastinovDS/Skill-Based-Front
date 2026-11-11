/**
 * The screens before a match as dev scenes (`/?menu=<id>`, #471): the real components with fixed
 * data and no server, so `mise run shots` can show every state of the start menu (the reference
 * test of the map does not cover them). The list is shared with `visual/scenes.ts`;
 * `sceneList.test.ts` keeps the two in step.
 */
import type { QueueStatus } from '../api/http.ts';
import type { MatchEndMsg, UnratedReason } from '../protocol.gen.ts';
import type { MatchSummary } from '../app/matchSummary.ts';
import { BOARD_SCENE_IDS } from './boardScenes.ts';

/**
 * The main screen of III Plinth (#919, `DevPlay.svelte`): the real screen with a fake API. A scene
 * that needs a click to reach its state (a start that waits or fails, a link being made) is
 * clicked by `visual/shots.spec.ts`; the table `DOCK_CLICKS` of `visual/scenes.ts` says which.
 */
const PLAY_SCENE_IDS = [
  'menu-guest',
  'menu-account',
  'menu-resume',
  'menu-banned',
  'menu-error',
  'menu-bot',
  'menu-friend',
  'queue-search',
  'queue-long',
  'queue-found',
  'queue-confirmed',
  'queue-drawing',
  'bot-starting',
  'bot-random',
  'bot-error',
  'bot-timeout',
  'invite-creating',
  'invite-link',
  'invite-waiting',
  'invite-joined',
  'invite-opp-ready',
  'invite-you-ready',
  'invite-starting',
  'invite-drawing-start',
] as const;

export const MENU_SCENE_IDS = [
  'welcome',
  'welcome-notice',
  'welcome-invited',
  'welcome-intro',
  ...PLAY_SCENE_IDS,
  'password-set',
  'password-change',
  'howto',
  'result-guest',
  'result-defeat',
  'result-draw',
  'result-forfeit',
  'result-disconnect',
  'result-rated',
  'boot',
  'exit-dialog',
  'match-loading-map',
  'match-loading-connect',
  'match-loading-frame',
  'match-error-map',
  'crash',
  ...BOARD_SCENE_IDS,
  // The style foundation (#841): the specimen of the tokens and primitives, the stone overlay.
  'style',
  'style-overlay',
] as const;

export type MenuSceneId = (typeof MENU_SCENE_IDS)[number];

export function isMenuScene(id: string | null): id is MenuSceneId {
  return MENU_SCENE_IDS.some((known) => known === id);
}

export function isPlayScene(id: string): boolean {
  return PLAY_SCENE_IDS.some((known) => known === id);
}

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
  // Both confirmed, the server draws the map of the pair (GOW_QUEUE_MAPS=generated, #926).
  'queue-drawing': {
    ...searching,
    state: 'found',
    opponent_nick: 'Vega',
    confirm_in_s: 0,
    you_confirmed: true,
    opponent_confirmed: true,
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
  stats: {
    units_killed: 19,
    units_lost: 14,
    cities_captured: 5,
    provinces_captured: 3,
    attacks: 7,
    attacks_won: 4,
    defenses: 3,
    defenses_held: 2,
  },
};

const unrated = (reason: UnratedReason): MatchEndMsg => ({
  ...ended,
  unrated_reason: reason,
});

/** The result screens of DEC-34 (`?menu=result-*`): why a match did not change the rating. */
export const RESULT_SCENES: Readonly<Record<string, MatchEndMsg>> = {
  'result-guest': unrated('guest'),
  // The outcomes and reasons of the result screen (#593): the scenes play as player 0.
  'result-defeat': { ...ended, reason: 'capital_captured', winner: 1, vp: [5, 11] },
  'result-draw': { ...ended, reason: 'double_defeat', winner: null, vp: [8, 8] },
  'result-forfeit': { ...ended, reason: 'forfeit', vp: [4, 6] },
  'result-disconnect': { ...ended, reason: 'disconnect', winner: 1, vp: [7, 3] },
  'result-rated': { ...ended, rated: true, rating: { before: 1466, after: 1480 } },
};

/** What the client knows of its own side at the end of the result scenes (#596). */
export const RESULT_SUMMARY: MatchSummary = {
  nicks: { mine: 'Ember', enemy: 'Marta' },
};
