import type { MatchAudio } from '../audio/matchAudio.ts';
import { diagnostics } from '../diagnostics.ts';
import type { HudState } from '../hud/hudState.svelte.ts';
import {
  MatchConnection,
  type ConnectionStatus,
  type MatchConnectionOptions,
} from '../net/matchConnection.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import { SnapshotBuffer } from '../net/snapshotBuffer.ts';
import type { Command, EventMsg, ServerMsg, WelcomeMsg } from '../protocol.gen.ts';
import { NO_RENDER_RULES, type RenderRules } from '../render/renderRules.ts';
import type { RenderSource } from '../render/source.ts';
import { OrderBook } from './orderBook.ts';

/** Events kept for the fight marks: they live a few seconds, so a short tail is enough. */
const EVENT_TAIL = 64;

/** A silence between two snapshots longer than this is logged (a snapshot comes every 100 ms). */
const SNAPSHOT_GAP_WARN_MS = 1000;

/** What a session needs to know about the match: the HUD to feed and the rule numbers. */
export interface MatchContext {
  /** The HUD numbers: fed from the same snapshots the map draws. */
  hud: HudState;
  /**
   * `renderRules(ruleset_public)` (ARC-C02): what the map draws with; its `tickHz` also paces the
   * snapshot buffer.
   */
  rules: RenderRules;
  /** The sounds of the match (#71); absent: silent (tests, the replay). */
  audio?: MatchAudio;
}

export interface MatchSessionOptions {
  matchId: string;
  /** Guest token; goes out in `hello` only. */
  token: string;
  /**
   * The HUD and the tick rate, or a function that makes them from the first `welcome` (the
   * ruleset and the player's side arrive there, so a real match cannot know them earlier). Until
   * then `frame()` is `null` and `tickHz` is the default.
   */
  context: MatchContext | ((welcome: WelcomeMsg) => MatchContext);
  /** Sees every server message after the session has handled it (`welcome`, `paused`, `match_end`). */
  onServerMessage?: (msg: ServerMsg) => void;
  /** Connection status changes. */
  onStatus?: (status: ConnectionStatus) => void;
  /** Socket factory, page location, backoff, clocks: see `MatchConnectionOptions`. */
  connection?: Partial<Omit<MatchConnectionOptions, 'matchId' | 'token' | 'handlers'>>;
  /** Clock of the snapshot buffer, ms. */
  now?: () => number;
}

/**
 * One match on the client (CLI-06, #62): the connection, the snapshot buffer, the event tail and
 * the sent-order book, wired so that the map and the HUD read the same stream. It is the
 * `RenderSource` of the map. Plain TypeScript: no Svelte state, no PixiJS.
 */
export class MatchSession implements RenderSource {
  readonly orders = new OrderBook();
  /** The rule numbers of the match; none until `welcome` (the default tick rate). */
  rules: RenderRules = NO_RENDER_RULES;
  buffer: SnapshotBuffer;
  #hud: HudState | null = null;
  #audio: MatchAudio | null = null;
  readonly #now: (() => number) | undefined;
  readonly #onServerMessage: ((msg: ServerMsg) => void) | undefined;
  readonly #connection: MatchConnection;
  #events: readonly EventMsg[] = [];
  /** When the previous snapshot arrived (ms); `null` after a reset or before the first one. */
  #lastSnapshotAt: number | null = null;
  #status: ConnectionStatus = 'idle';

  constructor(opts: MatchSessionOptions) {
    this.#now = opts.now;
    this.#onServerMessage = opts.onServerMessage;
    this.buffer = new SnapshotBuffer({ tickMs: 1000 / this.tickHz, now: opts.now });
    const context = opts.context;
    if (typeof context === 'function') {
      this.#makeContext = context;
    } else {
      this.#setContext(context);
    }
    this.#connection = new MatchConnection({
      ...opts.connection,
      matchId: opts.matchId,
      token: opts.token,
      handlers: {
        onMessage: (msg) => {
          this.#onMessage(msg);
        },
        onStatus: (status) => {
          this.#status = status;
          opts.onStatus?.(status);
        },
        // The snapshot timeline is broken: forget the old frames and the old HUD picture.
        onReset: () => {
          this.#lastSnapshotAt = null;
          this.buffer.clear();
          this.#hud?.reset();
          this.#audio?.reset();
        },
        onAckLost: (seq) => {
          this.orders.onAckLost(seq);
        },
      },
    });
  }

  #makeContext: ((welcome: WelcomeMsg) => MatchContext) | null = null;

  #setContext(context: MatchContext): void {
    this.#hud = context.hud;
    this.#audio = context.audio ?? null;
    this.rules = context.rules;
    this.buffer = new SnapshotBuffer({ tickMs: 1000 / context.rules.tickHz, now: this.#now });
  }

  /** Ticks a second of the match (`ruleset_public.tick_hz`); the default until `welcome`. */
  get tickHz(): number {
    return this.rules.tickHz;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  start(): void {
    this.#connection.connect();
  }

  stop(): void {
    this.#connection.close();
    this.orders.clear();
  }

  /** After `failed`: connect again (the player asked for it). */
  retry(): void {
    this.#connection.retry();
  }

  /** Ask for a full snapshot after a gap; the buffer is cleared first. */
  resync(): void {
    this.#connection.resync();
  }

  /** Ask to pause a private match (DEC-05); the answer is a `paused` message or an `error`. */
  pause(): void {
    this.#connection.pause();
  }

  /** End the pause early; only the player who paused may. */
  resume(): void {
    this.#connection.resume();
  }

  /** Ask where an own group can go (DEC-20); the `reach` answer goes to `onServerMessage`. */
  queryReach(group: string): void {
    this.#connection.queryReach(group);
  }

  /** Queue a command; returns its `seq`. */
  send(cmd: Command): number {
    return this.#connection.send(cmd);
  }

  frame(): RenderFrame | null {
    const frame = this.buffer.sample();
    if (frame !== null) {
      this.orders.onRendered(frame.base.tick);
      this.#hud?.onRender(frame.tick);
      this.#audio?.onRender(frame.tick);
    }
    return frame;
  }

  events(): readonly EventMsg[] {
    return this.#events;
  }

  /**
   * Diagnostics for "the match froze" reports (#546): a long silence between two snapshots goes
   * to the console with its length, so a bug report can say whether the server or the page stalled,
   * and to the server log with the flag of a hidden tab (#810, `diagnostics.ts`).
   */
  #noteSnapshotGap(): void {
    const now = (this.#now ?? (() => performance.now()))();
    const last = this.#lastSnapshotAt;
    this.#lastSnapshotAt = now;
    if (last !== null && now - last > SNAPSHOT_GAP_WARN_MS) {
      diagnostics.gap(now - last);
    }
  }

  #onMessage(msg: ServerMsg): void {
    switch (msg.type) {
      case 'welcome':
        // A reconnect starts the list of what `X` can undo anew (#764).
        this.orders.undo.clear();
        // The first welcome fixes the ruleset; after a reconnect it is the same match.
        if (this.#makeContext !== null && this.#hud === null) {
          this.#setContext(this.#makeContext(msg));
        }
        break;
      case 'snapshot':
        this.#noteSnapshotGap();
        diagnostics.snapshot(msg.tick);
        // A duplicate or a stale snapshot is dropped by the buffer, and so by the HUD.
        if (this.buffer.push(msg) === 'added') this.#hud?.onSnapshot(msg);
        break;
      case 'event':
        this.#events = [...this.#events, msg].slice(-EVENT_TAIL);
        this.#hud?.onEvent(msg);
        this.orders.onEvent(msg);
        break;
      case 'ack':
        this.orders.onAck(msg);
        break;
      case 'tutorial':
        // A chapter waiting at a card holds the match still: the map plays out to the newest
        // snapshot, so the card is seen over the frame of its tick (#1047, P1).
        this.buffer.held = msg.paused;
        break;
      case 'match_end':
        this.orders.undo.clear();
        // The last snapshot is drawn too (#819: a capital's capture is seen before the result).
        this.buffer.finish();
        break;
      default:
        break;
    }
    if (msg.type === 'event' || msg.type === 'ack' || msg.type === 'match_end') {
      this.#audio?.onMessage(msg);
    }
    this.#onServerMessage?.(msg);
  }
}
