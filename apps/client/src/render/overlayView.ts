import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { EMPTY_OVERLAY, type GhostArrow, type OverlayState } from './interaction.ts';
import { ghostLook } from './intentLayout.ts';
import { reducedMotion } from './motion.ts';
import type { MapLayers } from './layers.ts';
import {
  arrowGeometry,
  dashSegments,
  edgeEnds,
  nodePoint,
  triangleCorners,
  type TokenSpot,
} from './layout.ts';
import {
  ARROW_HEAD,
  ARROW_OUTLINE,
  BG,
  CAPITAL_RADIUS,
  ORDER_GHOST_ALPHA,
  ORDER_GHOST_DASH,
  ORDER_GHOST_GAP,
  ORDER_GHOST_WIDTH,
  NODE_RADIUS,
  PICK_BAND,
  PAPER,
  WIDTH_BADGE,
  YOU,
  PREVIEW_ALPHA,
  PREVIEW_DASH,
  PREVIEW_GAP,
  PREVIEW_WIDTH,
  ROAD_LIGHT_ALPHA,
  ROAD_LIGHT_EXTRA,
  roadThickness,
  SELECT_COLOR,
  SELECT_RING_GAP,
  SELECT_UNIT_SCALE,
  SELECT_WIDTH,
} from './style.ts';

/**
 * The player's own input on the map (CLI-06, #62): the selection outline, dashed ghost arrows of
 * orders not yet in a snapshot, and the dotted preview of where a click would send the group.
 * Static parts (node ring, lines) are redrawn only when the overlay object changes; the frame
 * of a selected group follows its token every frame.
 */
export class OverlayView {
  private readonly ring = new Graphics();
  private readonly frame = new Graphics();
  private readonly lines = new Graphics();
  /** Ghost arrows of sent orders: redrawn every frame while one shakes and fades. */
  private readonly ghosts = new Graphics();
  private overlay: OverlayState = EMPTY_OVERLAY;
  /** Side of the triangle the selection frame is drawn for (0: not drawn yet). */
  private frameSide = 0;
  private widths: readonly number[] = [];
  private readonly badge = new Container({ label: 'road-width', visible: false });
  private readonly badgeText: Text;
  private readonly badgeStyle = new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: WIDTH_BADGE.fontSize,
    fontWeight: '700',
    fill: PAPER,
  });

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    // The viewing player: the own colour is blue whoever that is (6).
    _me: PlayerId,
    /** Radius of a city now (`CityView.radiusOf`); the class radius of the city kind by default. */
    private readonly radiusOf: (node: number) => number = (node) =>
      map.nodes[node]?.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS,
  ) {
    this.badge.addChild(
      new Graphics()
        .circle(0, 0, WIDTH_BADGE.radius)
        .fill(WIDTH_BADGE.fill)
        .stroke({ width: 1.5, color: WIDTH_BADGE.stroke }),
    );
    this.badgeText = this.badge.addChild(
      new Text({ text: '', style: this.badgeStyle, anchor: 0.5, resolution: 1 }),
    );
    layers.layer.intents.addChild(this.lines, this.ring, this.frame, this.badge, this.ghosts);
    this.frame.visible = false;
  }

  /** `groupSpot`: the drawn centre, side and symbol scale of an own group's token. */
  update(
    next: OverlayState,
    groupSpot: (id: string) => TokenSpot | undefined,
    now: number = performance.now(),
  ): void {
    const changed = next !== this.overlay;
    if (changed) {
      this.overlay = next;
      this.drawLines(next);
      this.drawRing(next);
    }
    // A rejected ghost shakes and fades with the clock; the others only when the overlay changes.
    if (changed || next.ghosts.some((g) => g.status === 'rejected')) this.drawGhosts(next, now);
    const selected = next.selection;
    const at = selected?.kind === 'group' ? groupSpot(selected.id) : undefined;
    this.frame.visible = at !== undefined;
    if (at !== undefined) {
      if (this.frameSide !== at.side) this.drawFrame(at.side);
      this.frame.position.set(at.x, at.y);
      this.frame.scale.set(at.scale);
    }
  }

  /** `widths[i]`: the width of road `i` as the snapshot says (shown on the hovered road). */
  setRoadWidths(widths: readonly number[]): void {
    this.widths = widths;
    if (this.overlay.road !== null) this.drawLines(this.overlay);
  }

  setLabelResolution(resolution: number): void {
    if (this.badgeText.resolution !== resolution) this.badgeText.resolution = resolution;
  }

  destroy(): void {
    this.badge.destroy({ children: true });
    this.badgeStyle.destroy();
    this.lines.destroy();
    this.ghosts.destroy();
    this.ring.destroy();
    this.frame.destroy();
  }

  private drawRing(state: OverlayState): void {
    const g = this.ring;
    g.clear();
    const selected = state.selection;
    if (selected?.kind !== 'node') return;
    const at = nodePoint(this.map, selected.id);
    if (at === undefined) return;
    // Outside the capacity ring: a white ring on a dark one.
    const radius = this.radiusOf(selected.id) + SELECT_RING_GAP;
    g.circle(at.x, at.y, radius + SELECT_WIDTH).stroke({ width: 2, color: BG });
    g.circle(at.x, at.y, radius).stroke({ width: SELECT_WIDTH, color: SELECT_COLOR });
  }

  /** The white outline of the triangle, 1.45 times bigger, on a dark halo (9.5). */
  private drawFrame(side: number): void {
    const g = this.frame;
    g.clear();
    const [left, right, tip] = triangleCorners(side * SELECT_UNIT_SCALE);
    // The bigger triangle has the same tip height offset: centre it on the token's box centre.
    const dy = (triangleCorners(side)[2].y - tip.y) / 2;
    const poly = [left, right, tip].flatMap((p) => [p.x, p.y + dy]);
    g.poly(poly).stroke({ width: SELECT_WIDTH + 4, color: BG, alpha: 0.8, join: 'round' });
    g.poly(poly).stroke({ width: SELECT_WIDTH, color: SELECT_COLOR, join: 'round' });
    this.frameSide = side;
  }

  private drawLines(state: OverlayState): void {
    const g = this.lines;
    g.clear();
    this.drawCandidates(g, state.candidates);
    const road = state.road === null ? undefined : edgeEnds(this.map, state.road);
    this.badge.visible = false;
    if (road !== undefined && state.road !== null) {
      const width = this.widths[state.road] ?? this.map.edges[state.road]?.base_width ?? 1;
      // The width as a number in a disc in the middle of the road: it reads without colour.
      this.badge.position.set((road.a.x + road.b.x) / 2, (road.a.y + road.b.y) / 2);
      this.badgeText.text = String(width);
      this.badge.visible = true;
      g.moveTo(road.a.x, road.a.y).lineTo(road.b.x, road.b.y);
      g.stroke({
        width: roadThickness(width) + ROAD_LIGHT_EXTRA,
        color: SELECT_COLOR,
        alpha: ROAD_LIGHT_ALPHA,
        cap: 'round',
      });
    }
    const preview = state.preview;
    if (preview !== null) {
      const from = nodePoint(this.map, preview.from);
      const to = nodePoint(this.map, preview.to);
      if (from !== undefined && to !== undefined) {
        for (const [a, b] of dashSegments(from, to, PREVIEW_DASH, PREVIEW_GAP)) {
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        }
        g.stroke({
          width: PREVIEW_WIDTH,
          color: preview.planned ? SELECT_COLOR : YOU,
          alpha: PREVIEW_ALPHA,
          cap: 'round',
        });
      }
    }
  }

  /** Road pick: a dashed band along each road a click would upgrade. */
  private drawCandidates(g: Graphics, candidates: readonly number[]): void {
    if (candidates.length === 0) return;
    for (const id of candidates) {
      const ends = edgeEnds(this.map, id);
      const edge = this.map.edges[id];
      if (ends === undefined || edge === undefined) continue;
      // From rim to rim: the band stays off the city bodies.
      const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
      const ra = this.radius(edge.a) + 2;
      const rb = this.radius(edge.b) + 2;
      if (length <= ra + rb) continue;
      const at = (d: number): Point => ({
        x: ends.a.x + ((ends.b.x - ends.a.x) * d) / length,
        y: ends.a.y + ((ends.b.y - ends.a.y) * d) / length,
      });
      for (const [p, q] of dashSegments(at(ra), at(length - rb), PICK_BAND.dash, PICK_BAND.gap)) {
        g.moveTo(p.x, p.y).lineTo(q.x, q.y);
      }
    }
    // One stroke for all: the band is as wide as the widest road plus a margin.
    g.stroke({
      width: roadThickness(5) + PICK_BAND.extra,
      color: SELECT_COLOR,
      alpha: PICK_BAND.alpha,
      cap: 'butt',
    });
  }

  private radius(node: number): number {
    return this.radiusOf(node);
  }

  private drawGhosts(state: OverlayState, now: number): void {
    this.ghosts.clear();
    for (const ghost of state.ghosts) this.drawGhost(this.ghosts, ghost, now);
  }

  /**
   * Dashed arrow along the server's path, or straight to the destination while unanswered; solid
   * once the server accepted it; shaking and fading once it rejected it (U6).
   */
  private drawGhost(g: Graphics, ghost: GhostArrow, now: number): void {
    const status = ghost.status ?? 'pending';
    const look = ghostLook(
      status,
      ghost.rejectedAt == null ? 0 : now - ghost.rejectedAt,
      status === 'accepted' ? 1 : ORDER_GHOST_ALPHA,
      reducedMotion(),
    );
    if (look.alpha <= 0) return;
    // The server's path starts at the group's node; the unanswered arrow goes straight to `dest`.
    const nodes = ghost.path ?? [ghost.from, ghost.dest];
    const points = nodes
      .map((id) => nodePoint(this.map, id))
      .filter((p): p is Point => p !== undefined)
      .map((p) => ({ x: p.x + look.dx, y: p.y }));
    const color = YOU;
    const last = points.at(-1);
    const before = points.at(-2);
    if (last === undefined || before === undefined) return;
    const head = arrowGeometry(
      before,
      last,
      0,
      this.radiusOf(nodes.at(-1) ?? 0) + 2,
      ARROW_HEAD.length,
      ARROW_HEAD.width,
    );
    const fade = Math.min(1, look.alpha / ORDER_GHOST_ALPHA);
    for (const pass of [
      { ...ARROW_OUTLINE, alpha: ARROW_OUTLINE.alpha * fade },
      { width: ORDER_GHOST_WIDTH, color, alpha: look.alpha },
    ]) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = i === points.length - 1 && head !== null ? head.end : points[i];
        if (a === undefined || b === undefined) continue;
        if (look.solid) {
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
          continue;
        }
        for (const [s, e] of dashSegments(a, b, ORDER_GHOST_DASH, ORDER_GHOST_GAP)) {
          g.moveTo(s.x, s.y).lineTo(e.x, e.y);
        }
      }
      g.stroke({ width: pass.width, color: pass.color, alpha: pass.alpha, cap: 'round' });
      if (head !== null) {
        g.poly([head.head[0], head.head[1], head.head[2]]).fill({
          color: pass.color,
          alpha: pass.alpha,
        });
      }
    }
  }
}
