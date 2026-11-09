/**
 * A round of a fight on the map, "Parry" (#856; ui-style 54, the fight data; the owner's pick of round
 * 4, #829): the shots of the round as etched arcs between the two sides. A pair of shots that met flies
 * one shallow arch from both ends and meets at its top, where the heads glance off each other and curl
 * back home; a shot that hit flies the whole arch into the unit and bursts into a ring of ticks while a
 * small hatched helmet drops away; a charge the terrain burned (DEC-45) sinks into the plains first.
 *
 * Pure functions, no PixiJS and no DOM. Nothing decides what happened: the round is laid out from the
 * fields of `fight_round` alone (AGENTS.md 7.1). For side `p`:
 *
 * - the pairs that met = `shots[p] - losses[1 - p]` (the same for both sides, DEC-07 rule 2);
 * - the hits by `p` = `losses[1 - p]` (a surplus shot always kills);
 * - shot `i` of `p` is a bonus shot (the octagram head) when `i < virtual[p]` (virtual first, B4);
 * - `burned[p]` charges went to the terrain before the shots, and are drawn first.
 *
 * Every time is a share of a round (`combat.round_ticks`): at 20 ticks and 10 Hz the shares are the
 * seconds of the mockup `in-game-style-r5.html` (`RND`): the burn 0.42 s before the shots, the pairs
 * 0.3 s to the top of the arch, a hit 0.5 s, the glance and the burst 0.62 s, one shot 0.14 s after
 * the other.
 */
import type { PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { RoundFx } from './fightFx.ts';

export type Side = 'own' | 'enemy';

/** The timing of a round, shares of a round. */
export const PARRY = {
  /** The shots leave this long after the tick when a charge was burned (0.42 s). */
  burnLead: 0.21,
  /** The burn mark lives this long from the tick (0.75 s). */
  burn: 0.375,
  /** One shot leaves this long after the one before it (0.14 s). */
  stagger: 0.07,
  /** The two shots of a pair reach the top of their arch (0.3 s). */
  meet: 0.15,
  /** A shot that hits flies the whole arch (0.5 s). */
  hit: 0.25,
  /** The glance of a pair and the burst of a hit (0.62 s). */
  fx: 0.31,
} as const;

/** The look of a shot, world units at 100 % (the effects grow by the map's `scale` when it is zoomed out). */
export const ETCH = {
  /** The cut kept behind the head, a share of the arch. */
  tail: 0.42,
  /** Points along the cut. */
  steps: 18,
  /** The dark casing and the hairline in the side's colour. */
  casing: 3,
  hair: 1.3,
  /** The lozenge head: half its length and half its width, its casing and its ink edge. */
  head: { half: 3.8, side: 2.2, casing: 2, edge: 0.8 },
  /** The bow of the arch: this share of its chord, never less nor more than these. */
  lift: { share: 0.62, min: 14, max: 26 },
  /** The shots leave and land this far from the middle of a token (towards the other side), and this high. */
  reach: 8,
  rise: 6,
  /** The octagram of a bonus shot: the size of its inner square. */
  octa: 8,
} as const;

/** The pace of the octagram (#812): the outer square turns 4.2 rad/s, the inner one -3.3, easing in over 0.25 s. */
const OCTA_RAD_PER_ROUND = { outer: 8.4, inner: -6.6 } as const;
const OCTA_EASE_SHARE = 0.125;

/** What a round did, by side: the pairs that met, the hits and the bonus and the burned charges of each side. */
export interface RoundLayout {
  readonly pairs: number;
  readonly hits: Readonly<Record<Side, number>>;
  readonly virtual: Readonly<Record<Side, number>>;
  readonly burned: Readonly<Record<Side, number>>;
}

/** The round of `fx` as the viewing player `me` sees it (own and enemy). */
export function roundLayout(fx: RoundFx, me: PlayerId): RoundLayout {
  const enemy: PlayerId = me === 0 ? 1 : 0;
  const nat = (n: number): number => Math.max(0, Math.floor(n));
  const hitsOwn = nat(fx.losses[enemy]);
  const hitsEnemy = nat(fx.losses[me]);
  // Both sides count the same pairs (DEC-07 rule 2); a round that disagrees draws the fewer.
  const pairs = Math.min(nat(fx.shots[me] - hitsOwn), nat(fx.shots[enemy] - hitsEnemy));
  return {
    pairs,
    hits: { own: hitsOwn, enemy: hitsEnemy },
    virtual: { own: nat(fx.virtual[me]), enemy: nat(fx.virtual[enemy]) },
    burned: { own: nat(fx.burned[me]), enemy: nat(fx.burned[enemy]) },
  };
}

/** When the shots leave: after the burn, if a charge was burned. */
export function shotsLead(layout: RoundLayout): number {
  return layout.burned.own + layout.burned.enemy > 0 ? PARRY.burnLead : 0;
}

/** When the last shot of the round has landed (the pairs met, the hits struck), a share of a round. */
export function landShare(layout: RoundLayout): number {
  const lead = shotsLead(layout);
  const hits = layout.hits.own + layout.hits.enemy;
  if (hits > 0) return lead + (layout.pairs + hits - 1) * PARRY.stagger + PARRY.hit;
  if (layout.pairs > 0) return lead + (layout.pairs - 1) * PARRY.stagger + PARRY.meet;
  return lead;
}

/** When every mark of the round is gone (the last glance or burst, the burn). */
export function endShare(layout: RoundLayout): number {
  const burn = layout.burned.own + layout.burned.enemy > 0 ? PARRY.burn : 0;
  const shots =
    layout.pairs + layout.hits.own + layout.hits.enemy > 0 ? landShare(layout) + PARRY.fx : 0;
  return Math.max(burn, shots);
}

/** One mark of a round at a moment. */
export type ParryMark =
  /** A charge of `side` sinking into the plains, `q` 0..1 of its life. */
  | { readonly kind: 'burn'; readonly side: Side; readonly q: number }
  /** A shot of `side` along the arch towards the other side, its head at `s` (0..1 of the arch). */
  | {
      readonly kind: 'shot';
      readonly side: Side;
      readonly s: number;
      readonly bonus: boolean;
      /** Share of a round since it left (the turn of an octagram head). */
      readonly age: number;
    }
  /** Two heads glancing off each other at the top of the arch, `q` 0..1. */
  | { readonly kind: 'glance'; readonly q: number; readonly bonus: boolean }
  /** A shot of `side` bursting on the other side, `q` 0..1; the lost unit drops away. */
  | { readonly kind: 'burst'; readonly side: Side; readonly q: number; readonly bonus: boolean };

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** The mockup's eases: out quad, out cubic, in-out cubic. */
export const easeOutQuad = (p: number): number => 1 - (1 - clamp01(p)) ** 2;
export const easeOut = (p: number): number => 1 - (1 - clamp01(p)) ** 3;
export const easeInOut = (p: number): number => {
  const t = clamp01(p);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

/**
 * The marks of a round `age` shares of a round after its tick. A pair `j` leaves at
 * `lead + j * stagger`, a hit `k` of a side after all the pairs and the hits before it (own first);
 * bonus shots are the first ones of a side (B4).
 */
export function parryMarks(layout: RoundLayout, age: number): ParryMark[] {
  const marks: ParryMark[] = [];
  if (age < 0) return marks;
  for (const side of ['own', 'enemy'] as const) {
    if (layout.burned[side] > 0 && age < PARRY.burn) {
      marks.push({ kind: 'burn', side, q: age / PARRY.burn });
    }
  }
  const lead = shotsLead(layout);
  const t = age - lead;
  if (t < 0) return marks;
  for (let j = 0; j < layout.pairs; j++) {
    const d = t - j * PARRY.stagger;
    if (d < 0) continue;
    const bonus = { own: j < layout.virtual.own, enemy: j < layout.virtual.enemy };
    if (d < PARRY.meet) {
      const s = easeOutQuad(d / PARRY.meet) * 0.5;
      marks.push({ kind: 'shot', side: 'own', s, bonus: bonus.own, age: d });
      marks.push({ kind: 'shot', side: 'enemy', s, bonus: bonus.enemy, age: d });
    } else if (d < PARRY.meet + PARRY.fx) {
      marks.push({
        kind: 'glance',
        q: (d - PARRY.meet) / PARRY.fx,
        bonus: bonus.own || bonus.enemy,
      });
    }
  }
  let order = layout.pairs;
  for (const side of ['own', 'enemy'] as const) {
    for (let k = 0; k < layout.hits[side]; k++, order++) {
      const d = t - order * PARRY.stagger;
      if (d < 0) continue;
      const bonus = layout.pairs + k < layout.virtual[side];
      if (d < PARRY.hit) {
        marks.push({ kind: 'shot', side, s: easeInOut(d / PARRY.hit), bonus, age: d });
      } else if (d < PARRY.hit + PARRY.fx) {
        marks.push({ kind: 'burst', side, q: (d - PARRY.hit) / PARRY.fx, bonus });
      }
    }
  }
  return marks;
}

/** When each hit of a round lands (a share of a round after its tick) and the side that shot it. */
export function hitLandings(layout: RoundLayout): { readonly side: Side; readonly at: number }[] {
  const lead = shotsLead(layout);
  const out: { side: Side; at: number }[] = [];
  let order = layout.pairs;
  for (const side of ['own', 'enemy'] as const) {
    for (let k = 0; k < layout.hits[side]; k++, order++) {
      out.push({ side, at: lead + order * PARRY.stagger + PARRY.hit });
    }
  }
  return out;
}

/** The angles of the outer and the inner square of an octagram head `age` shares of a round after it left. */
export function octaAngles(age: number): { outer: number; inner: number } {
  const a = Math.max(0, age);
  const ease = Math.min(1, a / OCTA_EASE_SHARE);
  return {
    outer: OCTA_RAD_PER_ROUND.outer * a * ease + Math.PI / 4,
    inner: OCTA_RAD_PER_ROUND.inner * a * ease,
  };
}

// --- Geometry -------------------------------------------------------------------------------------------

/** Where the shots of a fight leave from and land: the near edges of the two tokens, a little up. */
export interface Ends {
  readonly own: Point;
  readonly enemy: Point;
}

/** The ends of the arch between two tokens `own` and `enemy`; `scale` is the size of the effects. */
export function archEnds(own: Point, enemy: Point, scale: number): Ends {
  const dx = enemy.x - own.x;
  const dy = enemy.y - own.y;
  const gap = Math.hypot(dx, dy) || 1;
  const reach = Math.min(ETCH.reach * scale, 0.3 * gap);
  const ux = dx / gap;
  const uy = dy / gap;
  const rise = ETCH.rise * scale;
  return {
    own: { x: own.x + ux * reach, y: own.y + uy * reach - rise },
    enemy: { x: enemy.x - ux * reach, y: enemy.y - uy * reach - rise },
  };
}

/**
 * The point at `s` (0..1) of the arch from `a` to `b`: a parabola bowed up the screen by
 * `ETCH.lift` of its chord (kept between its least and most, times `scale`). The arch from `b` to `a`
 * is the same curve run backwards, so two shots of a pair meet at its top (s = 0.5).
 */
export function archPoint(a: Point, b: Point, s: number, scale: number): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  let nx = -dy / length;
  let ny = dx / length;
  // Up the screen; on a vertical chord, to the left.
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const lift = Math.min(
    ETCH.lift.max * scale,
    Math.max(ETCH.lift.min * scale, length * ETCH.lift.share),
  );
  const bow = lift * 4 * s * (1 - s);
  return { x: a.x + dx * s + nx * bow, y: a.y + dy * s + ny * bow };
}

/** The cut of a shot whose head is at `s`: points from its tail (`s - ETCH.tail`, not before 0) to the head. */
export function etchPoints(from: Point, to: Point, s: number, scale: number): Point[] {
  const s0 = Math.max(0, s - ETCH.tail);
  const points: Point[] = [];
  for (let i = 0; i <= ETCH.steps; i++) {
    points.push(archPoint(from, to, s0 + ((s - s0) * i) / ETCH.steps, scale));
  }
  return points;
}

/** The unit tangent at the end of a run of points (the direction of a head). */
export function headDirection(points: readonly Point[]): Point {
  const head = points[points.length - 1];
  const before = points[points.length - 2];
  if (head === undefined || before === undefined) return { x: 1, y: 0 };
  const dx = head.x - before.x;
  const dy = head.y - before.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length };
}
