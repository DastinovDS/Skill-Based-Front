import { Container, Graphics } from 'pixi.js';
import type { BakeSpec } from './bake.ts';
import {
  BARRACKS_HOUSE,
  capacityRing,
  ringRadius,
  warehouseSegments,
  type Arc,
} from './cityLayout.ts';
import { CHIP, PLATE, chipHatch, chipHeight, lighten, type ChipState } from './fightFx.ts';
import { dashSegments, triangleCorners, triangleHeight } from './layout.ts';
import { circleBox, shadowBox, type Box } from './shading.ts';
import {
  BAKE_MARGIN,
  BAR_BASE,
  BAR_SEGMENT,
  BARRACKS_MARK,
  BG,
  CAPITAL_STAR,
  CITY_HALO,
  CITY_HALO_INSET,
  FIGHT_COLOR,
  GLYPH_COLOR,
  INNER_RING,
  INNER_RING_INSET,
  NEUTRAL_FILL,
  NEUTRAL_OUTLINE,
  OWNER_OUTLINE,
  PAPER,
  PLATE_FILL,
  PLATE_INNER_RING,
  RING_FILLED,
  RING_SEGMENT,
  RIM,
  SEGMENT_EMPTY,
  SEGMENT_EMPTY_BAR,
  SHADOW,
  UNIT_DASH,
  UNIT_HALO,
  UNIT_OUTLINE,
  VP_BADGE,
  VP_BADGE_RADIUS,
  ENEMY,
  YOU,
  NEUTRAL_STROKE,
} from './style.ts';
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

/** The warehouse bar under the ring: a dark base, a square per place, the filled ones with a gradient. The sprite's origin is the middle of its top edge. */
export function warehouseBarSpec(capacity: number, stock: number, color: number): BakeSpec {
  const bar = warehouseSegments(stock, capacity);
  const base: Box = {
    x: -bar.width / 2 - 1,
    y: -1,
    width: bar.width + 2,
    height: BAR_SEGMENT.height + 4,
  };
  return {
    key: `bar:${String(capacity)}:${String(stock)}:${String(color)}`,
    box: shadowBox(base, BAKE_MARGIN),
    draw(into, tools) {
      shadow(into, (g) => g.roundRect(base.x, base.y, base.width, base.height, BAR_BASE.radius));
      const g = graphics(into);
      g.roundRect(base.x, base.y, base.width, base.height, BAR_BASE.radius).fill(BAR_BASE.color);
      for (const segment of bar.segments) {
        g.rect(segment.x, 1, BAR_SEGMENT.width, BAR_SEGMENT.height).fill(
          segment.filled ? tools.gradient(color) : SEGMENT_EMPTY_BAR,
        );
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

/** The barracks badge: a dark disc with a house, the rim in the owner's colour. */
export function barracksSpec(rim: number): BakeSpec {
  const radius = BARRACKS_MARK.radius;
  return {
    key: `barracks:${String(rim)}`,
    box: shadowBox(circleBox(radius + 1), BAKE_MARGIN),
    draw(into) {
      shadow(into, (g) => g.circle(0, 0, radius));
      const g = graphics(into);
      g.circle(0, 0, radius)
        .fill(BARRACKS_MARK.fill)
        .stroke({ ...BARRACKS_MARK.stroke, color: rim });
      g.poly(BARRACKS_HOUSE.flatMap(([x, y]) => [x, y])).fill(PAPER);
    },
  };
}

// --- Group triangles (U1) --------------------------------------------------------------------------

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
