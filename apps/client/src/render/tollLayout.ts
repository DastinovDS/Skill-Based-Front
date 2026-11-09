/**
 * The toll of a road fortification as an effect (DEC-43, item D; #707), Engraved (#858; mockup
 * `tollStrike` of #829): a strike of three hairlines (an ivory core between two in the colour of the
 * wall's owner) runs from the gate of the wall to the group, then the engraved hit throws seven cuts
 * and a ring off the group, and "-N" rises on a thin tag. No glow, no light. All of it is over
 * `TOLL_MS` after the event; with "less motion" only the tag stays, still.
 *
 * Pure functions, no PixiJS and no DOM. Everything is a function of the age of the event in ticks,
 * so a paused or frozen scene shows a toll in the state of its tick (like the fights, `parryLayout.ts`).
 * Nothing here decides anything: the numbers and the places come from the events and the snapshot.
 */
import type { EventMsg, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { FIGHT_FX_STRENGTH } from './style.ts';

/** Everything of one toll is over this long after its event, ms (the mockup's 1.1 s). */
export const TOLL_MS = 1100;
/** The strike runs from the gate to the group this long; the hit lands as it arrives. */
export const STRIKE_MS = 308;
export const HIT_AT_MS = STRIKE_MS;
/** The hit throws its cuts this long. */
export const HIT_MS = 660;

/** The strike: three hairlines this far apart, the ivory core and the owner's colour either side. */
export const STRIKE = { spread: 2.6, core: 1.3, side: 0.8 } as const;
/** The hit: seven cuts thrown out to this radius, an ink ring, from this radius on. */
export const TOLL_HIT = { cuts: 7, from: 4, reach: 16, ring: 6, grow: 14, width: 1 } as const;

/** What the player is told of a toll: which side lost the charges. */
export interface TollInfo {
  readonly tick: number;
  /** The fortified node, the road, and the charges taken. */
  readonly node: number;
  readonly edge: number;
  readonly charges: number;
  /** Own group that paid (`toll_paid`); `null` for a toll the own line took (`toll_taken`). */
  readonly group: string | null;
  /** The viewing player lost the charges (`toll_paid`). */
  readonly paid: boolean;
}

/** A toll event as an effect, or `null` for any other event or a malformed one. */
export function tollInfo(event: EventMsg): TollInfo | null {
  if (event.kind !== 'toll_paid' && event.kind !== 'toll_taken') return null;
  const { node, edge, charges, group } = event.data;
  if (typeof node !== 'number' || typeof edge !== 'number' || typeof charges !== 'number') {
    return null;
  }
  if (charges <= 0) return null;
  const paid = event.kind === 'toll_paid';
  return {
    tick: event.tick,
    node,
    edge,
    charges,
    group: paid && typeof group === 'string' ? group : null,
    paid,
  };
}

/** Milliseconds since the event: the age in ticks at `tickHz`; `null` before it and after `TOLL_MS`. */
export function tollMs(age: number, tickHz: number): number | null {
  if (age < 0 || tickHz <= 0) return null;
  const ms = (age * 1000) / tickHz;
  return ms >= TOLL_MS ? null : ms;
}

const easeOut = (p: number): number => 1 - (1 - p) ** 3;

/**
 * The strike at `ms` since the event: the three hairlines from beside `from` to the head, each a pair
 * of points, the core in the middle; `null` before it and once it has arrived.
 */
export function strikeLines(from: Point, to: Point, ms: number, scale = 1): Point[][] | null {
  if (ms < 0 || ms >= STRIKE_MS) return null;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < 0.01) return null;
  const p = easeOut(ms / STRIKE_MS);
  const head = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p };
  const nx = -(to.y - from.y) / length;
  const ny = (to.x - from.x) / length;
  return [-1, 0, 1].map((k) => [
    { x: from.x + nx * k * STRIKE.spread * scale, y: from.y + ny * k * STRIKE.spread * scale },
    head,
  ]);
}

/** The hit at `ms` since the event: how far it has gone (0..1); `null` outside it. */
export function hitPhase(ms: number): number | null {
  const q = (ms - HIT_AT_MS) / HIT_MS;
  return q <= 0 || q >= 1 ? null : q;
}

/**
 * The cuts of the hit at `q` (0..1) round `at`, `scale` the size of the effects: `TOLL_HIT.cuts`
 * strokes thrown out at fixed angles turned by the seed, every other one in ink, and the ink ring.
 */
export function hitCuts(
  at: Point,
  q: number,
  scale: number,
  seed: number,
): { cuts: { from: Point; to: Point; ink: boolean }[]; ring: number } {
  const grow = easeOut(q);
  const cuts: { from: Point; to: Point; ink: boolean }[] = [];
  for (let j = 0; j < TOLL_HIT.cuts; j++) {
    // A fixed jitter per cut from the seed (no randomness: a paused scene shows the same frame).
    const jitter = ((seed * 31 + j * 17) % 97) / 97;
    const angle = (j / TOLL_HIT.cuts) * Math.PI * 2 + jitter * 0.6;
    const reach = (TOLL_HIT.from + TOLL_HIT.reach * grow * (0.7 + jitter * 0.5)) * scale;
    const cx = Math.cos(angle);
    const cy = Math.sin(angle);
    cuts.push({
      from: { x: at.x + cx * reach * 0.55, y: at.y + cy * reach * 0.55 },
      to: { x: at.x + cx * reach, y: at.y + cy * reach },
      ink: j % 2 === 0,
    });
  }
  return { cuts, ring: (TOLL_HIT.ring + TOLL_HIT.grow * grow) * 0.8 * scale };
}

/** How a token swells when the toll hits it: 1 outside, up to `1 + amplitude` at the middle of the pop. */
export function tollPop(ms: number, strength: number = FIGHT_FX_STRENGTH): number {
  const from = HIT_AT_MS;
  const span = 260;
  if (ms < from || ms >= from + span) return 1;
  return 1 + 0.25 * strength * Math.sin((Math.PI * (ms - from)) / span);
}

/** The tag "-N": from the hit on, rising a little and fading over the last quarter; still with less motion. */
export function tollNumber(
  ms: number,
  reduced: boolean,
  rise: number,
): { alpha: number; lift: number } | null {
  if (ms < HIT_AT_MS) return reduced ? { alpha: 1, lift: 0 } : null;
  return {
    alpha: Math.max(0, Math.min(1, (1 - ms / TOLL_MS) / 0.25)),
    lift: reduced ? 0 : rise * Math.min(1, (ms - HIT_AT_MS) / (0.15 * TOLL_MS)),
  };
}

/** A different hit for tolls on different roads. */
export function tollSeed(info: TollInfo): number {
  return (info.edge * 31 + info.node * 7 + info.tick) % 997;
}

/** Whose toll is it: the player that lost the charges. */
export function victimOf(info: TollInfo, me: PlayerId): PlayerId {
  return info.paid ? me : me === 0 ? 1 : 0;
}
