/**
 * The picture behind the start menu (#471, variant A "Front" of docs/design/mockups/start-menu.html):
 * the own capital at the left, the enemy capital far away in the fog. Since #866 the map lies over
 * the whole window and is cropped by it, as the Lapis mockup has it
 * (docs/design/mockups/out-of-game-style-r2.html): the shade of the screens darkens it towards the
 * left edge. The entry screen lays the whole map over the window, centred (#839, the mockup's entry
 * of out-of-game-style-r3.html).
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

interface SceneEdge {
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

/** The solid fog is at least this wide at the right edge of the window. */
export const FOG_WIDTH = 180;
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
/** Not above the title bar, not under the legal strip and the tagline: the front road in between. */
const TOP_ROOM = BAR_BOTTOM + FOG_TOP_FADE + 4;
const BOTTOM_ROOM = 100;
/** The map is laid out this much larger than it takes to cover the window (#866): it is cropped. */
export const COVER_ZOOM = 1.1;

/** The owners of the picture by node id (`MenuWorld.owners`); without them, the map file's. */
export type Owners = readonly (0 | 1 | null)[];

const MIN_SCALE = 0.16;

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
  owners?: Owners,
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
    owner: owners === undefined ? owner(n.start_owner) : (owners[n.id] ?? null),
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

/** `v` kept within `lo..hi` (`lo` wins when they cross). */
const within = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Lays the map out for a window of `width` x `height` px (#866): the map covers the window at
 * `COVER_ZOOM` times the scale that just covers it, the enemy capital `ENEMY_MARGIN` from the right
 * edge inside the fog and the front road in the middle of the room between the bar and the bottom
 * strip, as far as the map still covers the window. The own capital lies at the left, under the
 * shade of the screens; the window crops the rest.
 */
export function layoutScene(map: MapFile, width: number, height: number, owners?: Owners): Scene {
  const mapWidth = Math.max(1, map.meta.width);
  const mapHeight = Math.max(1, map.meta.height);
  const scale = Math.max(MIN_SCALE, Math.max(width / mapWidth, height / mapHeight) * COVER_ZOOM);
  const ends = capitals(map);
  if (ends === null) {
    return place(
      map,
      width,
      height,
      scale,
      { x: 0, y: 0 },
      { on: true, start: width - FOG_WIDTH },
      owners,
    );
  }
  const [, capital1] = ends;
  const front = shortestPath(map, ends[0].id, capital1.id).flatMap((id) => {
    const node = map.nodes.find((n) => n.id === id);
    return node === undefined ? [] : [node.y];
  });
  const frontMiddle = (Math.min(...front) + Math.max(...front)) / 2;
  const origin = {
    x: within(width - ENEMY_MARGIN - capital1.x * scale, width - mapWidth * scale, 0),
    y: within(
      (TOP_ROOM + height - BOTTOM_ROOM) / 2 - frontMiddle * scale,
      height - mapHeight * scale,
      0,
    ),
  };
  const enemyX = origin.x + capital1.x * scale;
  return place(
    map,
    width,
    height,
    scale,
    origin,
    { on: true, start: Math.min(width - FOG_WIDTH, enemyX - 90) },
    owners,
  );
}

/**
 * The entry screen (#839, the mockup's entry of out-of-game-style-r3.html): the whole map covers
 * the window, centred, and nothing is in the fog.
 */
export function layoutEntry(map: MapFile, width: number, height: number, owners?: Owners): Scene {
  const scale = Math.max(
    MIN_SCALE,
    width / Math.max(1, map.meta.width),
    height / Math.max(1, map.meta.height),
  );
  const origin = {
    x: (width - map.meta.width * scale) / 2,
    y: (height - map.meta.height * scale) / 2,
  };
  return place(map, width, height, scale, origin, { on: false, start: width + FOG_FADE }, owners);
}

/** Px on the screen per world unit of a piece of the map at most (#839): a large map keeps small pieces. */
export const PIECES_PX = 0.8;

/** The size of the pieces against the match (`k`): at most `PIECES_PX` px a unit on the screen. */
export function pieceScale(scene: Scene): number {
  return Math.min(1, PIECES_PX / Math.max(0.05, scene.scale));
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
