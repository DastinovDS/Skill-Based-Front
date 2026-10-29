/**
 * Geometry of the progress marks of an own city (variant A "Cells", #439; ui-style 9.4a): the
 * recruit queue (DEC-25) and the barracks or warehouse build (DEC-26). One cell is one unit of the
 * thing; a state is told by a pattern, not by colour: a free slot is a dashed frame, a queued unit
 * a frame with a dot, a unit in production a hatch growing to a head line, a ready one a solid cell
 * (and a dashed amber ring when it has no room).
 *
 * Pure functions, no PixiJS and no DOM. Every number is from the snapshot (`recruit_queue`,
 * `recruit_progress`, `recruit_waiting`, `building`) and `ruleset_public` (`recruit.unit_ticks`,
 * `recruit.queue_max`, `city_upgrades`); nothing about the rules is decided here (AGENTS.md 7.1).
 */
import type { BuildKind } from '../protocol.gen.ts';
import { ringRadius } from './cityLayout.ts';
import { PROGRESS } from './style.ts';

/** What a queue cell shows. `ready`: the unit is made and waits for a place (DEC-25, item 7). */
export type CellState = 'slot' | 'queued' | 'active' | 'ready';

export interface QueueCell {
  /** Left edge from the middle of the plate. */
  readonly x: number;
  readonly state: CellState;
  /** Width of the growing part inside the cell, whole pixels; only for `active`. */
  readonly fill: number;
}

export interface QueueMark {
  /** Plate size. */
  readonly width: number;
  readonly height: number;
  readonly cells: readonly QueueCell[];
  /** The cell that gets the dashed amber ring (ready with no room, or stopped by a fight); `null`: none. */
  readonly alert: number | null;
}

/** What the snapshot says of a recruit queue, and what the viewer asks for. */
export interface QueueInput {
  /** Units in the queue, the one in production included (`recruit_queue`). */
  readonly count: number;
  /** Ticks of production of the first unit (`recruit_progress`). */
  readonly progress: number;
  /** Ticks per unit (`ruleset_public.recruit.unit_ticks`). */
  readonly unitTicks: number;
  /** The first unit is ready and waits for a place (`recruit_waiting`). */
  readonly waiting: boolean;
  /** A fight is going on in the city: the production stands (DEC-25, item 9). */
  readonly paused: boolean;
  /**
   * Slots to show: the queue length at least; the selected city shows all `queue_max` of them, so the
   * free ones are dashed.
   */
  readonly slots: number;
}

/** Whole pixels of `share` (0..1) of `inner`, so one texture serves a range of progress values. */
export function fillPixels(share: number, inner: number): number {
  if (!(share > 0) || inner <= 0) return 0;
  return Math.min(inner, Math.floor(share * inner));
}

/** Width and height of a plate round `cells` cells wide and `height` tall. */
function plateSize(cellsWidth: number, cellHeight: number): { width: number; height: number } {
  return { width: cellsWidth + 2 * PROGRESS.pad, height: cellHeight + 2 * PROGRESS.pad };
}

/** The inner width of a cell the growing part can fill. */
export const innerWidth = (cellWidth: number): number => cellWidth - 2 * PROGRESS.frame.inset;

/**
 * The queue plate of an own city; `null`: nothing to show (no queue and no free slots).
 * The first unit is `ready` when the server says it waits for a place, `active` once it has made
 * a pixel of progress, else `queued`; the others are `queued`, the rest of the slots `slot`.
 */
export function queueMark(input: QueueInput): QueueMark | null {
  const count = Math.max(0, Math.floor(input.count));
  const slots = Math.max(count, Math.floor(input.slots));
  if (slots <= 0) return null;
  const { width: cw, height: ch, gap } = PROGRESS.cell;
  const plate = plateSize(slots * cw + (slots - 1) * gap, ch);
  const share =
    input.unitTicks > 0 ? Math.min(1, Math.max(0, input.progress / input.unitTicks)) : 0;
  const fill = fillPixels(share, innerWidth(cw));
  const cells: QueueCell[] = [];
  for (let i = 0; i < slots; i++) {
    const x = -plate.width / 2 + PROGRESS.pad + i * (cw + gap);
    if (i >= count) {
      cells.push({ x, state: 'slot', fill: 0 });
    } else if (i > 0) {
      cells.push({ x, state: 'queued', fill: 0 });
    } else if (input.waiting) {
      cells.push({ x, state: 'ready', fill: 0 });
    } else if (fill > 0) {
      cells.push({ x, state: 'active', fill });
    } else {
      cells.push({ x, state: 'queued', fill: 0 });
    }
  }
  const alert = count > 0 && (input.waiting || input.paused) ? 0 : null;
  return { ...plate, cells, alert };
}

export interface BuildMark {
  readonly width: number;
  readonly height: number;
  readonly kind: BuildKind;
  /** Width of the growing part inside the cell, whole pixels. */
  readonly fill: number;
  /** Left edge of the wide cell from the left of the plate. */
  readonly cellX: number;
}

/**
 * The build plate: the badge of the kind (house = barracks, stacked squares = warehouse) and one
 * wide cell filled by `share` (0..1, the part done: from `building.done_tick` and the duration in
 * `ruleset_public.city_upgrades`).
 */
export function buildMark(kind: BuildKind, share: number): BuildMark {
  const { cx, radius } = PROGRESS.badge;
  const cellX = cx + radius + 4;
  const { width: cw, height: ch } = PROGRESS.buildCell;
  const width = cellX + cw + PROGRESS.pad;
  return {
    width,
    height: ch + 2 * PROGRESS.pad,
    kind,
    fill: fillPixels(share, innerWidth(cw)),
    cellX,
  };
}

/** Opacity of a pulsing alert ring: `pulse` is 0..1 (`beaconPulse`); with "less motion" it holds still, fully visible. */
export function alertAlpha(pulse: number, reduced: boolean): number {
  return reduced ? 1 : PROGRESS.alert.low + (1 - PROGRESS.alert.low) * pulse;
}

/** Where the plates sit: the top edge of each, from the city centre (`null` for the one not shown). */
export interface MarkTops {
  readonly queue: number | null;
  readonly build: number | null;
}

/**
 * The queue plate rests just above the capacity ring; the build plate goes above it, or in its place
 * when the city has no queue plate.
 */
export function markTops(
  radius: number,
  queue: QueueMark | null,
  build: BuildMark | null,
): MarkTops {
  const bottom = -(ringRadius(radius) + PROGRESS.ringGap);
  let top = bottom;
  let queueTop: number | null = null;
  if (queue !== null) {
    top -= queue.height;
    queueTop = top;
    top -= PROGRESS.gap;
  }
  const buildTop = build === null ? null : (queue === null ? bottom : top) - build.height;
  return { queue: queueTop, build: buildTop };
}

/**
 * The alert ring of a queue cell: its middle from the city centre (`top`: the top edge of the queue
 * plate) and its size, the cell grown by `PROGRESS.alert.grow` on every side.
 */
export function alertSpot(
  mark: QueueMark,
  top: number,
): { x: number; y: number; width: number; height: number } | null {
  const cell = mark.alert === null ? undefined : mark.cells[mark.alert];
  if (cell === undefined) return null;
  const { width: cw, height: ch } = PROGRESS.cell;
  const grow = PROGRESS.alert.grow;
  return {
    x: cell.x + cw / 2,
    y: top + PROGRESS.pad + ch / 2,
    width: cw + 2 * grow,
    height: ch + 2 * grow,
  };
}

type Pt = readonly [number, number];

/** The part of a convex polygon where `side(point) >= 0` (one step of Sutherland-Hodgman). */
function clip(poly: readonly Pt[], side: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if (a === undefined || b === undefined) continue;
    const da = side(a);
    const db = side(b);
    if (da >= 0) out.push(a);
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * The hatch of the growing part: 45 degree stripes ("/") over a `width` x `height` rectangle with its
 * top left at the origin, as flat polygons. The stripes are anchored to the rectangle's top left
 * corner, so they stay put while the part grows (a head line, not a shimmer). Stripe `k` covers
 * `k * period <= x + y <= k * period + thickness`.
 */
export function hatchPolygons(
  width: number,
  height: number,
  period: number = PROGRESS.hatch.period,
  thickness: number = PROGRESS.hatch.thickness,
): number[][] {
  if (width <= 0 || height <= 0 || period <= 0 || thickness <= 0) return [];
  const rect: Pt[] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const polygons: number[][] = [];
  for (let from = 0; from < width + height; from += period) {
    const to = from + Math.min(thickness, period);
    const band = clip(
      clip(rect, (p) => p[0] + p[1] - from),
      (p) => to - (p[0] + p[1]),
    );
    if (band.length >= 3) polygons.push(band.flatMap((p) => [p[0], p[1]]));
  }
  return polygons;
}
