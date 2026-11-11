/**
 * Where the barracks and the factory of a city stand (#954, ui-style 73 topic T, P2 "Free side";
 * mockup `docs/design/mockups/city-buildings-r2.html`, `freeGap` and the placement `P2`): outside
 * the capacity ring, in the widest free angle between the roads that leave the city, clear of the VP
 * lozenge and the warehouse side; side by side, or stacked outward (the barracks the outer one) when
 * the angle is narrow. The owed charges of a build are a row of lozenges beyond the icon, the recruit
 * queue a column of helmets beyond the barracks.
 *
 * Pure functions, no PixiJS. The only inputs are the map's roads (public and static: the angles at
 * which they leave a city), the radius of the city, whether it carries a VP lozenge and which
 * buildings the snapshot gives it; nothing about the rules is decided here (AGENTS.md 7.1). Angles
 * are radians on screen (y grows down): 0 is to the right, `PI / 2` straight down.
 */
import type { MapFile } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { ringRadius } from './cityLayout.ts';
import { BUILDING, LOZENGE, RECRUIT_PIPS, RING_ENGRAVED, VP_BADGE_LIFT } from './style.ts';

export type BuildingKind = 'barracks' | 'factory';

export const BUILDING_KINDS: readonly BuildingKind[] = ['barracks', 'factory'];

const TAU = 2 * Math.PI;

/**
 * The size of a building icon at `cameraScale` css px per world unit, in world units across its
 * box: `BUILDING.world` near zoom 1, and big enough to stay `BUILDING.minPx` css px zoomed out.
 * Rounded up to a quarter octave, so that a zoom gesture lays the buildings out again only now and
 * then.
 */
export function iconSize(cameraScale: number): number {
  const raw = Math.max(BUILDING.world, BUILDING.minPx / Math.max(1e-3, cameraScale));
  return BUILDING.world * 2 ** (Math.ceil(Math.log2(raw / BUILDING.world) * 4 - 1e-9) / 4);
}

/**
 * The scale of a recruit helmet at `cameraScale`: at least 1, and big enough to stay `screen` css
 * px per unit of its drawing down to the zoom where that needs more than the minimum; zoomed out
 * further it grows only by the power `keep` of the zoom (#869). Rounded up to a quarter octave.
 */
export function pipScale(cameraScale: number): number {
  const { minScale, screen, keep } = BUILDING.pips;
  const out = screen / minScale / Math.max(1e-3, cameraScale);
  const exact = minScale * Math.max(1, out) ** keep;
  return 2 ** (Math.ceil(Math.log2(exact) * 4) / 4) / minScale;
}

/** The angle at which every road leaves each city of the map (the roads are straight and static). */
export function roadAngles(map: MapFile): number[][] {
  const out: number[][] = map.nodes.map(() => []);
  for (const edge of map.edges) {
    const a = map.nodes[edge.a];
    const b = map.nodes[edge.b];
    if (a === undefined || b === undefined) continue;
    out[edge.a]?.push(Math.atan2(b.y - a.y, b.x - a.x));
    out[edge.b]?.push(Math.atan2(a.y - b.y, a.x - b.x));
  }
  return out;
}

const polar = (angle: number, dist: number): Point => ({
  x: dist * Math.cos(angle),
  y: dist * Math.sin(angle),
});

/** Half the drawn extent of an icon of `size`, casing included. */
export function iconHalf(size: number): number {
  return BUILDING.half * size;
}

/** The scale of a lozenge of the owed row by the icon's size (1 is the warehouse's). */
export function lozengeScale(size: number): number {
  const { min, max, share, ref } = BUILDING.lozenge;
  return Math.max(min, Math.min(max, (share * size) / ref));
}

/**
 * The widest free angle between the roads, seen from a ring of distance `dist`: each road blocks a
 * half-width of `free.road` units, the VP lozenge (when `vp`, at -45 degrees) `free.vp`, and the
 * warehouse side (straight down) `free.store` radians either side. `mid`: its middle, `width`: its
 * span (0 when nothing is free: `mid` is then the left).
 */
export function freeGap(
  roads: readonly number[],
  dist: number,
  vp: boolean,
): { mid: number; width: number } {
  const { road, vp: vpHalf, store } = BUILDING.free;
  const blocks: [number, number][] = roads.map((a) => [a, Math.asin(Math.min(1, road / dist))]);
  if (vp) blocks.push([-Math.PI / 4, Math.asin(Math.min(1, vpHalf / dist))]);
  blocks.push([Math.PI / 2, store]);
  const spans = blocks
    .map(([a, half]): [number, number] => {
      const c = ((a % TAU) + TAU) % TAU;
      return [c - half, c + half];
    })
    .sort((p, q) => p[0] - q[0]);
  let best = { mid: Math.PI, width: 0 };
  spans.forEach(([, end], i) => {
    const next = i + 1 < spans.length ? (spans[i + 1]?.[0] ?? end) : (spans[0]?.[0] ?? 0) + TAU;
    let reach = end;
    for (let j = 0; j <= i; j++) reach = Math.max(reach, spans[j]?.[1] ?? reach);
    const width = next - reach;
    if (width > best.width) best = { mid: reach + width / 2, width };
  });
  return best;
}

/** What one city shows of its buildings. */
export interface BuildingInput {
  /** The radius of the city body (`cityRadius`, the province's is not used: a province has none). */
  readonly radius: number;
  /** The angles of the roads that leave it (`roadAngles`). */
  readonly roads: readonly number[];
  /** The city carries the VP lozenge. */
  readonly vp: boolean;
  /** The buildings to seat: built ones and ones being built. */
  readonly kinds: readonly BuildingKind[];
  /** The icon size now (`iconSize`). */
  readonly size: number;
}

export interface BuildingLayout {
  readonly size: number;
  /** The middle of each icon's art box, from the city centre, and its direction away from the centre. */
  readonly items: Readonly<Partial<Record<BuildingKind, Point>>>;
  readonly angles: Readonly<Partial<Record<BuildingKind, number>>>;
  /** Where the recruit queue stands: its angle and its distance from the city centre. */
  readonly queue: { readonly angle: number; readonly dist: number };
  /** The free angle the seats were taken from. */
  readonly gap: { readonly mid: number; readonly width: number };
}

/**
 * The seats of the buildings of a city (the mockup's P2): one icon in the middle of the free angle;
 * two side by side when the angle is wide enough for both, else on one line outward, the barracks the
 * outer one, so its recruit queue stands beyond it.
 */
export function layoutBuildings(input: BuildingInput): BuildingLayout {
  const { radius, roads, vp, kinds, size } = input;
  const half = iconHalf(size);
  const dist = ringRadius(radius) + RING_ENGRAVED.cut / 2 + BUILDING.free.ringAir + half;
  const gap = freeGap(roads, dist, vp);
  const step = 2 * half + BUILDING.free.sep;
  const side = gap.width >= step / dist + (2 * half) / dist;
  const items: Partial<Record<BuildingKind, Point>> = {};
  const angles: Partial<Record<BuildingKind, number>> = {};
  kinds.forEach((kind, i) => {
    let at: Point;
    if (kinds.length === 1) at = polar(gap.mid, dist);
    else if (side) at = polar(gap.mid + ((i === 0 ? -1 : 1) * step) / dist / 2, dist);
    else at = polar(gap.mid, dist + (kind === 'barracks' ? 1 : 0) * step);
    items[kind] = at;
    angles[kind] = Math.atan2(at.y, at.x);
  });
  const barracks = items.barracks ?? polar(gap.mid, dist);
  const angle = Math.atan2(barracks.y, barracks.x);
  return {
    size,
    items,
    angles,
    queue: { angle, dist: Math.hypot(barracks.x, barracks.y) + half + BUILDING.queue.gap },
    gap,
  };
}

/**
 * The centres of `slots` recruit helmets of scale `scale` (`pipScale`): in a column outward beyond the
 * barracks along its direction, `BUILDING.queue.pitch` apart (times the scale), the first one
 * `BUILDING.queue.gap` past the icon. A column beyond the icon keeps the clearance the icon was
 * given from the roads and the VP lozenge, whatever its length (the gaps only widen outward), and a
 * helmet keeps its place as the queue grows.
 */
export function queueSeats(layout: BuildingLayout, slots: number, scale = 1): Point[] {
  const { angle, dist } = layout.queue;
  const first = dist + (RECRUIT_PIPS.width / 2) * (scale - 1);
  const out: Point[] = [];
  for (let j = 0; j < slots; j++) out.push(polar(angle, first + j * BUILDING.queue.pitch * scale));
  return out;
}

/** The row of owed charges beside an icon: `cost` lozenge centres, the scale of each, in payment order. */
export interface OwedRow {
  readonly k: number;
  readonly slots: readonly Point[];
}

/**
 * The owed charges of a build of `cost` charges (the menu's price row): a row just outside the icon
 * at `item` along its direction `angle` from the city centre, laid across it and centred.
 */
export function owedRow(item: Point, angle: number, size: number, cost: number): OwedRow {
  const k = lozengeScale(size);
  const out = iconHalf(size) + BUILDING.row.gap + LOZENGE.casing * k * BUILDING.row.rim;
  const middle = { x: item.x + Math.cos(angle) * out, y: item.y + Math.sin(angle) * out };
  const across = { x: -Math.sin(angle), y: Math.cos(angle) };
  const pitch = LOZENGE.pitch * k * BUILDING.lozenge.pitch;
  const n = Math.max(0, Math.floor(cost));
  const slots: Point[] = [];
  for (let j = 0; j < n; j++) {
    const d = (j - (n - 1) / 2) * pitch;
    slots.push({ x: middle.x + across.x * d, y: middle.y + across.y * d });
  }
  return { k, slots };
}

/** Where the VP lozenge of a city of `radius` stands, from its centre (`vpBadgeAt`'s place). */
export function vpSeat(radius: number): Point {
  return polar(-Math.PI / 4, ringRadius(radius) + VP_BADGE_LIFT);
}
