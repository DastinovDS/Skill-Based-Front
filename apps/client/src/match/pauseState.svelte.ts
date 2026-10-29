import type { PlayerId, ServerMsg } from '../protocol.gen.ts';
import type { MessageKey } from '../i18n/index.ts';

/** How long a refusal banner stays up before it hides by itself (ms). A UI timing, not a rule. */
export const NOTICE_MS = 4000;

/**
 * The pause refusal banner and whether this player may still pause the match (DEC-05: one pause
 * per player in a private match, none in a rated one). `welcome` says it (`pause_available`, also
 * after a reconnect or a reload), and the player's own pause makes it false at once: the button is
 * offered only while it is true. A refusal that still comes shows the banner, which hides by itself.
 */
export class PauseState {
  notice = $state.raw<MessageKey | null>(null);
  /** The player may pause now: false before `welcome`, in a rated match, once the pause is used. */
  available = $state(false);
  #timer: ReturnType<typeof setTimeout> | null = null;

  /** Reads `paused` and `error` messages; others are ignored. */
  onMessage(msg: ServerMsg, me: PlayerId): void {
    if (msg.type === 'welcome') {
      this.available = msg.pause_available;
    } else if (msg.type === 'paused') {
      if (msg.paused && msg.by === me) {
        this.available = false;
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
