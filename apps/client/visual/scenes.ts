// The dev scenes the screenshot tools open (`/?scene=<id>`), each with the tick it is frozen at
// (src/dev/scenarios.ts). Shared by the reference test (scenes.spec.ts) and `mise run shots`
// (shots.spec.ts); src/dev/sceneList.test.ts fails when a scene of scenarios.ts is missing here.
export const SCENES = [
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
] as const;

/**
 * The screens before a match (`/?menu=<id>`, src/dev/menuScenes.ts, #471): shot by `mise run shots`
 * as `menu-<id>.png` (and in grey scale); they have no reference screenshots.
 */
export const MENU_SCENES = [
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
  'result-guest',
  'result-calibration',
  'result-limit',
  'exit-rated',
] as const;
