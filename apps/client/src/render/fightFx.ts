/**
 * Timing and geometry of the fight animation (DEC-24, DEC-32; ui-style 9.9, 27, 29): the arena
 * over a fight going on (A1, "chips": a chip for every unit of a fight), who shot in the last round
 * (the shots themselves are the tracers of `shotLayout.ts`), the losses that pop up after a round and
 * the way a fight ends.
 *
 * Pure functions, no PixiJS and no DOM. Nothing here decides what happened in a fight: places,
 * the units of the sides, their losses, the bonus stock and the silent charges, the shots of the
 * last round, the winner and the capture come from the server (`view.fights`, its `last_round`,
 * and the events `fight_round` and `fight_ended`; AGENTS.md 7.1). Since DEC-29 (#294) the last
 * round of the view carries the shots of both sides with the virtual (bonus) ones apart. A fight
 * without it (an old replay: #323) has no shots and no stock.
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
 * half of its width and of its height. It holds two rows of four chips per side with their badges
 * (#791, "On chips" of #776: the badges carry the bonus and the penalty, so the row of the ◇ stock
 * is gone and the plate is 12 px lower), the "+N" of the hidden chips under them, and a bar of the
 * time to the next round along its bottom edge.
 */
export const PLATE = { halfWidth: 96, halfHeight: 36 } as const;
/** A chip is a triangle of this side (px): close to the 20 px of a significant symbol (ui-style 22). */
export const CHIP = { side: 18, pitch: 20, max: 8, columns: 4 } as const;
/** How far the arena keeps from what it floats over (px): room for the caption and the end label above it, and for the ring below. */
export const ARENA_REACH = 36;
/** The bonus caption sits this far over the plate (px). */
export const CAPTION_RISE = 22;
/** The plate floats this many px (screen) above the ring of a city. */
export const ARENA_GAP_NODE = PLATE.halfHeight + ARENA_REACH + 8;
/** The plate of a fight on a road floats this many px above its meeting point. */
export const ARENA_GAP_EDGE = PLATE.halfHeight + ARENA_REACH + 18;

/** A key of the place of a fight: the arena of a fight, its end and its effects share one. */
export function placeKey(place: FightPlace): string {
  return `${String(place.node)}/${String(place.edge)}/${String(place.at.x)},${String(place.at.y)}`;
}

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
  /** Shots of the round by player, and the virtual (bonus) ones among them; zeros if the event lacks them. */
  readonly shots: readonly [number, number];
  readonly virtual: readonly [number, number];
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
      shots: [intField(data, 'shots_0') ?? 0, intField(data, 'shots_1') ?? 0],
      virtual: [intField(data, 'virtual_0') ?? 0, intField(data, 'virtual_1') ?? 0],
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

/** The end of a fight stays this share of a round (3 s at 20 ticks and 10 Hz). */
export const END_SHARE = 1.5;
/** A chip that changed pulses once over this share of a round. */
export const PULSE_SHARE = 0.45;
/** The self-shot of a chip whose charge the terrain burned (DEC-45, #791) lasts this share of a round. */
export const SELF_SHOT_SHARE = 0.6;

/** Progress 0..1 of an effect that lasts `share` of a round, `age` ticks old; `null`: not now. */
export function roundEffect(age: number, share: number, roundTicks: number): number | null {
  const length = Math.max(1, roundTicks) * share;
  if (age < 0 || length <= 0) return null;
  const t = age / length;
  return t >= 1 ? null : t;
}

/**
 * How visible the caption of a bonus shot is `age` ticks after the round (fractional): fully until a
 * round and a fifth are over, then it fades over four fifths of a round (if no next round comes and
 * replaces it, a fight that stalls).
 */
export function exchangeAlpha(age: number, roundTicks: number): number {
  if (age < 0) return 0;
  const round = Math.max(1, roundTicks);
  const hold = round * 1.2;
  const fade = round * 0.8;
  return Math.min(1, Math.max(0, 1 - (age - hold) / fade));
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

/** The badges of one chip (#791): bonus shots up, penalty charges down; 0: none of that kind. */
export interface ChipBadge {
  readonly up: number;
  readonly down: number;
}

export interface Chips {
  /** The chips drawn, at most `CHIP.max`: the pinned penalty ones first, then charged, discharged, killed. */
  readonly shown: readonly ChipState[];
  /** Chips that do not fit: the "+N" with its exact number. */
  readonly hidden: number;
  /** How many of the hidden ones are charged (a small number under "+N"). */
  readonly hiddenCharged: number;
  /** The badges of the chips drawn, by index into `shown` (`null`: none). */
  readonly badges: readonly (ChipBadge | null)[];
  /** Indices of the pinned penalty chips whose charge the terrain burned (DEC-45): now empty. */
  readonly burned: readonly number[];
}

/**
 * How many penalty chips a side keeps pinned in front of its chips (#791): the most it was silenced
 * or had pending to burn so far in this fight (`mute`), or burned in a round. The view remembers it
 * per fight: under `combat.terrain_burn` the view's `mute` falls to 0 after the first round, the
 * chip it marked stays where it was.
 */
export function pinnedPenalty(before: number, side: SideCount, burnedNow: number): number {
  return Math.max(before, Math.max(0, side.mute), Math.max(0, burnedNow));
}

/**
 * The chips of a side: one per unit that was in the fight (`units + losses`: a reinforcement adds
 * chips, the dead stay as dashed ones). The `pinned` penalty chips stand first and never move
 * (#791): a charge plains silence (DEC-24 F2) keeps its chip charged with a badge down to the end;
 * one plains burned (DEC-45) is that chip, now discharged and without a badge. Then the charged
 * ones, the discharged, the killed: the charges spent go out at the end of the charged ones, so the
 * first chips keep their state longest. Beyond `CHIP.max` the rest is a "+N".
 *
 * The bonus badges (`bonus`: the virtual shots left, `FightView.virtual_left`) sit one a chip on the
 * living chips right after the penalty ones, the most stable ones; a shot fired takes the badge of
 * the last of them, so the others stay where they were; with more bonus than living chips the last
 * one carries the rest as a count. Which chip carries what is a visual convention: the view gives
 * the numbers only (ui-style 27.2, item 5; AGENTS.md 7.1).
 */
export function chipsOf(side: SideCount, pinned = 0, max: number = CHIP.max): Chips {
  const charged = Math.min(side.units, Math.max(0, side.charged));
  const empty = Math.max(0, side.units - charged);
  const killed = Math.max(0, side.losses);
  const mute = Math.min(Math.max(0, side.mute), charged);
  const burnt = Math.min(Math.max(0, pinned - mute), empty);
  const front = mute + burnt;
  const all: ChipState[] = [
    ...Array<ChipState>(mute).fill('charged'),
    ...Array<ChipState>(burnt).fill('empty'),
    ...Array<ChipState>(charged - mute).fill('charged'),
    ...Array<ChipState>(empty - burnt).fill('empty'),
    ...Array<ChipState>(killed).fill('killed'),
  ];
  const shown = all.slice(0, max);
  const up: number[] = shown.map(() => 0);
  const down: number[] = shown.map(() => 0);
  for (let i = 0; i < mute && i < shown.length; i++) down[i] = 1;
  const living = Math.min(side.units, shown.length);
  const bonus = Math.max(0, side.bonus);
  if (bonus > 0 && living > 0) {
    const first = Math.min(front, living - 1);
    const slots = living - first;
    for (let i = 0; i < bonus; i++) {
      const index = first + Math.min(i, slots - 1);
      up[index] = (up[index] ?? 0) + 1;
    }
  }
  const badges = shown.map((_, i): ChipBadge | null => {
    const u = up[i] ?? 0;
    const d = down[i] ?? 0;
    return u > 0 || d > 0 ? { up: u, down: d } : null;
  });
  const burned: number[] = [];
  for (let i = mute; i < front && i < shown.length; i++) burned.push(i);
  return {
    shown,
    hidden: all.length - shown.length,
    hiddenCharged: all.slice(max).filter((state) => state === 'charged').length,
    badges,
    burned,
  };
}

/**
 * The chips that changed in the last round of a side, by index among all of its chips (the ones
 * past `CHIP.max` are not drawn): the charges shot (`spent`) are the first discharged chips after
 * the charged ones, the charges the terrain burned (`burned`, DEC-45) the last pinned penalty
 * chips (`pinned`, see `chipsOf`), the units that died (`losses`) the last killed ones. The view
 * tells how many, not which: the choice is a visual convention (ui-style 27.2, item 5).
 */
export function changedChips(
  side: SideCount,
  round: {
    readonly spent: number;
    readonly losses: number;
    readonly burned?: number;
  } | null,
  pinned = 0,
): number[] {
  if (round === null) return [];
  const charged = Math.min(side.units, Math.max(0, side.charged));
  const empty = Math.max(0, side.units - charged);
  const mute = Math.min(Math.max(0, side.mute), charged);
  const burnt = Math.min(Math.max(0, pinned - mute), empty);
  const front = mute + burnt;
  const total = side.units + Math.max(0, side.losses);
  const changed: number[] = [];
  const burnedNow = Math.min(Math.max(0, round.burned ?? 0), burnt);
  for (let i = front - burnedNow; i < front; i++) changed.push(i);
  // The charges that went out by a shot (and a burn not pinned: no chip in front for it).
  const out = Math.max(0, round.spent) + Math.max(0, (round.burned ?? 0) - burnedNow);
  const start = front + (charged - mute);
  for (let i = start; i < Math.min(side.units, start + out); i++) changed.push(i);
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
  const y = two ? -18 + row * CHIP.pitch : -8;
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

// --- Who shot in the last round ------------------------------------------------------------------

/** The shots one side made in a round: real ones, and the virtual (bonus, terrain) ones. */
export interface SideShots {
  readonly real: number;
  readonly virtual: number;
}

/** The exchange of the last round: a side that did not shoot has `null`. */
export interface Exchange {
  readonly own: SideShots | null;
  readonly enemy: SideShots | null;
}

/**
 * Who shot what in `round` (`FightView.last_round`, indexed by player). `shots` counts the virtual
 * ones too, so the real ones are the rest. `null` round (a fight with no round yet, or a replay
 * file without the data of rounds): nobody shot.
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

/** Share 0..1 of the way to the next round: the arc around the arena fills over a round. */
export function roundProgress(nextRoundTick: number, tick: number, roundTicks: number): number {
  const left = (nextRoundTick - tick) / Math.max(1, roundTicks);
  return Math.min(1, Math.max(0, 1 - left));
}
