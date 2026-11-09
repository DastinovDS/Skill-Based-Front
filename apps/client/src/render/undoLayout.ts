/**
 * The look of the cue of `X` on the map (#764), Rewind fixed (#851, ui-style 54b; mockup
 * `in-game-style-r5.html`, `undoArrowW`, `undoRingW`, `nothingCue` W1). Pure functions, no PixiJS
 * and no DOM. Nothing here decides what was undone: the marks come from the server's `ack`
 * (`match/orderController.ts`).
 */
import type { Point } from './camera.ts';
import { easeSettle, easeTravel } from '../theme/tokens.ts';
import { REWIND } from './style.ts';

export interface RewindLook {
  /** The share of the cancelled order's arrow still out (1..0, at least `REWIND.keep` units of it), and its opacity. */
  readonly arrow: number;
  readonly arrowAlpha: number;
  /** How far the three-quarter ring has wound (0..1; 0 before it starts), and its opacity. */
  readonly ring: number;
  readonly ringAlpha: number;
}

/**
 * The cue `ageMs` after the undo; `null`: over. The order winds back into the group over
 * `REWIND.arrowMs` (eased in and out) and fades at the end; the ring winds from `ring.from` over
 * `ring.ms` (eased out), holds, then fades. With "less motion" nothing runs: the ring stands wound
 * and fades, the arrow is gone.
 */
export function rewindLook(ageMs: number, reduced: boolean): RewindLook | null {
  if (ageMs < 0 || ageMs >= REWIND.ms) return null;
  const R = REWIND.ring;
  const ringAlpha = ageMs <= R.fadeFrom ? 1 : Math.max(0, 1 - (ageMs - R.fadeFrom) / R.fadeMs);
  if (reduced) return { arrow: 0, arrowAlpha: 0, ring: 1, ringAlpha };
  const q = Math.min(1, ageMs / REWIND.arrowMs);
  const arrowAlpha =
    q >= 1 ? 0 : q > REWIND.fadeFrom ? 1 - (q - REWIND.fadeFrom) / (1 - REWIND.fadeFrom) : 1;
  const wound = ageMs < R.from ? 0 : easeSettle((ageMs - R.from) / R.ms);
  return {
    arrow: 1 - easeTravel(q),
    arrowAlpha,
    ring: wound,
    ringAlpha: ageMs < R.from ? 0 : ringAlpha,
  };
}

/** "Nothing to undo" `ageMs` after the press: its opacity and sideways shake; `null`: over. */
export function nothingLook(ageMs: number, reduced: boolean): { alpha: number; dx: number } | null {
  const E = REWIND.empty;
  if (ageMs < 0 || ageMs >= E.ms) return null;
  const alpha =
    ageMs < E.inMs
      ? ageMs / E.inMs
      : ageMs > E.fadeFrom
        ? Math.max(0, 1 - (ageMs - E.fadeFrom) / E.fadeMs)
        : 1;
  const dx = reduced
    ? 0
    : Math.sin((ageMs / 1000) * 40) * E.shake * Math.max(0, 1 - ageMs / E.shakeMs);
  return { alpha: alpha * E.alpha, dx };
}

/**
 * The three-quarter ring round `centre` wound to `share` (0..1): from straight up it turns
 * anticlockwise on the screen (the way back), `radius` out; its head leads the turn. The arc as a
 * polyline and the head (a barbed point) `REWIND.ringHead.ahead` past its leading end.
 */
export function rewindRing(
  centre: Point,
  radius: number,
  share: number,
): { readonly arc: Point[]; readonly tip: Point; readonly dir: Point } | null {
  if (share <= 0) return null;
  const a0 = -Math.PI / 2;
  const a1 = a0 - Math.PI * 1.5 * Math.min(1, share);
  const steps = Math.max(6, Math.ceil(24 * share));
  const arc: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    arc.push({ x: centre.x + radius * Math.cos(a), y: centre.y + radius * Math.sin(a) });
  }
  // Going round this way (the angle falling) the tangent is (sin a, -cos a).
  const dir = { x: Math.sin(a1), y: -Math.cos(a1) };
  const end = arc[arc.length - 1] ?? centre;
  const ahead = REWIND.ringHead.ahead;
  return { arc, tip: { x: end.x + dir.x * ahead, y: end.y + dir.y * ahead }, dir };
}
