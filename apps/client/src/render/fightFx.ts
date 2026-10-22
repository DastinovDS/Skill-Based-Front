/**
 * Timing and geometry of the fight animation (DEC-24, DEC-32; ui-style 9.9, 27, 29): the arena
 * over a fight going on (A1, "chips": a chip for every unit of a fight), the exchange of blows of
 * the last round, the losses that pop up after a round and the way a fight ends.
 *
 * Pure functions, no PixiJS and no DOM. Nothing here decides what happened in a fight: places,
 * the units of the sides, their losses, the bonus stock and the silent charges, the shots of the
 * last round, the winner and the capture come from the server (`view.fights`, its `last_round`,
 * and the events `fight_round` and `fight_ended`; AGENTS.md 7.1). Since DEC-29 (#294) the last
 * round of the view carries the shots of both sides with the virtual (bonus) ones apart. A fight
 * without it (an old replay: #323) has no arrows and no stock.
 *
 * The arena is drawn in screen pixels (ui-style 27.2, item 7): every size here, but a place on the
 * map, is in CSS px, and the view scales the arena by `1 / cameraScale` so it neither shrinks at
 * 60% nor grows at 200%. All durations are shares of a round (`ruleset_public.combat.round_ticks`,
 * 20 ticks since DEC-32), never fixed seconds.
 */
import type { EventMsg, FightRoundView, FightView, MapFile, PlayerId } from '../protocol.gen.ts';
import type { RenderGroup } from '../net/interpolate.ts';
import type { Point } from './camera.ts';
import { ringRadius } from './cityLayout.ts';
import { fightPoint } from './layout.ts';

/**
 * The plate of the arena, CSS px (A1: two halves, own on the left, the enemy's on the right):
 * half of its width and of its height. It holds two rows of four chips per side, the stock of
 * bonus shots and the "+N" of the hidden chips under them, and a bar of the time to the next
 * round along its bottom edge.
 */
export const PLATE = { halfWidth: 96, halfHeight: 42 } as const;
/** A chip is a triangle of this side (px): close to the 20 px of a significant symbol (ui-style 22). */
export const CHIP = { side: 18, pitch: 20, max: 8, columns: 4 } as const;
/** How far the arrows and their labels reach beyond the plate (px), top and bottom. */
export const ARENA_REACH = 36;
/** The bonus caption sits this far over the plate (px): above the label of the own arrow. */
export const CAPTION_RISE = 46;
/** The plate floats this many px (screen) above the ring of a city; its lower arrow clears it. */
export const ARENA_GAP_NODE = PLATE.halfHeight + ARENA_REACH + 8;
/** The plate of a fight on a road floats this many px above its meeting point. */
export const ARENA_GAP_EDGE = PLATE.halfHeight + ARENA_REACH + 18;

/** Where a fight is: the true place (a city, or the meeting point on a road). */
export interface FightPlace {
  readonly node: number | null;
  readonly edge: number | null;
  /** The city, or the meeting point on the road. */
  readonly at: Point;
  /** Radius of the capacity ring of the city in world units; 0 on a road. */
  readonly ring: number;
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
  return { node, edge, at, ring: node === null ? 0 : ringRadius(radiusOf(node)) };
}

/**
 * The middle of the arena in world units: above the ring of the city, or above the meeting
 * point, by a gap that is fixed in screen px (`cameraScale`: CSS px per world unit).
 */
export function arenaCenter(place: FightPlace, cameraScale: number): Point {
  const scale = cameraScale > 0 ? cameraScale : 1;
  const gap = place.node === null ? ARENA_GAP_EDGE : ARENA_GAP_NODE;
  return { x: place.at.x, y: place.at.y - place.ring - gap / scale };
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

// --- Time ----------------------------------------------------------------------------------------

/** The arrows of a round grow over this share of a round. */
export const GROW_SHARE = 0.2;
/** The loss numbers of a round stay this share of a round. */
export const LOSS_POP_SHARE = 0.8;
/** The end of a fight stays this share of a round (3 s at 20 ticks and 10 Hz). */
export const END_SHARE = 1.5;
/** A chip that changed pulses once over this share of a round. */
export const PULSE_SHARE = 0.45;

/** Progress 0..1 of an effect that lasts `share` of a round, `age` ticks old; `null`: not now. */
export function roundEffect(age: number, share: number, roundTicks: number): number | null {
  const length = Math.max(1, roundTicks) * share;
  if (age < 0 || length <= 0) return null;
  const t = age / length;
  return t >= 1 ? null : t;
}

/**
 * The arrows of the last round of a fight: they grow from the shooter to the opponent over
 * `GROW_SHARE` of a round, then stay until the next round replaces them; if no next round comes
 * (the fight stalls) they fade between one and two rounds after the shots. `age`: ticks since the
 * round (fractional); `reduced` motion: no growing, the arrow is there whole.
 */
export function exchangeLook(
  age: number,
  roundTicks: number,
  reduced: boolean,
): { grow: number; alpha: number } {
  const round = Math.max(1, roundTicks);
  const grow = reduced ? 1 : Math.min(1, Math.max(0, age / (round * GROW_SHARE)));
  const hold = round * 1.2;
  const fade = round * 0.8;
  return { grow, alpha: Math.min(1, Math.max(0, 1 - (age - hold) / fade)) };
}

/** The swell of a chip that changed: one pulse, scale 1 to 1.2 and back; 1 outside of it. */
export function chipPulse(age: number, roundTicks: number, reduced: boolean): number {
  if (reduced) return 1;
  const t = roundEffect(age, PULSE_SHARE, roundTicks);
  return t === null ? 1 : 1 + 0.2 * Math.sin(Math.PI * t);
}

// --- Sides of an arena --------------------------------------------------------------------------

/**
 * One side of a fight as the view tells it: the units (all of them, and the charged ones among
 * them), the units it lost in the fight so far, the stock of bonus shots it has left
 * (`FightView.virtual_left`, DEC-32, item 3) and its charged units that do not shoot because of
 * the terrain (`FightView.mute`, DEC-24, F2).
 */
export interface SideCount {
  readonly units: number;
  readonly charged: number;
  readonly losses: number;
  readonly bonus: number;
  readonly mute: number;
}

export interface ArenaSides {
  /** The viewing player and the opponent. */
  readonly own: SideCount;
  readonly enemy: SideCount;
}

/**
 * The units of both sides of a fight going on: the own groups of the fight (the view lists them),
 * and the enemy's exact units and charged ones of the view, plus the groups of the opponent when
 * the frame shows both sides (a replay). Losses, stock and silent charges are the view's own
 * numbers by player; a replay file has zeros there (#323).
 */
export function arenaSides(
  fight: FightView,
  groups: readonly RenderGroup[],
  me: PlayerId,
): ArenaSides {
  const enemy: PlayerId = me === 0 ? 1 : 0;
  const ids = new Set(fight.groups);
  const own = { units: 0, charged: 0 };
  const other = { units: fight.enemy_units, charged: fight.enemy_charged };
  for (const item of groups) {
    if (!ids.has(item.group.id)) continue;
    const side = (item.owner ?? me) === me ? own : other;
    side.units += item.group.units;
    side.charged += item.group.charged;
  }
  const side = (counts: { units: number; charged: number }, player: PlayerId): SideCount => ({
    ...counts,
    losses: fight.losses[player],
    bonus: fight.virtual_left[player],
    mute: fight.mute[player],
  });
  return { own: side(own, me), enemy: side(other, enemy) };
}

/** What a chip shows: a charged unit, a discharged one, one that died in this fight. */
export type ChipState = 'charged' | 'empty' | 'killed';

export interface Chips {
  /** The chips drawn, at most `CHIP.max`: charged first, then discharged, then killed. */
  readonly shown: readonly ChipState[];
  /** Chips that do not fit: the "+N" with its exact number. */
  readonly hidden: number;
  /** How many of the hidden ones are charged (a small number under "+N"). */
  readonly hiddenCharged: number;
  /** Indices (into `shown`) of the charged chips that do not shoot: the last ones of the charged. */
  readonly silent: readonly number[];
}

/**
 * The chips of a side: one per unit that was in the fight (`units + losses`: a reinforcement adds
 * chips, the dead stay as dashed ones), charged ones first. Beyond `CHIP.max` the rest is a "+N".
 * The silent ones (`mute`) are the last of the charged: a visual convention, the view only gives
 * the number.
 */
export function chipsOf(side: SideCount, max: number = CHIP.max): Chips {
  const charged = Math.min(side.units, Math.max(0, side.charged));
  const empty = Math.max(0, side.units - charged);
  const killed = Math.max(0, side.losses);
  const all: ChipState[] = [
    ...Array<ChipState>(charged).fill('charged'),
    ...Array<ChipState>(empty).fill('empty'),
    ...Array<ChipState>(killed).fill('killed'),
  ];
  const shown = all.slice(0, max);
  const silentCount = Math.min(Math.max(0, side.mute), charged);
  const silent: number[] = [];
  for (let i = charged - silentCount; i < charged; i++) {
    if (i < shown.length) silent.push(i);
  }
  return {
    shown,
    hidden: all.length - shown.length,
    hiddenCharged: Math.max(0, charged - max),
    silent,
  };
}

/**
 * The chips that changed in the last round of a side, by index among all of its chips (the ones
 * past `CHIP.max` are not drawn): the charges that went out (`spent`) are the first discharged
 * chips, the units that died (`losses`) the last killed ones. The view tells how many, not which:
 * the choice is a visual convention (ui-style 27.2, item 5).
 */
export function changedChips(
  side: SideCount,
  round: { readonly spent: number; readonly losses: number } | null,
): number[] {
  if (round === null) return [];
  const charged = Math.min(side.units, Math.max(0, side.charged));
  const total = side.units + Math.max(0, side.losses);
  const changed: number[] = [];
  for (let i = charged; i < Math.min(side.units, charged + round.spent); i++) changed.push(i);
  for (let i = Math.max(side.units, total - round.losses); i < total; i++) changed.push(i);
  return changed;
}

/** Centre of chip `index` of a side on the plate: two rows of columns when more than four fit one row. */
export function chipAt(index: number, shown: number, own: boolean): Point {
  const sign = own ? -1 : 1;
  const two = shown > CHIP.columns;
  const column = two ? Math.floor(index / 2) : index;
  const row = two ? index % 2 : 0;
  const x = sign * (8 + CHIP.side / 2 + column * CHIP.pitch);
  const y = two ? -25 + row * CHIP.pitch : -15;
  return { x, y };
}

/**
 * The hatching of a discharged chip: horizontal lines across a triangle with the tip down and
 * `side` wide, from the middle of the box of the chip, `pitch` apart, none above the first pitch.
 */
export function chipHatch(side: number, pitch: number): [Point, Point][] {
  const height = chipHeight(side);
  const lines: [Point, Point][] = [];
  for (let y = pitch; y < height - 1; y += pitch) {
    // Half the width of the triangle at this height (it narrows towards the tip at the bottom).
    const half = (side / 2) * (1 - y / height);
    lines.push([
      { x: -half, y: y - height / 2 },
      { x: half, y: y - height / 2 },
    ]);
  }
  return lines;
}

/** Height of a chip triangle of `side`. */
export function chipHeight(side: number): number {
  return side * 0.88;
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

/**
 * Where an arrow starts and ends, in px from the middle of the plate: the own arrow rises from the
 * top edge of its half (`rim` above the middle), arches `apex` over the middle and comes down into
 * the other half; `reach` is the distance of its ends from the middle line.
 */
const ARROW = {
  reach: 0.78 * PLATE.halfWidth,
  rim: PLATE.halfHeight - 1,
  apex: PLATE.halfHeight + 16,
} as const;
/** The label of the shots sits this far beyond the top of the arc, so the arc stays in view. */
const LABEL_LIFT = 10;

export interface ExchangeArrow {
  /** The curve from the shooter's half up and over into the opponent's half, from the middle of the plate. */
  readonly line: Point[];
  /** The front of the curve and the unit vector of its direction there. */
  readonly tip: Point;
  readonly direction: Point;
  /** The arrowhead at the front of the curve; `null` while it is too short to show one. */
  readonly head: [Point, Point, Point] | null;
  /** Where the label of the shots sits: over the middle of the arc, just beyond it. */
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
  grow: number,
  head = { length: 11, half: 6.5 },
  steps = 16,
): ExchangeArrow {
  // The enemy's arrow is the own one turned half way round the middle of the plate.
  const turn = own ? 1 : -1;
  const p = (x: number, y: number): Point => ({ x: turn * x, y: turn * y });
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
    tip,
    direction: { x: ux, y: uy },
    head:
      t < 0.2
        ? null
        : [
            tip,
            { x: base.x - uy * head.half, y: base.y + ux * head.half },
            { x: base.x + uy * head.half, y: base.y - ux * head.half },
          ],
    label: { x: at(0.5).x, y: at(0.5).y - turn * LABEL_LIFT },
  };
}

/** Share 0..1 of the way to the next round: the arc around the arena fills over a round. */
export function roundProgress(nextRoundTick: number, tick: number, roundTicks: number): number {
  const left = (nextRoundTick - tick) / Math.max(1, roundTicks);
  return Math.min(1, Math.max(0, 1 - left));
}
