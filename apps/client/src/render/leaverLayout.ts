/**
 * The ghost of a side that left a fight (#811). When a fight ends the token of a side can go at once
 * (it died, or it retreated), while the tracers of the last round are still flying towards it. Such a
 * tracer would end in empty space, so the place where the side stood keeps a faded helmet until the
 * shots have landed and their afterglow is over, then lets it go.
 *
 * Pure functions, no PixiJS and no DOM. Presentation only: the places are the remembered tokens of
 * the effects view and the times are shares of a round, nothing is decided here (AGENTS.md 7.1).
 */
import type { Point } from './camera.ts';
import type { FightPlace, RoundFx } from './fightFx.ts';
import { placeKey } from './fightFx.ts';
import { HIT_SHARE, type Side } from './fightImpact.ts';
import { AFTERGLOW_SHARE } from './shotLayout.ts';

/** How opaque the ghost is until the shots land: a faint helmet, never as solid as a token. */
export const LEAVER_ALPHA = 0.6;

/** A token closer than this to the remembered place (world units) is the side itself, still standing. */
export const LEAVER_STILL = 12;

/** What the effects view remembers of a fight place: where each side stood, and whether a token was there. */
export interface PlaceMemory {
  readonly points: Readonly<Record<Side, Point>>;
  /** A token of the side was seen there the last time the fight was in sight. */
  readonly seen: Readonly<Record<Side, boolean>>;
}

export interface Leaver {
  readonly side: Side;
  readonly at: Point;
  readonly alpha: number;
}

/**
 * The opacity of a ghost `age` ticks after the round (`null`: the shots are done, no ghost): full
 * until the last shot lands (`HIT_SHARE`), then it fades with the afterglow of the tracers.
 */
export function leaverAlpha(age: number, roundTicks: number): number | null {
  if (age < 0) return null;
  const share = age / Math.max(1, roundTicks);
  if (share < HIT_SHARE) return LEAVER_ALPHA;
  const fade = (share - HIT_SHARE) / AFTERGLOW_SHARE;
  return fade < 1 ? LEAVER_ALPHA * (1 - fade) : null;
}

/**
 * The ghosts of the frame. `live`: the keys of the places whose fight is still in sight (their
 * tokens are drawn, the shots have something to hit). For a round of a fight that is not in sight
 * any more, a side that had a token gets a ghost unless `standing` says its token is still there.
 */
export function leaversOf(
  rounds: readonly RoundFx[],
  tick: number,
  roundTicks: number,
  live: ReadonlySet<string>,
  memory: (key: string) => PlaceMemory | undefined,
  standing: (side: Side, place: FightPlace, at: Point) => boolean,
): Leaver[] {
  const found = new Map<string, Leaver>();
  for (const fx of rounds) {
    const key = placeKey(fx.place);
    if (live.has(key)) continue;
    const alpha = leaverAlpha(tick - fx.tick, roundTicks);
    const remembered = memory(key);
    if (alpha === null || remembered === undefined) continue;
    for (const side of ['own', 'enemy'] as const) {
      if (!remembered.seen[side]) continue;
      const at = remembered.points[side];
      if (standing(side, fx.place, at)) continue;
      // Two rounds of one place in the window: one ghost, the brighter of the two.
      const id = `${key}:${side}`;
      const old = found.get(id);
      if (old === undefined || old.alpha < alpha) found.set(id, { side, at, alpha });
    }
  }
  return [...found.values()];
}
