// The dev scenes the screenshot tools open (`/?scene=<id>`), each with the tick it is frozen at
// (src/dev/scenarios.ts). Shared by the reference test (scenes.spec.ts) and `mise run shots`
// (shots.spec.ts); src/dev/sceneList.test.ts fails when a scene of scenarios.ts is missing here.
export const SCENES: readonly {
  readonly id: string;
  readonly tick: number;
  /** Keys the player presses before the frame is taken (`supply`: Tab opens the «Supply» view). */
  readonly keys?: readonly string[];
}[] = [
  { id: 'snapshot', tick: 120 },
  { id: 'snapshot_fog', tick: 300 },
  { id: 'fog_road', tick: 300 },
  { id: 'snapshot_clash', tick: 400 },
  { id: 'overflow', tick: 120 },
  { id: 'ranges', tick: 600 },
  { id: 'fights', tick: 400 },
  { id: 'fights_kill', tick: 395 },
  { id: 'fights_flight', tick: 398 },
  { id: 'artery', tick: 2400 },
  { id: 'provinces', tick: 1200 },
  { id: 'progress', tick: 2400 },
  { id: 'defense', tick: 2400 },
  { id: 'figures', tick: 2400 },
  { id: 'orders', tick: 2400 },
  { id: 'supply', tick: 2400, keys: ['Tab'] },
  { id: 'terrain', tick: 2400, keys: ['KeyT'] },
  { id: 'economy', tick: 2400 },
  { id: 'economy_supply', tick: 2400, keys: ['Tab'] },
];

/**
 * The screens before a match (`/?menu=<id>`, src/dev/menuScenes.ts, #471): shot by `mise run shots`
 * as `menu-<id>.png` (and in grey scale); they have no reference screenshots.
 */
export const MENU_SCENES = [
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
  'board-guest',
  'board-calibration',
  'board-ranked',
  'board-far',
  'board-empty',
  'board-loading',
  'board-network',
  'board-limited',
  'replays',
  'replays-guest',
  'replays-empty',
  'replays-loading',
  'replays-network',
] as const;

/**
 * The Dock scenes (#473) that need a click to reach their state: the name of the button to press
 * (a join that waits or fails, a create that fails, a start that waits or fails).
 */
export const DOCK_CLICKS: Readonly<Record<string, string>> = {
  'lobby-joining': 'Join',
  'lobby-taken': 'Join',
  'create-error': 'Create the match',
  'bot-starting': 'Start',
  'bot-error': 'Start',
};

/**
 * The in-match status bars (`/?scene=overflow&status=<id>`, src/dev/statusScenes.ts, #602): shot by
 * `mise run shots` as `status-<id>.png` (and in grey scale); they have no reference screenshots.
 */
export const STATUS_SCENES = [
  'reconnecting',
  'failed',
  'gone',
  'version',
  'replaced',
  'paused-you',
  'paused-enemy',
  'pause-denied',
  'renderer',
] as const;
