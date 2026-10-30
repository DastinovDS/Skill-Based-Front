import { Assets, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { t } from '../i18n/index.ts';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import { badgeScale } from './alertLayout.ts';
import { etaPlace, secondsRight } from './etaLayout.ts';
import { comet, cometPhase, routeSpans, type RouteSpan } from './etaRoute.ts';
import hourglassUrl from './glyphs/hourglass.png';
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
  ETA_MARK,
  ETA_ROUTE,
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

/** The stretch of the road `a`-`b` between the city rims (radius `ra` at `a`, `rb` at `b`); `null`: none. */
function rimSpan(a: Point, b: Point, ra: number, rb: number): [Point, Point] | null {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= ra + rb) return null;
  const at = (d: number): Point => ({
    x: a.x + ((b.x - a.x) * d) / length,
    y: a.y + ((b.y - a.y) * d) / length,
  });
  return [at(ra), at(length - rb)];
}

/**
 * The player's own input on the map (CLI-06, #62): the selection outline, dashed ghost arrows of
 * orders not yet in a snapshot, and the dotted preview of where a click would send the group.
 * Static parts (node ring, lines) are redrawn only when the overlay object changes; the frame
 * of a selected group follows its token every frame.
 */
export class OverlayView {
  private readonly ring = new Graphics();
  private readonly frame = new Graphics({ label: 'select-frame' });
  private readonly lines = new Graphics({ label: 'order-lines' });
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
  /**
   * The time to the hovered reachable node (E4 "Hourglass", #627): a disc with the hourglass glyph
   * beside the road, the seconds on its far side; no window. The disc is drawn once, only the
   * container moves.
   */
  private readonly eta = new Container({ label: 'order-eta', visible: false });
  private readonly etaDisc = new Graphics();
  private readonly etaGlyph = new Sprite();
  private readonly etaText: Text;
  /** The comet of the route (H10, #627): redrawn every frame while the route is shown. */
  private readonly comet = new Graphics({ label: 'order-comet' });
  /** The roads of the hovered route, rim to rim (empty: no route). */
  private spans: RouteSpan[] = [];
  /** The still comet is drawn for these spans (under "less motion" it is not redrawn per frame). */
  private cometStill: RouteSpan[] | null = null;
  private cometDrawn = false;
  private destroyed = false;
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
    const M = ETA_MARK;
    this.etaDisc
      .circle(0, 0, M.radius)
      .fill({ color: BG, alpha: M.fillAlpha })
      .stroke({ width: M.rim.width, color: PAPER, alpha: M.rim.alpha });
    this.etaGlyph.anchor.set(0.5);
    this.etaGlyph.visible = false;
    this.eta.addChild(this.etaDisc, this.etaGlyph, this.etaText);
    // The glyph is a static file of the client (img-src 'self'); the Assets cache keeps it for the
    // next match. Without it the disc and the seconds still say what the mark is.
    void Assets.load<Texture>(hourglassUrl).then(
      (texture) => {
        if (this.destroyed) return;
        this.etaGlyph.texture = texture;
        this.etaGlyph.width = M.glyph;
        this.etaGlyph.height = M.glyph;
        this.etaGlyph.visible = true;
      },
      (error: unknown) => {
        console.warn('hourglass glyph failed to load', error);
      },
    );
    this.layers = layers;
    this.bandLayer = layers.layer.intents;
    layers.layer.intents.addChild(
      this.band,
      this.lines,
      this.comet,
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
    this.drawComet(now);
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
   * The seconds (rounded up) on the way to the hovered node, or nothing (#432). The way is the
   * route the server gave with the time (`ReachNode.path`, #448); the hourglass disc sits in the
   * middle of it between the two rims, above the road, the seconds on the far side of the disc.
   */
  private placeEta(state: OverlayState): void {
    const mark = state.eta;
    const points =
      mark === null
        ? []
        : mark.path.map((id) => nodePoint(this.map, id)).filter((p) => p !== undefined);
    if (mark === null || points.length < 2 || this.tickHz <= 0) {
      this.eta.visible = false;
      return;
    }
    const text = `${String(Math.ceil(mark.ticks / this.tickHz))} ${t('unit.s')}`;
    if (this.etaText.text !== text) this.etaText.text = text;
    const M = ETA_MARK;
    const scale = badgeScale(this.cameraScale);
    const place = etaPlace(
      points,
      {
        start: this.radiusOf(mark.from) + REACH_RING.gap,
        end: this.radiusOf(mark.node) + REACH_RING.gap,
      },
      { width: 2 * M.radius * scale, height: 2 * M.radius * scale },
      (roadSpan(3) / 2 + M.roadGap) * scale,
      // The cities on the way: the disc stays clear of them.
      mark.path.map((id) => this.radiusOf(id) + REACH_RING.gap + M.badgeClear),
    );
    if (place === null) {
      this.eta.visible = false;
      return;
    }
    // The seconds go on the side of the disc away from the road and from the nearest city.
    const right = secondsRight(place.spot, place.road, points);
    this.etaText.anchor.set(right ? 0 : 1, 0.5);
    this.etaText.position.set(right ? M.textOffset : -M.textOffset, 0);
    this.eta.scale.set(scale);
    this.eta.position.set(place.spot.x, place.spot.y);
    this.eta.visible = true;
  }

  /**
   * The comet of the hovered route (H10, #627): every frame while it runs, once for the still
   * frame of "less motion". Flat strokes in one small Graphics, no filter.
   */
  private drawComet(now: number): void {
    if (this.spans.length === 0) {
      if (this.cometDrawn) this.comet.clear();
      this.cometDrawn = false;
      this.cometStill = null;
      return;
    }
    const phase = cometPhase(now, reducedMotion());
    if (phase === null && this.cometStill === this.spans) return;
    this.cometStill = phase === null ? this.spans : null;
    const g = this.comet;
    const { width } = ETA_ROUTE.comet;
    const shape = comet(this.spans, phase);
    g.clear();
    this.cometDrawn = true;
    const casing = ETA_ROUTE.casing;
    for (const piece of shape.pieces) {
      for (const [a, b] of piece.segments) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    if (shape.pieces.length > 0) {
      g.stroke({ width: width + casing.extra, color: BG, alpha: casing.alpha, cap: 'round' });
    }
    for (const piece of shape.pieces) {
      for (const [a, b] of piece.segments) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke({ width, color: PAPER, alpha: piece.alpha, cap: 'round' });
    }
    if (shape.head !== null) {
      g.circle(shape.head.x, shape.head.y, width / 2 + 1.5).fill({ color: PAPER });
    }
  }

  destroy(): void {
    this.destroyed = true;
    // The glyph texture belongs to the Assets cache: only the sprite goes.
    this.etaGlyph.texture = Texture.EMPTY;
    this.eta.destroy({ children: true });
    this.comet.destroy();
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
    this.spans = state.eta === null ? [] : this.routeOf(state.eta.path);
    this.drawRoute(g, this.spans);
    if (preview !== null) {
      // Along the route, node to node, as the order will go (a path of one road: that road).
      for (let i = 1; i < preview.path.length; i++) {
        const from = nodePoint(this.map, preview.path[i - 1] ?? -1);
        const to = nodePoint(this.map, preview.path[i] ?? -1);
        if (from === undefined || to === undefined) continue;
        for (const [a, b] of dashSegments(from, to, PREVIEW_DASH, PREVIEW_GAP)) {
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        }
      }
      g.stroke({
        width: PREVIEW_WIDTH,
        color: SELECT_COLOR,
        alpha: PREVIEW_ALPHA,
        cap: 'round',
      });
    }
  }

  /** The roads of `route` (nodes) from rim to rim, as the comet runs them. */
  private routeOf(route: readonly number[]): RouteSpan[] {
    const points: Point[] = [];
    const rims: number[] = [];
    for (const id of route) {
      const at = nodePoint(this.map, id);
      if (at === undefined) return [];
      points.push(at);
      rims.push(this.radius(id) + ETA_ROUTE.rimGap);
    }
    return routeSpans(points, rims);
  }

  /** The route the travel time is for: a faint thin line on each of its roads, rim to rim (H10). */
  private drawRoute(g: Graphics, spans: readonly RouteSpan[]): void {
    if (spans.length === 0) return;
    const { line, casing } = ETA_ROUTE;
    for (const span of spans) g.moveTo(span.a.x, span.a.y).lineTo(span.b.x, span.b.y);
    g.stroke({ width: line.width + casing.extra, color: BG, alpha: casing.alpha, cap: 'round' });
    for (const span of spans) g.moveTo(span.a.x, span.a.y).lineTo(span.b.x, span.b.y);
    g.stroke({
      width: line.width,
      color: PAPER,
      alpha: line.alpha,
      cap: 'round',
    });
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
      const span = rimSpan(ends.a, ends.b, this.radius(edge.a) + 2, this.radius(edge.b) + 2);
      if (span === null) continue;
      for (const [p, q] of dashSegments(span[0], span[1], PICK_BAND.dash, PICK_BAND.gap)) {
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
