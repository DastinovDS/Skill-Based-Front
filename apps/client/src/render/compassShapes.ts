import { Graphics, type Container } from 'pixi.js';
import type { BakeSpec } from './bake.ts';
import { COMPASS } from './coachMarks.ts';
import { circleBox } from './shading.ts';
import { CASING } from './style.ts';
import { ENGRAVED } from '../theme/tokens.ts';

/**
 * The baked shapes of the tutorial's goal mark, Compass (`docs/design/tutorial.md`, section 8;
 * `mockups/tutorial.html`): a double ring in ivory on a dark casing, the outer one dashed, a soft
 * glow behind them, and four lozenge points that turn once. Ivory on a casing, never a player or
 * alert colour. One texture per radius (a bounded key: the radii of the kinds of place).
 */

const INK = ENGRAVED.ink;

const graphics = (into: Container): Graphics => into.addChild(new Graphics());

/** A dashed circle: `dash` long strokes with `gap` between them, in world units along the arc. */
function dashedCircle(g: Graphics, r: number, dash: number, gap: number): Graphics {
  const circumference = 2 * Math.PI * r;
  const count = Math.max(4, Math.round(circumference / (dash + gap)));
  const step = (2 * Math.PI) / count;
  const on = step * (dash / (dash + gap));
  for (let i = 0; i < count; i++) {
    const a0 = i * step - Math.PI / 2;
    g.moveTo(r * Math.cos(a0), r * Math.sin(a0));
    g.arc(0, 0, r, a0, a0 + on);
  }
  return g;
}

/** The two rings of a Compass mark: the inner one solid, the outer one dashed, each on a casing. */
export function compassRingSpec(inner: number): BakeSpec {
  const outer = inner + COMPASS.step;
  const r1 = Math.round(inner * 2) / 2;
  const r2 = Math.round(outer * 2) / 2;
  return {
    key: `coach-ring-${String(r1)}`,
    box: circleBox(r2 + 3),
    draw(into, tools) {
      const g = graphics(into);
      g.circle(0, 0, r1).stroke({ width: tools.hair(4), color: CASING });
      g.circle(0, 0, r1).stroke({ width: tools.hair(1.6), color: INK });
      g.circle(0, 0, r2).stroke({ width: tools.hair(3), color: CASING });
      dashedCircle(g, r2, 3, 5).stroke({
        width: tools.hair(1),
        color: INK,
        alpha: 0.6,
        cap: 'butt',
      });
    },
  };
}

/** The soft glow behind the rings: concentric strokes fading out (no filter, ui-style BL1). */
export function compassGlowSpec(inner: number): BakeSpec {
  const r = Math.round((inner + COMPASS.step + 2) * 2) / 2;
  const layers = 7;
  return {
    key: `coach-glow-${String(r)}`,
    box: circleBox(r + 9),
    draw(into, tools) {
      const g = graphics(into);
      for (let i = 0; i < layers; i++) {
        const spread = (i / (layers - 1)) * 7 - 3.5;
        const alpha = 0.16 * (1 - Math.abs(spread) / 4.2);
        g.circle(0, 0, r + spread).stroke({ width: tools.hair(1.3), color: INK, alpha });
      }
    },
  };
}

/** The four points of the compass on the outer ring: ivory lozenges on a casing. */
export function compassPointsSpec(inner: number): BakeSpec {
  const r = Math.round((inner + COMPASS.step) * 2) / 2;
  const { length, width } = COMPASS.point;
  return {
    key: `coach-points-${String(r)}`,
    box: circleBox(r + length + 2),
    draw(into, tools) {
      const g = graphics(into);
      for (const a of [0, 0.5, 1, 1.5]) {
        const ux = Math.cos(a * Math.PI);
        const uy = Math.sin(a * Math.PI);
        const x = r * ux;
        const y = r * uy;
        g.poly([
          x - ux * length,
          y - uy * length,
          x - uy * width,
          y + ux * width,
          x + ux * length,
          y + uy * length,
          x + uy * width,
          y - ux * width,
        ])
          .fill(INK)
          .stroke({ width: tools.hair(1.2), color: CASING, join: 'round' });
      }
    },
  };
}

/**
 * A ring of the marks in turn (I.7): one terrain each look, so the three read apart in grey too
 * (solid, dashed, dotted; ui rule: not by colour alone).
 */
export function turnRingSpec(radius: number, look: 0 | 1 | 2): BakeSpec {
  const r = Math.round(radius * 2) / 2;
  return {
    key: `coach-turn-${String(r)}-${String(look)}`,
    box: circleBox(r + 4),
    draw(into, tools) {
      const g = graphics(into);
      g.circle(0, 0, r).stroke({ width: tools.hair(4.5), color: CASING });
      const ink = { width: tools.hair(1.8), color: INK, cap: 'butt' as const };
      if (look === 0) g.circle(0, 0, r).stroke(ink);
      else if (look === 1) dashedCircle(g, r, 7, 4).stroke(ink);
      else dashedCircle(g, r, 2, 4).stroke(ink);
    },
  };
}
