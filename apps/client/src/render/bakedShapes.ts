import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { BakeSpec } from './bake.ts';
import {
  BUNKER_GLYPH,
  BUNKER_SLIT,
  FACTORY_GLYPH,
  capacityRing,
  ringRadius,
  type Arc,
  type PlaceState,
} from './cityLayout.ts';
import { hatchPolygons, innerWidth, type BuildMark, type CellState } from './progressLayout.ts';
import { ARENA_BAR, CHIP, PLATE, lighten, type ChipState } from './fightFx.ts';
import { dashSegments } from './layout.ts';
import { circleBox, shadowBox, type Box } from './shading.ts';
import {
  BAKE_MARGIN,
  BAR_SEGMENT,
  BARRACKS_MARK,
  BG,
  DEFENSE_PIPS,
  FLOW_STARVE,
  GLYPH_COLOR,
  PAPER,
  PLACE_DASHED,
  PLACE_FRAME,
  PLATE_FILL,
  PROGRESS,
  SEGMENT_EMPTY,
  SHADOW,
  SUPPLY_LINE,
  ENEMY,
  FEED,
  YOU,
  NEUTRAL_STROKE,
  WARN,
  BADGE,
  BADGE_DOWN,
  BADGE_UP,
  CASING,
  CITY_ENGRAVED,
  CUT,
  HELMET_ENGRAVED,
  INK,
  DARK_PLATE,
  PROVINCE_ENGRAVED,
  RING_ENGRAVED,
  VP,
  VP_LOZENGE,
} from './style.ts';
import { counterLayout, type DefensePips } from './defenseLayout.ts';
import { hatchAcross } from './pieceShapes.ts';
import {
  helmet,
  helmetExtent,
  helmetLines,
  type Helmet,
  type HelmetKind,
} from '../units/helmet.ts';
import type { Point } from './camera.ts';
import {
  badgeBox,
  badgeCount,
  badgeFont,
  badgeLabel,
  chevronStrokes,
  type BadgeDir,
} from './badgeLayout.ts';
import { drawBonusChevron } from './bonusChevron.ts';

// The baked shapes of the map (BL1-1 "Restrained", ui-style 26.3, #347). Each function returns the
// `BakeSpec` of one look: the key says which, `draw` puts the shape into a scratch container (see
// `bake.ts`). Everything is drawn around the origin of the sprite; the box leaves room for the shadow.

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/**
 * The soft shadow of a shape: its outline `base` px wider, drawn as a few stacked layers (the widest
 * faintest) `SHADOW.dy` below. `trace` adds the path of the shape to the Graphics it is given.
 */
function shadow(into: Container, trace: (g: Graphics) => void, base = 0): void {
  for (const { grow, alpha } of SHADOW.layers) {
    const g = new Graphics();
    g.y = SHADOW.dy;
    trace(g);
    g.fill({ color: 0x000000, alpha });
    const width = 2 * (base + grow);
    if (width > 0) {
      trace(g);
      g.stroke({ width, color: 0x000000, alpha, join: 'round' });
    }
    into.addChild(g);
  }
}

const graphics = (into: Container): Graphics => into.addChild(new Graphics());

// --- Cities ----------------------------------------------------------------------------------------

export type CityKind = 'neutral' | 'you' | 'enemy';

/** A circle as a closed outline of `n` points (the hatch of a neutral city is cut to it). */
function circlePoints(radius: number, n = 48): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
  }
  return out;
}

/**
 * The body of a city (Engraved, #847; mockup `cityBody`): the disc on a dark cut, filled with the
 * owner's colour (own blue, the enemy red with two ink rings inside, so the side reads without the
 * hue; a neutral one hatched in its grey), an ink ring outside it and a faint cut inside an owned one.
 * `occupied`: units stand there, the disc is the dark plate the helmet stands on. The capital star
 * (dark, an ink edge) shows on an empty capital.
 */
export function cityBodySpec(
  kind: CityKind,
  radius: number,
  capital: boolean,
  occupied = false,
): BakeSpec {
  const E = CITY_ENGRAVED;
  const reach = radius + E.cut.grow;
  return {
    key: `city:${kind}:${String(radius)}:${capital ? 'c' : ''}:${occupied ? 'o' : ''}`,
    box: circleBox(reach + 1),
    draw(into, tools) {
      const g = graphics(into);
      g.circle(0, 0, reach).fill({ color: CUT, alpha: E.cut.alpha });
      if (occupied) {
        g.circle(0, 0, radius).fill(DARK_PLATE);
      } else if (kind === 'neutral') {
        const { pitch, width, alpha } = E.neutralHatch;
        for (const [a, b] of hatchAcross(circlePoints(radius), -Math.PI / 4, pitch))
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        g.stroke({ width: tools.hair(width), color: NEUTRAL_STROKE, alpha });
      } else {
        g.circle(0, 0, radius).fill(kind === 'you' ? YOU : ENEMY);
      }
      g.circle(0, 0, radius + E.rim.grow).stroke({
        width: tools.hair(E.rim.width),
        color: kind === 'neutral' ? NEUTRAL_STROKE : INK,
      });
      if (kind !== 'neutral') {
        g.circle(0, 0, radius - E.inner.inset).stroke({
          width: tools.hair(E.inner.width),
          color: CUT,
          alpha: E.inner.alpha,
        });
      }
      if (kind === 'enemy') {
        for (const inset of E.enemy.insets) {
          g.circle(0, 0, radius - inset).stroke({ width: tools.hair(E.enemy.width), color: INK });
        }
      }
      if (capital && !occupied) {
        g.star(0, 0, 5, radius * E.star.outer, radius * E.star.inner, -Math.PI / 2)
          .fill(DARK_PLATE)
          .stroke({ width: tools.hair(E.star.width), color: INK, join: 'miter' });
      }
    },
  };
}

/**
 * A province (DEC-23; Engraved, #847, mockup `provinceAt`): a dark disc, the owner's dot with an ink
 * ring, the opponent's with a second ink ring outside (the side without the hue); nobody's a thin
 * grey ring with a dot. `occupied`: units stand there, only the dark disc under the helmet. The
 * capacity ring is the city ring (`cityRingSpec`).
 */
export function provinceBodySpec(kind: CityKind, occupied = false): BakeSpec {
  const P = PROVINCE_ENGRAVED;
  const reach = P.enemy.radius + P.enemy.width;
  return {
    key: `province:${kind}:${occupied ? 'o' : ''}`,
    box: circleBox(reach + 1),
    draw(into, tools) {
      const g = graphics(into);
      g.circle(0, 0, P.plate).fill(DARK_PLATE);
      if (occupied) return;
      if (kind === 'neutral') {
        g.circle(0, 0, P.neutral.radius).stroke({
          width: tools.hair(P.neutral.width),
          color: NEUTRAL_STROKE,
        });
        g.circle(0, 0, P.neutral.dot).fill(NEUTRAL_STROKE);
        return;
      }
      g.circle(0, 0, P.dot).fill(kind === 'you' ? YOU : ENEMY);
      g.circle(0, 0, P.rim.radius).stroke({ width: tools.hair(P.rim.width), color: INK });
      if (kind === 'enemy') {
        g.circle(0, 0, P.enemy.radius).stroke({ width: tools.hair(P.enemy.width), color: INK });
      }
    },
  };
}

function strokeArcs(
  g: Graphics,
  radius: number,
  arcs: readonly Arc[],
  style: { width: number; color: number; alpha?: number },
): void {
  for (const arc of arcs) {
    g.moveTo(radius * Math.cos(arc.from), radius * Math.sin(arc.from)).arc(
      0,
      0,
      radius,
      arc.from,
      arc.to,
    );
  }
  g.stroke({ ...style, cap: 'butt' });
}

/**
 * The capacity ring (Engraved, #847; mockup `ringAt`): every place on a dark cut; a place with a unit
 * of the viewer a solid ink arc, room two ink hairlines either side of the ring (filled against
 * hollow, never the colour alone). Above `RING_MAX_SEGMENTS` one arc with a dark notch every fifth.
 */
export function cityRingSpec(radius: number, capacity: number, garrison: number): BakeSpec {
  const r = ringRadius(radius);
  const R = RING_ENGRAVED;
  const reach = r + R.cut / 2;
  return {
    key: `ring:${String(radius)}:${String(capacity)}:${String(garrison)}`,
    box: circleBox(reach + 1),
    draw(into, tools) {
      const ring = capacityRing(capacity, garrison);
      const g = graphics(into);
      strokeArcs(g, r, ring.arcs, { width: R.cut, color: CUT, alpha: R.cutAlpha });
      strokeArcs(
        g,
        r,
        ring.arcs.filter((arc) => arc.filled),
        { width: R.filled, color: INK },
      );
      const room = ring.arcs.filter((arc) => !arc.filled);
      for (const side of [-1, 1]) {
        strokeArcs(g, r + side * R.room.offset, room, {
          width: tools.hair(R.room.width),
          color: INK,
        });
      }
      for (const angle of ring.notches) {
        const inner = r - R.cut / 2;
        const outer = r + R.cut / 2;
        g.moveTo(inner * Math.cos(angle), inner * Math.sin(angle)).lineTo(
          outer * Math.cos(angle),
          outer * Math.sin(angle),
        );
      }
      if (ring.notches.length > 0) g.stroke({ width: R.notch, color: CUT });
    },
  };
}

/** The colour of the warehouse stock of a city kind. */
export function stockColor(kind: CityKind): number {
  return kind === 'you' ? YOU : kind === 'enemy' ? ENEMY : NEUTRAL_STROKE;
}

/**
 * The outline of a warehouse place that holds no charge, in the 5 x 4 cell at (`x`, `y`): a frame
 * for room, a dashed outline for a level not built yet (C1). Drawn inside the cell, so the cell
 * keeps its size whatever the state.
 */
export function drawPlaceOutline(
  g: Graphics,
  x: number,
  y: number,
  state: Exclude<PlaceState, 'filled'>,
): void {
  const { width, height } = BAR_SEGMENT;
  if (state === 'frame') {
    const w = PLACE_FRAME.width;
    g.rect(x + w / 2, y + w / 2, width - w, height - w).stroke(PLACE_FRAME);
    return;
  }
  const { width: w, color, alpha, dash, gap } = PLACE_DASHED;
  const [x0, y0, x1, y1] = [x + w / 2, y + w / 2, x + width - w / 2, y + height - w / 2];
  const corners: Point[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  corners.forEach((from, i) => {
    const to = corners[(i + 1) % corners.length];
    if (to === undefined) return;
    for (const [a, b] of dashSegments(from, to, dash, gap)) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  });
  g.stroke({ width: w, color, alpha });
}

/**
 * The VP badge (Engraved, #847; mockup `vpBadge`): a gilt lozenge, a dark square turned 45 degrees
 * with two gilt squares inside its edge (the number is a Text over it, gilt too).
 */
export function vpBadgeSpec(): BakeSpec {
  const V = VP_LOZENGE;
  const lozenge = (g: Graphics, side: number): Graphics => {
    const h = (side * Math.SQRT2) / 2;
    return g.poly([0, -h, h, 0, 0, h, -h, 0]);
  };
  const reach = (V.side * Math.SQRT2) / 2;
  return {
    key: 'vp-badge',
    box: circleBox(reach + 1),
    draw(into, tools) {
      const g = graphics(into);
      lozenge(g, V.side).fill(DARK_PLATE);
      lozenge(g, V.outer).stroke({ width: tools.hair(V.width), color: VP, join: 'miter' });
      lozenge(g, V.inner).stroke({ width: tools.hair(V.width), color: VP, join: 'miter' });
    },
  };
}

/**
 * Economy v2 (DEC-41): the factory (item 2) and bunker (item 12) badges, in the language of the
 * barracks badge: a dark disc, the rim in the owner's colour, the glyph in paper (a saw-tooth
 * factory, a low dome with a slit). The opponent's has the light inner ring and a smaller glyph,
 * so the side reads without the hue.
 */
export function siteMarkSpec(kind: 'factory' | 'fort', rim: number): BakeSpec {
  const radius = BARRACKS_MARK.radius;
  const enemy = rim === ENEMY;
  return {
    key: `${kind}:${String(rim)}`,
    box: shadowBox(circleBox(radius + 1), BAKE_MARGIN),
    draw(into) {
      shadow(into, (g) => g.circle(0, 0, radius));
      const g = graphics(into);
      g.circle(0, 0, radius)
        .fill(BARRACKS_MARK.fill)
        .stroke({ ...BARRACKS_MARK.stroke, color: rim });
      const k = enemy ? BARRACKS_MARK.enemy.house : 1;
      if (enemy) {
        g.circle(0, 0, BARRACKS_MARK.enemy.innerRadius).stroke({
          width: BARRACKS_MARK.enemy.ringWidth,
          color: PAPER,
          alpha: BARRACKS_MARK.enemy.ringAlpha,
        });
      }
      drawSiteGlyph(g, kind, 0, 0, k);
    },
  };
}

/** The factory or bunker glyph at (`cx`, `cy`), scaled by `k` (1: the badge of a mark). */
function drawSiteGlyph(
  g: Graphics,
  kind: 'factory' | 'fort',
  cx: number,
  cy: number,
  k: number,
): void {
  const shape = kind === 'factory' ? FACTORY_GLYPH : BUNKER_GLYPH;
  g.poly(shape.flatMap(([x, y]) => [cx + x * k, cy + y * k])).fill(PAPER);
  if (kind === 'fort') {
    const { x, y, width, height } = BUNKER_SLIT;
    g.rect(cx + x * k, cy + y * k, width * k, height * k).fill(BG);
  }
}

// --- Helmets (#784, variant Full of #775) ------------------------------------------------------------
// A helmet is three baked sprites: the back (shadow, dark casing, the light strap
// and brim, the empty plate of the dome), the charge fill (the whole dome in the gradient of the
// owner, shown from the bottom by a crop of its frame, `BakedSprite.cropBottom`) and the front (the
// light edge of the dome). All face right; a view flips them for the opponent (`scale.x = -1`).

/** A polyline (the strap, the brim) into `g`, to be stroked. */
function polyline(g: Graphics, points: readonly Point[]): Graphics {
  const [first, ...rest] = points;
  if (first === undefined) return g;
  g.moveTo(first.x, first.y);
  for (const p of rest) g.lineTo(p.x, p.y);
  return g;
}

/** The lines of a helmet under the dome: the strap, then the brim (own). */
function gear(h: Helmet): (readonly Point[])[] {
  return h.band === null ? [h.strap] : [h.strap, h.band];
}

function helmetBox(h: Helmet): Box {
  const e = helmetExtent(h);
  return { x: e.left, y: e.top, width: e.right - e.left, height: e.bottom - e.top };
}

/** The light tone of the owner's colour: the strap, the brim and the edge of the dome. */
export function helmetLight(color: number): number {
  return lighten(color, 0.5);
}

/** The pitch of the hatch of a helmet `width` wide: finer on a small one, never under 1.4 units. */
export function helmetHatchPitch(width: number): number {
  return Math.min(HELMET_ENGRAVED.hatch.pitch, Math.max(1.4, width * 0.075));
}

/**
 * The back of a helmet `width` wide (Engraved, #847; mockup `helmet`): the dark casing round the
 * dome, the strap and the brim (thicker in a city, where it parts the icon from the city disc), the
 * dome on the dark plate hatched in the side's `color` (the part without a charge: the charge fill
 * covers the rest), the strap and the brim as ink lines. `dashed` (numbers unknown, a memory): the
 * dome on a see-through plate and a pale strap; its beaded outline is the front.
 */
export function helmetBackSpec(
  kind: HelmetKind,
  width: number,
  color: number,
  look: 'solid' | 'dashed',
  inside: boolean,
): BakeSpec {
  const h = helmet(kind, width);
  const lines = helmetLines(width);
  const E = HELMET_ENGRAVED;
  const casing = E.casing + (inside ? E.inside : 0);
  const dome = flat(h.dome);
  const box = helmetBox(h);
  return {
    key: `hel-back:${kind}:${String(width)}:${String(color)}:${look}:${inside ? 'i' : ''}`,
    box: { x: box.x - 1, y: box.y - 1, width: box.width + 2, height: box.height + 2 },
    draw(into, tools) {
      const lineWidth = (line: readonly Point[]): number =>
        (line === h.strap ? lines.strap : lines.band) * E.gear;
      const g = graphics(into);
      if (look === 'dashed') {
        g.poly(dome).fill({ color: DARK_PLATE, alpha: E.unknownPlate });
        for (const line of gear(h)) {
          polyline(g, line).stroke({
            width: tools.hair(0.9),
            color: lighten(color, E.pale),
            cap: 'round',
            join: 'round',
          });
        }
        return;
      }
      for (const line of gear(h)) {
        polyline(g, line).stroke({
          width: lineWidth(line) + casing * 0.8,
          color: CASING,
          cap: 'round',
          join: 'round',
        });
      }
      g.poly(dome).stroke({ width: casing * 0.9, color: CASING, join: 'round' });
      g.poly(dome).fill(DARK_PLATE);
      for (const [a, b] of hatchAcross(h.dome, -Math.PI / 4, helmetHatchPitch(width)))
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke({ width: tools.hair(E.hatch.width), color });
      for (const line of gear(h)) {
        polyline(g, line).stroke({
          width: tools.hair(lineWidth(line)),
          color: INK,
          cap: 'round',
          join: 'round',
        });
      }
    },
  };
}

/** The box of the charge fill: the dome and a margin; its bottom is the bottom of the dome plus 1. */
export function helmetLevelBox(h: Helmet): Box {
  const top = h.domeTop - 1;
  return {
    x: h.bounds.x - 1,
    y: top,
    width: h.bounds.width + 2,
    height: h.domeBottom + 1 - top,
  };
}

/** The charge fill of a helmet: the whole dome solid in the side's colour (shown from the bottom up). */
export function helmetLevelSpec(kind: HelmetKind, width: number, color: number): BakeSpec {
  const h = helmet(kind, width);
  return {
    key: `hel-level:${kind}:${String(width)}:${String(color)}`,
    box: helmetLevelBox(h),
    draw(into) {
      graphics(into).poly(flat(h.dome)).fill(color);
    },
  };
}

/**
 * The ink edge of the dome, over the fill. `dashed` (numbers unknown, a memory): a row of pale beads
 * along the outline instead (a stippled contour, not a dash).
 */
export function helmetFrontSpec(
  kind: HelmetKind,
  width: number,
  color: number,
  look: 'solid' | 'dashed',
): BakeSpec {
  const h = helmet(kind, width);
  const E = HELMET_ENGRAVED;
  const box = helmetLevelBox(h);
  const grow = 2.2;
  return {
    key: `hel-front:${kind}:${String(width)}:${String(color)}:${look}`,
    box: {
      x: box.x - grow,
      y: box.y - grow,
      width: box.width + 2 * grow,
      height: box.height + 2 * grow,
    },
    draw(into, tools) {
      const g = graphics(into);
      if (look === 'dashed') {
        const pale = lighten(color, E.pale);
        const k = width / 40;
        for (const p of beadsAlong(h.dome, Math.max(12, Math.round(E.bead.count * Math.min(1, k)))))
          g.circle(p.x, p.y, Math.max(0.5, E.bead.radius * Math.min(1, k * 1.2)));
        g.fill(pale);
        return;
      }
      g.poly(flat(h.dome)).stroke({ width: tools.hair(E.edge), color: INK, join: 'round' });
    },
  };
}

/** `n` points evenly along a closed outline (the beads of a stippled contour). */
function beadsAlong(polygon: readonly Point[], n: number): Point[] {
  const lengths: number[] = [];
  let total = 0;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length] ?? p;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    lengths.push(d);
    total += d;
  });
  const out: Point[] = [];
  let i = 0;
  let walked = 0;
  for (let k = 0; k < n; k++) {
    const at = (k / n) * total;
    while (i < polygon.length - 1 && walked + (lengths[i] ?? 0) < at) {
      walked += lengths[i] ?? 0;
      i++;
    }
    const p = polygon[i] ?? { x: 0, y: 0 };
    const q = polygon[(i + 1) % polygon.length] ?? p;
    const d = lengths[i] ?? 0;
    const t = d > 0 ? (at - walked) / d : 0;
    out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  }
  return out;
}

/** Width of a helmet chip of the arena (px): one pitch, so the chips touch and do not overlap. */
export const CHIP_HELMET_WIDTH = CHIP.pitch;

/**
 * A helmet chip of the arena, facing right (the opponent's is flipped where it is placed), Engraved
 * (#856; mockup `helmet` and `deadChip`): charged, the dome solid in the side's colour; discharged, the
 * dome on the dark plate hatched in the side's colour; both on a dark casing with the strap (and the
 * brim) and the dome's edge in ink. Killed: only the outline of the dome, stippled in ink.
 */
export function helmetChipSpec(state: ChipState, enemy: boolean, color: number): BakeSpec {
  const kind: HelmetKind = enemy ? 'enemy' : 'own';
  const width = CHIP_HELMET_WIDTH;
  const h = helmet(kind, width);
  const lines = helmetLines(width);
  const E = HELMET_ENGRAVED;
  const box = helmetBox(h);
  const dome = flat(h.dome);
  const grow = E.casing / 2;
  return {
    key: `hel-chip:${state}:${kind}:${String(color)}`,
    box: {
      x: box.x - grow,
      y: box.y - grow,
      width: box.width + 2 * grow,
      height: box.height + 2 * grow,
    },
    draw(into, tools) {
      const g = graphics(into);
      if (state === 'killed') {
        for (const p of beadsAlong(h.dome, CHIP_STIPPLE.count))
          g.circle(p.x, p.y, CHIP_STIPPLE.radius);
        g.fill({ color: INK, alpha: CHIP_STIPPLE.alpha });
        return;
      }
      const lineWidth = (line: readonly Point[]): number =>
        (line === h.strap ? lines.strap : lines.band) * E.gear;
      for (const line of gear(h)) {
        polyline(g, line).stroke({
          width: lineWidth(line) + E.casing * 0.8,
          color: CASING,
          cap: 'round',
          join: 'round',
        });
      }
      g.poly(dome).stroke({ width: E.casing * 0.9, color: CASING, join: 'round' });
      if (state === 'charged') {
        g.poly(dome).fill(color);
      } else {
        g.poly(dome).fill(DARK_PLATE);
        for (const [a, b] of hatchAcross(h.dome, -Math.PI / 4, helmetHatchPitch(width)))
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        g.stroke({ width: tools.hair(E.hatch.width), color });
      }
      for (const line of gear(h)) {
        polyline(g, line).stroke({
          width: tools.hair(lineWidth(line)),
          color: INK,
          cap: 'round',
          join: 'round',
        });
      }
      g.poly(dome).stroke({ width: tools.hair(E.edge), color: INK, join: 'round' });
    },
  };
}

/** The stippled outline of a dead chip (mockup `deadChip`): this many ink dots, this big, this faint. */
const CHIP_STIPPLE = { count: 26, radius: 0.62, alpha: 0.55 } as const;

/** The shield badge of "Defense": a dark disc with a ring in the owner's colour and the shield glyph. */
export function shieldSpec(color: number, enemy: boolean): BakeSpec {
  return {
    key: `shield:${String(color)}:${enemy ? 'e' : ''}`,
    box: circleBox(9 + 2),
    draw(into, tools) {
      // Engraved (#847, mockup `siteSign`): a dark disc on a casing, two fine rings in the side's
      // colour, the opponent's an ink ring inside them, the ink shield.
      const g = graphics(into);
      g.circle(0, 0, 10).fill(CASING);
      g.circle(0, 0, 9).fill(DARK_PLATE);
      g.circle(0, 0, 8.6).stroke({ width: tools.hair(0.9), color });
      g.circle(0, 0, 6.8).stroke({ width: tools.hair(0.9), color });
      if (enemy) g.circle(0, 0, 5.2).stroke({ width: tools.hair(0.8), color: INK });
      g.poly([-3.8, -4.2, 3.8, -4.2, 3.8, 0.8, 0, 4.6, -3.8, 0.8]).fill(INK);
    },
  };
}

/**
 * The counter of "Defense" (D1 "Diamond pips", #349; chevrons since #797): the shield badge at the
 * origin and, for an own group with places, a capsule of chevrons to its left (the side of the
 * city's column): green for a bonus gathered, hollow for room. Above `DEFENSE_PIPS.maxPips` places only the two chevrons are
 * baked: the numbers are text laid over them (`counterLayout`). The opponent has the badge alone
 * (`pips: null`): its bonus is never public (DEC-30, item 5; AGENTS.md 4.4).
 */
export function defenseCounterSpec(
  color: number,
  enemy: boolean,
  pips: DefensePips | null,
): BakeSpec {
  const layout = pips === null || enemy ? null : counterLayout(pips);
  if (layout === null) return shieldSpec(color, enemy);
  const { gap, height, rim, plateAlpha } = DEFENSE_PIPS;
  const left = -gap - layout.width;
  const box: Box = { x: left - 1, y: -height / 2 - 1, width: 9 + 2 - left + 1, height: height + 2 };
  const badge = circleBox(9 + 2);
  const union: Box = {
    x: Math.min(box.x, badge.x),
    y: Math.min(box.y, badge.y),
    width: Math.max(box.x + box.width, badge.x + badge.width) - Math.min(box.x, badge.x),
    height: Math.max(box.y + box.height, badge.y + badge.height) - Math.min(box.y, badge.y),
  };
  const key =
    layout.numbers.length === 0
      ? layout.pips.map((p) => (p.filled ? 'f' : 'h')).join('')
      : `n${String(layout.width)}`;
  return {
    key: `defense:${String(color)}:${key}`,
    box: shadowBox(union, BAKE_MARGIN),
    draw(into) {
      const capsule = (g: Graphics): void => {
        g.roundRect(left, -height / 2, layout.width, height, height / 2);
      };
      shadow(into, capsule);
      shadow(into, (g) => g.circle(0, 0, 9));
      const g = graphics(into);
      capsule(g);
      g.fill({ color: PLATE_FILL, alpha: plateAlpha }).stroke({ width: rim, color });
      // The bonus as chevrons (#797, the badge's chevron up): green for a point gathered, hollow
      // (a light contour, dark inside) for room, as wide as the pitch allows.
      for (const pip of layout.pips) {
        drawBonusChevron(g, left + pip.x, 0.5, pip.radius * 1.75, !pip.filled);
      }
      g.circle(0, 0, 9).fill(PLATE_FILL).stroke({ width: 2.5, color });
      g.poly([-4.5, -5, 4.5, -5, 4.5, 1, 0, 5.5, -4.5, 1]).fill(GLYPH_COLOR);
    },
  };
}

// --- The arena of a fight (AR1 chips, drawn in screen px) --------------------------------------------

/**
 * An engraved cartouche (#856; mockup `panel`): the dark plate, an ink rule round it, and unless `thin`
 * a second, fainter rule inside and the four corners notched out. No shadow, no light.
 */
function cartouche(
  g: Graphics,
  body: Box,
  look: {
    readonly edge: number;
    readonly edgeAlpha: number;
    /** The inner rule: its inset, its alpha and the side of the corner notches; `null`: none. */
    readonly inner: { readonly at: number; readonly alpha: number; readonly notch: number } | null;
  },
): void {
  const { x, y, width: w, height: h } = body;
  g.rect(x, y, w, h).fill({ color: DARK_PLATE, alpha: CARTOUCHE.fill });
  g.rect(x + 0.5, y + 0.5, w - 1, h - 1).stroke({
    width: look.edge,
    color: INK,
    alpha: look.edgeAlpha,
    join: 'miter',
  });
  if (look.inner === null) return;
  const i = look.inner.at;
  g.rect(x + i, y + i, w - 2 * i, h - 2 * i).stroke({
    width: CARTOUCHE.rule,
    color: INK,
    alpha: look.inner.alpha,
    join: 'miter',
  });
  const n = look.inner.notch / 2;
  for (const [cx, cy] of [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ] as const)
    g.rect(cx - n, cy - n, 2 * n, 2 * n).fill(DARK_PLATE);
}

/** The weights of a cartouche (mockup `panel`, Engraved). */
const CARTOUCHE = { fill: 0.93, rule: 0.8 } as const;

/**
 * The plate of the arena, Engraved (#856; mockup `arenaV`): a cartouche with a double rule and notched
 * corners, a fine rule between the two halves, and the round bar's ruled line along the bottom with a
 * tick at every quarter (the part of the round passed and its burin point are drawn over it by the view).
 */
export function arenaPlateSpec(): BakeSpec {
  const { halfWidth: hw, halfHeight: hh } = PLATE;
  const body: Box = { x: -hw, y: -hh, width: 2 * hw, height: 2 * hh };
  return {
    key: 'arena-plate',
    box: { x: body.x - 2, y: body.y - 2, width: body.width + 4, height: body.height + 4 },
    draw(into) {
      const g = graphics(into);
      cartouche(g, body, { edge: 1, edgeAlpha: 0.75, inner: { at: 3, alpha: 0.28, notch: 4 } });
      g.moveTo(0.5, -hh + 9)
        .lineTo(0.5, ARENA_BAR.y - 7)
        .stroke({ width: 1, color: INK, alpha: 0.35 });
      const { x, width, y } = ARENA_BAR;
      g.moveTo(x, y + 0.5).lineTo(x + width, y + 0.5);
      for (let j = 0; j <= 4; j++) {
        const tx = Math.round(x + (width * j) / 4) + 0.5;
        g.moveTo(tx, y - 2).lineTo(tx, y + 3);
      }
      g.stroke({ width: 1, color: INK, alpha: 0.5 });
    },
  };
}

/**
 * A row of the kill feed (#812), Engraved (#856; mockup `feedRowV`): a cartouche beside the node. The
 * winner's row has the heavy ink rule, a second rule inside and the notched corners; the other row a
 * thin faint rule (the weight tells it, not the hue). The origin is the middle of the row.
 */
export function feedRowSpec(winner: boolean): BakeSpec {
  const { halfWidth: hw, rowHeight: h } = FEED;
  const body: Box = { x: -hw, y: -h / 2, width: 2 * hw, height: h };
  return {
    key: `feed-row:${winner ? 'win' : 'other'}`,
    box: { x: body.x - 3, y: body.y - 3, width: body.width + 6, height: body.height + 6 },
    draw(into) {
      const g = graphics(into);
      if (winner)
        cartouche(g, body, { edge: 1.6, edgeAlpha: 1, inner: { at: 3.5, alpha: 1, notch: 5 } });
      else cartouche(g, body, { edge: 1, edgeAlpha: 0.4, inner: null });
    },
  };
}

/** The squares of the head of a bonus shot (#812): `outer` is the larger, `inner` carries the middle one. */
export type OctaPart = 'outer' | 'inner';

/**
 * The octagram of a bonus shot, Engraved (#856; mockup `octagram`): the sides of its two squares and the
 * weights of its lines, baked at twice the size it is drawn at (`OCTA_LOOK.bake`) so it stays crisp
 * zoomed in. The inner square is `ETCH.octa` world units at 100 %, the outer 1.3 times that.
 */
export const OCTA_LOOK = {
  bake: 2,
  inner: 16,
  outer: 20.8,
  edge: 2.2,
  rule: 1.4,
  casing: 2,
} as const;

/**
 * One square of the octagram head of a bonus shot (#812; Engraved, #856): the outer square is the dark
 * plate with an ink edge and an inner ink rule, the inner square is solid in the side's colour on a dark
 * casing with a small middle square, ink for the own side and dark for the opponent's (the side reads
 * without the hue). The origin is the middle; both squares are drawn upright, the view turns them.
 */
export function octagramSpec(part: OctaPart, enemy: boolean, color: number): BakeSpec {
  const half = (part === 'outer' ? OCTA_LOOK.outer : OCTA_LOOK.inner) / 2;
  return {
    key: `octa:${part}:${enemy ? 'e' : 'o'}:${String(color)}`,
    box: circleBox(Math.ceil(half * Math.SQRT2) + 3),
    draw(into) {
      const g = graphics(into);
      if (part === 'outer') {
        g.rect(-half, -half, 2 * half, 2 * half)
          .fill(DARK_PLATE)
          .stroke({ width: OCTA_LOOK.edge, color: INK, join: 'miter' });
        const rule = half * 0.8;
        g.rect(-rule, -rule, 2 * rule, 2 * rule).stroke({
          width: OCTA_LOOK.rule,
          color: INK,
          join: 'miter',
        });
        return;
      }
      g.rect(-half, -half, 2 * half, 2 * half)
        .fill(color)
        .stroke({ width: OCTA_LOOK.casing, color: CASING, join: 'miter' });
      const m = half * 0.32;
      g.rect(-m, -m, 2 * m, 2 * m).fill(enemy ? CASING : INK);
    },
  };
}

// --- Progress marks above an own city (variant A "Cells", #439) --------------------------------------
// The plate of a recruit queue or of a build is one baked sprite per look: the key holds the states of
// the cells and the whole-pixel width of the growing part, so a unit in production costs one texture per
// pixel of progress (at most `innerWidth` of them), shared by every city. The origin of a plate is the
// middle of its top edge. The dashed ring that asks for a look is a sprite of its own (it pulses).

/** A rectangle outline made of dashes (PixiJS has no dashed stroke). */
function dashedRect(
  g: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  dash: number,
  gap: number,
): void {
  const corners: Point[] = [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
  corners.forEach((from, i) => {
    const to = corners[(i + 1) % corners.length];
    if (to === undefined) return;
    for (const [a, b] of dashSegments(from, to, dash, gap)) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  });
}

/** The dark plate behind a mark: contrast on any terrain. `x` is its left edge from the sprite origin. */
function progressPlate(into: Container, x: number, width: number, height: number): void {
  const { radius, alpha, rim } = PROGRESS.plate;
  const g = graphics(into);
  g.roundRect(x, 0, width, height, radius).fill({ color: BG, alpha });
  g.roundRect(x + 0.5, 0.5, width - 1, height - 1, radius - 0.5).stroke({
    width: 1,
    color: 0xffffff,
    alpha: rim,
  });
}

/**
 * One cell of the shared grammar: `slot` a dashed frame, `queued` a frame with a dot, `active` a
 * hatch of `fill` pixels ending in a head line, `ready` solid.
 */
function drawCell(
  g: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  state: CellState,
  fill: number,
  tone: number,
): void {
  const { frame, dot, slot } = PROGRESS;
  const half = frame.width / 2;
  if (state === 'slot') {
    dashedRect(
      g,
      x + half,
      y + half,
      width - frame.width,
      height - frame.width,
      slot.dash,
      slot.gap,
    );
    g.stroke({ width: frame.width, color: SEGMENT_EMPTY });
    return;
  }
  const radius = Math.min(2.5, height / 3);
  g.roundRect(x + half, y + half, width - frame.width, height - frame.width, radius)
    .fill(state === 'ready' ? tone : BG)
    .stroke({ width: frame.width, color: tone });
  if (state === 'queued') {
    g.circle(x + width / 2, y + height / 2, Math.max(dot.min, height * dot.share)).fill(tone);
  } else if (state === 'active' && fill > 0) {
    const ox = x + frame.inset;
    const oy = y + frame.inset;
    const inner = height - 2 * frame.inset;
    for (const poly of hatchPolygons(fill, inner)) {
      g.poly(poly.map((v, i) => v + (i % 2 === 0 ? ox : oy))).fill(tone);
    }
    if (fill < innerWidth(width)) g.rect(ox + fill - 1, oy, frame.head, inner).fill(PAPER);
  }
}

/** The little house of the barracks badge, in units of the glyph size around its middle. */
const HOUSE: readonly (readonly [number, number])[] = [
  [-1, -0.05],
  [0, -0.95],
  [1, -0.05],
  [0.68, -0.05],
  [0.68, 0.85],
  [-0.68, 0.85],
  [-0.68, -0.05],
];

/**
 * The glyph of a build kind in its badge: a little house (barracks), stacked squares (warehouse),
 * a factory or a bunker (economy v2, the glyphs of their marks, smaller).
 */
function drawKindGlyph(g: Graphics, kind: BuildMark['kind'], cx: number, cy: number): void {
  const s = PROGRESS.badge.glyph;
  if (kind === 'factory' || kind === 'fort') {
    drawSiteGlyph(g, kind, cx, cy + 0.2, s / 5.2);
    return;
  }
  if ((kind as string) === 'warehouse') {
    for (const [x, y] of [
      [-0.9, -0.1],
      [0.05, -0.1],
      [-0.425, -1],
    ] as const) {
      g.rect(cx + x * s, cy + 0.5 + y * s, 0.85 * s, 0.85 * s).fill(PAPER);
    }
    return;
  }
  g.poly(HOUSE.flatMap(([x, y]) => [cx + x * s, cy + 0.5 + y * s])).fill(PAPER);
}

/** The plate of a barracks or warehouse build (DEC-26): the badge of its kind and one wide cell. */
export function buildMarkSpec(mark: BuildMark): BakeSpec {
  const { width, height } = mark;
  return {
    key: `build:${mark.kind}:${String(mark.fill)}:${String(mark.owed)}`,
    box: { x: -width / 2 - 1, y: -1, width: width + 2, height: height + 2 },
    draw(into) {
      progressPlate(into, -width / 2, width, height);
      const g = graphics(into);
      const { cx, radius, rim } = PROGRESS.badge;
      const left = -width / 2;
      const cy = height / 2;
      g.circle(left + cx, cy, radius)
        .fill(BG)
        .stroke({ width: rim, color: PAPER });
      drawKindGlyph(g, mark.kind, left + cx, cy);
      const { width: cw, height: ch } = PROGRESS.buildCell;
      if (mark.owed > 0) {
        // Economy v2 (DEC-41, item 7): the time has not started, the build waits for charges: a
        // dashed cell with a hollow dot per charge still owed (an empty dot is a missing charge).
        drawCell(g, left + mark.cellX, PROGRESS.pad, cw, ch, 'slot', 0, YOU);
        const { radius, width: stroke, pitch } = PROGRESS.owed;
        const x0 = left + mark.cellX + cw / 2 - ((mark.owed - 1) * pitch) / 2;
        for (let i = 0; i < mark.owed; i++) {
          g.circle(x0 + i * pitch, PROGRESS.pad + ch / 2, radius).stroke({
            width: stroke,
            color: PAPER,
          });
        }
        return;
      }
      drawCell(g, left + mark.cellX, PROGRESS.pad, cw, ch, 'active', mark.fill, YOU);
    },
  };
}

// --- Supply lines --------------------------------------------------------------------------------

/**
 * The direction chevron of a supply line looked at (#672): a light «>» on a dark casing, pointing
 * along +x (the sprite is turned to the leg); the same texture for every leg.
 */
export function lineChevronSpec(): BakeSpec {
  const { half, depth, width, casing } = SUPPLY_LINE.chevron;
  const reach = Math.max(half, depth / 2) + width / 2 + casing;
  return {
    key: 'line-chevron',
    box: shadowBox(circleBox(reach), BAKE_MARGIN),
    draw(into) {
      const g = graphics(into);
      const trace = (): void => {
        g.moveTo(-depth / 2, -half)
          .lineTo(depth / 2, 0)
          .lineTo(-depth / 2, half);
      };
      trace();
      g.stroke({ width: width + 2 * casing, color: BG, alpha: 0.92, join: 'round', cap: 'round' });
      trace();
      g.stroke({ width, color: PAPER, join: 'round', cap: 'round' });
    },
  };
}

// --- Supply flow ---------------------------------------------------------------------------------

/**
 * The starving mark (DEC-43, ui-style 42): an amber triangle with an exclamation mark, a shape and
 * a glyph so that it is not told by colour alone. Centred on its middle; the same texture for every
 * node.
 */
export function starveMarkSpec(): BakeSpec {
  const { half, height } = FLOW_STARVE;
  return {
    key: 'flow-starve',
    box: shadowBox(
      { x: -half - 1, y: -height / 2 - 1, width: 2 * half + 2, height: height + 2 },
      BAKE_MARGIN,
    ),
    draw(into) {
      const g = graphics(into);
      g.poly([0, -height / 2, half, height / 2, -half, height / 2])
        .fill(WARN)
        .stroke({ width: 1.6, color: BG, join: 'round' });
      // The bang: a bar and a dot, cut from the dark of the background.
      g.roundRect(-1, -height / 2 + 5.5, 2, 5, 1).fill(BG);
      g.circle(0, height / 2 - 3.4, 1.25).fill(BG);
    },
  };
}

/**
 * The self-shot of a chip whose charge the terrain burned (DEC-45, #791): a ring and six short rays
 * in the red of the disadvantage badge, each over a dark outline; the arena scales and fades it.
 */
export function selfShotSpec(): BakeSpec {
  const radius = 7;
  const reach = 13;
  return {
    key: 'self-shot',
    box: circleBox(reach + 3),
    draw(into) {
      const g = graphics(into);
      const rays = (): void => {
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i + Math.PI / 6;
          const c = Math.cos(a);
          const s = Math.sin(a);
          g.moveTo(c * (radius + 2), s * (radius + 2)).lineTo(c * reach, s * reach);
        }
      };
      g.circle(0, 0, radius).stroke({ width: 4.2, color: BG });
      rays();
      g.stroke({ width: 4.2, color: BG, cap: 'round' });
      g.circle(0, 0, radius).stroke({ width: 1.8, color: BADGE_DOWN });
      rays();
      g.stroke({ width: 1.8, color: BADGE_DOWN, cap: 'round' });
    },
  };
}

/** The number beside one chevron of a badge (a shared style: the baked texts are destroyed, not it). */
const badgeStyles = new Map<string, TextStyle>();
function badgeTextStyle(size: number, color: number): TextStyle {
  const key = `${String(size)}:${String(color)}`;
  let style = badgeStyles.get(key);
  if (style === undefined) {
    style = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: badgeFont(size),
      fontWeight: '800',
      fill: color,
      stroke: { color: CUT, width: 3, join: 'round' },
    });
    badgeStyles.set(key, style);
  }
  return style;
}

/**
 * An advantage or disadvantage badge (#791, variant 8 "Chevrons" of #776, ui-style 32): up to
 * three chevrons tell the count by strokes (green up, red down), each with a dark outline under it
 * (3:1 on every terrain); above three one chevron and the number, "9+" above nine. The key is
 * bounded: direction, the count capped (`badgeCount`), the size (the map or a chip).
 */
export function chevronBadgeSpec(dir: BadgeDir, count: number, size: number): BakeSpec {
  const n = badgeCount(count);
  const label = badgeLabel(n);
  const font = badgeFont(size);
  const labelWidth = label.length * font * 0.62;
  const color = dir === 'up' ? BADGE_UP : BADGE_DOWN;
  return {
    key: `badge:${dir}:${String(n)}:${String(size)}`,
    box: badgeBox(size, n, labelWidth),
    draw(into) {
      const strokes = chevronStrokes(dir, size, n);
      const width = size * BADGE.stroke;
      const g = graphics(into);
      // The dark outline of every chevron first, then the colour over it.
      for (const [tone, w] of [
        [CUT, width + BADGE.outline],
        [color, width],
      ] as const) {
        for (const stroke of strokes) polyline(g, stroke);
        g.stroke({ width: w, color: tone, cap: 'round', join: 'round' });
      }
      if (label !== '') {
        const text = into.addChild(
          new Text({ text: label, style: badgeTextStyle(size, color), anchor: { x: 0, y: 0.5 } }),
        );
        text.position.set(size * 0.56 + size * 0.1, 0);
      }
    },
  };
}
