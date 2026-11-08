import { Container, Graphics } from 'pixi.js';
import type { BakeSpec, BakeTools } from './bake.ts';
import type { Point } from './camera.ts';
import {
  crownArc,
  lozengeRow,
  quantize,
  towerOutline,
  type BuildProgress,
  type TowerKind,
} from './pieceLayout.ts';
import { CASING, CROWN, DARK_PLATE, INK, LOZENGE, TOWER, WARN } from './style.ts';
import { scanLines } from '../units/helmet.ts';

// The baked shapes of the Engraved pieces of a city (#847, part 2 of #829): the warehouse lozenges,
// the towers on the ring, the Crown arc of a build and the alert ring of a recruit. Each returns the
// `BakeSpec` of one look (a bounded key, `bake.ts`); no shadow, no gradient: line and hatching on
// the dark plate, every coloured mark on a dark casing. Mockup: in-game-style-r5.html.

const graphics = (into: Container): Graphics => into.addChild(new Graphics());

/** A turned square (a lozenge) of `side` across its flats, round (`x`, `y`). */
function lozengePath(g: Graphics, x: number, y: number, side: number): Graphics {
  const h = (side * Math.SQRT2) / 2;
  return g.poly([x, y - h, x + h, y, x, y + h, x - h, y]);
}

/**
 * One charge (57u): the casing, then the side's `color` (`on`: in stock, paid) or the dark plate
 * with an ink square (`on` false: room, owed); `alpha` dims a place that is not there yet. `k`
 * scales the mark.
 */
export function drawLozenge(
  g: Graphics,
  tools: BakeTools,
  at: Point,
  on: boolean,
  color: number,
  k = 1,
  alpha = 1,
): void {
  lozengePath(g, at.x, at.y, LOZENGE.casing * k).fill({ color: CASING, alpha });
  if (on) {
    lozengePath(g, at.x, at.y, LOZENGE.fill * k).fill({ color, alpha });
    return;
  }
  lozengePath(g, at.x, at.y, LOZENGE.fill * k).fill({ color: DARK_PLATE, alpha });
  lozengePath(g, at.x, at.y, LOZENGE.hollow * k).stroke({
    width: tools.hair(LOZENGE.line),
    color: INK,
    alpha: LOZENGE.lineAlpha * alpha,
    join: 'miter',
  });
}

/**
 * The warehouse under a city (Lozenges, 57u): one mark per place, `stock` of them filled in
 * `color`, the rest hollow, then `locked` faint hollow ones for the levels not built yet (DEC-26).
 * No bar and no number. The sprite's origin is the middle of the row.
 */
export function warehouseMarksSpec(
  capacity: number,
  stock: number,
  color: number,
  locked = 0,
): BakeSpec {
  const cap = Math.max(0, Math.floor(capacity));
  const total = cap + Math.max(0, Math.floor(locked));
  const filled = Math.min(cap, Math.max(0, Math.floor(stock)));
  const xs = lozengeRow(total);
  const h = (LOZENGE.casing * Math.SQRT2) / 2;
  const left = (xs[0] ?? 0) - h;
  const right = (xs[xs.length - 1] ?? 0) + h;
  return {
    key: `lozenges:${String(cap)}:${String(filled)}:${String(total - cap)}:${String(color)}`,
    box: { x: left - 1, y: -h - 1, width: right - left + 2, height: 2 * h + 2 },
    draw(into, tools) {
      const g = graphics(into);
      xs.forEach((x, j) => {
        drawLozenge(g, tools, { x, y: 0 }, j < filled, color, 1, j < cap ? 1 : LOZENGE.lockedAlpha);
      });
    },
  };
}

// --- Towers on the ring ------------------------------------------------------------------------------

/** Lines at `angle` (radians on screen) `pitch` apart across a closed outline: an owner's hatch. */
export function hatchAcross(
  polygon: readonly Point[],
  angle: number,
  pitch: number,
): [Point, Point][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // Turn the outline so the hatch is horizontal, cut it, and turn the cuts back.
  const turned = polygon.map((p) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c }));
  const back = (p: Point): Point => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  return scanLines(turned, pitch).map(([a, b]) => [back(a), back(b)]);
}

const points = (outline: readonly (readonly [number, number])[]): Point[] =>
  outline.map(([x, y]) => ({ x, y }));
const flat = (outline: readonly (readonly [number, number])[]): number[] =>
  outline.flatMap(([x, y]) => [x, y]);

function towerBox(kind: TowerKind): { x: number; y: number; width: number; height: number } {
  const ps = towerOutline(kind);
  const xs = ps.map(([x]) => x);
  const ys = ps.map(([, y]) => y);
  const pad = TOWER.casing;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  return {
    x: x0,
    y: y0,
    width: Math.max(...xs) + pad - x0,
    height: Math.max(...ys) + pad - y0,
  };
}

/**
 * What the back of a tower shows: `built` the owner's hatch (own horizontal, the enemy's 45
 * degrees), `plan` the light plan of a build that still owes charges, `rising` the dark ground a
 * build's fill rises over.
 */
export type TowerLook = 'built' | 'plan' | 'rising';

/**
 * The back of a tower in its own frame (its top is -y): the casing and the ground, the hatch of a
 * built one in the owner's `color` (`enemy`: at 45 degrees).
 */
export function towerBackSpec(
  kind: TowerKind,
  look: TowerLook,
  color: number,
  enemy: boolean,
): BakeSpec {
  const outline = towerOutline(kind);
  return {
    key: `tower-back:${kind}:${look}:${String(color)}:${enemy ? 'e' : 'o'}`,
    box: towerBox(kind),
    draw(into, tools) {
      const g = graphics(into);
      const plan = look === 'plan';
      g.poly(flat(outline)).stroke({
        width: TOWER.casing,
        color: CASING,
        alpha: plan ? TOWER.plan.casingAlpha : 1,
        join: 'miter',
      });
      g.poly(flat(outline)).fill({ color: DARK_PLATE, alpha: plan ? TOWER.plan.groundAlpha : 1 });
      if (look !== 'built') return;
      for (const [a, b] of hatchAcross(
        points(outline),
        enemy ? -Math.PI / 4 : 0,
        TOWER.hatch.pitch,
      ))
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke({ width: tools.hair(TOWER.hatch.width), color });
    },
  };
}

/** The top and the bottom of a tower's block (its fill rises from the bottom). */
export function towerSpan(kind: TowerKind): { top: number; bottom: number } {
  const ys = towerOutline(kind).map(([, y]) => y);
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}

/**
 * The fill of a tower with its build time: the whole block in the side's `color` with faint bed
 * joints, shown from the bottom by a crop (`BakedSprite.cropBottom`), so it rises continuously.
 */
export function towerFillSpec(kind: TowerKind, color: number): BakeSpec {
  const outline = towerOutline(kind);
  const { top, bottom } = towerSpan(kind);
  const box = towerBox(kind);
  return {
    key: `tower-fill:${kind}:${String(color)}`,
    box: { x: box.x, y: top, width: box.width, height: bottom - top },
    draw(into, tools) {
      const g = graphics(into);
      g.poly(flat(outline)).fill(color);
      for (let y = bottom - TOWER.joint.every; y > top + 0.5; y -= TOWER.joint.every) {
        // A joint across the block at `y`: clipped to the outline by its crossings.
        const xs: number[] = [];
        outline.forEach(([x0, y0], i) => {
          const [x1, y1] = outline[(i + 1) % outline.length] ?? [x0, y0];
          if (y0 > y !== y1 > y) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
        });
        xs.sort((m, n) => m - n);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const from = xs[k];
          const to = xs[k + 1];
          if (from !== undefined && to !== undefined) g.moveTo(from, y).lineTo(to, y);
        }
      }
      g.stroke({ width: tools.hair(TOWER.joint.width), color: CASING, alpha: TOWER.joint.alpha });
    },
  };
}

/**
 * The front of a tower: its ink outline (dotted while it is only a plan), the dark gate of a built
 * barracks.
 */
export function towerFrontSpec(kind: TowerKind, look: TowerLook): BakeSpec {
  const outline = towerOutline(kind);
  return {
    key: `tower-front:${kind}:${look}`,
    box: towerBox(kind),
    draw(into, tools) {
      const g = graphics(into);
      const line = tools.hair(TOWER.line);
      if (look === 'plan') {
        const { dot, gap } = TOWER.plan;
        outline.forEach(([x0, y0], i) => {
          const [x1, y1] = outline[(i + 1) % outline.length] ?? [x0, y0];
          const length = Math.hypot(x1 - x0, y1 - y0);
          for (let d = 0; d < length; d += dot + gap) {
            const e = Math.min(length, d + dot);
            g.moveTo(x0 + ((x1 - x0) * d) / length, y0 + ((y1 - y0) * d) / length).lineTo(
              x0 + ((x1 - x0) * e) / length,
              y0 + ((y1 - y0) * e) / length,
            );
          }
        });
        g.stroke({ width: line, color: INK, alpha: TOWER.plan.lineAlpha });
        return;
      }
      g.poly(flat(outline)).stroke({ width: line, color: INK, join: 'miter' });
      if (kind === 'barracks' && look === 'built') {
        const { x, y, side } = TOWER.gate;
        g.rect(x, y, side, side).fill(CASING);
      }
    },
  };
}

/** The ink head line of a tower's fill: a line across the block (placed at the level of the fill). */
export function towerHeadSpec(kind: TowerKind): BakeSpec {
  const box = towerBox(kind);
  const inner = { x: box.x + TOWER.casing, width: box.width - 2 * TOWER.casing };
  return {
    key: `tower-head:${kind}`,
    box: { x: inner.x - 0.5, y: -1, width: inner.width + 1, height: 2 },
    draw(into) {
      graphics(into).rect(inner.x, -0.5, inner.width, 1).fill(INK);
    },
  };
}

// --- The Crown arc ---------------------------------------------------------------------------------

/** The share of the arc a build's time has filled, baked in `CROWN.steps` steps. */
export function crownShare(progress: BuildProgress): number {
  return progress.running ? quantize(progress.time, CROWN.steps) : 0;
}

/**
 * The Crown arc of a build (57k) round the city centre: the casing, a faint ink line, two ink
 * serifs; while charges are owed, the lozenges on it (hollow owed, solid paid); once paid, the time
 * fills the arc in the side's `color` behind a small ink burin point. `scale`: the tower's scale
 * (`towerScale`), which sets the radius and the size of the lozenges.
 */
export function crownSpec(
  radius: number,
  kind: TowerKind,
  progress: BuildProgress,
  color: number,
  scale: number,
): BakeSpec {
  const crown = crownArc(radius, kind, progress.cost, scale);
  const share = crownShare(progress);
  const k = (CROWN.lozenge * scale) / TOWER.minScale;
  const owed = !progress.running;
  const reach = crown.radius + CROWN.serif.half + LOZENGE.casing * k;
  return {
    key: `crown:${String(radius)}:${kind}:${String(progress.cost)}:${String(owed ? progress.paid : -1)}:${String(share)}:${String(color)}:${String(scale)}`,
    box: { x: -reach, y: -reach, width: 2 * reach, height: 2 * reach },
    draw(into, tools) {
      const g = graphics(into);
      const { radius: r, from, span } = crown;
      const arc = (a0: number, a1: number): Graphics =>
        g.moveTo(r * Math.cos(a0), r * Math.sin(a0)).arc(0, 0, r, a0, a1);
      arc(from - 0.03, from + span + 0.03).stroke({
        width: CROWN.width + CROWN.casing,
        color: CASING,
        cap: 'butt',
      });
      arc(from, from + span).stroke({
        width: tools.hair(CROWN.line.width),
        color: INK,
        alpha: CROWN.line.alpha,
        cap: 'butt',
      });
      for (const a of [from, from + span]) {
        const { half, casing, width } = CROWN.serif;
        const c = Math.cos(a);
        const s = Math.sin(a);
        g.moveTo((r - half) * c, (r - half) * s).lineTo((r + half) * c, (r + half) * s);
        g.stroke({ width: casing, color: CASING });
        g.moveTo((r - half) * c, (r - half) * s).lineTo((r + half) * c, (r + half) * s);
        g.stroke({ width: tools.hair(width), color: INK });
      }
      if (share > 0) {
        const a1 = from + span * share;
        arc(from, a1).stroke({ width: CROWN.width, color, cap: 'butt' });
        if (share < 1) {
          const head = { x: r * Math.cos(a1), y: r * Math.sin(a1) };
          const turn = (side: number): number[] => {
            const h = (side * Math.SQRT2) / 2;
            const c = Math.cos(a1 + Math.PI / 4);
            const s = Math.sin(a1 + Math.PI / 4);
            return [
              [0, -h],
              [h, 0],
              [0, h],
              [-h, 0],
            ].flatMap(([x = 0, y = 0]) => [head.x + x * c - y * s, head.y + x * s + y * c]);
          };
          g.poly(turn(CROWN.burin.casing)).fill(CASING);
          g.poly(turn(CROWN.burin.ink)).fill(INK);
        }
      }
      if (owed) {
        crown.lozenges.forEach((p, j) => {
          drawLozenge(g, tools, p, j < progress.paid, color, k);
        });
      }
    },
  };
}

/** The ring that opens from a tower just built (57k): an ink circle on a casing, faded by the view. */
export function towerRingSpec(radius: number): BakeSpec {
  const reach = radius + CROWN.ring.casing;
  return {
    key: `tower-ring:${String(radius)}`,
    box: { x: -reach, y: -reach, width: 2 * reach, height: 2 * reach },
    draw(into, tools) {
      const g = graphics(into);
      g.circle(0, 0, radius).stroke({ width: CROWN.ring.casing, color: CASING });
      g.circle(0, 0, radius).stroke({ width: tools.hair(CROWN.ring.width), color: INK });
    },
  };
}

/** The dashed amber ring round a recruit that needs a look (ready with no room, stopped by a fight). */
export function pipAlertSpec(radius: number): BakeSpec {
  const reach = radius + 2;
  return {
    key: `pip-alert:${String(radius)}`,
    box: { x: -reach, y: -reach, width: 2 * reach, height: 2 * reach },
    draw(into) {
      const g = graphics(into);
      const n = Math.max(6, Math.round((2 * Math.PI * radius) / 5));
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        g.moveTo(radius * Math.cos(a), radius * Math.sin(a)).arc(0, 0, radius, a, a + Math.PI / n);
      }
      g.stroke({ width: 3, color: CASING, cap: 'butt' });
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        g.moveTo(radius * Math.cos(a), radius * Math.sin(a)).arc(0, 0, radius, a, a + Math.PI / n);
      }
      g.stroke({ width: 1.4, color: WARN, cap: 'butt' });
    },
  };
}
