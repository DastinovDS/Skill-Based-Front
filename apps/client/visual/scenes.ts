// The dev scenes the screenshot tools open (`/?scene=<id>`), each with the tick it is frozen at
// (src/dev/scenarios.ts). Shared by the reference test (scenes.spec.ts) and `mise run shots`
// (shots.spec.ts); src/dev/sceneList.test.ts fails when a scene of scenarios.ts is missing here.
export const SCENES: readonly {
  readonly id: string;
  readonly tick: number;
  /** Keys the player presses before the frame is taken (`terrain`: `T` opens the terrain mode). */
  readonly keys?: readonly string[];
}[] = [
  { id: 'snapshot', tick: 120 },
  { id: 'snapshot_fog', tick: 300 },
  { id: 'fog_road', tick: 300 },
  { id: 'snapshot_clash', tick: 400 },
  { id: 'overflow', tick: 120 },
  { id: 'ranges', tick: 600 },
  { id: 'fights', tick: 400 },
  { id: 'fights_colours', tick: 400 },
  { id: 'fights_kill', tick: 395 },
  { id: 'fights_flight', tick: 398 },
  { id: 'fights_burn', tick: 400 },
  { id: 'walk_fight', tick: 400 },
  { id: 'walk_pair', tick: 400 },
  { id: 'walk_capture', tick: 400 },
  { id: 'artery', tick: 2400 },
  { id: 'artery_colours', tick: 2400 },
  { id: 'badges', tick: 2400 },
  { id: 'provinces', tick: 1200 },
  { id: 'shoulder', tick: 2400 },
  { id: 'shoulder_far', tick: 2400 },
  { id: 'progress', tick: 2400 },
  { id: 'figures', tick: 2400 },
  { id: 'orders', tick: 2400 },
  { id: 'group_select', tick: 2400 },
  { id: 'group_plan', tick: 2400 },
  { id: 'group_order', tick: 2400 },
  { id: 'rally_due', tick: 2580 },
  { id: 'terrain', tick: 2400, keys: ['KeyT'] },
  { id: 'economy', tick: 2400 },
  { id: 'build_pay', tick: 2400 },
  { id: 'flow', tick: 2400 },
  { id: 'stances', tick: 2400 },
  { id: 'forts', tick: 2400 },
  { id: 'forts_toll', tick: 2400 },
  { id: 'forts_geo', tick: 1200 },
];

/**
 * The screens before a match (`/?menu=<id>`, src/dev/menuScenes.ts, #471): shot by `mise run shots`
 * as `screen-<id>.png` (and in grey scale); they have no reference screenshots.
 */
export const MENU_SCENES = [
  'welcome',
  'welcome-notice',
  'welcome-invited',
  'welcome-intro',
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
  'profile',
  'profile-guest',
  'profile-long',
  'profile-empty',
  'profile-loading',
  'profile-network',
  'profile-nick',
  'settings',
  'settings-guest',
  'style',
  'style-overlay',
] as const;

/**
 * The main-screen scenes (#919) that need clicks to reach their state: the names of the buttons
 * to press in order (a start that waits or fails, a random map, a link being made).
 */
export const DOCK_CLICKS: Readonly<Record<string, readonly string[]>> = {
  'bot-starting': ['Start'],
  'bot-random': ['Random map', 'Start'],
  'bot-error': ['Start'],
  'bot-timeout': ['Start'],
  'invite-creating': ['Get the link'],
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
  'renderer',
] as const;
