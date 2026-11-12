import type { PlayerId, ServerMsg } from '../protocol.gen.ts';

/** The console line of an `error` message of the server (its code only, never its text). */
export function serverErrorLine(code: string): string {
  return `[client] server error: ${code}`;
}

/**
 * Whether this player may still pause the match (DEC-05: one pause per player in a private match,
 * none in a rated one). `welcome` says it (`pause_available`, also after a reconnect or a reload),
 * and the player's own pause makes it false at once: the button is offered only while it is true.
 * A refused pause or another `error` message of the server is no bar line (#765, G8, G9): the button
 * is offered only when a pause is possible, so it is a stale click or a client bug, logged.
 */
export class PauseState {
  /** The player may pause now: false before `welcome`, in a rated match, once the pause is used. */
  available = $state(false);
  readonly #log: (line: string) => void;

  constructor(
    log: (line: string) => void = (line) => {
      console.warn(line);
    },
  ) {
    this.#log = log;
  }

  /** Reads `welcome`, `paused` and `error` messages; others are ignored. */
  onMessage(msg: ServerMsg, me: PlayerId): void {
    if (msg.type === 'welcome') {
      this.available = msg.pause_available;
    } else if (msg.type === 'paused') {
      if (msg.paused && msg.by === me) {
        this.available = false;
      }
    } else if (msg.type === 'error') {
      this.#log(serverErrorLine(msg.code));
    }
  }
}
