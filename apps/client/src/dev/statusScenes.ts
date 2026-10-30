/**
 * The in-match status bars as dev scenes (#602): `/?scene=<id>&status=<state>` puts the real bar
 * (`MatchStatus`) over a frozen fixture scene, so `mise run shots` shows every state of the
 * connection over the HUD (the alert stack of `overflow` stands above it). `renderer` is the
 * notice of a map that could not be drawn. The list is shared with `visual/scenes.ts`;
 * `sceneList.test.ts` keeps the two in step.
 */
import type { MessageKey } from '../i18n/index.ts';
import type { StatusInput } from '../app/matchStatus.ts';

export const STATUS_SCENE_IDS = [
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

export type StatusSceneId = (typeof STATUS_SCENE_IDS)[number];

export function isStatusScene(id: string | null): id is StatusSceneId {
  return STATUS_SCENE_IDS.some((known) => known === id);
}

const READY: StatusInput = {
  status: 'ready',
  paused: null,
  me: 0,
  notice: null,
  pauseLeft: 0,
};

const DENIED: MessageKey = 'match.error.pauseDenied';

/** The inputs of `statusView` for a scene; `renderer` has no bar of its own (the HUD shows it). */
export const STATUS_INPUTS: Readonly<Record<StatusSceneId, StatusInput>> = {
  reconnecting: { ...READY, status: 'reconnecting' },
  failed: { ...READY, status: 'failed' },
  gone: { ...READY, status: 'gone' },
  version: { ...READY, status: 'version_mismatch' },
  replaced: { ...READY, status: 'replaced' },
  'paused-you': {
    ...READY,
    paused: { type: 'paused', paused: true, by: 0, ends_in_s: 42 },
    pauseLeft: 42,
  },
  'paused-enemy': {
    ...READY,
    paused: { type: 'paused', paused: true, by: 1, ends_in_s: 42 },
    pauseLeft: 42,
  },
  'pause-denied': { ...READY, notice: DENIED },
  renderer: READY,
};
