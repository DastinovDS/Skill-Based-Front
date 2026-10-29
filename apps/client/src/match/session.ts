import type { HudState } from '../hud/hudState.svelte.ts';
import {
  MatchConnection,
  type ConnectionStatus,
  type MatchConnectionOptions,
} from '../net/matchConnection.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import { SnapshotBuffer } from '../net/snapshotBuffer.ts';
import type {
  CapacityPublic,
  Command,
  EventMsg,
  OrdersPublic,
  ServerMsg,
  WelcomeMsg,
} from '../protocol.gen.ts';
import type {
  CapacityTicks,
  CityDevelopment,
  OrderDelays,
  RenderSource,
} from '../render/source.ts';
import { OrderBook } from './orderBook.ts';

/** Events kept for the fight marks: they live a few seconds, so a short tail is enough. */
const EVENT_TAIL = 64;

/** Until `welcome` tells the real rate. */
const DEFAULT_TICK_HZ = 10;

/** A silence between two snapshots longer than this is logged (a snapshot comes every 100 ms). */
const SNAPSHOT_GAP_WARN_MS = 1000;

/** What a session needs to know about the match: the HUD to feed and the tick rate. */
export interface MatchContext {
  /** The HUD numbers: fed from the same snapshots the map draws. */
  hud: HudState;
  /** `ruleset_public.tick_hz`: paces the snapshot buffer and ages fog memories. */
  tickHz: number;
  /** `ruleset_public.orders`: the delays of the countdown on order arrows. */
  orders?: Pick<OrdersPublic, 'planned_delay_ticks'>;
  /** `ruleset_public.capacity`: the arc of the overcrowding pill. */
  capacity?: Pick<CapacityPublic, 'attrition_ticks' | 'grace_ticks'>;
  /** `ruleset_public.combat.round_ticks`: the round progress of a fight going on (DEC-24). */
  roundTicks?: number;
  /** `ruleset_public.recruit.unit_ticks`: the progress of a recruit queue (DEC-25). */
  recruitTicks?: number;
  /** `ruleset_public.recruit.queue_max`: the free slots a selected city shows (DEC-25). */
  recruitQueueMax?: number;
  /** `ruleset_public.city_upgrades` when enabled (DEC-26): the city build mark. */
  cityUpgrades?: CityDevelopment | null;
  /** `ruleset_public.build.ticks_per_level`: the part done of the tape of an own road build (DEC-28). */
  roadBuildTicks?: number;
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
  tickHz = DEFAULT_TICK_HZ;
  /** Delays of planned orders and "Defense": the countdown on the arrows. */
  orderDelays: OrderDelays | undefined;
  roundTicks: number | undefined;
  recruitTicks: number | undefined;
  recruitQueueMax: number | undefined;
  cityUpgrades: CityDevelopment | null | undefined;
  roadBuildTicks: number | undefined;
  /** The overcrowding numbers: the pill beside an overcrowded city. */
  capacityTicks: CapacityTicks | undefined;
  buffer: SnapshotBuffer;
  #hud: HudState | null = null;
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
    this.tickHz = context.tickHz;
    const orders = context.orders;
    this.orderDelays = orders === undefined ? undefined : { planned: orders.planned_delay_ticks };
    this.roundTicks = context.roundTicks;
    this.recruitTicks = context.recruitTicks;
    this.recruitQueueMax = context.recruitQueueMax;
    this.cityUpgrades = context.cityUpgrades;
    this.roadBuildTicks = context.roadBuildTicks;
    this.capacityTicks =
      context.capacity === undefined
        ? undefined
        : {
            attritionTicks: context.capacity.attrition_ticks,
            graceTicks: context.capacity.grace_ticks,
          };
    this.buffer = new SnapshotBuffer({ tickMs: 1000 / context.tickHz, now: this.#now });
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
    }
    return frame;
  }

  events(): readonly EventMsg[] {
    return this.#events;
  }

  /**
   * Diagnostics for "the match froze" reports (#546): a long silence between two snapshots goes
   * to the console with its length, so a bug report can say whether the server or the page stalled.
   */
  #noteSnapshotGap(): void {
    const now = (this.#now ?? (() => performance.now()))();
    const last = this.#lastSnapshotAt;
    this.#lastSnapshotAt = now;
    if (last !== null && now - last > SNAPSHOT_GAP_WARN_MS) {
      console.warn(`[client] snapshot gap ${String(Math.round(now - last))} ms`);
    }
  }

  #onMessage(msg: ServerMsg): void {
    switch (msg.type) {
      case 'welcome':
        // The first welcome fixes the ruleset; after a reconnect it is the same match.
        if (this.#makeContext !== null && this.#hud === null) {
          this.#setContext(this.#makeContext(msg));
        }
        break;
      case 'snapshot':
        this.#noteSnapshotGap();
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
      default:
        break;
    }
    this.#onServerMessage?.(msg);
  }
}
