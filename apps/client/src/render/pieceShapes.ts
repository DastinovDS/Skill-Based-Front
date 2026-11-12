import { Container, Graphics } from 'pixi.js';
import type { BakeSpec, BakeTools } from './bake.ts';
import type { Point } from './camera.ts';
import type { BuildingKind } from './buildingLayout.ts';
import { cornerBounds, parseCut, solidCorners } from './cutPath.ts';
import { foundationOrigin, foundationSize } from './foundationLayout.ts';
import { lozengeRow } from './pieceLayout.ts';
import {
  BADGE_DOWN,
  BUILD_PAY,
  BUILDING,
  CASING,
  DARK_PLATE,
  FOUNDATION,
  INK,
  LOZENGE,
  WARN,
} from './style.ts';
import { CP_MARK } from '../theme/cpMark.ts';
import { CUT_ICONS, CUT_SOLIDS } from '../theme/cutIcons.ts';
import { ENGRAVED } from '../theme/tokens.ts';
import { scanLines } from '../units/helmet.ts';

// The baked shapes of the Engraved pieces of a city (#847, part 2 of #829): the warehouse lozenges,
// the barracks and factory icons (#954), the charges of a build and the barracks' foundation of a
// city that recruits (#1005). Each
// returns the `BakeSpec` of one look (a bounded key, `bake.ts`); no shadow, no gradient: line and
// hatching on the dark plate, every coloured mark on a dark casing. Mockups: in-game-style-r5.html,
// city-buildings-r2.html.

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
function drawLozenge(
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
 * `color`, the rest hollow. No bar and no number. The sprite's origin is the middle of the row.
 */
export function warehouseMarksSpec(capacity: number, stock: number, color: number): BakeSpec {
  const cap = Math.max(0, Math.floor(capacity));
  const filled = Math.min(cap, Math.max(0, Math.floor(stock)));
  const xs = lozengeRow(cap);
  const h = (LOZENGE.casing * Math.SQRT2) / 2;
  const left = (xs[0] ?? 0) - h;
  const right = (xs[xs.length - 1] ?? 0) + h;
  return {
    key: `lozenges:${String(cap)}:${String(filled)}:${String(color)}`,
    box: { x: left - 1, y: -h - 1, width: right - left + 2, height: 2 * h + 2 },
    draw(into, tools) {
      const g = graphics(into);
      xs.forEach((x, j) => {
        drawLozenge(g, tools, { x, y: 0 }, j < filled, color);
      });
    },
  };
}

// --- The barracks and the factory (#954) ----------------------------------------------------------------

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

/**
 * The chords of a closed outline at the heights `ys`: where a horizontal line across it is inside
 * (the rules of an icon's solid).
 */
export function chordsAt(polygon: readonly Point[], ys: readonly number[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (const y of ys) {
    const xs: number[] = [];
    polygon.forEach((p, i) => {
      const q = polygon[(i + 1) % polygon.length] ?? p;
      if (p.y > y !== q.y > y) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
    });
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = xs[k];
      const to = xs[k + 1];
      if (from !== undefined && to !== undefined)
        out.push([
          { x: from, y },
          { x: to, y },
        ]);
    }
  }
  return out;
}

/** The icon's 26-unit box with room for its casing and the flag of the barracks, round its origin. */
const ICON_REACH = 16;
const ICON_BOX = { x: -ICON_REACH, y: -ICON_REACH, width: 2 * ICON_REACH, height: 2 * ICON_REACH };

const solidOf = (kind: BuildingKind): Point[] => solidCorners(CUT_SOLIDS[kind] ?? '');

/** The top and the bottom of an icon's solid (its fill rises from the bottom). */
export function iconSpan(kind: BuildingKind): { top: number; bottom: number } {
  const b = cornerBounds(solidOf(kind));
  return { top: b.y, bottom: b.y + b.height };
}

/**
 * What the back of an icon shows: `built` the owner's rules on the dark ground (own horizontal, the
 * enemy's at 45 degrees), `plan` the half-dark ground of a build that still owes charges, `rising`
 * the dark ground a build's fill rises over.
 */
export type IconLook = 'built' | 'plan' | 'rising';

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/** Strokes the "Cut" outline of an icon (`CUT_ICONS`): every subpath, closed or open. */
function strokeOutline(
  g: Graphics,
  kind: BuildingKind,
  width: number,
  color: number,
  alpha = 1,
): void {
  for (const { points, closed } of parseCut(CUT_ICONS[kind])) {
    points.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    if (closed) g.closePath();
  }
  g.stroke({ width, color, alpha, cap: 'square', join: 'miter' });
}

/**
 * The back of an icon (the menu's art, `theme/cutIcons.ts`, on a 26-unit box centred on its origin):
 * the dark ground of the solid and, built, its rules in the owner's `color` (`enemy`: at 45 degrees).
 */
export function iconBackSpec(
  kind: BuildingKind,
  look: IconLook,
  color: number,
  enemy: boolean,
): BakeSpec {
  const solid = solidOf(kind);
  return {
    key: `icon-back:${kind}:${look}:${String(color)}:${enemy ? 'e' : 'o'}`,
    box: ICON_BOX,
    draw(into, tools) {
      const g = graphics(into);
      g.poly(flat(solid)).fill({
        color: DARK_PLATE,
        alpha: look === 'plan' ? BUILDING.plan.plateAlpha : 1,
      });
      if (look !== 'built') return;
      const { rule, ruleW } = BUILDING;
      if (enemy) {
        for (const [a, b] of hatchAcross(solid, -Math.PI / 4, rule))
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        g.stroke({ width: tools.hair(ruleW), color });
        return;
      }
      const bounds = cornerBounds(solid);
      const ys: number[] = [];
      for (
        let y = Math.floor(bounds.y / rule) * rule + ruleW / 2;
        y < bounds.y + bounds.height;
        y += rule
      )
        ys.push(y);
      for (const [a, b] of chordsAt(solid, ys)) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke({ width: ruleW, color });
    },
  };
}

/**
 * The fill of an icon with its build time: the whole solid in the side's `color` with faint bed
 * joints (one per rule), shown from the bottom by a crop (`BakedSprite.cropBottom`), so it rises
 * continuously.
 */
export function iconFillSpec(kind: BuildingKind, color: number): BakeSpec {
  const solid = solidOf(kind);
  const { top, bottom } = iconSpan(kind);
  const bounds = cornerBounds(solid);
  return {
    key: `icon-fill:${kind}:${String(color)}`,
    box: { x: bounds.x - 1, y: top, width: bounds.width + 2, height: bottom - top },
    draw(into, tools) {
      const g = graphics(into);
      g.poly(flat(solid)).fill(color);
      const ys: number[] = [];
      for (let y = bottom - BUILDING.rule; y > top + 0.4; y -= BUILDING.rule) ys.push(y);
      const joints = graphics(into);
      for (const [a, b] of chordsAt(solid, ys)) joints.moveTo(a.x, a.y).lineTo(b.x, b.y);
      joints.stroke({
        width: tools.hair(BUILDING.joint.width),
        color: CASING,
        alpha: BUILDING.joint.alpha,
      });
    },
  };
}

/** The ivory head line of an icon's fill: a line across the solid (placed at the level of the fill). */
export function iconHeadSpec(kind: BuildingKind): BakeSpec {
  const bounds = cornerBounds(solidOf(kind));
  const x0 = bounds.x;
  const x1 = bounds.x + bounds.width;
  return {
    key: `icon-head:${kind}`,
    box: { x: x0 - 1, y: -1.5, width: x1 - x0 + 2, height: 3 },
    draw(into, tools) {
      graphics(into)
        .moveTo(x0 - 0.5, 0)
        .lineTo(x1 + 0.5, 0)
        .stroke({ width: tools.hair(BUILDING.head.width), color: ENGRAVED.ink, cap: 'butt' });
    },
  };
}

/**
 * The front of an icon: the dark casing and the ink line over it, square ends (as `CutIcon.svelte`
 * draws them); a build that still owes charges is a plan, its outline dotted on a lighter casing.
 */
export function iconFrontSpec(kind: BuildingKind, look: IconLook): BakeSpec {
  return {
    key: `icon-front:${kind}:${look}`,
    box: ICON_BOX,
    draw(into, tools) {
      const g = graphics(into);
      if (look === 'plan') {
        strokeOutline(g, kind, BUILDING.casing, CASING, BUILDING.plan.casingAlpha);
        const { dash, line, lineAlpha } = BUILDING.plan;
        const dotted = graphics(into);
        for (const { points, closed } of parseCut(CUT_ICONS[kind])) {
          const first = points[0];
          const loop = closed && first !== undefined ? [...points, first] : points;
          for (let i = 0; i + 1 < loop.length; i++) {
            const a = loop[i];
            const b = loop[i + 1];
            if (a === undefined || b === undefined) continue;
            const length = Math.hypot(b.x - a.x, b.y - a.y);
            for (let d = 0; d < length; d += 2 * dash) {
              const e = Math.min(length, d + dash);
              dotted
                .moveTo(a.x + ((b.x - a.x) * d) / length, a.y + ((b.y - a.y) * d) / length)
                .lineTo(a.x + ((b.x - a.x) * e) / length, a.y + ((b.y - a.y) * e) / length);
            }
          }
        }
        dotted.stroke({ width: tools.hair(line), color: INK, alpha: lineAlpha, cap: 'butt' });
        return;
      }
      strokeOutline(g, kind, BUILDING.casing, CASING, BUILDING.casingAlpha);
      strokeOutline(g, kind, tools.hair(BUILDING.ink), INK);
    },
  };
}

// --- The charges of a build ----------------------------------------------------------------------------

/**
 * One paid charge alone (#872): the lozenge that flies into a build, pops on the row by the icon and
 * runs into it, at `k` of its warehouse size (the view scales the sprite down from there).
 */
export function chargeSpec(color: number, k: number): BakeSpec {
  const h = (LOZENGE.casing * k * Math.SQRT2) / 2 + 1;
  return {
    key: `charge:${String(color)}:${String(k)}`,
    box: { x: -h, y: -h, width: 2 * h, height: 2 * h },
    draw(into, tools) {
      drawLozenge(graphics(into), tools, { x: 0, y: 0 }, true, color, k);
    },
  };
}

/** One owed charge (hollow) or paid one (solid) of a build's row, at `k` of its warehouse size. */
export function owedSpec(on: boolean, color: number, k: number): BakeSpec {
  const h = (LOZENGE.casing * k * Math.SQRT2) / 2 + 1;
  return {
    key: `owed:${on ? 'paid' : 'owed'}:${String(color)}:${String(k)}`,
    box: { x: -h, y: -h, width: 2 * h, height: 2 * h },
    draw(into, tools) {
      drawLozenge(graphics(into), tools, { x: 0, y: 0 }, on, color, k);
    },
  };
}

/** The ring that opens from an icon just built (57k): an ink circle on a casing, faded by the view. */
export function doneRingSpec(radius: number): BakeSpec {
  const reach = radius + BUILD_PAY.done.casing;
  return {
    key: `done-ring:${String(radius)}`,
    box: { x: -reach, y: -reach, width: 2 * reach, height: 2 * reach },
    draw(into, tools) {
      const g = graphics(into);
      g.circle(0, 0, radius).stroke({ width: BUILD_PAY.done.casing, color: CASING });
      g.circle(0, 0, radius).stroke({ width: tools.hair(BUILD_PAY.done.width), color: INK });
    },
  };
}

// --- The barracks' foundation while its city recruits (#1005, D2 "Foundation") ------------------------

/** The corners of a box with its corners cut by `ch` (the foundation's outline), clockwise. */
function chamferCorners(x0: number, y0: number, x1: number, y1: number, ch: number): number[] {
  return [
    x0 + ch,
    y0,
    x1 - ch,
    y0,
    x1,
    y0 + ch,
    x1,
    y1 - ch,
    x1 - ch,
    y1,
    x0 + ch,
    y1,
    x0,
    y1 - ch,
    x0,
    y0 + ch,
  ];
}

/** Dashes `dash` long `gap` apart along a closed outline (flat x, y pairs), from its first corner. */
function dashOutline(g: Graphics, corners: readonly number[], dash: number, gap: number): Graphics {
  const n = corners.length / 2;
  let carry = 0;
  for (let i = 0; i < n; i++) {
    const ax = corners[2 * i] ?? 0;
    const ay = corners[2 * i + 1] ?? 0;
    const bx = corners[(2 * i + 2) % (2 * n)] ?? 0;
    const by = corners[(2 * i + 3) % (2 * n)] ?? 0;
    const length = Math.hypot(bx - ax, by - ay);
    let d = carry;
    while (d < length) {
      const e = Math.min(length, d + dash);
      g.moveTo(ax + ((bx - ax) * d) / length, ay + ((by - ay) * d) / length).lineTo(
        ax + ((bx - ax) * e) / length,
        ay + ((by - ay) * e) / length,
      );
      d += dash + gap;
    }
    carry = d - length;
  }
  return g;
}

/** The box of the foundation's sprites round the barracks' seat (its casing and a unit of air). */
function foundationBakeBox(sockets: number): BakeSpec['box'] {
  const o = foundationOrigin(sockets);
  const { width, height } = foundationSize(sockets);
  const c = FOUNDATION.casing;
  return {
    x: o.x - c - 1,
    y: o.y - c * 0.4 - 1,
    width: width + 2 * c + 2,
    height: height + c * 1.4 + 2,
  };
}

/**
 * The foundation of a barracks of `sockets` sockets, at the 16-unit icon, round the barracks' seat:
 * a level base under its ground line, on a dark casing that merges with the barracks' own, its
 * plate darker downward, an ink rim with cut corners.
 */
export function foundationSpec(sockets: number): BakeSpec {
  const o = foundationOrigin(sockets);
  const { width, height } = foundationSize(sockets);
  const { casing: c, chamfer, rim, plate } = FOUNDATION;
  return {
    key: `foundation:${String(sockets)}`,
    box: foundationBakeBox(sockets),
    draw(into, tools) {
      const x1 = o.x + width;
      const y1 = o.y + height;
      graphics(into)
        .poly(chamferCorners(o.x - c, o.y - c * 0.4, x1 + c, y1 + c, chamfer + c * 0.6))
        .fill({ color: CASING, alpha: 0.94 });
      graphics(into)
        .poly(chamferCorners(o.x, o.y, x1, y1, chamfer))
        .fill(tools.ramp(plate.top, plate.bottom));
      const i = rim.inset;
      graphics(into)
        .poly(chamferCorners(o.x + i, o.y + i, x1 - i, y1 - i, rim.chamfer))
        .stroke({ width: tools.hair(rim.width), color: INK, alpha: rim.alpha, join: 'miter' });
    },
  };
}

/**
 * The amber "needs a look" rim of a foundation (no room, or a fight in the city): dashed on a
 * casing; the view pulses it.
 */
export function foundationAlertSpec(sockets: number): BakeSpec {
  const o = foundationOrigin(sockets);
  const { width, height } = foundationSize(sockets);
  const { rim, alert } = FOUNDATION;
  return {
    key: `foundation-alert:${String(sockets)}`,
    box: foundationBakeBox(sockets),
    draw(into, tools) {
      const i = rim.inset;
      const corners = chamferCorners(
        o.x + i,
        o.y + i,
        o.x + width - i,
        o.y + height - i,
        rim.chamfer,
      );
      graphics(into)
        .poly(corners)
        .stroke({ width: alert.casing, color: CASING, alpha: 0.9, join: 'miter' });
      dashOutline(graphics(into), corners, alert.dash, alert.gap).stroke({
        width: tools.hair(alert.width),
        color: WARN,
        cap: 'butt',
      });
    },
  };
}

/**
 * The body of a socket: a recess (`empty`, `free`), a unit ordered (`queued`), or the hatch under
 * the unit under way (`under`).
 */
export type SocketLook = 'empty' | 'free' | 'queued' | 'under';

/** A socket's body, its origin at the socket's top left (16-unit icon): the dark plate and the owner's hatch. */
export function socketSpec(look: SocketLook, color: number): BakeSpec {
  const { cell, socket } = FOUNDATION;
  const hatched = look === 'queued' || look === 'under';
  return {
    key: `socket:${look}${hatched ? `:${String(color)}` : ''}`,
    box: { x: -0.5, y: -0.5, width: cell + 1, height: cell + 1 },
    draw(into, tools) {
      graphics(into)
        .rect(0, 0, cell, cell)
        .fill({ color: DARK_PLATE, alpha: hatched ? 1 : socket.plateAlpha });
      if (!hatched) return;
      const square: Point[] = [
        { x: 0, y: 0 },
        { x: cell, y: 0 },
        { x: cell, y: cell },
        { x: 0, y: cell },
      ];
      const g = graphics(into);
      for (const [a, b] of hatchAcross(square, -Math.PI / 4, socket.hatch.pitch))
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke({
        width: tools.hair(socket.hatch.width),
        color,
        alpha: look === 'queued' ? socket.hatch.queued : socket.hatch.under,
        cap: 'butt',
      });
    },
  };
}

/** A socket's own rule over it: barely there on a recess, dashed on a free slot, ink on a unit. */
export function socketRuleSpec(look: 'empty' | 'free' | 'filled'): BakeSpec {
  const { cell, socket } = FOUNDATION;
  const i = socket.inset;
  return {
    key: `socket-rule:${look}`,
    box: { x: -0.5, y: -0.5, width: cell + 1, height: cell + 1 },
    draw(into, tools) {
      const corners = [i, i, cell - i, i, cell - i, cell - i, i, cell - i];
      const style = {
        width: tools.hair(socket.rule),
        color: INK,
        alpha: socket.ruleAlpha[look],
        join: 'miter' as const,
        cap: 'butt' as const,
      };
      if (look === 'free')
        dashOutline(graphics(into), corners, socket.dash, socket.gap).stroke(style);
      else graphics(into).poly(corners).stroke(style);
    },
  };
}

/**
 * The made part of a unit under way: the socket in the owner's colour, lighter at the top; the view
 * scales it from the left.
 */
export function socketFillSpec(color: number): BakeSpec {
  const { cell } = FOUNDATION;
  return {
    key: `socket-fill:${String(color)}`,
    box: { x: 0, y: 0, width: cell, height: cell },
    draw(into, tools) {
      graphics(into).rect(0, 0, cell, cell).fill(tools.gradient(color));
    },
  };
}

/** The ivory head line of a unit under way, on its casing, a little past the socket at both ends. */
export function socketHeadSpec(): BakeSpec {
  const { cell, head } = FOUNDATION;
  const reach = head.casing / 2 + 0.5;
  return {
    key: 'socket-head',
    box: { x: -reach, y: -head.over - 0.5, width: 2 * reach, height: cell + 2 * head.over + 1 },
    draw(into, tools) {
      graphics(into)
        .moveTo(0, -head.over)
        .lineTo(0, cell + head.over)
        .stroke({ width: head.casing, color: CASING, alpha: head.casingAlpha, cap: 'butt' });
      graphics(into)
        .moveTo(0, -head.over)
        .lineTo(0, cell + head.over)
        .stroke({ width: tools.hair(head.width), color: ENGRAVED.ink, cap: 'butt' });
    },
  };
}

/** The soft ivory glow at the head of a unit under way, at full strength (the view sets its opacity). */
export function socketGlowSpec(): BakeSpec {
  const r = FOUNDATION.head.glow;
  return {
    key: 'socket-glow',
    box: { x: -r - 0.5, y: -r - 0.5, width: 2 * r + 1, height: 2 * r + 1 },
    draw(into) {
      // Discs from the rim in: stacked, they fall off as the mockup's radial gradient does.
      const g = graphics(into);
      for (let i = 0; i < 6; i++) {
        g.circle(0, 0, r * (1 - i / 6)).fill({ color: ENGRAVED.ink, alpha: 0.2 });
      }
    },
  };
}

/**
 * The CP mark on the ring (#930, W4): `ink` the mark of a queued recruit's walk (dimmed by
 * `alpha`), `down` the same in red with a down chevron (the CP now do not pay it). `size` world
 * units square, centred. A walk not paid is told by the strip under the bar (#930, C3), not here (#765).
 */
export type CpMarkLook = 'ink' | 'down';

/** The vertical extent of the mark's glyph in its box, for the fill of a recruit being made. */
export function cpMarkGlyph(size: number): { readonly top: number; readonly bottom: number } {
  const k = size / CP_MARK.box.width;
  return { top: (0 - CP_MARK.box.y) * k - size / 2, bottom: (15.5 - CP_MARK.box.y) * k - size / 2 };
}

export function cpMarkSpec(look: CpMarkLook, size: number, alpha = 1): BakeSpec {
  const { box, shapes, casing, ink } = CP_MARK;
  const k = size / box.width;
  const h = size / 2;
  // The chevron of a shortfall stands after the mark, up and to the right.
  const right = look === 'down' ? h + 0.8 * h : h + 1;
  return {
    key: `cp-mark:${look}:${String(size)}:${String(alpha)}`,
    box: { x: -h - 1, y: -h - 1, width: h + 1 + right, height: 2 * h + 2 },
    draw(into) {
      const g = graphics(into);
      g.alpha = alpha;
      const place = (shape: readonly number[]): number[] =>
        shape.map((v, i) => (i % 2 === 0 ? (v - box.x) * k - h : (v - box.y) * k - h));
      for (const shape of shapes) {
        g.poly(place(shape)).stroke({
          width: casing.width * k,
          color: casing.color,
          join: 'miter',
        });
      }
      for (const shape of shapes) g.poly(place(shape)).fill(look === 'down' ? BADGE_DOWN : ink);
      if (look === 'down') {
        const c = graphics(into);
        const x = h * 1.15;
        const y = -h * 0.55;
        const w = h * 0.45;
        for (const [tone, width] of [
          [CASING, 3],
          [BADGE_DOWN, 1.4],
        ] as const) {
          c.moveTo(x - w, y - w / 2)
            .lineTo(x, y + w / 2)
            .lineTo(x + w, y - w / 2)
            .stroke({ width, color: tone, join: 'miter' });
        }
      }
    },
  };
}
