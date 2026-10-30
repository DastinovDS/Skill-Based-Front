import type { IconName } from '../hud/icons.ts';
import type { MessageKey } from '../i18n/index.ts';
import type { ConnectionStatus } from '../net/matchConnection.ts';
import type { PausedMsg, PlayerId } from '../protocol.gen.ts';

/** What a status bar can offer; the key is the hotkey that does it (`Enter` the main action, `Esc` out). */
export type StatusAction = 'retry' | 'reload' | 'menu' | 'resume';

/** One bar of the in-match status line: what happened, in which tone, and what can be done. */
export interface StatusView {
  /** `info` is a state that passes by itself (a reconnect, a pause); `alert` needs the player or ends the match here. */
  tone: 'info' | 'alert';
  icon: IconName;
  title: MessageKey;
  text: MessageKey | null;
  /** Seconds in the text (`{seconds}`): a pause counts down. */
  seconds: number | null;
  /** The buttons, the main one first. */
  actions: readonly StatusAction[];
  /** `status` is read politely, `alert` at once. */
  role: 'status' | 'alert';
}

export interface StatusInput {
  status: ConnectionStatus;
  paused: PausedMsg | null;
  me: PlayerId;
  /** The pause refusal or another error line that hides by itself (`PauseState.notice`). */
  notice: MessageKey | null;
  pauseLeft: number;
}

/** The hotkey of each action: the main one is `Enter`, leaving is `Esc`. */
export const ACTION_KEYS: Readonly<Record<StatusAction, 'Enter' | 'Escape'>> = {
  retry: 'Enter',
  reload: 'Enter',
  resume: 'Enter',
  menu: 'Escape',
};

/**
 * The bar for a state of the connection, or `null` when the match runs as usual. A dead connection
 * (gone, failed, version, replaced) wins over a pause; a pause wins over a refusal notice.
 */
export function statusView(input: StatusInput): StatusView | null {
  const { status, paused, me, notice, pauseLeft } = input;
  const base = { seconds: null, role: 'alert', tone: 'alert', icon: 'alert' } as const;
  switch (status) {
    case 'reconnecting':
      return {
        tone: 'info',
        icon: 'refresh',
        title: 'match.status.reconnecting.title',
        text: 'match.status.reconnecting.text',
        seconds: null,
        actions: ['menu'],
        role: 'status',
      };
    case 'failed':
      return {
        ...base,
        title: 'match.status.failed.title',
        text: 'match.status.failed.text',
        actions: ['retry', 'menu'],
      };
    case 'gone':
      return {
        ...base,
        title: 'match.status.gone.title',
        text: 'match.status.gone.text',
        actions: ['menu'],
      };
    case 'version_mismatch':
      return {
        ...base,
        title: 'match.status.version.title',
        text: 'match.status.version.text',
        actions: ['reload'],
      };
    case 'replaced':
      return {
        ...base,
        title: 'match.status.replaced.title',
        text: 'match.status.replaced.text',
        actions: ['menu'],
      };
    default:
      break;
  }
  if (paused !== null) {
    const mine = paused.by === me;
    return {
      tone: 'info',
      icon: 'pause',
      title: mine ? 'match.paused.you.title' : 'match.paused.enemy.title',
      text: 'match.paused.text',
      seconds: pauseLeft,
      actions: mine ? ['resume'] : [],
      role: 'status',
    };
  }
  if (notice !== null) {
    return { ...base, title: notice, text: null, actions: [] };
  }
  return null;
}

/** The action a key does in this bar, or `null`. `Esc` leaves only where a bar offers the way out as the last resort. */
export function statusKeyAction(view: StatusView | null, key: string): StatusAction | null {
  if (view === null) return null;
  // A reconnect passes by itself: `Esc` stays the exit dialog of the match (a double `Esc` forfeits).
  if (view.tone === 'info') {
    return key === 'Enter' && view.actions.includes('resume') ? 'resume' : null;
  }
  return view.actions.find((action) => ACTION_KEYS[action] === key) ?? null;
}

/** The stage a player waits at while joining: the map file, the socket, the first picture of the match. */
export type LoadingStage = 'map' | 'connect' | 'frame';
