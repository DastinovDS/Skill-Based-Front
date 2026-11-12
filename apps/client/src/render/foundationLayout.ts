/**
 * The recruit queue of a city as the barracks' own foundation (#1005, D2 "Foundation", ui-style 76;
 * mockup `docs/design/mockups/recruit-plinth-d.html`): while a city recruits, its barracks stands
 * on a flat foundation of `queue_max` sockets, the barracks' ground line on the foundation's top
 * rule, the two one piece. The factory never moves; the piece takes the nearest free seat to the
 * barracks' seat at rest, clear of the factory, the roads, the VP lozenge, the capacity ring with
 * the Fine rings of a selection round it, the selection ticks, the warehouse row and the name.
 *
 * Pure functions, no PixiJS. What a socket shows comes from the snapshot (`recruit_queue`,
 * `recruit_progress`, `recruit_waiting`) and the ruleset (`recruit.unit_ticks`, `queue_max`); the
 * map's roads are public and static. Nothing about the rules is decided here (AGENTS.md 7.1).
 * Coordinates are world units from the city centre, y down.
 */
import type { Point } from './camera.ts';
import { fitReach, ringRadius } from './cityLayout.ts';
import { parseCut } from './cutPath.ts';
import type { BuildingKind } from './buildingLayout.ts';
import { lozengeRow, lozengeRowY } from './pieceLayout.ts';
import {
  BUILDING,
  CORNER_TICKS,
  FINE_RING,
  FOUNDATION,
  LOZENGE,
  RING_ENGRAVED,
  VP_BADGE_LIFT,
  VP_LOZENGE,
} from './style.ts';
import { CUT_ICONS, CUT_SOLIDS } from '../theme/cutIcons.ts';

/** A box: `x0 < x1`, `y0 < y1`. */
export interface Box {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The scale of the foundation by the icon's size (1 at the 16-unit icon of zoom 1). */
export const foundationScale = (size: number): number => size / BUILDING.world;

/** The box of an icon's art (`CUT_ICONS`, its 26-unit box), not its casing. */
function artBox(kind: BuildingKind): Box {
  const points = parseCut(CUT_ICONS[kind]).flatMap((sub) => sub.points);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const ART: Readonly<Record<BuildingKind, Box>> = {
  barracks: artBox('barracks'),
  factory: artBox('factory'),
};

/** The barracks' ground line in its 26-unit box: the bottom of its solid. */
const GROUND = Math.max(
  ...parseCut(CUT_SOLIDS.barracks ?? '').flatMap((s) => s.points.map((p) => p.y)),
);

/** The box an icon of `size` at `at` covers, its casing included. */
export function iconBox(kind: BuildingKind, at: Point, size: number): Box {
  const s = size / BUILDING.box;
  const a = ART[kind];
  const p = (BUILDING.casing / 2) * s;
  return {
    x0: at.x + a.x0 * s - p,
    y0: at.y + a.y0 * s - p,
    x1: at.x + a.x1 * s + p,
    y1: at.y + a.y1 * s + p,
  };
}

/** The foundation's width and height at the 16-unit icon (its casing not included). */
export function foundationSize(sockets: number): { width: number; height: number } {
  const n = Math.max(1, Math.floor(sockets));
  const { cell, gap, padX, padY } = FOUNDATION;
  return { width: n * cell + (n - 1) * gap + 2 * padX, height: cell + 2 * padY };
}

/**
 * The foundation under a barracks of `size` drawn at `seat`: centred under it, its top rule on the
 * barracks' ground line. Its casing is not included.
 */
export function foundationBox(seat: Point, size: number, sockets: number): Box {
  const k = foundationScale(size);
  const { width, height } = foundationSize(sockets);
  const y0 = seat.y + GROUND * (size / BUILDING.box);
  return { x0: seat.x - (width * k) / 2, y0, x1: seat.x + (width * k) / 2, y1: y0 + height * k };
}

/** The foundation's top left corner from the barracks' seat, at the 16-unit icon (the sprites' origin). */
export function foundationOrigin(sockets: number): Point {
  return {
    x: -foundationSize(sockets).width / 2,
    y: GROUND * (BUILDING.world / BUILDING.box),
  };
}

/** Socket `pos` (0 the left; fractional while the queue slides) of a foundation, from its top left, at the 16-unit icon. */
export function socketAt(pos: number): Point {
  return { x: FOUNDATION.padX + pos * (FOUNDATION.cell + FOUNDATION.gap), y: FOUNDATION.padY };
}

/** The centres of `n` CP marks of the rally walks, in a row under the foundation, from the barracks' seat (16-unit icon). */
export function markSeats(sockets: number, n: number): Point[] {
  const { size, pitch, gap } = FOUNDATION.marks;
  const o = foundationOrigin(sockets);
  const y = o.y + foundationSize(sockets).height + FOUNDATION.casing + gap + size / 2;
  const out: Point[] = [];
  for (let j = 0; j < n; j++) out.push({ x: (j - (n - 1) / 2) * pitch, y });
  return out;
}

/** What the piece covers when the barracks stands at `seat`: the icon, the foundation with its casing, the marks. */
export function pieceBoxes(seat: Point, size: number, sockets: number, marks: number): Box[] {
  const k = foundationScale(size);
  const f = foundationBox(seat, size, sockets);
  const c = FOUNDATION.casing * k;
  const out = [
    iconBox('barracks', seat, size),
    { x0: f.x0 - c, y0: f.y0, x1: f.x1 + c, y1: f.y1 + c },
  ];
  if (marks > 0) {
    const seats = markSeats(sockets, marks);
    const h = (FOUNDATION.marks.size / 2 + 0.5) * k;
    const first = seats[0];
    const last = seats[seats.length - 1];
    if (first !== undefined && last !== undefined) {
      out.push({
        x0: seat.x + first.x * k - h,
        y0: seat.y + first.y * k - h,
        x1: seat.x + last.x * k + h * 1.8,
        y1: seat.y + first.y * k + h,
      });
    }
  }
  return out;
}

/** Something the piece keeps clear of: a disc, a box, or a road (a segment `r` either side). */
export type Obstacle =
  | { readonly kind: 'disc'; readonly x: number; readonly y: number; readonly r: number }
  | { readonly kind: 'box'; readonly box: Box }
  | {
      readonly kind: 'road';
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly r: number;
    };

/** The name of a city under it (`nameLayout.ts`): its top and its size in world units now. */
export interface CaptionBox {
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** What a city shows round it, which the piece keeps clear of. */
export interface CitySigns {
  /** The radius of the city body. */
  readonly radius: number;
  /** The angles of the roads that leave it. */
  readonly roads: readonly number[];
  /** It carries the VP lozenge. */
  readonly vp: boolean;
  /** Places of the warehouse row (0: none drawn). */
  readonly warehouse: number;
  /** Its name, when shown. */
  readonly caption: CaptionBox | null;
  /** The factory's box as drawn (its casing included) and the owed lozenges of its build (centre, radius). */
  readonly factory: Box | null;
  readonly owed: readonly { readonly x: number; readonly y: number; readonly r: number }[];
  /**
   * How much larger than drawn in the world the unit token in the city is now (`symbolScale`: zoomed
   * far out a token keeps its least size on screen and outgrows the ring); 1 when not.
   */
  readonly tokenScale?: number;
}

/** How far a road goes from the city for the piece: beyond any seat the search tries. */
const ROAD_REACH = 2000;

/** The obstacles of a city for a piece of icon `size` (the air kept from the factory scales with it). */
export function cityObstacles(signs: CitySigns, size: number): Obstacle[] {
  const k = foundationScale(size);
  const ring = ringRadius(signs.radius);
  // The capacity ring and, round it, the Fine rings of a selected city or of a target (55p): the
  // piece keeps clear of them whether the city is selected or not, so it never jumps on a click.
  const fine = ring + FINE_RING.r2;
  const out: Obstacle[] = [
    {
      kind: 'disc',
      x: 0,
      y: 0,
      r: Math.max(ring + RING_ENGRAVED.cut / 2, fine + FINE_RING.select.band / 2) + 1,
    },
  ];
  const lozenge =
    ((FINE_RING.select.lozenge + 2 * FINE_RING.select.lozengeCasing) * Math.SQRT2) / 2;
  for (let j = 0; j < 4; j++) {
    const a = Math.PI / 4 + (j * Math.PI) / 2;
    out.push({ kind: 'disc', x: fine * Math.cos(a), y: fine * Math.sin(a), r: lozenge + 0.5 });
  }
  // The corner ticks of a selected group round the largest helmet the city holds (B6, #949), as
  // large as the token is drawn now.
  const ticks =
    (fitReach(signs.radius) + CORNER_TICKS.gap + CORNER_TICKS.casing.width / 2) *
    Math.max(1, signs.tokenScale ?? 1);
  out.push({ kind: 'box', box: { x0: -ticks, y0: -ticks, x1: ticks, y1: ticks } });
  for (const a of signs.roads) {
    out.push({
      kind: 'road',
      x0: ring * Math.cos(a),
      y0: ring * Math.sin(a),
      x1: ROAD_REACH * Math.cos(a),
      y1: ROAD_REACH * Math.sin(a),
      r: BUILDING.free.road,
    });
  }
  if (signs.vp) {
    const d = ring + VP_BADGE_LIFT;
    out.push({
      kind: 'disc',
      x: d * Math.cos(-Math.PI / 4),
      y: d * Math.sin(-Math.PI / 4),
      r: (VP_LOZENGE.side * Math.SQRT2) / 2 + 2,
    });
  }
  if (signs.warehouse > 0) {
    const xs = lozengeRow(signs.warehouse);
    const reach = (LOZENGE.casing * Math.SQRT2) / 2 + 1.5;
    const half = (xs[xs.length - 1] ?? 0) + reach;
    const y = lozengeRowY(signs.radius);
    out.push({ kind: 'box', box: { x0: -half, y0: y - reach, x1: half, y1: y + reach } });
  }
  if (signs.caption !== null) {
    const { top, width, height } = signs.caption;
    out.push({
      kind: 'box',
      box: { x0: -width / 2 - 2, y0: top - 2, x1: width / 2 + 2, y1: top + height },
    });
  }
  const air = FOUNDATION.clear * k;
  if (signs.factory !== null) {
    const f = signs.factory;
    out.push({
      kind: 'box',
      box: { x0: f.x0 - air, y0: f.y0 - air, x1: f.x1 + air, y1: f.y1 + air },
    });
  }
  for (const o of signs.owed) out.push({ kind: 'disc', x: o.x, y: o.y, r: o.r + air });
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** A box as discs that cover it (each the circumcircle of a slice along its long side). */
export function boxDiscs(b: Box): { x: number; y: number; r: number }[] {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const wide = w >= h;
  const n = Math.max(1, Math.ceil((wide ? w / Math.max(h, 1e-6) : h / Math.max(w, 1e-6)) * 1.4));
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    out.push(
      wide
        ? { x: b.x0 + f * w, y: b.y0 + h / 2, r: Math.hypot(w / n / 2, h / 2) }
        : { x: b.x0 + w / 2, y: b.y0 + f * h, r: Math.hypot(w / 2, h / n / 2) },
    );
  }
  return out;
}

/** Does a disc at (`x`, `y`) of radius `r` meet `o`? */
export function meets(o: Obstacle, x: number, y: number, r: number): boolean {
  if (o.kind === 'disc') return Math.hypot(x - o.x, y - o.y) < r + o.r;
  if (o.kind === 'box') {
    const b = o.box;
    return Math.hypot(x - clamp(x, b.x0, b.x1), y - clamp(y, b.y0, b.y1)) < r;
  }
  const dx = o.x1 - o.x0;
  const dy = o.y1 - o.y0;
  const q = clamp(((x - o.x0) * dx + (y - o.y0) * dy) / (dx * dx + dy * dy), 0, 1);
  return Math.hypot(x - o.x0 - q * dx, y - o.y0 - q * dy) < r + o.r;
}

/** What the placement of a city's piece depends on. */
export interface PieceInput {
  readonly signs: CitySigns;
  /** The barracks' seat at rest (`layoutBuildings`). */
  readonly rest: Point;
  /** The icon size now (`iconSize`). */
  readonly size: number;
  /** The sockets of the foundation (`queue_max`, or the queue when longer). */
  readonly sockets: number;
  /** The CP marks of the rally walks under it (#930, W4). */
  readonly marks: number;
}

/** Where the barracks stands on its foundation; `clear`: nothing is met (else the least crowded seat). */
export interface PieceSeat extends Point {
  readonly clear: boolean;
}

/**
 * The seat of the barracks while its city recruits: the free seat nearest to its seat at rest where
 * the whole piece is clear of the city's signs. The search walks rings of growing distance round
 * the seat at rest (`FOUNDATION.search.step` apart, about one step between the tries of a ring),
 * each from the way out of the city and then to either side in turn, and takes the first clear seat:
 * deterministic, and cheap where the seat at rest is nearly free. With no clear seat within
 * `search.reach`, the seat that meets the fewest signs, the nearest of those.
 */
export function placePiece(input: PieceInput): PieceSeat {
  const { rest, size, sockets, marks } = input;
  const k = foundationScale(size);
  const obstacles = cityObstacles(input.signs, size);
  const relative = pieceBoxes({ x: 0, y: 0 }, size, sockets, marks).flatMap(boxDiscs);
  const hits = (x: number, y: number, stopAt: number): number => {
    let n = 0;
    for (const d of relative) {
      for (const o of obstacles) {
        if (meets(o, x + d.x, y + d.y, d.r)) {
          n++;
          if (n >= stopAt) return n;
          break;
        }
      }
    }
    return n;
  };
  const step = FOUNDATION.search.step * k;
  const reach = FOUNDATION.search.reach * k;
  const out = Math.atan2(rest.y, rest.x);
  let fallback: { x: number; y: number; n: number } | null = null;
  for (let ring = 0; ring * step <= reach; ring++) {
    const rho = ring * step;
    const tries = ring === 0 ? 1 : Math.max(8, Math.ceil((2 * Math.PI * rho) / step));
    for (let i = 0; i < tries; i++) {
      const m = i === 0 ? 0 : i % 2 === 1 ? (i + 1) / 2 : -i / 2;
      const a = out + (m * 2 * Math.PI) / tries;
      const x = rest.x + rho * Math.cos(a);
      const y = rest.y + rho * Math.sin(a);
      const n = hits(x, y, fallback === null ? Infinity : fallback.n);
      if (n === 0) return { x, y, clear: true };
      if (fallback === null || n < fallback.n) fallback = { x, y, n };
    }
  }
  return { x: fallback?.x ?? rest.x, y: fallback?.y ?? rest.y, clear: false };
}

/** A seat between the seat at rest and the seat on the foundation: round the city, `q` of the way (0..1). */
export function swingSeat(rest: Point, anchor: Point, q: number): Point {
  const a0 = Math.atan2(rest.y, rest.x);
  let turn = Math.atan2(anchor.y, anchor.x) - a0;
  turn = ((((turn + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const d0 = Math.hypot(rest.x, rest.y);
  const d = d0 + (Math.hypot(anchor.x, anchor.y) - d0) * q;
  const a = a0 + turn * q;
  return { x: d * Math.cos(a), y: d * Math.sin(a) };
}

// --- The sockets ------------------------------------------------------------------------------------

/**
 * What a socket shows: `empty` a dark recess past the queue, `free` the same dashed (a free slot of
 * the selected city), `queued` a unit ordered (the owner's hatch), `active` the unit under way (its
 * colour sweeping over the hatch), `full` the unit made that waits for room.
 */
export type SocketKind = 'empty' | 'free' | 'queued' | 'active' | 'full';

/** What the snapshot says of a recruit queue, and whether the city is selected. */
export interface QueueState {
  /** Units in the queue, the one in production included (`recruit_queue`). */
  readonly count: number;
  /** Ticks of production of the first unit (`recruit_progress`). */
  readonly progress: number;
  /** Ticks per unit (`ruleset_public.recruit.unit_ticks`). */
  readonly unitTicks: number;
  /** The first unit is made and waits for a place (`recruit_waiting`, DEC-25, item 7). */
  readonly waiting: boolean;
  /** The sockets of the foundation (`recruit.queue_max`). */
  readonly sockets: number;
  readonly selected: boolean;
}

/** The sockets a foundation has: `queue_max`, or the queue when it is longer. */
export function socketCount(state: Pick<QueueState, 'count' | 'sockets'>): number {
  return Math.max(Math.floor(state.sockets), Math.floor(state.count), 1);
}

/** The kind of each socket, left to right. */
export function socketKinds(state: QueueState): SocketKind[] {
  const count = Math.max(0, Math.floor(state.count));
  const out: SocketKind[] = [];
  for (let j = 0; j < socketCount(state); j++) {
    if (j >= count) out.push(state.selected ? 'free' : 'empty');
    else if (j > 0) out.push('queued');
    else out.push(state.waiting ? 'full' : 'active');
  }
  return out;
}

/** The share of the unit under way that is made (0..1); 1 when it waits for room. */
export function activeShare(state: Pick<QueueState, 'progress' | 'unitTicks' | 'waiting'>): number {
  if (state.waiting) return 1;
  if (!(state.unitTicks > 0)) return 0;
  return clamp(state.progress / state.unitTicks, 0, 1);
}

/** The barracks stands on its foundation: the city recruits, or it is selected and may recruit. */
export function foundationOn(count: number, selected: boolean, queueMax: number): boolean {
  return count > 0 || (selected && queueMax > 0);
}

/**
 * The foundation's rim turns amber and dashed: the unit made waits for room (DEC-25, item 7), or a
 * fight in the city stops the production (item 9).
 */
export function foundationAlert(count: number, waiting: boolean, paused: boolean): boolean {
  return count > 0 && (waiting || paused);
}

/** Opacity of the pulsing amber rim: `pulse` is 0..1 (`beaconPulse`); with "less motion" it holds still. */
export function alertAlpha(pulse: number, reduced: boolean): number {
  return reduced ? 1 : FOUNDATION.alert.low + (1 - FOUNDATION.alert.low) * pulse;
}
