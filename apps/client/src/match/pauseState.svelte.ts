import type { PlayerId, ServerMsg } from '../protocol.gen.ts';
import type { MessageKey } from '../i18n/index.ts';

/** How long a refusal banner stays up before it hides by itself (ms). A UI timing, not a rule. */
export const NOTICE_MS = 4000;

/**
 * The pause refusal banner and whether this player has used the pause of the match (DEC-05: one
 * pause per player in a private match). The server tells only who is paused now, so "used" is
 * tracked from the player's own `paused` message for the life of this page: after a reload the
 * button is enabled again and the server refuses with the banner, which then hides by itself.
 */
export class PauseState {
  notice = $state.raw<MessageKey | null>(null);
  used = $state(false);
  #timer: ReturnType<typeof setTimeout> | null = null;

  /** Reads `paused` and `error` messages; others are ignored. */
  onMessage(msg: ServerMsg, me: PlayerId): void {
    if (msg.type === 'paused') {
      if (msg.paused && msg.by === me) {
        this.used = true;
      }
      this.dismiss();
    } else if (msg.type === 'error') {
      this.#show(msg.code === 'PAUSE_DENIED' ? 'match.error.pauseDenied' : 'match.error.generic');
    }
  }

  /** Hides the banner now (the next action of the player). */
  dismiss(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.notice = null;
  }

  #show(key: MessageKey): void {
    this.dismiss();
    this.notice = key;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.notice = null;
    }, NOTICE_MS);
  }
}
