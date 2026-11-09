/**
 * The pieces of the map behind the screens before a match in the Engraved look of the match
 * (#839, after #829): the start territory as the Border band with the engraved border, roads as the
 * match draws them, cities as engraved discs on their capacity ring. Pure geometry for SVG: path
 * strings in world units of the map file (the picture scales them with one transform), reusing the
 * match's own layout functions (`render/territory.ts`, `render/regionLayout.ts`,
 * `render/cityLayout.ts`) and sizes (`render/style.ts`, `render/engraving.ts` for the band).
 * Decoration: nothing here is game state, the owners are those of the map file at the start.
 */
import type { GeoFile } from '../map/geography.ts';
import type { MapFile } from '../protocol.gen.ts';
import { capacityRing, ringRadius } from '../render/cityLayout.ts';
import { territoryBorders, type Border } from '../render/regionLayout.ts';
import { ROAD_LANE } from '../render/style.ts';
import { territoryOf, type Territory } from '../render/territory.ts';
import { menuCityRadius, type Point } from './menuScene.ts';

/**
 * The Border band and the engraved border of the match (`BORDER_BAND`, `BORDER_ENGRAVING` of
 * `render/engraving.ts`, kept here as numbers: that module carries PixiJS).
 */
export const MENU_BORDER = {
  band: { depth: 13, pitch: 3.2, width: 0.85, alpha: 0.85 },
  cut: { inset: 0, width: 1.6, alpha: 0.85 },
  rule: { inset: 2.4, width: 1.1 },
  rule2: { inset: 4.6, width: 1.1 },
  beads: { inset: 5, step: 5.5, radius: 0.95 },
} as const;

/** Segments as one SVG path: a run of segments that meet end to start is one polyline. */
export function segmentsPath(
  segments: readonly { readonly a: Point; readonly b: Point }[],
): string {
  const f = (v: number): string => v.toFixed(1);
  let d = '';
  let last: Point | null = null;
  for (const { a, b } of segments) {
    if (last === null || Math.hypot(a.x - last.x, a.y - last.y) > 1e-6) {
      d += `M${f(a.x)} ${f(a.y)}`;
    }
    d += `L${f(b.x)} ${f(b.y)}`;
    last = b;
  }
  return d;
}

/** A polygon as a closed SVG path. */
function polygonPath(points: readonly Point[]): string {
  return points.length < 3
    ? ''
    : `M${points.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}Z`;
}

export interface SideLand {
  /** The areas of the side, for a clip of its band. */
  readonly cells: string;
  /** Its land borders (not along water), stroked twice the band deep and clipped to the areas. */
  readonly band: string;
  /** The dark cut on its border, its rule inside it and the second rule (own) or the beads (enemy). */
  readonly cut: string;
  readonly rule: string;
  readonly inner: string;
}

export interface MenuLand {
  readonly own: SideLand;
  readonly enemy: SideLand;
}

/** The areas of a map, worked out once per map (a capture redraws the land with other owners). */
const territories = new WeakMap<MapFile, { readonly geo: GeoFile | null; readonly t: Territory }>();

/** The areas of the nodes of `map`: the vector file's, or the Voronoi cells without one. */
export function menuTerritory(map: MapFile, geo: GeoFile | null): Territory {
  const known = territories.get(map);
  if (known !== undefined && known.geo === geo) return known.t;
  const t = territoryOf(map, geo);
  territories.set(map, { geo, t });
  return t;
}

/**
 * The territory of the menu map: the areas of the vector file (or the Voronoi cells), the border
 * lines at the match's insets times `k` (the size of the pieces against the match). The owners
 * are `given` by node id (the picture's front, `MenuWorld.owners`), else the map file's.
 */
export function menuLand(
  map: MapFile,
  geo: GeoFile | null,
  k = 1,
  given?: readonly (0 | 1 | null)[],
): MenuLand {
  const territory = menuTerritory(map, geo);
  const owners =
    given ??
    map.nodes.map((n) => (n.start_owner === 0 || n.start_owner === 1 ? n.start_owner : null));
  const at = (inset: number): Border[] =>
    territoryBorders(territory.cells, owners, inset * k, territory.edges);
  const B = MENU_BORDER;
  const cut = at(B.cut.inset);
  const rule = at(B.rule.inset);
  const rule2 = at(B.rule2.inset);
  const beads = at(B.beads.inset);
  const side = (owner: 0 | 1): SideLand => {
    const of = (list: readonly Border[]): Border[] => list.filter((b) => b.owner === owner);
    return {
      cells: territory.cells
        .flatMap((cell, i) => (owners[i] === owner ? [polygonPath(cell)] : []))
        .join(''),
      band: segmentsPath(of(cut).filter((b) => b.water !== true && b.neighbour !== null)),
      cut: segmentsPath(of(cut)),
      rule: segmentsPath(of(rule)),
      inner: segmentsPath(of(owner === 0 ? rule2 : beads)),
    };
  };
  return { own: side(0), enemy: side(1) };
}

/** An arc of radius `r` round `c` from angle `from` to `to` (radians) as an SVG path. */
export function arcPath(c: Point, r: number, from: number, to: number): string {
  const x0 = c.x + r * Math.cos(from);
  const y0 = c.y + r * Math.sin(from);
  const x1 = c.x + r * Math.cos(to);
  const y1 = c.y + r * Math.sin(to);
  const large = to - from > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r.toFixed(2)} ${r.toFixed(2)} 0 ${String(large)} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** The capacity of a node of `kind` on the menu map (decoration, by the kind's look in the match). */
const CAPACITY: Readonly<Record<string, number>> = {
  capital: 10,
  city_large: 8,
  city_medium: 6,
  city_small: 4,
};

/**
 * The capacity ring of the match (`RING_ENGRAVED`): every place on a dark cut `cut` wide, room two
 * ink hairlines `offset` either side of the ring.
 */
export const MENU_RING = { cut: 6, room: { width: 0.8, offset: 1.5 } } as const;

export interface MenuCity {
  /** World units. */
  readonly at: Point;
  readonly radius: number;
  /**
   * The capacity ring: its radius, the places as arcs on it (`cut`) and the two hairlines of room
   * either side (`room`); all room, the menu shows no garrison.
   */
  readonly ring: { readonly radius: number; readonly cut: string; readonly room: string };
}

/** A city of `kind` at `at` (world units): its disc and its capacity ring of empty places. */
export function menuCity(kind: string, at: Point): MenuCity {
  const radius = menuCityRadius(kind as Parameters<typeof menuCityRadius>[0]);
  const ring = ringRadius(radius);
  const arcs = capacityRing(CAPACITY[kind] ?? 4, 0).arcs;
  const along = (r: number): string => arcs.map((arc) => arcPath(at, r, arc.from, arc.to)).join('');
  const off = MENU_RING.room.offset;
  return {
    at,
    radius,
    ring: { radius: ring, cut: along(ring), room: along(ring - off) + along(ring + off) },
  };
}

/** Width of one lane of a road (the match's `ROAD_LANE`): every road of the map starts at level 1. */
export const MENU_LANE = ROAD_LANE.width;
