/**
 * The payment of a build in motion (#872, ui-style 57k and 73; mockups
 * `in-game-style-r5.html` and `city-buildings-r2.html`): each charge a build takes (progressive
 * payment, DEC-41 item 7) flies from the warehouse or from the own group standing in the city to its
 * lozenge of the row of owed charges by the icon and pops there as it lands; once the build is paid in full, the lozenges
 * run into the icon.
 *
 * Driven only by the server: the event `build_paid` (`warehouse` and `units` taken, `owed` left; an
 * event only its own player gets) and the build in the snapshot. Nothing about the payment is
 * computed here: the times are the age of the event at the render tick, so a replay that jumps or
 * a reconnect simply shows the state. Pure functions, no PixiJS.
 */
import type { EventMsg, PlayerId } from '../protocol.gen.ts';
import { easeEngrave, easeTravel } from '../theme/tokens.ts';
import type { BuildingKind } from './buildingLayout.ts';
import { BUILD_PAY } from './style.ts';

/** One `build_paid` of an own build (the barracks or the factory). */
export interface Payment {
  readonly tick: number;
  readonly node: number;
  readonly kind: BuildingKind;
  /** Charges taken from the warehouse of the node, then from the own groups standing there. */
  readonly warehouse: number;
  readonly units: number;
  /** Charges still owed after it: 0 is the payment in full. */
  readonly owed: number;
}

/** The payment of `event` when it is a `build_paid` of `me` for a build; `null` otherwise. */
export function paymentOf(event: EventMsg, me: PlayerId): Payment | null {
  if (event.kind !== 'build_paid') return null;
  const { player, node, kind, warehouse, units, owed } = event.data;
  if (player !== me || typeof node !== 'number') return null;
  if (kind !== 'barracks' && kind !== 'factory') return null;
  const w = typeof warehouse === 'number' ? Math.max(0, Math.floor(warehouse)) : 0;
  const u = typeof units === 'number' ? Math.max(0, Math.floor(units)) : 0;
  if (w + u === 0) return null;
  const left = typeof owed === 'number' ? Math.max(0, Math.floor(owed)) : 0;
  return { tick: event.tick, node, kind, warehouse: w, units: u, owed: left };
}

/** Milliseconds from `payment` to the render `tick` at `tickHz` (negative before it). */
export function paymentMs(payment: Payment, tick: number, tickHz: number): number {
  return tickHz > 0 ? ((tick - payment.tick) * 1000) / tickHz : Number.POSITIVE_INFINITY;
}

/** How long after its event the motion of `payment` lasts, ms, for a build of `cost` charges. */
export function paymentSpan(payment: Payment, cost: number): number {
  const { run, ...pay } = BUILD_PAY;
  const n = payment.warehouse + payment.units;
  const landed = pay.flightMs + (n - 1) * pay.staggerMs;
  const tail = payment.owed === 0 ? run.ms + Math.max(0, cost - 1) * run.staggerMs : 0;
  return landed + Math.max(pay.popMs, tail);
}

/** A charge in the air: `k` of its payment, from the warehouse or the group, to lozenge `j`. */
export interface PayFlight {
  readonly payment: Payment;
  readonly k: number;
  readonly from: 'warehouse' | 'group';
  /** Of the charges from the warehouse, how many left after this one (0: the last place of the row). */
  readonly behind: number;
  readonly j: number;
  /** 0..1 of the flight, eased. */
  readonly q: number;
}

/** What the row of owed charges of one build shows at a moment. */
export interface PayShow {
  readonly flights: readonly PayFlight[];
  /** The charges the snapshot counts paid whose flight has not landed yet: shown still owed. */
  readonly hidden: number;
  /** The lozenges that just landed, by index, and their scale (1 + a sine bump). */
  readonly pops: ReadonlyMap<number, number>;
  /** Paid in full and landed: each lozenge's run into the icon, 0..1 (eased); `null`: not now. */
  readonly run: readonly number[] | null;
}

const EMPTY: PayShow = { flights: [], hidden: 0, pops: new Map(), run: null };

/**
 * The motion of one build at the render `tick`: `payments` are its own `build_paid` (any
 * order), `cost` the charges it costs, `baseTick` the tick of the snapshot drawn (a payment newer
 * than it is not in the picture yet, so it does not move yet).
 */
export function payShow(
  payments: readonly Payment[],
  cost: number,
  tick: number,
  baseTick: number,
  tickHz: number,
): PayShow {
  const { run: R, ...pay } = BUILD_PAY;
  const flights: PayFlight[] = [];
  const pops = new Map<number, number>();
  let hidden = 0;
  let run: number[] | null = null;
  for (const payment of payments) {
    if (payment.tick > baseTick) continue;
    const ms = paymentMs(payment, tick, tickHz);
    if (ms < 0 || ms >= paymentSpan(payment, cost)) continue;
    const n = payment.warehouse + payment.units;
    // The lozenges are paid in order: this payment fills the ones after those paid before it.
    const first = cost - payment.owed - n;
    for (let k = 0; k < n; k++) {
      const age = ms - k * pay.staggerMs;
      const j = Math.min(cost - 1, Math.max(0, first + k));
      if (age < pay.flightMs) {
        hidden++;
        if (age >= 0) {
          const fromWarehouse = k < payment.warehouse;
          flights.push({
            payment,
            k,
            from: fromWarehouse ? 'warehouse' : 'group',
            behind: fromWarehouse ? payment.warehouse - 1 - k : 0,
            j,
            q: easeTravel(age / pay.flightMs),
          });
        }
        continue;
      }
      const landed = age - pay.flightMs;
      if (landed < pay.popMs) pops.set(j, 1 + pay.pop * Math.sin((landed / pay.popMs) * Math.PI));
    }
    if (payment.owed === 0) {
      const into = ms - (pay.flightMs + (n - 1) * pay.staggerMs);
      if (into >= 0) {
        run = [];
        for (let j = 0; j < cost; j++) run.push(easeEngrave((into - j * R.staggerMs) / R.ms));
      }
    }
  }
  if (flights.length === 0 && hidden === 0 && pops.size === 0 && run === null) return EMPTY;
  return { flights, hidden, pops, run: run?.some((q) => q < 1) === true ? run : null };
}

/**
 * The own build payments among the events, read again only when the list changed (the tail only when
 * it grew). `recent` gives those that may still move at the render tick, newest first.
 */
export class PaymentLog {
  private seen: readonly EventMsg[] | null = null;
  private count = 0;
  private list: Payment[] = [];

  constructor(private readonly me: PlayerId) {}

  read(events: readonly EventMsg[]): void {
    if (events === this.seen && events.length === this.count) return;
    const from = events === this.seen && events.length > this.count ? this.count : 0;
    if (from === 0) this.list = [];
    for (let i = from; i < events.length; i++) {
      const event = events[i];
      const payment = event === undefined ? null : paymentOf(event, this.me);
      if (payment !== null) this.list.push(payment);
    }
    this.seen = events;
    this.count = events.length;
  }

  /** The payments whose event is at most `horizonMs` before the render `tick` (and not after it). */
  recent(tick: number, tickHz: number, horizonMs: number): Payment[] {
    const out: Payment[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const payment = this.list[i];
      if (payment === undefined) continue;
      const ms = paymentMs(payment, tick, tickHz);
      // The events come in tick order: past the horizon, every older one is too.
      if (ms > horizonMs) break;
      if (ms >= 0) out.push(payment);
    }
    return out;
  }
}
