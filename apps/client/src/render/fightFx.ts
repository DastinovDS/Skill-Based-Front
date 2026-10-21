/**
 * Timing and geometry of the fight animation (DEC-24; ui-style 9.9): the arena over a fight going
 * on, the exchange of blows of the last round, the losses that pop up after a round and the way a
 * fight ends.
 *
 * Pure functions, no PixiJS and no DOM. Nothing here decides what happened in a fight: places,
 * the units of the sides, the shots of the last round, losses, the winner and the capture come from
 * the server (`view.fights`, its `last_round`, and the events `fight_round` and `fight_ended`;
 * AGENTS.md 7.1). Since DEC-29 (#294) the last round of the view carries the shots of both sides
 * with the virtual (bonus) ones apart. A fight without it (an old replay: #323) has no arrows.
 */
import type { EventMsg, FightRoundView, FightView, MapFile, PlayerId } from '../protocol.gen.ts';
import type { RenderGroup } from '../net/interpolate.ts';
import type { Point } from './camera.ts';
import { ringRadius } from './cityLayout.ts';
import { fightPoint } from './layout.ts';

/** Radius of the arena disc. */
export const ARENA_RADIUS = 24;
/**
 * The arena of a fight in a city floats this far above the ring of the city (its lower arrow and
 * label reach `ARENA_REACH` below the middle of the arena, so the gap clears them).
 */
export const ARENA_GAP_NODE = 52;
/** The arena of a fight on a road floats this far above its meeting point. */
export const ARENA_GAP_EDGE = 58;
/** How far the arrows and their labels reach from the middle of the arena (top and bottom). */
export const ARENA_REACH = 46;

/** Where a fight is: the true place (a city, or the meeting point on a road) and its arena. */
export interface FightPlace {
  readonly node: number | null;
  readonly edge: number | null;
  /** The city, or the meeting point on the road. */
  readonly at: Point;
  /** The middle of the arena. */
  readonly arena: Point;
}

/**
 * The place of a fight: `node`, or `edge` with the twice-point of DEC-24 C3. `radiusOf` is the
 * radius of a city now. `undefined`: an unknown place.
 */
export function fightPlace(
  map: MapFile,
  node: number | null,
  edge: number | null,
  point: number | null,
  radiusOf: (node: number) => number,
): FightPlace | undefined {
  const at = fightPoint(map, node, edge, point);
  if (at === undefined) return undefined;
  const lift = node === null ? ARENA_GAP_EDGE : ringRadius(radiusOf(node)) + ARENA_GAP_NODE;
  return { node, edge, at, arena: { x: at.x, y: at.y - lift } };
}

/** One round of a fight, from `fight_round` (or the instant `fight` of replays up to sim 9). */
export interface RoundFx {
  readonly kind: 'round';
  readonly tick: number;
  readonly place: FightPlace;
  readonly losses: readonly [number, number];
}

/** The end of a fight, from `fight_ended`. */
export interface EndFx {
  readonly kind: 'end';
  readonly tick: number;
  readonly place: FightPlace;
  readonly winner: PlayerId | null;
  readonly captured: boolean;
  /** Losses of the whole fight. */
  readonly losses: readonly [number, number];
  /** An old replay's instant fight: its numbers pop up, but it has no result to tell. */
  readonly legacy: boolean;
}

export type FightFx = RoundFx | EndFx;

function intField(data: EventMsg['data'], key: string): number | null {
  const value = data[key];
  return typeof value === 'number' ? value : null;
}

/**
 * A fight event as an effect, or `null` if it is not one, names an unknown place or lacks the
 * losses. `fight_started` is not an effect of its own: the arena shows from the view.
 */
export function fightFx(
  event: EventMsg,
  map: MapFile,
  radiusOf: (node: number) => number,
): FightFx | null {
  const { kind, data } = event;
  if (kind !== 'fight_round' && kind !== 'fight_ended' && kind !== 'fight') return null;
  const losses0 = intField(data, 'losses_0');
  const losses1 = intField(data, 'losses_1');
  if (losses0 === null || losses1 === null) return null;
  const place = fightPlace(
    map,
    intField(data, 'node'),
    intField(data, 'edge'),
    intField(data, 'point'),
    radiusOf,
  );
  if (place === undefined) return null;
  const losses = [losses0, losses1] as const;
  if (kind === 'fight_round') {
    return {
      kind: 'round',
      tick: event.tick,
      place,
      losses,
    };
  }
  const winner = data['winner'];
  return {
    kind: 'end',
    tick: event.tick,
    place,
    winner: winner === 0 || winner === 1 ? winner : null,
    captured: data['captured'] === true,
    losses,
    legacy: kind === 'fight',
  };
}

/** How a fight ended, as the label tells it. */
export type FightResult = 'captured' | 'held' | 'bounced';

/**
 * The end in a word: the node went to the winner (`captured`), the winner kept the place
 * (`held`), or nobody won and both sides turned back (`bounced`).
 */
export function fightResult(end: EndFx): FightResult {
  if (end.captured) return 'captured';
  return end.winner === null ? 'bounced' : 'held';
}

// --- Time ---------------------------------------------------------------------------------------

/** The loss numbers of a round stay this long. */
export const LOSS_POP_MS = 1500;
/** The end of a fight stays this long. */
export const END_FX_MS = 3000;
/** The arrows of a round grow over this many ticks. */
export const EXCHANGE_GROW_TICKS = 3;

/**
 * The arrows of the last round of a fight: they grow from the shooter to the opponent over
 * `EXCHANGE_GROW_TICKS`, then stay until the next round replaces them; if no next round comes
 * (the fight stalls) they fade between one and two rounds after the shots. `age`: ticks since the
 * round (fractional); `reduced` motion: no growing, the arrow is there whole.
 */
export function exchangeLook(
  age: number,
  roundTicks: number,
  reduced: boolean,
): { grow: number; alpha: number } {
  const grow = reduced ? 1 : Math.min(1, Math.max(0, age / EXCHANGE_GROW_TICKS));
  const hold = Math.max(1, roundTicks) * 1.2;
  const fade = Math.max(1, roundTicks) * 0.8;
  return { grow, alpha: Math.min(1, Math.max(0, 1 - (age - hold) / fade)) };
}

// --- Sides of an arena --------------------------------------------------------------------------

/** The units of one side of a fight: all of them, and the charged ones among them. */
export interface SideCount {
  readonly units: number;
  readonly charged: number;
}

export interface ArenaSides {
  /** The viewing player and the opponent. */
  readonly own: SideCount;
  readonly enemy: SideCount;
}

/**
 * The units of both sides of a fight going on: the own groups of the fight (the view lists them),
 * and the enemy's exact units and charged ones of the view, plus the groups of the opponent when
 * the frame shows both sides (a replay).
 */
export function arenaSides(
  fight: FightView,
  groups: readonly RenderGroup[],
  me: PlayerId,
): ArenaSides {
  const ids = new Set(fight.groups);
  const own = { units: 0, charged: 0 };
  const enemy = { units: fight.enemy_units, charged: fight.enemy_charged };
  for (const item of groups) {
    if (!ids.has(item.group.id)) continue;
    const side = (item.owner ?? me) === me ? own : enemy;
    side.units += item.group.units;
    side.charged += item.group.charged;
  }
  return { own, enemy };
}

/**
 * Where the charged part of a half of the arena ends: the half is cut across by a horizontal line,
 * the charged units below it (like a charge gauge filling from the bottom), the discharged above.
 * `y` of the line, from the middle of the arena (down is positive): `radius` with no charged unit,
 * `-radius` with all charged (or with no unit at all: nothing to cut).
 */
export function chargeLine(side: SideCount, radius: number): number {
  if (side.units <= 0) return -radius;
  const share = Math.min(1, Math.max(0, side.charged / side.units));
  return radius - 2 * radius * share;
}

/**
 * The part of the half-disc of `radius` between the heights `y0` and `y1` (y0 above y1, from the
 * middle of the arena, down is positive): the corners of a polygon, `own` the left half, else the
 * right one. Empty when the slice has no height.
 */
export function halfSlice(
  radius: number,
  own: boolean,
  y0: number,
  y1: number,
  steps = 10,
): Point[] {
  const top = Math.min(radius, Math.max(-radius, Math.min(y0, y1)));
  const bottom = Math.min(radius, Math.max(-radius, Math.max(y0, y1)));
  if (bottom - top <= 0.01) return [];
  const sign = own ? -1 : 1;
  const edge = (y: number): number => sign * Math.sqrt(Math.max(0, radius * radius - y * y));
  const points: Point[] = [{ x: 0, y: top }];
  for (let i = 0; i <= steps; i++) {
    const y = top + ((bottom - top) * i) / steps;
    points.push({ x: edge(y), y });
  }
  points.push({ x: 0, y: bottom });
  return points;
}

/** Horizontal lines across the slice between `y0` and `y1` of a half: the hatching of discharged units. */
export function hatchLines(
  radius: number,
  own: boolean,
  y0: number,
  y1: number,
  pitch: number,
): [Point, Point][] {
  const top = Math.max(-radius, Math.min(y0, y1));
  const bottom = Math.min(radius, Math.max(y0, y1));
  const sign = own ? -1 : 1;
  const lines: [Point, Point][] = [];
  // The lines sit on a grid from the top of the arena, so they do not slide as the level moves.
  for (let y = -radius + pitch / 2; y < bottom; y += pitch) {
    if (y <= top + 0.5) continue;
    const x = sign * Math.sqrt(Math.max(0, radius * radius - y * y));
    lines.push([
      { x: 0, y },
      { x, y },
    ]);
  }
  return lines;
}

/** A colour moved `amount` (0..1) of the way to white: the lightened tone of discharged units. */
export function lighten(color: number, amount: number): number {
  const mix = (shift: number): number => {
    const channel = (color >> shift) & 0xff;
    return Math.round(channel + (255 - channel) * amount) & 0xff;
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

// --- The exchange of blows of the last round ------------------------------------------------------

/** The shots one side made in a round: real ones, and the virtual (bonus, terrain) ones. */
export interface SideShots {
  readonly real: number;
  readonly virtual: number;
}

/** The exchange of the last round: a side that did not shoot has `null` (no arrow). */
export interface Exchange {
  readonly own: SideShots | null;
  readonly enemy: SideShots | null;
}

/**
 * Who shot what in `round` (`FightView.last_round`, indexed by player). `shots` counts the virtual
 * ones too, so the real ones are the rest. `null` round (a fight with no round yet, or a replay
 * file without the data of rounds): nobody shot, no arrows.
 */
export function exchangeOf(round: FightRoundView | null, me: PlayerId): Exchange {
  if (round === null) return { own: null, enemy: null };
  const enemy: PlayerId = me === 0 ? 1 : 0;
  const side = (player: PlayerId): SideShots | null => {
    const shots = round.shots[player];
    if (shots <= 0) return null;
    const virtual = Math.min(shots, Math.max(0, round.virtual[player]));
    return { real: shots - virtual, virtual };
  };
  return { own: side(me), enemy: side(enemy) };
}

/** Where the arrow of a side starts and ends, as shares of the arena radius (own: upper left to upper right). */
const ARROW = { reach: 0.55, rim: 0.8, apex: 1.55 } as const;

export interface ExchangeArrow {
  /** The curve from the shooter's half up and over into the opponent's half, from the middle of the arena. */
  readonly line: Point[];
  /** The arrowhead at the front of the curve; `null` while it is too short to show one. */
  readonly head: [Point, Point, Point] | null;
  /** The middle of the whole arc, where the label of the shots sits. */
  readonly label: Point;
}

/**
 * The arrow of one side as a curve (a quadratic arc): the own arrow rises from the own (left)
 * half over the top into the enemy's (right) half, the enemy's falls from its half under the
 * bottom into the own one, so the two are one exchange and never overlap. `grow` (0..1) is how
 * much of it is drawn; the head sits at the front.
 */
export function exchangeArrow(
  own: boolean,
  radius: number,
  grow: number,
  head = { length: 9, half: 5.5 },
  steps = 16,
): ExchangeArrow {
  // The enemy's arrow is the own one turned half way round the middle of the arena.
  const turn = own ? 1 : -1;
  const p = (x: number, y: number): Point => ({ x: turn * x * radius, y: turn * y * radius });
  const start = p(-ARROW.reach, -ARROW.rim);
  const end = p(ARROW.reach, -ARROW.rim);
  // The apex of a quadratic curve is half way between the chord and the control point.
  const control = p(0, 2 * -ARROW.apex + ARROW.rim);
  const at = (t: number): Point => {
    const w = 1 - t;
    return {
      x: w * w * start.x + 2 * w * t * control.x + t * t * end.x,
      y: w * w * start.y + 2 * w * t * control.y + t * t * end.y,
    };
  };
  const t = Math.min(1, Math.max(0, grow));
  const line: Point[] = [];
  const n = Math.max(1, Math.ceil(steps * t));
  for (let i = 0; i <= n; i++) line.push(at((t * i) / n));
  const tip = at(t);
  const dx = 2 * (1 - t) * (control.x - start.x) + 2 * t * (end.x - control.x);
  const dy = 2 * (1 - t) * (control.y - start.y) + 2 * t * (end.y - control.y);
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const base = { x: tip.x - ux * head.length, y: tip.y - uy * head.length };
  return {
    line,
    head:
      t < 0.2
        ? null
        : [
            tip,
            { x: base.x - uy * head.half, y: base.y + ux * head.half },
            { x: base.x + uy * head.half, y: base.y - ux * head.half },
          ],
    label: at(0.5),
  };
}

/** Share 0..1 of the way to the next round: the arc around the arena fills over a round. */
export function roundProgress(nextRoundTick: number, tick: number, roundTicks: number): number {
  const left = (nextRoundTick - tick) / Math.max(1, roundTicks);
  return Math.min(1, Math.max(0, 1 - left));
}
