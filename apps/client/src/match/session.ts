import type { HudState } from '../hud/hudState.svelte.ts';
import {
  MatchConnection,
  type ConnectionStatus,
  type MatchConnectionOptions,
} from '../net/matchConnection.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import { SnapshotBuffer } from '../net/snapshotBuffer.ts';
import type { Command, EventMsg, ServerMsg } from '../protocol.gen.ts';
import type { RenderSource } from '../render/source.ts';
import { OrderBook } from './orderBook.ts';

/** Events kept for the fight marks: they live a few seconds, so a short tail is enough. */
const EVENT_TAIL = 64;

export interface MatchSessionOptions {
  matchId: string;
  /** Guest token; goes out in `hello` only. */
  token: string;
  /** The HUD numbers: fed from the same snapshots the map draws. */
  hud: HudState;
  /** `ruleset_public.tick_hz`: paces the snapshot buffer and ages fog memories. */
  tickHz: number;
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
  readonly tickHz: number;
  readonly buffer: SnapshotBuffer;
  readonly #hud: HudState;
  readonly #connection: MatchConnection;
  #events: readonly EventMsg[] = [];
  #status: ConnectionStatus = 'idle';

  constructor(opts: MatchSessionOptions) {
    this.#hud = opts.hud;
    this.tickHz = opts.tickHz;
    this.buffer = new SnapshotBuffer({ tickMs: 1000 / opts.tickHz, now: opts.now });
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
        },
        // The snapshot timeline is broken: forget the old frames and the old HUD picture.
        onReset: () => {
          this.buffer.clear();
          this.#hud.reset();
        },
        onAckLost: (seq) => {
          this.orders.onAckLost(seq);
        },
      },
    });
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

  /** Ask for a full snapshot after a gap; the buffer is cleared first. */
  resync(): void {
    this.#connection.resync();
  }

  /** Queue a command; returns its `seq`. */
  send(cmd: Command): number {
    return this.#connection.send(cmd);
  }

  frame(): RenderFrame | null {
    const frame = this.buffer.sample();
    if (frame !== null) this.orders.onRendered(frame.base.tick);
    return frame;
  }

  events(): readonly EventMsg[] {
    return this.#events;
  }

  #onMessage(msg: ServerMsg): void {
    switch (msg.type) {
      case 'snapshot':
        // A duplicate or a stale snapshot is dropped by the buffer, and so by the HUD.
        if (this.buffer.push(msg) === 'added') this.#hud.onSnapshot(msg);
        break;
      case 'event':
        this.#events = [...this.#events, msg].slice(-EVENT_TAIL);
        this.#hud.onEvent(msg);
        break;
      case 'ack':
        this.orders.onAck(msg);
        break;
      default:
        break;
    }
  }
}
