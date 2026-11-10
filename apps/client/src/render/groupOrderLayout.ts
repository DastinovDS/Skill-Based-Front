/**
 * The arithmetic of the group order marks on the map (DEC-48, #896): which own groups belong to one
 * group order, where its seal stands, how much of a wait is left. Display only: every tick and every
 * member comes from the server's `OrderView` (`group_order`, `depart_tick`, `arrive_tick`); nothing
 * here decides a rule (AGENTS.md 7.1).
 */
import type { GroupView } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { WorldRect } from './interaction.ts';

/** `at` lies inside the rectangle (its corners in any order), edges included. */
export function insideRect(rect: WorldRect, at: Point): boolean {
  const { x, y, width, height } = normRect(rect);
  return at.x >= x && at.x <= x + width && at.y >= y && at.y <= y + height;
}

/** The rectangle as its top left corner and its size. */
export function normRect(rect: WorldRect): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(rect.x0, rect.x1),
    y: Math.min(rect.y0, rect.y1),
    width: Math.abs(rect.x1 - rect.x0),
    height: Math.abs(rect.y1 - rect.y0),
  };
}

/** One group order of the snapshot: its target, the common arrival and its members now. */
export interface GroupOrderMark {
  /** `OrderView.group_order`: the same opaque id on every member. */
  readonly id: string;
  readonly dest: number;
  /** The common arrival (a rally: the latest arrival of a member); `null` while a plan gathers. */
  readonly arrive: number | null;
  /** The members still with the order, in the order of the snapshot. */
  readonly members: readonly string[];
  /** Of them, those on a road (they left their node). */
  readonly moving: number;
}

/**
 * The group orders among the own groups of a snapshot (DEC-48, item I1): the groups that share a
 * `group_order` id, each order once, in the order its first member comes.
 */
export function groupOrders(groups: readonly GroupView[]): GroupOrderMark[] {
  const marks = new Map<
    string,
    { dest: number; arrive: number | null; members: string[]; moving: number }
  >();
  for (const group of groups) {
    const order = group.order;
    if (order?.group_order == null) continue;
    let mark = marks.get(order.group_order);
    if (mark === undefined) {
      mark = { dest: order.dest, arrive: order.arrive_tick, members: [], moving: 0 };
      marks.set(order.group_order, mark);
    }
    mark.members.push(group.id);
    if (group.location.kind === 'edge') mark.moving += 1;
    if (mark.arrive === null) mark.arrive = order.arrive_tick;
  }
  return [...marks].map(([id, mark]) => ({ id, ...mark }));
}

/**
 * The lozenges of the seal (B1): one per member the order had (`total`, the most the snapshots
 * showed), filled for those on the way, or for a rally those that merged already (they are gone
 * from the order).
 */
export function sealLozenges(mark: GroupOrderMark, total: number, rally: boolean): boolean[] {
  const n = Math.max(total, mark.members.length);
  const done = rally ? n - mark.members.length : mark.moving;
  return Array.from({ length: n }, (_, i) => i < done);
}

/** Whole seconds left until `tick` (rounded up), never below 0. */
export function secondsUntil(tick: number, now: number, tickHz: number): number {
  if (tickHz <= 0) return 0;
  return Math.ceil(Math.max(0, tick - now) / tickHz);
}

/**
 * The sand still on top of a waiting member's hourglass (C3): the share of its wait left, from the
 * tick the wait was first seen (`since`) to its departure; 1 before, 0 once it is due.
 */
export function waitShare(depart: number, since: number, now: number): number {
  const total = depart - since;
  if (total <= 0) return now < depart ? 1 : 0;
  return Math.min(1, Math.max(0, (depart - now) / total));
}

/**
 * The own group waits in its node to depart later (DEC-48, item C2): an order whose departure is
 * still ahead. `null`: it does not wait (it has no order, it is on its way, or a plan gathers).
 */
export function waitingDeparture(group: GroupView, now: number): number | null {
  const order = group.order;
  if (order === null || group.location.kind !== 'node' || order.gathering) return null;
  const depart = order.depart_tick;
  return depart !== null && depart > now ? depart : null;
}
