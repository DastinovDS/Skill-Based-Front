/**
 * The road highlight under the travel time of a move order (H10 "Comet", #627): the route the
 * server gave (`ReachNode.path`) cut into its roads from rim to rim, and the comet that runs along
 * them to the target. Pure geometry, no PixiJS and no DOM; the route and the time are the server's
 * (AGENTS.md 7.1), this only places the light on them.
 */
import type { Point } from './camera.ts';
import { ETA_ROUTE } from './style.ts';

/** One road of the route between the city rims; `at`: the arc length of its start on the route. */
export interface RouteSpan {
  readonly a: Point;
  readonly b: Point;
  readonly at: number;
  readonly length: number;
}

/**
 * The roads of the route `points` (the nodes in order, ends included), each trimmed by the rim
 * `rims[i]` of the node at its end: the light never lies on a city body. The arc length runs over
 * the roads only, so the comet passes through a city on the way instead of crossing it. A road
 * shorter than its two rims is left out.
 */
export function routeSpans(points: readonly Point[], rims: readonly number[]): RouteSpan[] {
  const spans: RouteSpan[] = [];
  let at = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    if (p === undefined || q === undefined) continue;
    const full = Math.hypot(q.x - p.x, q.y - p.y);
    const ra = rims[i - 1] ?? 0;
    const rb = rims[i] ?? 0;
    if (full <= ra + rb) continue;
    const ux = (q.x - p.x) / full;
    const uy = (q.y - p.y) / full;
    const length = full - ra - rb;
    spans.push({
      a: { x: p.x + ux * ra, y: p.y + uy * ra },
      b: { x: q.x - ux * rb, y: q.y - uy * rb },
      at,
      length,
    });
    at += length;
  }
  return spans;
}

/** The lit length of the route: the sum of its roads. */
export function spansLength(spans: readonly RouteSpan[]): number {
  const last = spans.at(-1);
  return last === undefined ? 0 : last.at + last.length;
}

function on(span: RouteSpan, d: number): Point {
  const t = span.length === 0 ? 0 : (d - span.at) / span.length;
  return { x: span.a.x + (span.b.x - span.a.x) * t, y: span.a.y + (span.b.y - span.a.y) * t };
}

/** The pieces of the route between the arc lengths `from` and `to`: one segment per road it touches. */
export function spanSlice(spans: readonly RouteSpan[], from: number, to: number): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (const span of spans) {
    const s0 = Math.max(from, span.at);
    const s1 = Math.min(to, span.at + span.length);
    if (s1 > s0) out.push([on(span, s0), on(span, s1)]);
  }
  return out;
}

/** The point at the arc length `d` (clamped to the route); `null`: an empty route. */
export function spanPoint(spans: readonly RouteSpan[], d: number): Point | null {
  const total = spansLength(spans);
  if (spans.length === 0) return null;
  const at = Math.min(total, Math.max(0, d));
  for (const span of spans) {
    if (at <= span.at + span.length) return on(span, at);
  }
  const last = spans.at(-1);
  return last === undefined ? null : last.b;
}

/** The phase 0..1 of the comet at `nowMs`; `null` under "less motion" (the comet stands still). */
export function cometPhase(nowMs: number, reduced: boolean): number | null {
  if (reduced) return null;
  const period = ETA_ROUTE.comet.periodMs;
  return (((nowMs % period) + period) % period) / period;
}

/** The whole length of the tail behind the head. */
export function cometTail(): number {
  return ETA_ROUTE.comet.piece * ETA_ROUTE.comet.pieces;
}

export interface Comet {
  /** The tail pieces, faint to bright, each a list of segments (a piece may span a city). */
  readonly pieces: readonly { readonly segments: [Point, Point][]; readonly alpha: number }[];
  /** The head dot. */
  readonly head: Point | null;
}

/**
 * The comet on a route of `total` lit length at `phase`: its head runs from the start to past the
 * target by the length of its tail, so the tail drains into the target before the next pass (the
 * head waits at the target meanwhile). `null` phase: the still frame, the head at `still` of the way.
 */
export function comet(spans: readonly RouteSpan[], phase: number | null): Comet {
  const total = spansLength(spans);
  if (total <= 0) return { pieces: [], head: null };
  const { piece, alpha, still } = ETA_ROUTE.comet;
  const pieces: number = ETA_ROUTE.comet.pieces;
  const d = phase === null ? total * still : phase * (total + cometTail());
  const out: { segments: [Point, Point][]; alpha: number }[] = [];
  // From the far end of the tail (faintest) to the head (brightest), as the mockup draws it.
  for (let i = pieces; i >= 1; i--) {
    const segments = spanSlice(spans, Math.max(0, d - i * piece), Math.max(0, d - (i - 1) * piece));
    if (segments.length > 0) out.push({ segments, alpha: (alpha * (pieces + 1 - i)) / pieces });
  }
  return { pieces: out, head: spanPoint(spans, Math.min(total, d)) };
}
