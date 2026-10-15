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
import type { CapacityTicks, CityBuildTicks, OrderDelays, RenderSource } from '../render/source.ts';
import { OrderBook } from './orderBook.ts';

/** Events kept for the fight marks: they live a few seconds, so a short tail is enough. */
const EVENT_TAIL = 64;

/** Until `welcome` tells the real rate. */
const DEFAULT_TICK_HZ = 10;

/** What a session needs to know about the match: the HUD to feed and the tick rate. */
export interface MatchContext {
  /** The HUD numbers: fed from the same snapshots the map draws. */
  hud: HudState;
  /** `ruleset_public.tick_hz`: paces the snapshot buffer and ages fog memories. */
  tickHz: number;
  /** `ruleset_public.orders`: the delays of the countdown on order arrows. */
  orders?: Pick<OrdersPublic, 'planned_delay_ticks' | 'defense_delay_ticks'>;
  /** `ruleset_public.capacity`: the arc of the overcrowding pill. */
  capacity?: Pick<CapacityPublic, 'attrition_ticks' | 'grace_ticks'>;
  /** `ruleset_public.combat.round_ticks`: the round progress of a fight going on (DEC-24). */
  roundTicks?: number;
  /** `ruleset_public.recruit.unit_ticks`: the progress of a recruit queue (DEC-25). */
  recruitTicks?: number;
  /** `ruleset_public.city_upgrades` when enabled (DEC-26): the city build mark. */
  cityUpgrades?: CityBuildTicks | null;
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
  cityUpgrades: CityBuildTicks | null | undefined;
  /** The overcrowding numbers: the pill beside an overcrowded city. */
  capacityTicks: CapacityTicks | undefined;
  buffer: SnapshotBuffer;
  #hud: HudState | null = null;
  readonly #now: (() => number) | undefined;
  readonly #onServerMessage: ((msg: ServerMsg) => void) | undefined;
  readonly #connection: MatchConnection;
  #events: readonly EventMsg[] = [];
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
    this.orderDelays =
      orders === undefined
        ? undefined
        : { planned: orders.planned_delay_ticks, defense: orders.defense_delay_ticks };
    this.roundTicks = context.roundTicks;
    this.recruitTicks = context.recruitTicks;
    this.cityUpgrades = context.cityUpgrades;
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
    if (frame !== null) this.orders.onRendered(frame.base.tick);
    return frame;
  }

  events(): readonly EventMsg[] {
    return this.#events;
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
        // A duplicate or a stale snapshot is dropped by the buffer, and so by the HUD.
        if (this.buffer.push(msg) === 'added') this.#hud?.onSnapshot(msg);
        break;
      case 'event':
        this.#events = [...this.#events, msg].slice(-EVENT_TAIL);
        this.#hud?.onEvent(msg);
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
