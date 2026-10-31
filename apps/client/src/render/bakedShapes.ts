import { Container, Graphics } from 'pixi.js';
import type { BakeSpec } from './bake.ts';
import {
  BARRACKS_HOUSE,
  BUNKER_GLYPH,
  BUNKER_SLIT,
  FACTORY_GLYPH,
  capacityRing,
  ringRadius,
  warehouseSegments,
  type Arc,
  type PlaceState,
} from './cityLayout.ts';
import {
  hatchPolygons,
  innerWidth,
  type BuildMark,
  type CellState,
  type QueueMark,
} from './progressLayout.ts';
import { CHIP, PLATE, chipHatch, chipHeight, lighten, type ChipState } from './fightFx.ts';
import { chargeTicks, dashSegments, triangleCorners, triangleHeight } from './layout.ts';
import { circleBox, darken, shadowBox, type Box } from './shading.ts';
import {
  BAKE_MARGIN,
  BAR_BASE,
  BAR_SEGMENT,
  BARRACKS_MARK,
  BG,
  CAPITAL_STAR,
  CITY_HALO,
  CITY_HALO_INSET,
  DEFENSE_PIPS,
  FIGHT_COLOR,
  GLYPH_COLOR,
  INNER_RING,
  INNER_RING_INSET,
  NEUTRAL_FILL,
  NEUTRAL_OUTLINE,
  OWNER_OUTLINE,
  PAPER,
  PLACE_DASHED,
  PLACE_FRAME,
  PLATE_FILL,
  PLATE_INNER_RING,
  PROGRESS,
  PROVINCE,
  RING_FILLED,
  RING_SEGMENT,
  RIM,
  SEGMENT_EMPTY,
  SHADOW,
  UNIT_DASH,
  UNIT_HALO,
  UNIT_OUTLINE,
  UNIT_TICKS,
  VP_BADGE,
  VP_BADGE_RADIUS,
  ENEMY,
  YOU,
  NEUTRAL_STROKE,
  WARN,
} from './style.ts';
import { counterLayout, type DefensePips } from './defenseLayout.ts';
import type { Point } from './camera.ts';

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

/** The upper left of a rim: from 1.08 to 1.75 pi, light from the upper left (the mockup). */
const RIM_ARC = { from: Math.PI * 1.08, to: Math.PI * 1.75, inset: 2.2 } as const;

/**
 * The body of a city: halo, a gradient fill with its outline (own: blue and white, enemy: red with
 * a dark inner ring, neutral: grey), the light rim of an owned one, the star of a capital, all on
 * the soft shadow of the halo.
 */
export function cityBodySpec(kind: CityKind, radius: number, capital: boolean): BakeSpec {
  const reach = radius + CITY_HALO_INSET + CITY_HALO.width / 2;
  return {
    key: `city:${kind}:${String(radius)}:${capital ? 'c' : ''}`,
    box: shadowBox(circleBox(reach), BAKE_MARGIN),
    draw(into, tools) {
      shadow(into, (g) => g.circle(0, 0, reach));
      const g = graphics(into);
      g.circle(0, 0, radius + CITY_HALO_INSET).stroke(CITY_HALO);
      const color = kind === 'you' ? YOU : kind === 'enemy' ? ENEMY : NEUTRAL_FILL;
      g.circle(0, 0, radius).fill(tools.gradient(color));
      g.circle(0, 0, radius).stroke(kind === 'neutral' ? NEUTRAL_OUTLINE : OWNER_OUTLINE);
      if (kind === 'enemy') g.circle(0, 0, radius - INNER_RING_INSET).stroke(INNER_RING);
      if (kind !== 'neutral') {
        const r = radius - RIM_ARC.inset;
        g.moveTo(r * Math.cos(RIM_ARC.from), r * Math.sin(RIM_ARC.from))
          .arc(0, 0, r, RIM_ARC.from, RIM_ARC.to)
          .stroke({ width: RIM.width, color: 0xffffff, alpha: RIM.alpha, cap: 'round' });
      }
      if (capital) {
        g.star(0, 0, 5, radius * 0.6, radius * 0.27, -Math.PI / 2)
          .fill(CAPITAL_STAR.fill)
          .stroke(CAPITAL_STAR.stroke);
      }
    },
  };
}

/**
 * A province (DEC-23, PB "Pale dot", #431): a small solid dot in a pale tint of the owner with a
 * thin darker outline, a dark casing and a soft shadow; the opponent's has a second thin light ring
 * outside; nobody's is a paler see-through grey dot with a dashed outline. The capacity ring is
 * the city ring (`cityRingSpec`) and the garrison token lies on top of it, so there is no dark
 * centre. No gradient, no rim, no star, no warehouse.
 */
export function provinceBodySpec(kind: CityKind): BakeSpec {
  const { dot: r, casing, tint, outline, neutralOutline, enemy } = PROVINCE;
  const reach = Math.max(r + casing.inset + casing.width / 2, r + enemy.inset + enemy.width / 2);
  return {
    key: `province:${kind}`,
    box: shadowBox(circleBox(reach), BAKE_MARGIN),
    draw(into) {
      shadow(into, (g) => g.circle(0, 0, r + casing.inset));
      const g = graphics(into);
      g.circle(0, 0, r + casing.inset).stroke({
        width: casing.width,
        color: BG,
        alpha: casing.alpha,
      });
      if (kind === 'neutral') {
        g.circle(0, 0, r).fill({
          color: lighten(NEUTRAL_STROKE, tint.neutral),
          alpha: tint.neutralAlpha,
        });
        const arcs = Math.max(
          1,
          Math.round((2 * Math.PI * r) / (neutralOutline.dash + neutralOutline.gap)),
        );
        const step = (2 * Math.PI) / arcs;
        const span = (neutralOutline.dash / (neutralOutline.dash + neutralOutline.gap)) * step;
        for (let i = 0; i < arcs; i++) {
          g.moveTo(r * Math.cos(i * step), r * Math.sin(i * step)).arc(
            0,
            0,
            r,
            i * step,
            i * step + span,
          );
        }
        g.stroke({ width: neutralOutline.width, color: NEUTRAL_STROKE });
        return;
      }
      const color = kind === 'you' ? YOU : ENEMY;
      g.circle(0, 0, r).fill(lighten(color, tint.owned));
      g.circle(0, 0, r).stroke({ width: outline.width, color: darken(color, outline.darken) });
      if (kind === 'enemy') {
        g.circle(0, 0, r + enemy.inset).stroke({
          width: enemy.width,
          color: PAPER,
          alpha: enemy.alpha,
        });
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

/** The capacity ring: a dark base, white segments for the garrison, grey for room, on a soft shadow. */
export function cityRingSpec(radius: number, capacity: number, garrison: number): BakeSpec {
  const r = ringRadius(radius);
  const reach = r + RING_SEGMENT.base / 2;
  return {
    key: `ring:${String(radius)}:${String(capacity)}:${String(garrison)}`,
    box: shadowBox(circleBox(reach), BAKE_MARGIN),
    draw(into) {
      const ring = capacityRing(capacity, garrison);
      // The shadow follows the arcs, so the gaps between the segments stay see-through.
      for (const { grow, alpha } of SHADOW.layers) {
        const s = new Graphics();
        s.y = SHADOW.dy;
        strokeArcs(s, r, ring.arcs, {
          width: RING_SEGMENT.base + 2 * grow,
          color: 0x000000,
          alpha,
        });
        into.addChild(s);
      }
      const g = graphics(into);
      strokeArcs(g, r, ring.arcs, {
        width: RING_SEGMENT.base,
        color: BG,
        alpha: RING_SEGMENT.baseAlpha,
      });
      strokeArcs(
        g,
        r,
        ring.arcs.filter((arc) => arc.filled),
        { width: RING_SEGMENT.width, color: RING_FILLED },
      );
      strokeArcs(
        g,
        r,
        ring.arcs.filter((arc) => !arc.filled),
        { width: RING_SEGMENT.width, color: SEGMENT_EMPTY },
      );
      for (const angle of ring.notches) {
        const inner = r - RING_SEGMENT.base / 2;
        const outer = r + RING_SEGMENT.base / 2;
        g.moveTo(inner * Math.cos(angle), inner * Math.sin(angle)).lineTo(
          outer * Math.cos(angle),
          outer * Math.sin(angle),
        );
      }
      if (ring.notches.length > 0) g.stroke({ width: 1.5, color: BG });
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
 * The warehouse bar under the ring: a dark base, a place per unit of capacity (a charge filled with
 * a gradient, room a frame) and `locked` dashed places for the levels not built yet. The sprite's
 * origin is the middle of its top edge.
 */
export function warehouseBarSpec(
  capacity: number,
  stock: number,
  color: number,
  locked = 0,
): BakeSpec {
  const bar = warehouseSegments(stock, capacity, locked);
  const base: Box = {
    x: -bar.width / 2 - 1,
    y: -1,
    width: bar.width + 2,
    height: BAR_SEGMENT.height + 4,
  };
  return {
    key: `bar:${String(capacity)}:${String(stock)}:${String(locked)}:${String(color)}`,
    box: shadowBox(base, BAKE_MARGIN),
    draw(into, tools) {
      shadow(into, (g) => g.roundRect(base.x, base.y, base.width, base.height, BAR_BASE.radius));
      const g = graphics(into);
      g.roundRect(base.x, base.y, base.width, base.height, BAR_BASE.radius).fill(BAR_BASE.color);
      for (const segment of bar.segments) {
        if (segment.state === 'filled') {
          g.rect(segment.x, 1, BAR_SEGMENT.width, BAR_SEGMENT.height).fill(tools.gradient(color));
        } else {
          drawPlaceOutline(g, segment.x, 1, segment.state);
        }
      }
    },
  };
}

/** The VP badge: a dark disc with a gold rim and a faint inner light ring (the number is a Text over it). */
export function vpBadgeSpec(): BakeSpec {
  return {
    key: 'vp-badge',
    box: shadowBox(circleBox(VP_BADGE_RADIUS + 1), BAKE_MARGIN),
    draw(into) {
      shadow(into, (g) => g.circle(0, 0, VP_BADGE_RADIUS));
      const g = graphics(into);
      g.circle(0, 0, VP_BADGE_RADIUS).fill(VP_BADGE.fill).stroke(VP_BADGE.stroke);
      g.circle(0, 0, VP_BADGE_RADIUS - 2.1).stroke({
        width: 1,
        color: 0xffffff,
        alpha: RIM.alpha * 0.35,
      });
    },
  };
}

/**
 * The barracks badge (B1, #349): a dark disc with a house, the rim in the owner's colour. The
 * opponent's has a light inner ring and a smaller house, so the side reads without the hue.
 */
export function barracksSpec(rim: number): BakeSpec {
  const radius = BARRACKS_MARK.radius;
  const enemy = rim === ENEMY;
  return {
    key: `barracks:${String(rim)}`,
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
      g.poly(BARRACKS_HOUSE.flatMap(([x, y]) => [x * k, y * k])).fill(PAPER);
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

/** How the outline of a triangle is drawn: own, the opponent's (a second inner outline), dashed (unknown). */
export type OutlineKind = 'own' | 'enemy' | 'dashed';

function triangleBox(side: number, spread: number): Box {
  const h = triangleHeight(side);
  return {
    x: -side / 2 - spread,
    y: -h / 2 - spread,
    width: side + 2 * spread,
    height: h + 2 * spread,
  };
}

/** The back of a triangle: the shadow, the casing of an icon in a city (`inside`) and the dark plate. */
export function triangleBackSpec(side: number, inside: boolean): BakeSpec {
  const corners = triangleCorners(side);
  const spread = inside ? UNIT_HALO.width / 2 : UNIT_OUTLINE.width / 2;
  return {
    key: `tri-back:${String(side)}:${inside ? 'i' : ''}`,
    box: shadowBox(triangleBox(side, spread + 1), BAKE_MARGIN),
    draw(into) {
      shadow(into, (g) => g.poly(flat(corners)), spread);
      const g = graphics(into);
      if (inside) g.poly(flat(corners)).stroke({ ...UNIT_HALO, color: BG });
      g.poly(flat(corners)).fill(PLATE_FILL);
    },
  };
}

/** The charge fill of a triangle: a full triangle with its tip at the origin (scaled from there by the level). */
export function triangleLevelSpec(side: number, color: number): BakeSpec {
  const h = triangleHeight(side);
  const corners = triangleCorners(side, true);
  return {
    key: `tri-level:${String(side)}:${String(color)}`,
    box: { x: -side / 2 - 1, y: -h - 1, width: side + 2, height: h + 2 },
    draw(into, tools) {
      graphics(into).poly(flat(corners)).fill(tools.gradient(color));
    },
  };
}

/**
 * The dividers of a triangle with `units` units (#508): a faint line at every unit's height from the
 * tip, over the fill and the empty part, inside the outline. One texture per (side, units); nothing
 * to draw (`null`) for one unit or more than `UNIT_TICKS.max`.
 */
export function triangleTicksSpec(side: number, units: number): BakeSpec | null {
  const levels = chargeTicks(units, UNIT_TICKS.max);
  if (levels.length === 0) return null;
  const h = triangleHeight(side);
  return {
    key: `tri-ticks:${String(side)}:${String(units)}`,
    box: triangleBox(side, 0),
    draw(into) {
      const g = graphics(into);
      for (const level of levels) {
        // Row `level` of the triangle from the tip: half-width grows linearly from the tip.
        const y = h / 2 - level * h;
        const half = (side * level) / 2 - UNIT_TICKS.inset;
        if (half <= 0) continue;
        g.moveTo(-half, y).lineTo(half, y);
      }
      g.stroke({ width: UNIT_TICKS.width, color: UNIT_TICKS.color, alpha: UNIT_TICKS.alpha });
    },
  };
}

/** The outline of a triangle with its light rim along the upper left side. */
export function triangleFrontSpec(
  side: number,
  kind: OutlineKind,
  color: number,
  inner: number,
): BakeSpec {
  const corners = triangleCorners(side);
  const [left, right, tip] = corners;
  const centroid = { x: 0, y: (left.y + right.y + tip.y) / 3 };
  return {
    key: `tri-front:${String(side)}:${kind}:${String(color)}`,
    box: shadowBox(triangleBox(side, UNIT_OUTLINE.width), 0),
    draw(into) {
      const g = graphics(into);
      if (kind === 'dashed') {
        for (const [from, to] of [
          [left, right],
          [right, tip],
          [tip, left],
        ] as const) {
          for (const [a, b] of dashSegments(from, to, UNIT_DASH.dash, UNIT_DASH.gap)) {
            g.moveTo(a.x, a.y).lineTo(b.x, b.y);
          }
        }
        g.stroke({ width: UNIT_OUTLINE.width, color, cap: 'round' });
        return;
      }
      g.poly(flat(corners)).stroke({ ...UNIT_OUTLINE, color });
      if (kind === 'enemy') {
        const scaled = corners.map((p) => ({
          x: centroid.x + (p.x - centroid.x) * inner,
          y: centroid.y + (p.y - centroid.y) * inner,
        }));
        g.poly(flat(scaled)).stroke({ width: 1.5, color: PAPER, alpha: 0.9, join: 'round' });
      }
      g.moveTo(left.x + 3, left.y + 2.6)
        .lineTo(tip.x - 1.6, tip.y - 4)
        .stroke({ width: 1.2, color: 0xffffff, alpha: RIM.alpha * 0.8, cap: 'round' });
    },
  };
}

/** The shield badge of "Defense": a dark disc with a ring in the owner's colour and the shield glyph. */
export function shieldSpec(color: number, enemy: boolean): BakeSpec {
  return {
    key: `shield:${String(color)}:${enemy ? 'e' : ''}`,
    box: shadowBox(circleBox(9 + 2), BAKE_MARGIN),
    draw(into) {
      shadow(into, (g) => g.circle(0, 0, 9));
      const g = graphics(into);
      g.circle(0, 0, 9).fill(PLATE_FILL).stroke({ width: 2.5, color });
      if (enemy) g.circle(0, 0, 5.5).stroke(PLATE_INNER_RING);
      g.poly([-4.5, -5, 4.5, -5, 4.5, 1, 0, 5.5, -4.5, 1]).fill(GLYPH_COLOR);
    },
  };
}

/**
 * The counter of "Defense" (D1 "Diamond pips", #349): the shield badge at the origin and, for an own
 * group with places, a capsule of diamonds to its left (the side of the city's column): filled for a
 * bonus gathered, hollow for room. Above `DEFENSE_PIPS.maxPips` places only the two diamonds are
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
  const { gap, height, rim, plateAlpha, hollow } = DEFENSE_PIPS;
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
      for (const pip of layout.pips) {
        const cx = left + pip.x;
        const r = pip.radius;
        g.poly([cx, -r, cx + r, 0, cx, r, cx - r, 0]);
        if (pip.filled) g.fill(PAPER);
        else g.fill(BG).stroke(hollow);
      }
      g.circle(0, 0, 9).fill(PLATE_FILL).stroke({ width: 2.5, color });
      g.poly([-4.5, -5, 4.5, -5, 4.5, 1, 0, 5.5, -4.5, 1]).fill(GLYPH_COLOR);
    },
  };
}

// --- The arena of a fight (AR1 chips, drawn in screen px) --------------------------------------------

/** The plate of the arena: dark, outlined, a dashed line between the halves, a light rim at the top. */
export function arenaPlateSpec(): BakeSpec {
  const { halfWidth: hw, halfHeight: hh } = PLATE;
  const body: Box = { x: -hw, y: -hh, width: 2 * hw, height: 2 * hh + 2 };
  return {
    key: 'arena-plate',
    box: shadowBox(body, BAKE_MARGIN),
    draw(into) {
      shadow(into, (g) => g.roundRect(body.x, body.y, body.width, body.height, 12));
      const g = graphics(into);
      g.roundRect(body.x, body.y, body.width, body.height, 12)
        .fill({ color: PLATE_FILL, alpha: 0.96 })
        .stroke({ width: 1.6, color: FIGHT_COLOR, alpha: 0.85 });
      // The middle line between the halves.
      for (const [from, to] of dashSegments({ x: 0, y: -hh + 5 }, { x: 0, y: hh - 12 }, 3, 3)) {
        g.moveTo(from.x, from.y).lineTo(to.x, to.y);
      }
      g.stroke({ width: 1, color: FIGHT_COLOR, alpha: 0.4 });
      g.moveTo(-hw + 8, -hh + 1)
        .lineTo(hw - 8, -hh + 1)
        .stroke({ width: 1, color: 0xffffff, alpha: RIM.alpha * 0.5 });
    },
  };
}

/** The tone of the discharged units and the hatching on their chips. */
const REST_LIGHTEN = 0.6;

function chipCorners(side: number): Point[] {
  const h = chipHeight(side);
  return [
    { x: -side / 2, y: -h / 2 },
    { x: side / 2, y: -h / 2 },
    { x: 0, y: h / 2 },
  ];
}

/**
 * A chip of the arena: charged (a gradient fill, a light outline), discharged (hollow, hatched,
 * outlined in the side's colour) or killed (dashed and faint); the enemy's also have a dark inner outline.
 */
export function chipSpec(state: ChipState, enemy: boolean, color: number): BakeSpec {
  const corners = chipCorners(CHIP.side);
  const inner = chipCorners(CHIP.side * 0.58);
  const spread = 2;
  return {
    key: `chip:${state}:${enemy ? 'e' : 'o'}:${String(color)}`,
    box: {
      x: -CHIP.side / 2 - spread,
      y: -chipHeight(CHIP.side) / 2 - spread,
      width: CHIP.side + 2 * spread,
      height: chipHeight(CHIP.side) + 2 * spread,
    },
    draw(into, tools) {
      const g = graphics(into);
      switch (state) {
        case 'charged':
          g.poly(flat(corners)).fill(tools.gradient(color));
          g.poly(flat(corners)).stroke({ width: 1.6, color: GLYPH_COLOR, join: 'round' });
          if (enemy) g.poly(flat(inner)).stroke({ width: 1.1, color: BG, join: 'round' });
          return;
        case 'empty':
          g.poly(flat(corners)).fill(PLATE_FILL);
          for (const [from, to] of chipHatch(CHIP.side, 3.5))
            g.moveTo(from.x, from.y).lineTo(to.x, to.y);
          g.stroke({ width: 1.2, color: lighten(color, REST_LIGHTEN), alpha: 0.85 });
          g.poly(flat(corners)).stroke({ width: 1.8, color, join: 'round' });
          if (enemy) g.poly(flat(inner)).stroke({ width: 1.1, color: BG, join: 'round' });
          return;
        case 'killed':
          corners.forEach((from, i) => {
            const to = corners[(i + 1) % corners.length];
            if (to === undefined) return;
            for (const [a, b] of dashSegments(from, to, 2.5, 2.5))
              g.moveTo(a.x, a.y).lineTo(b.x, b.y);
          });
          g.stroke({ width: 1.6, color, alpha: 0.6, cap: 'round' });
      }
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

const QUEUE_LETTER: Readonly<Record<CellState, string>> = {
  slot: 's',
  queued: 'q',
  active: 'a',
  ready: 'r',
};

/** The plate of a recruit queue (DEC-25): the cells, the first in production or ready. */
export function queueMarkSpec(mark: QueueMark): BakeSpec {
  const { width, height } = mark;
  const states = mark.cells
    .map((cell) => QUEUE_LETTER[cell.state] + (cell.state === 'active' ? String(cell.fill) : ''))
    .join('');
  return {
    key: `queue:${states}`,
    box: { x: -width / 2 - 1, y: -1, width: width + 2, height: height + 2 },
    draw(into) {
      progressPlate(into, -width / 2, width, height);
      const g = graphics(into);
      for (const cell of mark.cells) {
        const tone = cell.state === 'ready' ? WARN : YOU;
        drawCell(
          g,
          cell.x,
          PROGRESS.pad,
          PROGRESS.cell.width,
          PROGRESS.cell.height,
          cell.state,
          cell.fill,
          tone,
        );
      }
    },
  };
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
  if (kind === 'warehouse') {
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

/** The dashed amber ring that asks for a look at a cell (ready with no room, stopped by a fight). */
export function progressAlertSpec(width: number, height: number): BakeSpec {
  const { width: stroke, dash, gap } = PROGRESS.alert;
  return {
    key: `progress-alert:${String(width)}x${String(height)}`,
    box: { x: -width / 2 - 1, y: -height / 2 - 1, width: width + 2, height: height + 2 },
    draw(into) {
      const g = graphics(into);
      dashedRect(g, -width / 2, -height / 2, width, height, dash, gap);
      g.stroke({ width: stroke, color: WARN });
    },
  };
}
