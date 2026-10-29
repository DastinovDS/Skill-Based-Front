/**
 * The picture behind the start menu (#471, variant A "Front" of docs/design/mockups/start-menu.html):
 * a map drawn small (the menu map `maps/menu/valley.json`, #474), the own capital at the left of it,
 * the enemy capital far away in the fog.
 * Pure geometry: the map file and the size of the window in, screen points out. It draws nothing
 * and decides nothing about the game; it is decoration, so the road from one capital to the other
 * is a plain shortest path over the map file.
 */
import type { MapFile, Terrain } from '../protocol.gen.ts';

/** What the picture says about the state of the menu (#474: the motion of each, `menuMotion.ts`). */
export type BackdropPhase =
  /** Nothing going on: the supply rides, the enemy capital is a question mark in the fog. */
  | 'idle'
  /** In the queue: a scout walks into the fog, the stack at the front grows. */
  | 'search'
  /** A pair is found: the own order and the opponent's intent meet, the nick shows. */
  | 'found'
  /** The player confirmed the pair: the two groups march and fight. */
  | 'confirmed'
  /** The queue is locked (DEC-34): the supply stands, an amber dashed ring on the own capital. */
  | 'banned';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface SceneNode extends Point {
  readonly id: number;
  readonly city: boolean;
  /** The player that owns it at the start, or null. */
  readonly owner: 0 | 1 | null;
  readonly terrain: Terrain;
}

export interface SceneEdge {
  readonly a: SceneNode;
  readonly b: SceneNode;
  /** Both ends are the viewer's: drawn as a road (the rest are dashed borders). */
  readonly own: boolean;
  /** Road lines: 3 at the capital, 2 elsewhere (decoration, not the level of a road). */
  readonly lines: 2 | 3;
}

export interface Scene {
  readonly width: number;
  readonly height: number;
  /** Px per unit of the map file. */
  readonly scale: number;
  /** Px: the soft terrain blob of a node and the tint of the start territory round it. */
  readonly terrainRadius: number;
  readonly territoryRadius: number;
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  /** The road from the own capital to the enemy one, node by node. */
  readonly front: readonly Point[];
  /** The same road as node ids. */
  readonly frontIds: readonly number[];
  readonly ownCapital: Point;
  readonly enemyCapital: Point;
  /** Node ids of the two capitals: drawn on their own, not with the other cities. */
  readonly capitalIds: readonly [number, number];
  /** Where the fog is solid: the enemy capital stands to the right of it. */
  readonly fogStart: number;
  /** Where the fog begins to fade in; left of it the map is clear. */
  readonly fadeStart: number;
}

/** The text rail takes this much from the left edge (56 px margin and the rail of 430 px). */
export const RAIL_RIGHT = 520;
/**
 * From this window width on the rail stands beside the picture (app.css: below it, or in a window
 * up to 560 px tall, the rail flows over the picture under a flat shade).
 */
export const RAIL_BESIDE_MIN_WIDTH = 900;
/**
 * The panel of the "Dock" screens (lobby, invite, bot; #473) stands right of the rail: from here
 * to `DOCK_PANEL_RIGHT` at the widest (the same numbers are in `.front.docked .panel` of dock.css).
 */
export const DOCK_PANEL_LEFT = 552;
export const DOCK_PANEL_RIGHT = 1052;
/** Under this window width the panel starts closer to the rail, at `DOCK_NARROW_LEFT` (dock.css). */
export const DOCK_NARROW_BELOW = 1100;
export const DOCK_NARROW_LEFT = 470;
/** A map needs at least this much room (px) between the panel and the enemy margin to stand beside it. */
const DOCK_MAP_ROOM = 420;

/** The solid fog is at least this wide at the right edge of the window. */
export const FOG_WIDTH = 250;
/** The soft edge of the fog, left of the solid part. */
export const FOG_FADE = 130;
/**
 * The fog starts below the title bar: the chip of the player in the top right corner (28 px from
 * the top, ~36 px tall) never touches the edge of the fog (owner, #471). The fog fades in over
 * `FOG_TOP_FADE` px below this line.
 */
export const BAR_BOTTOM = 76;
export const FOG_TOP_FADE = 60;
/** Free space from the enemy capital to the right edge of the window. */
const ENEMY_MARGIN = 110;
/** Not above the title bar, not under the legal strip and the tagline. */
const TOP_ROOM = BAR_BOTTOM + FOG_TOP_FADE + 4;
const BOTTOM_ROOM = 100;

const MIN_SCALE = 0.16;
/**
 * The terrain blob and the territory tint by the spacing of the map (the median distance from a node
 * to its nearest neighbour): the look of the menu map sketch MM1 (#474, 58 and 44 units on it).
 */
const TERRAIN_PER_SPACING = 0.52;
const TERRITORY_PER_SPACING = 0.4;

/** The median distance from a node to its nearest neighbour, in map units. */
function spacing(map: MapFile): number {
  const nearest = map.nodes
    .map((n) =>
      Math.min(
        ...map.nodes.filter((o) => o.id !== n.id).map((o) => Math.hypot(o.x - n.x, o.y - n.y)),
      ),
    )
    .filter((d) => Number.isFinite(d))
    .sort((a, b) => a - b);
  return nearest[Math.floor(nearest.length / 2)] ?? 100;
}

/**
 * Where the own capital stands behind a docked panel. A window wide enough puts the whole map to
 * the right of the panel, so the panel never covers the front of the postcard (#473). In a
 * narrower one the panel covers the middle of the map: the own capital stays between the rail and
 * the panel and the enemy capital, with its label, to the right of the panel.
 */
export function dockOwnLeft(width: number): number | undefined {
  const clear = DOCK_PANEL_RIGHT + 56;
  if (width - ENEMY_MARGIN - clear >= DOCK_MAP_ROOM) return clear;
  if (width < RAIL_BESIDE_MIN_WIDTH) return undefined;
  // The own capital stays visible between the rail and the panel.
  return (width < DOCK_NARROW_BELOW ? DOCK_NARROW_LEFT : DOCK_PANEL_LEFT) - 36;
}

function owner(value: number | null): 0 | 1 | null {
  return value === 0 || value === 1 ? value : null;
}

/** Dijkstra over the travel time of the roads; returns node ids from `from` to `to`. */
function shortestPath(map: MapFile, from: number, to: number): number[] {
  const near = new Map<number, { to: number; cost: number }[]>();
  for (const edge of map.edges) {
    near.set(edge.a, [...(near.get(edge.a) ?? []), { to: edge.b, cost: edge.travel_ticks }]);
    near.set(edge.b, [...(near.get(edge.b) ?? []), { to: edge.a, cost: edge.travel_ticks }]);
  }
  const best = new Map<number, number>([[from, 0]]);
  const came = new Map<number, number>();
  const open = new Set<number>([from]);
  while (open.size > 0) {
    let current = -1;
    for (const id of [...open].sort((x, y) => x - y)) {
      if (current === -1 || (best.get(id) ?? Infinity) < (best.get(current) ?? Infinity)) {
        current = id;
      }
    }
    open.delete(current);
    if (current === to) break;
    for (const step of near.get(current) ?? []) {
      const cost = (best.get(current) ?? Infinity) + step.cost;
      if (cost < (best.get(step.to) ?? Infinity)) {
        best.set(step.to, cost);
        came.set(step.to, current);
        open.add(step.to);
      }
    }
  }
  const path = [to];
  while (path[0] !== from) {
    const before = came.get(path[0] as number);
    if (before === undefined) return [from, to];
    path.unshift(before);
  }
  return path;
}

/**
 * Lays the map out for a window of `width` x `height` px: the own capital right of the rail, the
 * enemy capital inside the fog at the right edge, the whole map in between at one scale. A tall
 * map in a short window is shrunk to fit its height; the fog then moves in front of the enemy
 * capital so that it is still hidden. `ownLeft` moves the own capital (`dockOwnLeft`).
 */
export function layoutScene(map: MapFile, width: number, height: number, ownLeft?: number): Scene {
  const capital0 = map.nodes.find((n) => n.capital_of === 0) ?? map.nodes[0];
  const capital1 = map.nodes.find((n) => n.capital_of === 1) ?? map.nodes[map.nodes.length - 1];
  if (capital0 === undefined || capital1 === undefined) {
    return {
      width,
      height,
      scale: MIN_SCALE,
      terrainRadius: 0,
      territoryRadius: 0,
      nodes: [],
      edges: [],
      front: [],
      frontIds: [],
      ownCapital: { x: RAIL_RIGHT, y: height / 2 },
      enemyCapital: { x: width - ENEMY_MARGIN, y: height / 2 },
      capitalIds: [-1, -1],
      fogStart: width - FOG_WIDTH,
      fadeStart: width - FOG_WIDTH - FOG_FADE,
    };
  }
  // Beside the rail the own capital never stands under it or under its key hints (#474: at 1024 px
  // 40% of the width put it at 410 px, under the hints that reach 426 px): the map shrinks instead.
  const left =
    ownLeft ?? (width >= RAIL_BESIDE_MIN_WIDTH ? RAIL_RIGHT : Math.max(width * 0.4, 260));
  const spanX = Math.max(1, capital1.x - capital0.x);
  const wantX = Math.max(80, width - ENEMY_MARGIN - left);
  const fitY = Math.max(80, height - TOP_ROOM - BOTTOM_ROOM) / Math.max(1, map.meta.height);
  const scale = Math.max(MIN_SCALE, Math.min(wantX / spanX, fitY));
  const middle = (TOP_ROOM + height - BOTTOM_ROOM) / 2;
  const at = (n: { x: number; y: number }): Point => ({
    x: left + (n.x - capital0.x) * scale,
    y: middle + (n.y - map.meta.height / 2) * scale,
  });
  const nodes: SceneNode[] = map.nodes.map((n) => ({
    ...at(n),
    id: n.id,
    city: n.kind !== 'province',
    owner: owner(n.start_owner),
    terrain: n.terrain,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: SceneEdge[] = [];
  for (const edge of map.edges) {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (a === undefined || b === undefined) continue;
    edges.push({
      a,
      b,
      own: a.owner === 0 && b.owner === 0,
      lines: edge.a === capital0.id || edge.b === capital0.id ? 3 : 2,
    });
  }
  const frontIds = shortestPath(map, capital0.id, capital1.id);
  const front = frontIds.flatMap((id) => {
    const found = byId.get(id);
    return found === undefined ? [] : [{ x: found.x, y: found.y }];
  });
  const ownCapital = at(capital0);
  const enemyCapital = at(capital1);
  const fogStart = Math.min(width - FOG_WIDTH, enemyCapital.x - 90);
  const gap = spacing(map);
  return {
    width,
    height,
    scale,
    terrainRadius: gap * TERRAIN_PER_SPACING * scale,
    territoryRadius: gap * TERRITORY_PER_SPACING * scale,
    nodes,
    edges,
    front,
    frontIds,
    ownCapital,
    enemyCapital,
    capitalIds: [capital0.id, capital1.id],
    fogStart,
    fadeStart: fogStart - FOG_FADE,
  };
}

/** The points of a star with `tips` tips, for the mark of a capital. */
export function starPoints(cx: number, cy: number, radius: number, tips = 5): string {
  const points: string[] = [];
  for (let i = 0; i < tips * 2; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / tips;
    const r = i % 2 === 1 ? radius * 0.45 : radius;
    points.push(
      `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`,
    );
  }
  return points.join(' ');
}
