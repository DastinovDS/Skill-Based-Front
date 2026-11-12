/**
 * A unit made by a city's barracks (#1005, D2 "Foundation", ui-style 76): it leaves its socket of
 * the foundation and drops into the capacity ring, whose cell then flashes ivory; or, sent to the
 * rally point (DEC-48, item H), it leaves its socket and walks (the walking group is the map's).
 *
 * Driven only by the server: the event `recruited` (`node`, `player`, `group`) and, for a walk,
 * `rally_walk_paid` of the same group. The times are the age of the event at the render tick, so a
 * replay that jumps or a reconnect simply shows the state. Pure functions, no PixiJS.
 */
import type { EventMsg } from '../protocol.gen.ts';
import { easeEngrave, easeSettle, easeTravel } from '../theme/tokens.ts';
import { capacityRing } from './cityLayout.ts';
import { FOUNDATION, RING_ENGRAVED } from './style.ts';

/** One `recruited`: where and when, and whether the unit walks to the rally point. */
export interface Recruit {
  readonly tick: number;
  readonly node: number;
  readonly player: number;
  /** It walks to the rally point (`rally_walk_paid` of its group): no drop into the ring. */
  readonly walks: boolean;
}

/** How long after its event a recruit still moves, ms: the drop and the flash, or the walk's fade. */
export const RECRUIT_SPAN_MS = FOUNDATION.drop.ms + FOUNDATION.drop.flashMs;

/** Milliseconds from `tick` of an event to the render `tick` at `tickHz` (negative before it). */
export function eventAge(eventTick: number, tick: number, tickHz: number): number {
  return tickHz > 0 ? ((tick - eventTick) * 1000) / tickHz : Number.POSITIVE_INFINITY;
}

/**
 * The `recruited` events among the events, read again only when the list changed (the tail only when
 * it grew). A `rally_walk_paid` of the same group marks its recruit as walking.
 */
export class RecruitLog {
  private seen: readonly EventMsg[] | null = null;
  private count = 0;
  private list: { tick: number; node: number; player: number; group: unknown }[] = [];
  private walking = new Set<string>();

  read(events: readonly EventMsg[]): void {
    if (events === this.seen && events.length === this.count) return;
    const from = events === this.seen && events.length > this.count ? this.count : 0;
    if (from === 0) {
      this.list = [];
      this.walking = new Set();
    }
    for (let i = from; i < events.length; i++) {
      const event = events[i];
      if (event === undefined) continue;
      const { node, player, group } = event.data;
      if (event.kind === 'recruited' && typeof node === 'number' && typeof player === 'number') {
        this.list.push({ tick: event.tick, node, player, group });
      } else if (event.kind === 'rally_walk_paid' && typeof group === 'string') {
        this.walking.add(`${String(event.tick)}:${group}`);
      }
    }
    this.seen = events;
    this.count = events.length;
  }

  /**
   * The recruits whose motion is not over at the render `tick` and that the snapshot drawn
   * (`baseTick`) already shows, newest first.
   */
  recent(tick: number, baseTick: number, tickHz: number): Recruit[] {
    const out: Recruit[] = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      if (r === undefined) continue;
      const ms = eventAge(r.tick, tick, tickHz);
      // The events come in tick order: past the span, every older one is too.
      if (ms >= RECRUIT_SPAN_MS) break;
      if (ms < 0 || r.tick > baseTick) continue;
      const walks = typeof r.group === 'string' && this.walking.has(`${String(r.tick)}:${r.group}`);
      out.push({ tick: r.tick, node: r.node, player: r.player, walks });
    }
    return out;
  }
}

/** The angles of the cell `index` of a capacity ring of `capacity` places (`capacityRing`). */
export function ringCell(capacity: number, index: number): { from: number; to: number } {
  const cap = Math.max(1, Math.floor(capacity));
  const i = Math.min(cap - 1, Math.max(0, Math.floor(index)));
  const ring = capacityRing(cap, 0);
  if (!ring.solid) {
    const arc = ring.arcs[i];
    if (arc !== undefined) return { from: arc.from, to: arc.to };
  }
  const start = -Math.PI / 2;
  return { from: start + (2 * Math.PI * i) / cap, to: start + (2 * Math.PI * (i + 1)) / cap };
}

const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));
const smooth = (a: number, b: number, x: number): number => {
  const q = clamp01((x - a) / (b - a));
  return q * q * (3 - 2 * q);
};

/** What a made unit looks like `q` (0..1, eased) of the way from its socket into the ring. */
export interface DropShape {
  /** The radius and the angles of its arc round the city centre. */
  readonly r: number;
  readonly from: number;
  readonly to: number;
  /** The width of the owner's arc, of its dark casing and the opacity of both. */
  readonly width: number;
  readonly casing: number;
  readonly alpha: number;
  /** The ivory sheen on its outer side (fades as it lands). */
  readonly sheen: number;
  /** The owner's colour still in the socket it leaves (fades). */
  readonly lift: number;
}

/**
 * The made unit as an arc round the city: it leaves its socket (`socket`: its middle, width and
 * height, from the city centre) outward to the ring's radius `ring` fast (settling), then slides
 * round to its cell `cell` and takes the cell's length and the width of a unit of the ring
 * (the mockup's `dropFromRect`). `k`: the foundation's scale.
 */
export function dropShape(
  q: number,
  socket: { x: number; y: number; width: number; height: number },
  ring: number,
  cell: { from: number; to: number },
  k: number,
): DropShape {
  const r0 = Math.hypot(socket.x, socket.y);
  const t0 = Math.atan2(socket.y, socket.x);
  const mid = (cell.from + cell.to) / 2;
  let turn = mid - t0;
  turn = ((((turn + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const qr = easeSettle(clamp01(q / 0.45));
  const qa = easeEngrave(clamp01((q - 0.28) / 0.72));
  const r = r0 + (ring - r0) * qr;
  const a = t0 + turn * qa;
  const length = socket.width + ((cell.to - cell.from) * ring - socket.width) * qa;
  const half = length / Math.max(r, 1e-6) / 2;
  const width = socket.height * 0.86 + (RING_ENGRAVED.filled + 0.6 - socket.height * 0.86) * qr;
  return {
    r,
    from: a - half,
    to: a + half,
    width,
    casing: width + 2.4 * k * (1 - q) + 1.2,
    alpha: smooth(0, 0.22, q),
    sheen: 1 - q,
    lift: 1 - smooth(0, 0.3, q),
  };
}

/** What a recruit `ms` after its event shows. */
export interface RecruitShow {
  /** The drop under way (`dropShape`'s `q`, eased); `null`: not now. */
  readonly drop: number | null;
  /** The flash of the ring's cell, 0..1 of its fade; `null`: not now. */
  readonly flash: number | null;
  /** The queue slides one socket left: the share of a socket still to go (1 at the event, 0 done). */
  readonly slide: number;
  /** A walker leaving its socket: the opacity of the owner's colour still in it; 0: none. */
  readonly leave: number;
}

/** The motion of a recruit `ms` after its event (`walks`: it walks to the rally point). */
export function recruitShow(ms: number, walks: boolean): RecruitShow {
  const { ms: dropMs, flashMs, slideMs, walkMs } = FOUNDATION.drop;
  const slide = ms < slideMs ? 1 - easeEngrave(ms / slideMs) : 0;
  if (walks) {
    return { drop: null, flash: null, slide, leave: ms < walkMs ? 1 - ms / walkMs : 0 };
  }
  const drop = ms < dropMs ? easeTravel(ms / dropMs) : null;
  const after = ms - dropMs;
  const flash = after >= 0 && after < flashMs ? after / flashMs : null;
  return { drop, flash, slide, leave: 0 };
}
