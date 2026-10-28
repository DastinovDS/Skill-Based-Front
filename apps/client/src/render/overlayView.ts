import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import { t } from '../i18n/index.ts';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import { badgeScale } from './alertLayout.ts';
import { etaSpot } from './etaLayout.ts';
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
  ETA_FONT_SIZE,
  ETA_LABEL,
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
  YOU,
  PREVIEW_ALPHA,
  PREVIEW_DASH,
  PREVIEW_GAP,
  PREVIEW_WIDTH,
  REACH_RING,
  roadSpan,
  SELECT_COLOR,
  SELECT_RING_GAP,
  SELECT_UNIT_SCALE,
  SELECT_WIDTH,
  WARN,
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
  /**
   * The dashed band of the road mode: a Graphics of its own because it has to show in the «Supply»
   * view, which hides the `intents` layer (#469): there it lies on the `roads` layer (under the
   * supply flows), on the normal map at the bottom of `intents`, where it always was.
   */
  private readonly band = new Graphics({ label: 'road-band' });
  private bandLayer: Container;
  private readonly layers: MapLayers;
  /** Ghost arrows of sent orders: redrawn every frame while one shakes and fades. */
  private readonly ghosts = new Graphics();
  private overlay: OverlayState = EMPTY_OVERLAY;
  /** Side of the triangle the selection frame is drawn for (0: not drawn yet). */
  private frameSide = 0;
  /** The time to the hovered reachable node: a small plate on the road to it, no window. */
  private readonly eta = new Container({ label: 'order-eta', visible: false });
  private readonly etaPlate = new Graphics();
  private readonly etaText: Text;
  /** The text the plate is drawn for (the plate is redrawn when the number changes). */
  private etaDrawn = '';
  private readonly etaStyle = new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: ETA_FONT_SIZE,
    fontWeight: '700',
    fill: PAPER,
    stroke: { color: BG, width: 3, join: 'round' },
  });
  private tickHz = 10;
  private cameraScale = 1;
  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    // The viewing player: the own colour is blue whoever that is (6).
    _me: PlayerId,
    /** Radius of a city now (`CityView.radiusOf`); the class radius of the city kind by default. */
    private readonly radiusOf: (node: number) => number = (node) =>
      map.nodes[node]?.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS,
  ) {
    this.etaText = new Text({
      text: '',
      style: this.etaStyle,
      anchor: { x: 0, y: 0.5 },
      resolution: 1,
    });
    this.eta.addChild(this.etaPlate, this.etaText);
    this.layers = layers;
    this.bandLayer = layers.layer.intents;
    layers.layer.intents.addChild(
      this.band,
      this.lines,
      this.ring,
      this.frame,
      this.eta,
      this.ghosts,
    );
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
      this.placeBand(next.supply !== null);
      this.drawLines(next);
      this.drawRing(next);
    }
    this.placeEta(next);
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

  setLabelResolution(resolution: number): void {
    if (this.etaText.resolution !== resolution) this.etaText.resolution = resolution;
  }

  /** Ticks per second, to turn the travel time into seconds. */
  setTickHz(tickHz: number): void {
    this.tickHz = tickHz;
  }

  /** Camera scale (CSS px per world unit): the number keeps its size on screen. */
  setCameraScale(scale: number): void {
    this.cameraScale = scale;
  }

  /**
   * The seconds (rounded up) on the road to the hovered node, or nothing (#432). The path is the
   * stretch from the group's city to that city (the server answers only the total time on hover,
   * `reach`); the label sits in the middle of it between the two rims, above the road.
   */
  private placeEta(state: OverlayState): void {
    const mark = state.eta;
    const from = mark === null ? undefined : nodePoint(this.map, mark.from);
    const to = mark === null ? undefined : nodePoint(this.map, mark.node);
    if (mark === null || from === undefined || to === undefined || this.tickHz <= 0) {
      this.eta.visible = false;
      return;
    }
    const text = `${String(Math.ceil(mark.ticks / this.tickHz))} ${t('unit.s')}`;
    if (this.etaText.text !== text) this.etaText.text = text;
    const width = this.drawEtaPlate(text);
    const scale = badgeScale(this.cameraScale);
    const spot = etaSpot(
      [from, to],
      {
        start: this.radiusOf(mark.from) + REACH_RING.gap,
        end: this.radiusOf(mark.node) + REACH_RING.gap,
      },
      { width: width * scale, height: ETA_LABEL.height * scale },
      (roadSpan(3) / 2 + ETA_LABEL.roadGap) * scale,
      // Two cities with a road between them: that road. Else the way is the server's and unknown
      // here: the last piece before the destination, never over a city on the way.
      this.map.edges.some(
        (e) => (e.a === mark.from && e.b === mark.node) || (e.b === mark.from && e.a === mark.node),
      )
        ? 'middle'
        : 'end',
    );
    if (spot === null) {
      this.eta.visible = false;
      return;
    }
    this.eta.scale.set(scale);
    this.eta.position.set(spot.x, spot.y);
    this.eta.visible = true;
  }

  /** The plate with the clock and the number, centred on the origin; returns its width. */
  private drawEtaPlate(text: string): number {
    const L = ETA_LABEL;
    const width = L.padX + L.clock + L.gap + this.etaText.width + L.padX;
    if (this.etaDrawn === text) return width;
    this.etaDrawn = text;
    const left = -width / 2;
    const cx = left + L.padX + L.clock / 2;
    const r = L.clock / 2 - 0.75;
    this.etaText.position.set(left + L.padX + L.clock + L.gap, 0);
    this.etaPlate
      .clear()
      .roundRect(left, -L.height / 2, width, L.height, L.radius)
      .fill({ color: BG, alpha: 0.92 })
      .stroke({ width: 1.5, color: PAPER, alpha: 0.75 })
      .circle(cx, 0, r)
      .stroke({ width: 1.5, color: PAPER })
      .moveTo(cx, 0)
      .lineTo(cx, -r * 0.6)
      .moveTo(cx, 0)
      .lineTo(cx + r * 0.5, r * 0.2)
      .stroke({ width: 1.5, color: PAPER, cap: 'round' });
    return width;
  }

  destroy(): void {
    this.eta.destroy({ children: true });
    this.etaStyle.destroy();
    this.band.destroy();
    this.lines.destroy();
    this.ghosts.destroy();
    this.ring.destroy();
    this.frame.destroy();
  }

  private drawRing(state: OverlayState): void {
    const g = this.ring;
    g.clear();
    this.drawReach(g, state);
    const selected = state.selection;
    if (selected?.kind !== 'node') return;
    const at = nodePoint(this.map, selected.id);
    if (at === undefined) return;
    // Outside the capacity ring: a white ring on a dark one.
    const radius = this.radiusOf(selected.id) + SELECT_RING_GAP;
    g.circle(at.x, at.y, radius + SELECT_WIDTH).stroke({ width: 2, color: BG });
    g.circle(at.x, at.y, radius).stroke({ width: SELECT_WIDTH, color: SELECT_COLOR });
  }

  /** Rings of the nodes the selected group can go to, solid; dashed where it must split first. */
  private drawReach(g: Graphics, state: OverlayState): void {
    for (const id of state.reach) {
      const at = nodePoint(this.map, id);
      if (at === undefined) continue;
      g.circle(at.x, at.y, this.radiusOf(id) + REACH_RING.gap);
    }
    if (state.reach.length > 0) {
      g.stroke({ width: REACH_RING.width, color: YOU, alpha: REACH_RING.alpha });
    }
    for (const id of state.split) {
      const at = nodePoint(this.map, id);
      if (at === undefined) continue;
      const r = this.radiusOf(id) + REACH_RING.gap;
      const dashes = Math.max(8, Math.round((2 * Math.PI * r) / (2 * REACH_RING.dash)));
      for (let i = 0; i < dashes; i++) {
        const from = (2 * Math.PI * i) / dashes;
        g.moveTo(at.x + r * Math.cos(from), at.y + r * Math.sin(from));
        g.arc(at.x, at.y, r, from, from + Math.PI / dashes);
      }
    }
    if (state.split.length > 0) {
      g.stroke({ width: REACH_RING.width, color: WARN, alpha: REACH_RING.alpha });
    }
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
    this.band.clear();
    this.drawCandidates(this.band, state.candidates);
    const g = this.lines;
    g.clear();
    // The dotted line of an ordinary order is gone (the arrow of the order is its picture); only a
    // planned order shows where its ribbon will go.
    const preview = state.preview !== null && state.preview.planned ? state.preview : null;
    if (preview !== null) {
      const from = nodePoint(this.map, preview.from);
      const to = nodePoint(this.map, preview.to);
      if (from !== undefined && to !== undefined) {
        for (const [a, b] of dashSegments(from, to, PREVIEW_DASH, PREVIEW_GAP)) {
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        }
        g.stroke({
          width: PREVIEW_WIDTH,
          color: SELECT_COLOR,
          alpha: PREVIEW_ALPHA,
          cap: 'round',
        });
      }
    }
  }

  /** The band is drawn on the layer that is visible in the current view (see `band`). */
  private placeBand(supply: boolean): void {
    const layer = supply ? this.layers.layer.roads : this.layers.layer.intents;
    if (layer === this.bandLayer) return;
    this.bandLayer = layer;
    // Bottom of the `intents`, as before; the top of the `roads`: over the lanes, under the cities.
    if (supply) layer.addChild(this.band);
    else layer.addChildAt(this.band, 0);
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
      width: roadSpan(3) + PICK_BAND.extra,
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
    // Only a rejected order leaves a trace (it shakes and fades, U6): an accepted or unanswered one
    // draws nothing, the order line or the ribbon of the snapshot is its picture.
    for (const ghost of state.ghosts) {
      if (ghost.status === 'rejected') this.drawGhost(this.ghosts, ghost, now);
    }
  }

  /**
   * The arrow of a rejected order, shaking and fading (U6): along the server's path if it sent
   * one, else straight to the destination.
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
