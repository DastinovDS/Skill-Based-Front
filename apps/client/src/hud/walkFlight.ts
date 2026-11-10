/**
 * The flight of a paid rally walk's CP mark (#930, W10 "Plan, due, pay"; mockup
 * `in-match-cp-vp.html`, `flightCP`): at the `rally_walk_paid` of an own recruit the CP mark leaves
 * the gate of its city (where the road to the rally point leaves the ring) and flies an arch up
 * into the CP gauge, landing as the spend sinks its sliver. Pure: `CpGauge.svelte` paints it.
 */
import type { Anchor } from '../render/anchors.ts';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface FlightPath {
  readonly from: Point;
  readonly to: Point;
}

/** How high the arch rises over the straight way, px (the mockup's 70). */
export const ARCH_PX = 70;
/** The flight fades over its last part: from this share of its time. */
const FADE_FROM = 0.62 / 0.75;
/** The trail: this many points back along the arch, each this much of the flight behind. */
const TRAIL_POINTS = 8;
const TRAIL_STEP = 0.025;

/**
 * The gate of a city on screen: 10 px out of its circle towards its rally point (`toward`), or
 * straight up when the point is not on screen.
 */
export function gatePoint(city: Anchor, toward: Anchor | null): Point {
  let ux = 0;
  let uy = -1;
  if (toward !== null) {
    const dx = toward.x - city.x;
    const dy = toward.y - city.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      ux = dx / d;
      uy = dy / d;
    }
  }
  const r = city.r + 10;
  return { x: city.x + ux * r, y: city.y + uy * r };
}

function along(path: FlightPath, q: number): Point {
  const { from, to } = path;
  return {
    x: from.x + (to.x - from.x) * q,
    y: from.y + (to.y - from.y) * q - Math.sin(Math.PI * q) * ARCH_PX,
  };
}

/**
 * Where the mark is `ageMs` into a flight of `durationMs` (eased by `ease`), its opacity, and the
 * dotted trail behind it as an SVG path.
 */
export function flightPoint(
  path: FlightPath,
  ageMs: number,
  durationMs: number,
  ease: (p: number) => number,
): Point & { readonly alpha: number; readonly trail: string } {
  const p = Math.min(1, Math.max(0, ageMs / durationMs));
  const q = ease(p);
  const at = along(path, q);
  const alpha = p < FADE_FROM ? 1 : Math.max(0, 1 - (p - FADE_FROM) / (1 - FADE_FROM));
  const parts: string[] = [];
  for (let k = 0; k <= TRAIL_POINTS; k++) {
    const b = along(path, Math.max(0, q - k * TRAIL_STEP));
    parts.push(`${k === 0 ? 'M' : 'L'}${b.x.toFixed(1)} ${b.y.toFixed(1)}`);
  }
  return { ...at, alpha, trail: parts.join('') };
}
