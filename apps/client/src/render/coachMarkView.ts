import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { MapFile } from '../protocol.gen.ts';
import { FONT, ENGRAVED } from '../theme/tokens.ts';
import type { SpriteCache } from './bake.ts';
import type { Point } from './camera.ts';
import { capacityRing, ringRadius, vpBadgeAt } from './cityLayout.ts';
import {
  COMPASS,
  compassGlow,
  compassTurn,
  focusDim,
  turnFlash,
  type CoachMarks,
} from './coachMarks.ts';
import { compassGlowSpec, compassPointsSpec, compassRingSpec } from './compassShapes.ts';
import type { MapLayers } from './layers.ts';
import { reducedMotion } from './motion.ts';
import { CASING, LOZENGE, RING_ENGRAVED } from './style.ts';

/** A box in world units. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * What the marks read from the map as it is drawn now (review 4: the elements of P3, the terrain
 * areas of P4); each `null` when that element is not drawn.
 */
export interface CoachGeometry {
  /** Where the own group standing in `node` is drawn this frame. */
  groupAt(node: number): Point | null;
  /** The capacity of `node` the snapshot gives. */
  capacityOf(node: number): number | null;
  /** The warehouse row under `node`: the centres of its first and last lozenge. */
  warehouseRow(node: number): { x0: number; x1: number; y: number } | null;
  /** The count under the group in `node` (an enemy's range, "1-2"). */
  countBox(node: number): Box | null;
  /** The area of `node` (its cell of the territory). */
  cell(node: number): readonly Point[] | null;
  /** Where the charges moving on the road between `a` and `b` (either way) are drawn this frame. */
  charges(a: number, b: number): readonly Point[];
  /** The arenas of the fights drawn now, world units: a terrain's label keeps off them (P7). */
  arenas(): readonly Box[];
}

/** One Compass mark: the glow, the rings and the points, each a baked sprite. */
interface Compass {
  readonly root: Container;
  readonly glow: ReturnType<SpriteCache['sprite']>;
  readonly ring: ReturnType<SpriteCache['sprite']>;
  readonly points: ReturnType<SpriteCache['sprite']>;
}

interface Arc {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly from: number;
  readonly to: number;
}

const INK = ENGRAVED.ink;

/** A key no drawing has: the part is drawn again on the next frame. */
const STALE = '\u0000';

/** Rounded to a half unit: a key that changes only when a shape moves visibly. */
const halfUnit = (v: number): string => String(Math.round(v * 2) / 2);

/** An edge of an area, the same whichever way it is walked. */
function edgeKey(a: Point, b: Point): string {
  const p = `${halfUnit(a.x)},${halfUnit(a.y)}`;
  const q = `${halfUnit(b.x)},${halfUnit(b.y)}`;
  return p < q ? `${p}-${q}` : `${q}-${p}`;
}

/**
 * The goal marks of a tutorial card on the map (`docs/design/tutorial.md`, sections 7.7 and 8,
 * "Compass"), in the effects layer: a place, the own group standing in one, a city's VP badge (a
 * double ring whose four points turn once), a road of a first-match hint (two rails and a
 * chevron). Review 4 (#1047) adds the element a card names, lit itself rather than ringed (P3: the
 * segments of a capacity ring, the warehouse row, the count under a group), the terrain areas of
 * the marks in turn with their labels (P4), and the focus phase (P5): the map dimmed but for the
 * places and rows that make and carry charges. Review 5 (#1053): a chapter's road lights the
 * charges moving on it, each one, rather than the road (P8: the map draws its own arrows there),
 * the terrains go a page at a time (P9), and a card that names a warehouse row dims the map round
 * it as a focus phase does. The Compass parts are baked sprites,
 * one texture per radius (`AGENTS.md` 7.2); the rest is redrawn only when its shape changes. The
 * motion stops by itself and "less motion" holds it still.
 */
export class CoachMarkView {
  private readonly root = new Container({ label: 'coach-marks' });
  private readonly roads = new Graphics({ label: 'coach-roads' });
  /** The charges moving on the marked roads (P8): a glow and an ivory ring round each. */
  private readonly chargeRings = new Graphics({ label: 'coach-charges' });
  private readonly turnRoot = new Container({ label: 'coach-turns' });
  /** The flash of a terrain's area (P4): a wash and the outline of the area. */
  private readonly areaWash = new Graphics({ label: 'coach-area-wash' });
  private readonly areaLine = new Graphics({ label: 'coach-area-line' });
  /** The elements a card names (P3): their glow, then their rims. */
  private readonly elementGlow = new Graphics({ label: 'coach-element-glow' });
  private readonly elementInk = new Graphics({ label: 'coach-element-ink' });
  /** A focus phase (P5): the map dimmed but for the places it lights (`focusHoles`). */
  private readonly focusShade = new Graphics({ label: 'coach-focus-dim' });
  private readonly focusHoles = new Graphics({ label: 'coach-focus-holes' });
  private readonly focusRims = new Graphics({ label: 'coach-focus-rims' });
  private readonly compasses: Compass[] = [];
  private readonly turnLabels: Text[] = [];
  private readonly labelStyle: TextStyle;
  private marks: CoachMarks | null = null;
  private roadKey = '';
  private turnKey = '';
  private areaKey = '';
  private elementKey = '';
  private focusKey = '';

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly radiusOf: (node: number) => number,
    private readonly sprites: SpriteCache,
  ) {
    this.labelStyle = new TextStyle({
      fontFamily: FONT.display,
      fontSize: 10.5,
      fontWeight: '500',
      letterSpacing: 2,
      fill: ENGRAVED.ink,
      stroke: { color: CASING, width: 3.5, join: 'round' },
    });
    this.focusShade.setMask({ mask: this.focusHoles, inverse: true });
    this.root.addChild(
      this.focusHoles,
      this.focusShade,
      this.focusRims,
      this.areaWash,
      this.areaLine,
      this.turnRoot,
      this.roads,
      this.chargeRings,
      this.elementGlow,
      this.elementInk,
    );
    layers.layer.effects.addChild(this.root);
  }

  setLabelResolution(resolution: number): void {
    for (const label of this.turnLabels) label.resolution = resolution;
  }

  /**
   * The marks of the card now (`null`: none, a normal match) and what they read from the map as
   * it is drawn this frame; `nowMs` is `performance.now()`.
   */
  update(marks: CoachMarks | null, map: CoachGeometry, nowMs: number): void {
    if (marks !== this.marks) {
      // Another card: every part is drawn again, even one that is now empty.
      this.marks = marks;
      this.roadKey = STALE;
      this.turnKey = STALE;
      this.areaKey = STALE;
      this.elementKey = STALE;
      this.focusKey = STALE;
    }
    if (marks === null) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const reduced = reducedMotion();
    const age = nowMs - marks.since;
    const turn = compassTurn(age, reduced);
    const glow = compassGlow(age, reduced);
    let used = 0;
    const place = (at: Point, inner: number): void => {
      const mark = this.compass(used++);
      mark.root.visible = true;
      mark.root.position.set(at.x, at.y);
      mark.glow.set(compassGlowSpec(inner));
      mark.ring.set(compassRingSpec(inner));
      mark.points.set(compassPointsSpec(inner));
      mark.glow.alpha = glow;
      mark.points.rotation = turn;
    };
    // A focus phase lights its places through the dimmed map: no Compass there (P5).
    if (!marks.focus) {
      for (const { id, ring } of marks.nodes) {
        const node = this.map.nodes[id];
        if (node === undefined) continue;
        place(node, ringRadius(this.radiusOf(id)) + COMPASS.gap + (ring ? COMPASS.wide : 0));
      }
      // The own group standing in a place: the ring of the place, centred on its helmet.
      for (const id of marks.groupsAt) {
        const at = map.groupAt(id);
        if (at !== null) place(at, ringRadius(this.radiusOf(id)) + COMPASS.gap);
      }
      for (const id of marks.vpBadges) {
        const node = this.map.nodes[id];
        if (node === undefined) continue;
        const v = vpBadgeAt(this.radiusOf(id));
        place({ x: node.x + v.x, y: node.y + v.y }, COMPASS.badge);
      }
    }
    for (let i = used; i < this.compasses.length; i++) {
      const mark = this.compasses[i];
      if (mark !== undefined) mark.root.visible = false;
    }
    this.roads.visible = !marks.focus;
    if (!marks.focus) this.drawRoads(marks, age, reduced);
    const charges = marks.charges.flatMap(([a, b]) => map.charges(a, b));
    this.drawCharges(charges, glow);
    this.drawTurns(marks, map, nowMs, reduced);
    this.drawElements(marks, map, glow);
    this.drawFocus(marks, map, charges, age, reduced);
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.compasses.length = 0;
    this.turnLabels.length = 0;
  }

  private compass(index: number): Compass {
    const existing = this.compasses[index];
    if (existing !== undefined) return existing;
    const root = new Container({ label: 'coach-compass' });
    const glow = root.addChild(this.sprites.sprite());
    const ring = root.addChild(this.sprites.sprite());
    const points = root.addChild(this.sprites.sprite());
    this.root.addChild(root);
    const made = { root, glow, ring, points };
    this.compasses.push(made);
    return made;
  }

  /** The road marks: two ivory rails on a casing either side of the road and a chevron at its middle. */
  private drawRoads(marks: CoachMarks, age: number, reduced: boolean): void {
    const g = this.roads;
    const key = marks.roads.map(([a, b]) => `${String(a)}-${String(b)}`).join(',');
    if (key !== this.roadKey) {
      this.roadKey = key;
      g.clear();
      for (const [a, b] of marks.roads) {
        const p = this.map.nodes[a];
        const q = this.map.nodes[b];
        if (p === undefined || q === undefined) continue;
        const angle = Math.atan2(q.y - p.y, q.x - p.x);
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        // The rails stop clear of both places' rings.
        const from = ringRadius(this.radiusOf(a)) + 6;
        const to = Math.hypot(q.x - p.x, q.y - p.y) - ringRadius(this.radiusOf(b)) - 6;
        if (to <= from) continue;
        for (const side of [1, -1]) {
          const ox = -uy * COMPASS.rail * side;
          const oy = ux * COMPASS.rail * side;
          const x0 = p.x + ux * from + ox;
          const y0 = p.y + uy * from + oy;
          const x1 = p.x + ux * to + ox;
          const y1 = p.y + uy * to + oy;
          g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 3.2, color: CASING, cap: 'round' });
          g.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 1.3, color: INK, cap: 'round' });
        }
        // The chevron points from the first place to the second.
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        const tip = { x: mx + ux * 4, y: my + uy * 4 };
        const wing = (s: number): Point => ({
          x: tip.x - ux * 8 - uy * 8 * s,
          y: tip.y - uy * 8 + ux * 8 * s,
        });
        const left = wing(1);
        const right = wing(-1);
        for (const [width, color] of [
          [4, CASING],
          [1.6, INK],
        ] as const) {
          g.moveTo(left.x, left.y)
            .lineTo(tip.x, tip.y)
            .lineTo(right.x, right.y)
            .stroke({ width, color, cap: 'round', join: 'round' });
        }
      }
    }
    // The rails breathe with the glow of the rings, then rest.
    g.alpha = reduced ? 1 : 0.7 + 0.3 * ((compassGlow(age, false) - 0.25) / 0.6);
  }

  /**
   * The charges moving on the marked roads (P8), each one lit where it is drawn this frame: a soft
   * glow and a thin ivory ring on a casing. Redrawn every frame (they move; a few circles).
   */
  private drawCharges(charges: readonly Point[], glow: number): void {
    const g = this.chargeRings.clear();
    const { ring } = COMPASS.charge;
    for (const at of charges) {
      for (let i = 0; i < 5; i++) {
        g.circle(at.x, at.y, ring + 1.5 + i * 1.4).stroke({
          width: 1.4,
          color: INK,
          alpha: 0.3 * glow * (1 - i / 5),
        });
      }
      g.circle(at.x, at.y, ring).stroke({ width: 3.2, color: CASING });
      g.circle(at.x, at.y, ring).stroke({ width: 1.3, color: INK });
    }
  }

  /**
   * The marks in turn (I.7, P4, P9): the terrains up to the card's page keep their labels; the area
   * of the terrain on the page now flashes twice when the page shows, then stays outlined until
   * the player turns the page. No ring on the places.
   */
  private drawTurns(marks: CoachMarks, map: CoachGeometry, nowMs: number, reduced: boolean): void {
    const turns = marks.turns ?? [];
    const arenas = map.arenas();
    const key = [
      ...turns.map((t) => `${t.label}:${t.nodes.join('.')}`),
      ...arenas.map((a) => `${halfUnit(a.x)},${halfUnit(a.y)},${halfUnit(a.w)}`),
    ].join('|');
    if (key !== this.turnKey) {
      this.turnKey = key;
      turns.forEach((turn, i) => {
        const label = this.turnLabel(i);
        label.text = turn.label.toUpperCase();
        // Over the first of its places whose spot is clear of the arena of a fight (P7).
        const spots = turn.nodes.flatMap((id) => {
          const node = this.map.nodes[id];
          if (node === undefined) return [];
          // Over the place's ring, or over its Compass when the card marks the place too.
          const compass = marks.focus ? undefined : marks.nodes.find((n) => n.id === id);
          const lift =
            compass === undefined
              ? 12
              : COMPASS.gap +
                COMPASS.step +
                COMPASS.point.length +
                (compass.ring ? COMPASS.wide : 0) +
                10;
          return [{ x: node.x, y: node.y - ringRadius(this.radiusOf(id)) - lift }];
        });
        // The label hangs over its anchor (anchor at its foot): its box, with a little room.
        const half = label.width / 2 + 4;
        const high = label.height + 4;
        const clear = (p: Point): boolean =>
          !arenas.some(
            (a) =>
              p.x + half > a.x && p.x - half < a.x + a.w && p.y + 4 > a.y && p.y - high < a.y + a.h,
          );
        const at = spots.find(clear) ?? spots[0];
        if (at !== undefined) label.position.set(at.x, at.y);
      });
      for (let i = turns.length; i < this.turnLabels.length; i++) {
        const label = this.turnLabels[i];
        if (label !== undefined) label.visible = false;
      }
    }
    const page = Math.min(marks.turn, turns.length - 1);
    turns.forEach((_turn, i) => {
      const label = this.turnLabels[i];
      if (label !== undefined) label.visible = i <= page;
    });
    // The area of the terrain on the page now: it flashes, then rests outlined.
    const now = turns[page] ?? null;
    const areaKey = now === null ? '' : `${String(page)}:${now.nodes.join('.')}`;
    if (areaKey !== this.areaKey) {
      this.areaKey = areaKey;
      this.areaWash.clear();
      this.areaLine.clear();
      if (now !== null) this.drawArea(now.nodes, map);
    }
    if (now !== null) {
      const flash = turnFlash(nowMs - marks.turnSince, reduced);
      this.areaWash.alpha = 0.1 + 0.2 * flash;
      this.areaLine.alpha = 0.75 + 0.25 * flash;
    }
  }

  /**
   * The areas of `nodes` as one region: an ivory wash over each and an engraved outline along the
   * edges no two of them share (the border between two areas of one terrain is not drawn).
   */
  private drawArea(nodes: readonly number[], map: CoachGeometry): void {
    const cells = nodes.flatMap((n) => {
      const cell = map.cell(n);
      return cell === null || cell.length < 3 ? [] : [cell];
    });
    const shared = new Map<string, number>();
    for (const cell of cells) {
      cell.forEach((a, i) => {
        const k = edgeKey(a, cell[(i + 1) % cell.length] as Point);
        shared.set(k, (shared.get(k) ?? 0) + 1);
      });
    }
    for (const cell of cells) this.areaWash.poly(cell.flatMap((p) => [p.x, p.y])).fill(INK);
    for (const [width, color] of [
      [4.2, CASING],
      [1.6, INK],
    ] as const) {
      for (const cell of cells) {
        cell.forEach((a, i) => {
          const b = cell[(i + 1) % cell.length] as Point;
          if ((shared.get(edgeKey(a, b)) ?? 0) > 1) return;
          this.areaLine.moveTo(a.x, a.y).lineTo(b.x, b.y);
        });
      }
      this.areaLine.stroke({ width, color, cap: 'round', join: 'round' });
    }
  }

  /**
   * The elements a card names, lit themselves (P3): each segment of a capacity ring rimmed in
   * ivory on a casing, the warehouse row and the count under a group in an engraved capsule with a
   * lozenge at each end; a soft glow behind them breathes with the Compass. Nothing covers them.
   */
  private drawElements(marks: CoachMarks, map: CoachGeometry, glow: number): void {
    const arcs: Arc[] = [];
    const capsules: Box[] = [];
    const { pad } = COMPASS.element;
    if (!marks.focus) {
      for (const id of marks.capacities) {
        const node = this.map.nodes[id];
        const cap = map.capacityOf(id);
        if (node === undefined || cap === null) continue;
        const r = ringRadius(this.radiusOf(id));
        for (const arc of capacityRing(cap, 0).arcs) {
          arcs.push({ x: node.x, y: node.y, r, from: arc.from, to: arc.to });
        }
      }
      capsules.push(...this.rowBoxes(marks, map));
      for (const id of marks.counts) {
        const box = map.countBox(id);
        if (box === null) continue;
        capsules.push({ x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad });
      }
    }
    const key = [
      ...arcs.map(
        (a) => `a${halfUnit(a.x)},${halfUnit(a.y)},${halfUnit(a.r)},${a.from.toFixed(3)}`,
      ),
      ...capsules.map(
        (c) => `c${halfUnit(c.x)},${halfUnit(c.y)},${halfUnit(c.w)},${halfUnit(c.h)}`,
      ),
    ].join('|');
    if (key !== this.elementKey) {
      this.elementKey = key;
      const g = this.elementGlow.clear();
      const ink = this.elementInk.clear();
      const band = RING_ENGRAVED.cut / 2 + 1.6;
      for (const a of arcs) {
        // The glow: arcs fading out on both sides of the segment (no filter, ui-style BL1).
        for (let i = 0; i < 6; i++) {
          const spread = 1.5 + i * 1.3;
          const alpha = 0.24 * (1 - i / 6);
          g.arc(a.x, a.y, a.r + band + spread, a.from, a.to).stroke({
            width: 1.4,
            color: INK,
            alpha,
          });
          g.moveTo(
            a.x + (a.r - band - spread) * Math.cos(a.from),
            a.y + (a.r - band - spread) * Math.sin(a.from),
          )
            .arc(a.x, a.y, Math.max(1, a.r - band - spread), a.from, a.to)
            .stroke({ width: 1.4, color: INK, alpha: alpha / 2 });
        }
        // The rim of the segment: its outer edge, its end, its inner edge back, its other end.
        const rim = (gfx: Graphics): Graphics =>
          gfx
            .moveTo(a.x + (a.r + band) * Math.cos(a.from), a.y + (a.r + band) * Math.sin(a.from))
            .arc(a.x, a.y, a.r + band, a.from, a.to)
            .lineTo(a.x + (a.r - band) * Math.cos(a.to), a.y + (a.r - band) * Math.sin(a.to))
            .arc(a.x, a.y, a.r - band, a.to, a.from, true)
            .closePath();
        rim(g).fill({ color: INK, alpha: 0.22 });
        rim(ink).stroke({ width: 3.4, color: CASING, join: 'round' });
        rim(ink).stroke({ width: 1.5, color: INK, join: 'round' });
      }
      for (const c of capsules) {
        const r = Math.min(c.h / 2, 6);
        for (let i = 0; i < 6; i++) {
          const s = 1.5 + i * 1.3;
          g.roundRect(c.x - s, c.y - s, c.w + 2 * s, c.h + 2 * s, r + s).stroke({
            width: 1.4,
            color: INK,
            alpha: 0.22 * (1 - i / 6),
          });
        }
        ink.roundRect(c.x, c.y, c.w, c.h, r).stroke({ width: 3.6, color: CASING });
        ink.roundRect(c.x, c.y, c.w, c.h, r).stroke({ width: 1.6, color: INK });
        // A lozenge at each end, as the corners of the HUD outline.
        const y = c.y + c.h / 2;
        for (const x of [c.x, c.x + c.w]) {
          ink
            .poly([x, y - 3.6, x + 3.6, y, x, y + 3.6, x - 3.6, y])
            .fill(INK)
            .stroke({ width: 1.1, color: CASING, join: 'round' });
        }
      }
    }
    this.elementGlow.alpha = glow;
  }

  /**
   * A focus phase (P5): the map goes dark but for the places and warehouse rows it lights and the
   * charges moving on its roads (P8), each lit place with a faint ivory rim. A card that names a
   * warehouse row (II.3) dims the map the same way round the row alone. It fades in.
   */
  private drawFocus(
    marks: CoachMarks,
    map: CoachGeometry,
    charges: readonly Point[],
    age: number,
    reduced: boolean,
  ): void {
    const rows = marks.focus ? [] : this.rowBoxes(marks, map);
    const on = marks.focus || rows.length > 0;
    this.focusShade.visible = on;
    this.focusRims.visible = on;
    if (!on) return;
    const { pad } = COMPASS.focus;
    const key = [
      marks.focus ? 'f' : 'c',
      marks.nodes.map((n) => n.id).join('.'),
      marks.focus
        ? marks.warehouses.map((id) => {
            const row = map.warehouseRow(id);
            return row === null ? '' : `${halfUnit(row.x0)},${halfUnit(row.x1)}`;
          })
        : rows.map((c) => `${halfUnit(c.x)},${halfUnit(c.y)},${halfUnit(c.w)}`),
      charges.map((p) => `${halfUnit(p.x)},${halfUnit(p.y)}`).join(';'),
    ].join('|');
    if (key !== this.focusKey) {
      this.focusKey = key;
      const { width, height } = this.map.meta;
      this.focusShade.clear().rect(0, 0, width, height).fill(CASING);
      const holes = this.focusHoles.clear();
      const rims = this.focusRims.clear();
      if (marks.focus) {
        const places = new Set<number>([...marks.nodes.map((n) => n.id), ...marks.warehouses]);
        for (const id of places) {
          const node = this.map.nodes[id];
          if (node === undefined) continue;
          const r = ringRadius(this.radiusOf(id)) + pad;
          holes.circle(node.x, node.y, r).fill(0xffffff);
          rims.circle(node.x, node.y, r).stroke({ width: 3, color: CASING, alpha: 0.6 });
          rims.circle(node.x, node.y, r).stroke({ width: 1.1, color: INK, alpha: 0.7 });
        }
        for (const at of charges) holes.circle(at.x, at.y, COMPASS.charge.hole).fill(0xffffff);
      } else {
        // The row alone, a little wider than its capsule (the rim of `drawElements` lies on it).
        const grow = COMPASS.element.glow;
        for (const c of rows) {
          holes
            .roundRect(c.x - grow, c.y - grow, c.w + 2 * grow, c.h + 2 * grow, c.h / 2 + grow)
            .fill(0xffffff);
        }
      }
    }
    const dim = focusDim(age, reduced);
    this.focusShade.alpha = dim;
    this.focusRims.alpha = dim / COMPASS.focus.dim;
  }

  /** The capsules of the warehouse rows the card names (P3), world units. */
  private rowBoxes(marks: CoachMarks, map: CoachGeometry): Box[] {
    const { pad } = COMPASS.element;
    const out: Box[] = [];
    for (const id of marks.warehouses) {
      const row = map.warehouseRow(id);
      if (row === null) continue;
      const h = LOZENGE.casing + 2 * pad;
      out.push({
        x: row.x0 - LOZENGE.casing / 2 - pad,
        y: row.y - h / 2,
        w: row.x1 - row.x0 + LOZENGE.casing + 2 * pad,
        h,
      });
    }
    return out;
  }

  private turnLabel(index: number): Text {
    const existing = this.turnLabels[index];
    if (existing !== undefined) {
      existing.visible = true;
      return existing;
    }
    const label = this.turnRoot.addChild(
      new Text({ text: '', style: this.labelStyle, anchor: { x: 0.5, y: 1 } }),
    );
    this.turnLabels.push(label);
    return label;
  }
}
