/**
 * Timing and geometry of the fight animation (DEC-24; ui-style 9.9): the arena over a fight going
 * on, the shots of a round, the losses that pop up after it and the way a fight ends.
 *
 * Pure functions, no PixiJS and no DOM. Nothing here decides what happened in a fight: places,
 * shots, losses, the winner and the capture come from the server (`view.fights` and the events
 * `fight_round` and `fight_ended`; AGENTS.md 7.1). Since DEC-29 (#294) the events carry the shots of
 * both sides with the virtual (bonus) ones apart, so both fly and the bonus ones look different.
 * An event from before that (an old replay) has no shots of the enemy: its hits (the losses) are
 * drawn instead.
 */
import type { EventMsg, FightView, MapFile, PlayerId } from '../protocol.gen.ts';
import type { RenderGroup } from '../net/interpolate.ts';
import type { Point } from './camera.ts';
import { ringRadius } from './cityLayout.ts';
import { fightPoint } from './layout.ts';

/** Radius of the arena disc. */
export const ARENA_RADIUS = 18;
/** The arena of a fight in a city floats this far above the ring of the city. */
export const ARENA_GAP_NODE = 26;
/** The arena of a fight on a road floats this far above its meeting point. */
export const ARENA_GAP_EDGE = 34;
/** How far outside the arena a shot starts (from the middle of it, along the axis). */
export const SHOT_START = ARENA_RADIUS + 16;
/** At most this many shots of one side fly in a round (more would be a smear). */
export const MAX_SHOTS = 3;

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
  /** Shots of players 0 and 1 in the round; `null`: not in the event (an old replay's enemy). */
  readonly shots: readonly [number | null, number | null];
  /** The virtual (bonus, terrain) shots among them, by player; 0 when the event has none. */
  readonly virtual: readonly [number, number];
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
      shots: [intField(data, 'shots_0'), intField(data, 'shots_1')],
      virtual: [intField(data, 'virtual_0') ?? 0, intField(data, 'virtual_1') ?? 0],
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

/** The shots of a round fly, hit and fade for this long. */
export const ROUND_FX_MS = 800;
/** The loss numbers of a round stay this long. */
export const LOSS_POP_MS = 1500;
/** The end of a fight stays this long. */
export const END_FX_MS = 3000;

/**
 * Where a shot is at `t` (0..1 of `ROUND_FX_MS`): `flight` 0 at the shooter to 1 at the middle of
 * the arena (the shots fly over the first 0.5, one after another), `alpha`, and the `spark` of the
 * impacts (0 before the first shot lands, then 0..1 over the rest).
 */
export function shotLook(
  t: number,
  index: number,
): { flight: number; alpha: number; spark: number } {
  const delay = index * 0.12;
  const flight = Math.min(1, Math.max(0, (t - delay) / 0.4));
  const eased = flight * flight;
  const landed = Math.max(0, (t - 0.4 - delay) / 0.45);
  return {
    flight: eased,
    alpha: flight >= 1 ? Math.max(0, 1 - landed * 2) : Math.min(1, flight * 4 + 0.2),
    spark: Math.min(1, landed),
  };
}

/** The star of the impact: it grows and fades out. */
export function sparkLook(spark: number): { scale: number; alpha: number } {
  return { scale: 0.5 + 0.9 * spark, alpha: spark <= 0 || spark >= 1 ? 0 : 1 - spark };
}

/** The numbers of the shots to draw for a side: a shot count, capped; unknown: none. */
export function shotCount(shots: number | null): number {
  return shots === null ? 0 : Math.min(MAX_SHOTS, Math.max(0, shots));
}

/** The shots drawn for a side: how many fly, and how many of them are virtual (bonus) ones. */
export interface DrawnShots {
  readonly count: number;
  /** The first `virtual` shots are the virtual ones (the rules fire them first). */
  readonly virtual: number;
}

/**
 * What to draw for `player` in a round: its shots from the event; an event without them (an old
 * replay's enemy) falls back to the hits it made, which are the opponent's losses.
 */
export function drawnShots(fx: RoundFx, player: PlayerId): DrawnShots {
  const count = shotCount(fx.shots[player] ?? fx.losses[player === 0 ? 1 : 0]);
  return { count, virtual: Math.min(count, Math.max(0, fx.virtual[player])) };
}

// --- Sides of an arena --------------------------------------------------------------------------

export interface ArenaSides {
  /** Units of the viewing player and of the opponent in the fight. */
  readonly own: number;
  readonly enemy: number;
}

/**
 * The units of both sides of a fight going on: the own groups of the fight (the view lists them),
 * and the enemy's exact total of the view, plus the groups of the opponent when the frame shows
 * both sides (a replay).
 */
export function arenaSides(
  fight: FightView,
  groups: readonly RenderGroup[],
  me: PlayerId,
): ArenaSides {
  const ids = new Set(fight.groups);
  let own = 0;
  let enemy = fight.enemy_units;
  for (const item of groups) {
    if (!ids.has(item.group.id)) continue;
    if ((item.owner ?? me) === me) own += item.group.units;
    else enemy += item.group.units;
  }
  return { own, enemy };
}

/** Share 0..1 of the way to the next round: the arc around the arena fills over a round. */
export function roundProgress(nextRoundTick: number, tick: number, roundTicks: number): number {
  const left = (nextRoundTick - tick) / Math.max(1, roundTicks);
  return Math.min(1, Math.max(0, 1 - left));
}
