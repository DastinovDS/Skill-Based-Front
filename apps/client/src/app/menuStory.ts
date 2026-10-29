/**
 * The places of the scripted story behind the start menu (#474, BG5 "Set"): where the stack
 * gathers, where the two orders meet, where the opponent comes from, which road the scout walks,
 * which roads the supply rides. Plain walks over the laid out map (`layoutScene`), chosen the way
 * the mockup chose them (docs/design/mockups/menu-background.html); decoration, not the game.
 */
import type { Point, Scene, SceneNode } from './menuScene.ts';

export interface Story {
  /** The last own node of the front road: the stack gathers there, the own order sets out from it. */
  readonly frontCity: SceneNode;
  /** The neutral node of the front road nearest the middle of the clear map: the orders meet there. */
  readonly meeting: SceneNode;
  /** Where the opponent's order comes from: a neighbour of the meeting point toward the enemy. */
  readonly entry: SceneNode;
  /** The scout's road: the front road from the own capital, ending on a road inside the fog edge. */
  readonly scoutPath: readonly Point[];
  /** From the own capital to each other own node over own nodes: the roads of the supply. */
  readonly supply: readonly (readonly Point[])[];
  /** Roads with both ends own: a group walks one now and then. */
  readonly ownRoads: readonly (readonly [Point, Point])[];
}

/** How far along its last road the scout stops: inside the fog edge, short of the enemy capital. */
const SCOUT_INTO = 0.6;
/** The scout keeps at least this far from the enemy capital (px). */
const SCOUT_KEEP_OFF = 120;

export function storyOf(scene: Scene): Story | null {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const front = scene.frontIds.flatMap((id) => {
    const node = byId.get(id);
    return node === undefined ? [] : [node];
  });
  if (front.length < 3) return null;
  const near = new Map<number, number[]>();
  for (const edge of scene.edges) {
    near.set(edge.a.id, [...(near.get(edge.a.id) ?? []), edge.b.id]);
    near.set(edge.b.id, [...(near.get(edge.b.id) ?? []), edge.a.id]);
  }
  for (const list of near.values()) list.sort((x, y) => x - y);
  const last = front.length - 1;
  const enemy = front[last] as SceneNode;

  let fi = 0;
  front.forEach((node, i) => {
    if (node.owner === 0) fi = i;
  });
  fi = Math.min(fi, last - 2);
  const frontCity = front[fi] as SceneNode;

  const midX = (frontCity.x + scene.fogStart) / 2;
  let ci = fi + 1;
  let best = Infinity;
  for (let i = fi + 1; i < last; i += 1) {
    const node = front[i] as SceneNode;
    const off = Math.abs(node.x - midX);
    if (node.owner === null && off < best) {
      best = off;
      ci = i;
    }
  }
  const meeting = front[ci] as SceneNode;

  // The scout walks to the last node short of the enemy's, then a part of the next road.
  let si = ci;
  for (let i = ci; i < last; i += 1) if ((front[i] as SceneNode).owner !== 1) si = i;
  const stopFrom = front[si] as SceneNode;
  const stopTo = front[si + 1] as SceneNode;
  const roadLength = Math.hypot(stopTo.x - stopFrom.x, stopTo.y - stopFrom.y) || 1;
  const toEnemy = (p: Point): number => Math.hypot(enemy.x - p.x, enemy.y - p.y);
  let into = SCOUT_INTO;
  const stopAt = (u: number): Point => ({
    x: stopFrom.x + (stopTo.x - stopFrom.x) * u,
    y: stopFrom.y + (stopTo.y - stopFrom.y) * u,
  });
  while (into > 0 && toEnemy(stopAt(into)) < SCOUT_KEEP_OFF) into -= 10 / roadLength;
  const scoutPath: Point[] = [...front.slice(0, si + 1), stopAt(Math.max(0, into))];

  // The opponent comes from a neighbour of the meeting point toward the enemy, off the scout's road.
  const before = front[ci - 1] as SceneNode;
  const after = front[ci + 1] as SceneNode;
  let entry = after;
  let entryX = -Infinity;
  for (const id of near.get(meeting.id) ?? []) {
    const node = byId.get(id);
    if (node === undefined || node === before || node === enemy) continue;
    if (node === stopTo && si === ci) continue;
    if (node.x > meeting.x + 30 && node.x > entryX) {
      entry = node;
      entryX = node.x;
    }
  }

  // Breadth first over own nodes from the capital, neighbours in id order.
  const capital = front[0] as SceneNode;
  const came = new Map<number, number>([[capital.id, -1]]);
  const queue = [capital.id];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const id of near.get(current) ?? []) {
      if (came.has(id) || byId.get(id)?.owner !== 0) continue;
      came.set(id, current);
      queue.push(id);
    }
  }
  const supply: Point[][] = [];
  for (const id of [...came.keys()].sort((x, y) => x - y)) {
    if (id === capital.id) continue;
    const path: Point[] = [];
    for (let at: number | undefined = id; at !== undefined && at !== -1; at = came.get(at)) {
      const node = byId.get(at);
      if (node !== undefined) path.unshift({ x: node.x, y: node.y });
    }
    supply.push(path);
  }

  const ownRoads = scene.edges
    .filter((e) => e.own)
    .map(
      (e) =>
        [
          { x: e.a.x, y: e.a.y },
          { x: e.b.x, y: e.b.y },
        ] as const,
    );

  return { frontCity, meeting, entry, scoutPath, supply, ownRoads };
}
