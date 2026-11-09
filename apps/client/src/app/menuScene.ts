/**
 * The picture behind the start menu (#471, variant A "Front" of docs/design/mockups/start-menu.html):
 * a map drawn small (the menu map `maps/menu/valley.json`, #474), the own capital at the left of it,
 * the enemy capital far away in the fog. The entry screen lays the whole map over the window
 * instead (#839, the mockup's entry of out-of-game-style-r3.html).
 * Pure geometry: the map file and the size of the window in, screen points out. It draws nothing
 * and decides nothing about the game; it is decoration, so the road from one capital to the other
 * is a plain shortest path over the map file.
 */
import type { MapFile, NodeKind } from '../protocol.gen.ts';

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
  readonly kind: NodeKind;
  readonly name: string;
  /** The player that owns it at the start, or null. */
  readonly owner: 0 | 1 | null;
  /** Where it stands on the map file (world units): the map layer is drawn in these. */
  readonly world: Point;
}

export interface SceneEdge {
  readonly a: SceneNode;
  readonly b: SceneNode;
  /** Both ends are the viewer's: an own road (the rest are buffer roads, or dotted in the fog). */
  readonly own: boolean;
}

export interface Scene {
  readonly width: number;
  readonly height: number;
  /** Px per unit of the map file. */
  readonly scale: number;
  /** Where the point 0,0 of the map file is on the screen (px): the baked ground starts there. */
  readonly origin: Point;
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
  /** The enemy side lies in the fog (the menus); the entry screen shows the whole map. */
  readonly fog: boolean;
  /** Where the fog is solid: the enemy capital stands to the right of it. */
  readonly fogStart: number;
  /** Where the fog begins to fade in; left of it the map is clear. */
  readonly fadeStart: number;
}

/**
 * The rail of text of the main screen (front.css `.front .rail`, #845): 128 px from the left edge
 * (64 px in a window under 1280 px) and 540 px wide (the ways to play with their rules).
 */
export const RAIL = { left: 128, narrowLeft: 64, narrowBelow: 1280, width: 540 } as const;
/** Room between the rail and the own capital: its capacity ring and the name under it. */
const RAIL_CLEAR = 34;
/** The own capital stands this far from the left edge at least: right of the rail of text. */
export function railRight(width: number): number {
  return (width < RAIL.narrowBelow ? RAIL.narrowLeft : RAIL.left) + RAIL.width + RAIL_CLEAR;
}
/**
 * From this window width on the rail stands beside the picture (front.css: below it, or in a window
 * up to 560 px tall, the rail flows over the picture under a flat shade).
 */
export const RAIL_BESIDE_MIN_WIDTH = 900;
/**
 * The panel of the "Dock" screens (bot, invite, open matches; dock.css `.front.docked .panel`,
 * #845): from `left` to 64 px short of the right edge (24 px under 1280 px), at most `maxWidth` wide.
 */
export const DOCK_PANEL = {
  left: 334,
  maxWidth: 960,
  right: 64,
  narrowRight: 24,
  narrowBelow: 1280,
} as const;
/** The right edge of the Dock panel in a window `width` px wide. */
export function dockPanelRight(width: number): number {
  const margin = width < DOCK_PANEL.narrowBelow ? DOCK_PANEL.narrowRight : DOCK_PANEL.right;
  return Math.min(width - margin, DOCK_PANEL.left + DOCK_PANEL.maxWidth);
}
/** A map needs at least this much room (px) between the panel and the enemy margin to stand beside it. */
const DOCK_MAP_ROOM = 420;

/** The solid fog is at least this wide at the right edge of the window. */
export const FOG_WIDTH = 250;
/** The soft edge of the fog, left of the solid part. */
export const FOG_FADE = 130;
/**
 * The fog starts below the title bar (72 px and its doubled rule, front.css): the player in the top
 * right corner never touches the edge of the fog (owner, #471). The fog fades in over
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
 * Where the own capital stands behind a docked panel. A window wide enough puts the whole map to
 * the right of the panel (#473). Otherwise the panel, translucent stone, covers most of the window
 * and the map lies under it as on the main screen.
 */
export function dockOwnLeft(width: number): number | undefined {
  const clear = dockPanelRight(width) + 56;
  if (width - ENEMY_MARGIN - clear >= DOCK_MAP_ROOM) return clear;
  return undefined;
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

/** The capitals of a map file: the own (player 0) and the enemy's. */
function capitals(map: MapFile): [MapFile['nodes'][number], MapFile['nodes'][number]] | null {
  const capital0 = map.nodes.find((n) => n.capital_of === 0) ?? map.nodes[0];
  const capital1 = map.nodes.find((n) => n.capital_of === 1) ?? map.nodes[map.nodes.length - 1];
  return capital0 === undefined || capital1 === undefined ? null : [capital0, capital1];
}

/** The nodes, the roads and the front road of `map` placed at `origin` px with `scale` px a unit. */
function place(
  map: MapFile,
  width: number,
  height: number,
  scale: number,
  origin: Point,
  fog: { readonly on: boolean; readonly start: number },
): Scene {
  const ends = capitals(map);
  const at = (n: { x: number; y: number }): Point => ({
    x: origin.x + n.x * scale,
    y: origin.y + n.y * scale,
  });
  const nodes: SceneNode[] = map.nodes.map((n) => ({
    ...at(n),
    id: n.id,
    city: n.kind !== 'province',
    kind: n.kind,
    name: n.name,
    owner: owner(n.start_owner),
    world: { x: n.x, y: n.y },
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: SceneEdge[] = [];
  for (const edge of map.edges) {
    const a = byId.get(edge.a);
    const b = byId.get(edge.b);
    if (a === undefined || b === undefined) continue;
    edges.push({ a, b, own: a.owner === 0 && b.owner === 0 });
  }
  const frontIds = ends === null ? [] : shortestPath(map, ends[0].id, ends[1].id);
  const front = frontIds.flatMap((id) => {
    const found = byId.get(id);
    return found === undefined ? [] : [{ x: found.x, y: found.y }];
  });
  return {
    width,
    height,
    scale,
    origin,
    nodes,
    edges,
    front,
    frontIds,
    ownCapital: ends === null ? { x: 0, y: height / 2 } : at(ends[0]),
    enemyCapital: ends === null ? { x: width, y: height / 2 } : at(ends[1]),
    capitalIds: ends === null ? [-1, -1] : [ends[0].id, ends[1].id],
    fog: fog.on,
    fogStart: fog.start,
    fadeStart: fog.start - FOG_FADE,
  };
}

/**
 * Lays the map out for a window of `width` x `height` px: the own capital right of the rail, the
 * enemy capital inside the fog at the right edge, the whole map in between at one scale. A tall
 * map in a short window is shrunk to fit its height; the fog then moves in front of the enemy
 * capital so that it is still hidden. `ownLeft` moves the own capital (`dockOwnLeft`).
 */
export function layoutScene(map: MapFile, width: number, height: number, ownLeft?: number): Scene {
  const ends = capitals(map);
  if (ends === null) {
    return place(
      map,
      width,
      height,
      MIN_SCALE,
      { x: 0, y: 0 },
      {
        on: true,
        start: width - FOG_WIDTH,
      },
    );
  }
  const [capital0, capital1] = ends;
  // Beside the rail the own capital never stands under it (#474, #839: the rail of #845 is 540 px
  // wide from 128 px): the map shrinks instead.
  const left =
    ownLeft ?? (width >= RAIL_BESIDE_MIN_WIDTH ? railRight(width) : Math.max(width * 0.4, 260));
  const spanX = Math.max(1, capital1.x - capital0.x);
  const wantX = Math.max(80, width - ENEMY_MARGIN - left);
  const fitY = Math.max(80, height - TOP_ROOM - BOTTOM_ROOM) / Math.max(1, map.meta.height);
  const scale = Math.max(MIN_SCALE, Math.min(wantX / spanX, fitY));
  const middle = (TOP_ROOM + height - BOTTOM_ROOM) / 2;
  const origin = {
    x: left - capital0.x * scale,
    y: middle - (map.meta.height / 2) * scale,
  };
  const enemyX = origin.x + capital1.x * scale;
  return place(map, width, height, scale, origin, {
    on: true,
    start: Math.min(width - FOG_WIDTH, enemyX - 90),
  });
}

/**
 * The entry screen (#839, the mockup's entry of out-of-game-style-r3.html): the whole map covers
 * the window, centred, and nothing is in the fog.
 */
export function layoutEntry(map: MapFile, width: number, height: number): Scene {
  const scale = Math.max(
    MIN_SCALE,
    width / Math.max(1, map.meta.width),
    height / Math.max(1, map.meta.height),
  );
  const origin = {
    x: (width - map.meta.width * scale) / 2,
    y: (height - map.meta.height * scale) / 2,
  };
  return place(map, width, height, scale, origin, { on: false, start: width + FOG_FADE });
}

/**
 * The radius of a city of `kind` on the menu map (world units, as `cityRadius` of the match by the
 * capacity of the kind in the played ruleset): decoration, the menu has no ruleset.
 */
export function menuCityRadius(kind: NodeKind): number {
  switch (kind) {
    case 'capital':
    case 'city_large':
      return 20;
    case 'city_medium':
      return 17;
    case 'city_small':
      return 14;
    default:
      return 8;
  }
}

/** The points of a star with `tips` tips, for the mark of a capital. */
export function starPoints(cx: number, cy: number, radius: number, tips = 5, inner = 0.45): string {
  const points: string[] = [];
  for (let i = 0; i < tips * 2; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / tips;
    const r = i % 2 === 1 ? radius * inner : radius;
    points.push(
      `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`,
    );
  }
  return points.join(' ');
}
