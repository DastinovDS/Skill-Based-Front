/**
 * The winner moving into a city, "Walk in" (#856; ui-style 54j and "The winner's jump"; the owner's
 * pick of round 3, #829). The server puts the attacker of a node in the node at contact and never moves
 * it; where its icon stands is the client's layout. The attacker of a node fight stands at the gate of
 * the road it came by, just outside the ring, the defender in the middle; when the fight ends with a
 * capture (`fight_ended` with `captured`) and its last shots have landed, the winner walks from the
 * gate into the middle in `DURATION.captureWalk` (0.6 s), and the flood of the capture (#819) starts as
 * it crosses the ring.
 *
 * Pure functions, no PixiJS. Nothing is decided here: the capture, the attacker and the rounds are the
 * server's events; the road an attacker came by is the one it was last seen on (an own group's road, an
 * enemy figure walking to the node), or, when that was never seen (a reload), the road to a neighbour of
 * the attacker's (AGENTS.md 7.1: a place to draw, not a rule). The walk is a tween between two known
 * places, from an event the client already has (7.3: no prediction).
 */
import type { EventMsg, MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { fightFx, placeKey, type RoundFx } from './fightFx.ts';
import { landShare, roundLayout } from './parryLayout.ts';
import { DURATION, easeTravel } from '../theme/tokens.ts';

/** The walk: it leaves this long (s) after the last shot landed, and the flood starts this share into it. */
export const WALK = { after: 0.1, cross: 0.42, gap: 12 } as const;

/** A capture walk: `owner` walks into `node` from tick `start` for `ticks` ticks; the fight ended at `end`. */
export interface Walk {
  readonly node: number;
  readonly owner: PlayerId;
  readonly end: number;
  readonly start: number;
  readonly ticks: number;
}

/**
 * The walks of the captures among `events`: one per `fight_ended` with `captured` in a node. It starts
 * when the last shot of the last round has landed (`landShare` of that `fight_round`, the same tick),
 * and `WALK.after` later.
 */
export function captureWalks(
  events: readonly EventMsg[],
  map: MapFile,
  me: PlayerId,
  roundTicks: number,
  tickHz: number,
): Walk[] {
  const rounds = new Map<string, RoundFx>();
  const radius = (): number => 0;
  for (const event of events) {
    if (event.kind !== 'fight_round') continue;
    const fx = fightFx(event, map, radius);
    if (fx?.kind === 'round') rounds.set(`${String(fx.tick)}:${placeKey(fx.place)}`, fx);
  }
  const walks: Walk[] = [];
  for (const event of events) {
    if (event.kind !== 'fight_ended') continue;
    const fx = fightFx(event, map, radius);
    if (fx?.kind !== 'end' || !fx.captured || fx.place.node === null) continue;
    const attacker = event.data['attacker'];
    const owner = attacker === 0 || attacker === 1 ? attacker : fx.winner;
    if (owner === null) continue;
    const last = rounds.get(`${String(fx.tick)}:${placeKey(fx.place)}`);
    const land = last === undefined ? 0 : landShare(roundLayout(last, me));
    const start = fx.tick + land * Math.max(1, roundTicks) + WALK.after * tickHz;
    walks.push({
      node: fx.place.node,
      owner,
      end: fx.tick,
      start,
      ticks: (DURATION.captureWalk / 1000) * tickHz,
    });
  }
  return walks;
}

/** How far a walk is at the render tick: 0 at the gate (also before it leaves), 1 in the middle; eased. */
export function walkShare(walk: Walk, tick: number): number {
  if (walk.ticks <= 0) return tick >= walk.start ? 1 : 0;
  return easeTravel((tick - walk.start) / walk.ticks);
}

/** Is the walk still under way (or waiting at the gate) at `tick`? */
export function walking(walk: Walk, tick: number): boolean {
  return tick >= walk.end && tick < walk.start + walk.ticks;
}

/**
 * How long after the snapshot of the capture the flood waits (ms), so that it starts as the walker
 * crosses the ring; 0 without a walk.
 */
export function floodDelayMs(walk: Walk, tickHz: number): number {
  if (tickHz <= 0) return 0;
  return Math.max(0, ((walk.start - walk.end + WALK.cross * walk.ticks) / tickHz) * 1000);
}

/**
 * The gate of a node on `road`: just outside the ring (`ring`, world units) on the road towards its
 * other end, as far as half the token (`half`) and `WALK.gap` more. `null` when the road does not touch
 * the node.
 */
export function gatePoint(
  map: MapFile,
  node: number,
  road: number,
  ring: number,
  half: number,
): Point | null {
  const edge = map.edges[road];
  const at = map.nodes[node];
  if (edge === undefined || at === undefined || (edge.a !== node && edge.b !== node)) return null;
  const far = map.nodes[edge.a === node ? edge.b : edge.a];
  if (far === undefined) return null;
  const dx = far.x - at.x;
  const dy = far.y - at.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  const d = Math.min(length / 2, ring + half + WALK.gap);
  return { x: at.x + (dx / length) * d, y: at.y + (dy / length) * d };
}

/**
 * The road `owner` came into `node` by: the one it was last seen on walking there (`seen`), else the
 * road to its own neighbour with the lowest id (`owners` now), else `null`.
 */
export function arrivalRoad(
  map: MapFile,
  node: number,
  owner: PlayerId,
  seen: number | undefined,
  owners: readonly (PlayerId | null)[],
): number | null {
  if (seen !== undefined) {
    const edge = map.edges[seen];
    if (edge !== undefined && (edge.a === node || edge.b === node)) return seen;
  }
  let best: number | null = null;
  map.edges.forEach((edge, id) => {
    if (edge.a !== node && edge.b !== node) return;
    const other = edge.a === node ? edge.b : edge.a;
    if (owners[other] === owner && (best === null || id < best)) best = id;
  });
  return best;
}

/** The point at share `q` of the way from `gate` to `centre`. */
export function walkPoint(gate: Point, centre: Point, q: number): Point {
  return { x: gate.x + (centre.x - gate.x) * q, y: gate.y + (centre.y - gate.y) * q };
}
