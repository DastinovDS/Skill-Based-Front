/**
 * The sign of a bonus inside a plate drawn with `Graphics` (#797): the green chevron up of the
 * advantage badge (#791, ui-style 45) on its dark outline, where a pill already redraws itself only
 * when its text changes (the plan pill of a planned order, the Shift counter over a target). A hollow one is a point still asked for: a light contour, dark inside, so
 * the two differ by shape, not by colour alone (AGENTS.md 7.4).
 */
import type { Graphics } from 'pixi.js';
import { chevronStrokes } from './badgeLayout.ts';
import { BADGE, BADGE_UP, BG, PAPER } from './style.ts';

/** Half the width of a chevron of `size`, outline included: what a pill leaves for it. */
export function chevronHalfWidth(size: number): number {
  return size * 0.56 + (size * BADGE.stroke + BADGE.outline) / 2;
}

/** One chevron up of `size` (the badge's units) centred on (`x`, `y`). */
export function drawBonusChevron(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  hollow = false,
): Graphics {
  const [stroke] = chevronStrokes('up', size, 1);
  if (stroke === undefined) return g;
  const width = size * BADGE.stroke;
  const tones: readonly (readonly [number, number])[] = hollow
    ? [
        [PAPER, width + BADGE.outline * 0.7],
        [BG, Math.max(1, width * 0.8)],
      ]
    : [
        [BG, width + BADGE.outline],
        [BADGE_UP, width],
      ];
  for (const [color, w] of tones) {
    const [first, ...rest] = stroke;
    if (first === undefined) continue;
    g.moveTo(x + first.x, y + first.y);
    for (const p of rest) g.lineTo(x + p.x, y + p.y);
    g.stroke({ width: w, color, cap: 'round', join: 'round' });
  }
  return g;
}
