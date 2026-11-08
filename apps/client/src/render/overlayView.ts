import { Assets, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { t, tf } from '../i18n/index.ts';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import { badgeScale } from './alertLayout.ts';
import { chevronHalfWidth, drawBonusChevron } from './bonusChevron.ts';
import { etaPlace, secondsRight } from './etaLayout.ts';
import { comet, cometPhase, routeSpans, type RouteSpan } from './etaRoute.ts';
import hourglassUrl from './glyphs/hourglass.png';
import type { Point } from './camera.ts';
import { EMPTY_OVERLAY, type GhostArrow, type OverlayState } from './interaction.ts';
import { CP_REJECT, ghostLook } from './intentLayout.ts';
import { reducedMotion } from './motion.ts';
import type { MapLayers } from './layers.ts';
import { helmetWidth } from './shapes.ts';
import { helmetOutline } from '../units/helmet.ts';
import { arrowGeometry, dashSegments, edgeEnds, nodePoint, type TokenSpot } from './layout.ts';
import { ringRadius } from './cityLayout.ts';
import {
  ARROW_HEAD,
  BONUS_MARK,
  ETA_FONT_SIZE,
  ETA_MARK,
  ETA_ROUTE,
  ARROW_OUTLINE,
  BG,
  CAPITAL_RADIUS,
  GHOST_CP,
  HELMET_FRAME,
  ORDER_GHOST_ALPHA,
  ORDER_GHOST_DASH,
  ORDER_GHOST_GAP,
  ORDER_GHOST_WIDTH,
  NODE_RADIUS,
  PICK_BAND,
  PAPER,
  YOU,
  REACH_RING,
  roadSpan,
  SELECT_COLOR,
  WARN,
  CASING,
  FINE_RING,
  HELMET_SELECT,
  INK,
} from './style.ts';

/** What a selection or hover outline is drawn for: the size and the kind of token. */
function frameKey(at: TokenSpot): string {
  return `${String(at.side)}:${at.enemy === true ? 'e' : 'o'}:${at.inside === true ? 'i' : ''}`;
}

/**
 * The outline round a token, flat, around its centre (world units, unscaled): the line `offset`
 * outside the whole helmet, strap included, flipped for the opponent's (#784).
 */
export function framePolygon(at: TokenSpot, offset: number): number[] {
  const kind = at.enemy === true ? 'enemy' : 'own';
  const outline = helmetOutline(kind, helmetWidth(at.side, at.inside === true), offset);
  return kind === 'own' ? outline : outline.map((v, i) => (i % 2 === 0 ? -v : v));
}

// --- Fine rings (ui-style 55p; mockup `highlight4`, H3) -----------------------------------------------
// One weight system round the capacity ring `R`: a 1 px ink line on a 2.6 px casing at R + 5, 8, 11.

function ring(g: Graphics, at: Point, r: number, width: number, color: number, alpha = 1): void {
  g.circle(at.x, at.y, r).stroke({ width: width + FINE_RING.casing, color: CASING, alpha });
  g.circle(at.x, at.y, r).stroke({ width, color, alpha });
}

/** Selected: two ink rings over a dark band, four lozenges on the outer one. */
export function drawSelectRings(g: Graphics, at: Point, R: number): void {
  const F = FINE_RING;
  const r1 = R + F.r1;
  const r2 = R + F.r2;
  g.circle(at.x, at.y, (r1 + r2) / 2).stroke({
    width: r2 - r1 + F.select.band,
    color: CASING,
    alpha: 0.9,
  });
  g.circle(at.x, at.y, r1).stroke({ width: F.ink, color: INK });
  g.circle(at.x, at.y, r2).stroke({ width: F.select.outer, color: INK });
  const lozenge = (cx: number, cy: number, side: number): void => {
    const h = (side * Math.SQRT2) / 2;
    g.poly([cx, cy - h, cx + h, cy, cx, cy + h, cx - h, cy]);
  };
  for (let j = 0; j < 4; j++) {
    const a = Math.PI / 4 + (j * Math.PI) / 2;
    const cx = at.x + r2 * Math.cos(a);
    const cy = at.y + r2 * Math.sin(a);
    lozenge(cx, cy, F.select.lozenge + 2 * F.select.lozengeCasing);
    g.fill(CASING);
    lozenge(cx, cy, F.select.lozenge);
    g.fill(INK);
  }
}

/** Hovered: one ink ring. */
export function drawHoverRing(g: Graphics, at: Point, R: number): void {
  ring(g, at, R + FINE_RING.r1 + 1, FINE_RING.hover.width, INK, FINE_RING.hover.alpha);
}

/** A reachable target: a ring of ink ticks, every fourth longer. */
export function drawTargetTicks(g: Graphics, at: Point, R: number): void {
  const T = FINE_RING.target;
  const r1 = R + FINE_RING.r1;
  const ticks = (pass: 'casing' | 'ink'): void => {
    for (let j = 0; j < T.ticks; j++) {
      const a = (j / T.ticks) * Math.PI * 2;
      const r2 = r1 + (j % T.every === 0 ? T.long : T.short);
      const pad = pass === 'casing' ? 0.8 : 0;
      g.moveTo(at.x + (r1 - pad) * Math.cos(a), at.y + (r1 - pad) * Math.sin(a)).lineTo(
        at.x + (r2 + pad) * Math.cos(a),
        at.y + (r2 + pad) * Math.sin(a),
      );
    }
    g.stroke(
      pass === 'casing'
        ? { width: FINE_RING.ink + T.casing, color: CASING }
        : { width: FINE_RING.ink, color: INK },
    );
  };
  ticks('casing');
  ticks('ink');
}

/** A target the group reaches only after a split (DEC-20): a dashed amber ring on a casing. */
export function drawSplitRing(g: Graphics, at: Point, R: number): void {
  const S = FINE_RING.split;
  const r = R + FINE_RING.r1 + 1;
  const n = Math.max(8, Math.round((2 * Math.PI * r) / (S.dash + S.gap)));
  const span = ((2 * Math.PI) / n) * (S.dash / (S.dash + S.gap));
  for (const pass of ['casing', 'ink'] as const) {
    for (let i = 0; i < n; i++) {
      const from = (2 * Math.PI * i) / n;
      g.moveTo(at.x + r * Math.cos(from), at.y + r * Math.sin(from));
      g.arc(at.x, at.y, r, from, from + span);
    }
    g.stroke(
      pass === 'casing'
        ? { width: S.width + FINE_RING.casing, color: CASING, cap: 'butt' }
        : { width: S.width, color: WARN, cap: 'butt' },
    );
  }
}

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
  /** The light outline of the own group under the pointer (#762): what a click would pick. */
  private readonly hoverFrame = new Graphics({ label: 'hover-frame' });
  /** The look the hover outline is drawn for (`frameKey`; empty: not drawn yet). */
  private hoverKey = '';
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
  /** The look the selection frame is drawn for (`frameKey`; empty: not drawn yet). */
  private frameKey = '';
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
  /** The bonus counter over the target of a planned order (#793); drawn again when its text changes. */
  private readonly bonus = new Container({ label: 'plan-bonus', visible: false });
  private readonly bonusPill = new Graphics();
  private readonly bonusText: Text;
  private readonly bonusTime: Text;
  /** The texts the pill was drawn for (empty: not drawn yet). */
  private bonusKey = '';
  private readonly bonusStyle = new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: BONUS_MARK.fontSize,
    fontWeight: '700',
    fill: PAPER,
  });
  private readonly bonusTimeStyle = new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: BONUS_MARK.timeFontSize,
    fontWeight: '600',
    fill: PAPER,
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
    this.bonusText = new Text({
      text: '',
      style: this.bonusStyle,
      anchor: { x: 0, y: 0.5 },
      resolution: 1,
    });
    this.bonusTime = new Text({
      text: '',
      style: this.bonusTimeStyle,
      anchor: { x: 0, y: 0.5 },
      resolution: 1,
    });
    this.bonusTime.alpha = 0.75;
    this.bonus.addChild(this.bonusPill, this.bonusText, this.bonusTime);
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
      this.hoverFrame,
      this.frame,
      this.eta,
      this.bonus,
      // Last: a rejected order's ghost lies over everything of the overlay.
      this.ghosts,
    );
    this.frame.visible = false;
    this.hoverFrame.visible = false;
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
    this.placeBonus(next);
    this.drawComet(now);
    // A rejected ghost shakes and fades with the clock; the others only when the overlay changes.
    if (changed || next.ghosts.some((g) => g.status === 'rejected')) this.drawGhosts(next, now);
    const selected = next.selection;
    const at = selected?.kind === 'group' ? groupSpot(selected.id) : undefined;
    this.frame.visible = at !== undefined;
    if (at !== undefined) {
      const key = frameKey(at);
      if (this.frameKey !== key) this.drawFrame(at, key);
      this.frame.position.set(at.x, at.y);
      this.frame.scale.set(at.scale);
    }
    // The group under the pointer gets a light outline, unless it is the selected one.
    const hovered = next.hover?.group ?? null;
    const spot =
      hovered === null || (selected?.kind === 'group' && selected.id === hovered)
        ? undefined
        : groupSpot(hovered);
    this.hoverFrame.visible = spot !== undefined;
    if (spot !== undefined) {
      const key = frameKey(spot);
      if (this.hoverKey !== key) this.drawHoverFrame(spot, key);
      this.hoverFrame.position.set(spot.x, spot.y);
      this.hoverFrame.scale.set(spot.scale);
    }
  }

  setLabelResolution(resolution: number): void {
    for (const text of [this.etaText, this.bonusText, this.bonusTime]) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
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
   * The bonus counter over the target (#793): "^ +3  gathers 6 s" (the green chevron of a bonus,
   * #797) in a pill just above the city's
   * ring, as big on screen at any zoom. The pill is drawn again only when its text changes.
   */
  private placeBonus(state: OverlayState): void {
    const mark = state.bonus ?? null;
    const at = mark === null ? undefined : nodePoint(this.map, mark.node);
    if (mark === null || at === undefined) {
      this.bonus.visible = false;
      return;
    }
    const value = `+${String(mark.bonus)}`;
    const time =
      mark.ticks === null || this.tickHz <= 0
        ? ''
        : tf('plan.gatherIn', { seconds: Math.ceil(mark.ticks / this.tickHz) });
    const key = `${value}|${time}`;
    if (key !== this.bonusKey) this.drawBonus(value, time, key);
    const M = BONUS_MARK;
    const scale = badgeScale(this.cameraScale);
    // The ring is in world units, the pill and its lift keep their size on screen.
    const lift = this.radiusOf(mark.node) + REACH_RING.gap + (M.lift + M.height / 2) * scale;
    this.bonus.scale.set(scale);
    this.bonus.position.set(at.x, at.y - lift);
    this.bonus.visible = true;
  }

  private drawBonus(value: string, time: string, key: string): void {
    const M = BONUS_MARK;
    this.bonusText.text = value;
    this.bonusTime.text = time;
    this.bonusTime.visible = time !== '';
    const d = chevronHalfWidth(M.chevron);
    const width =
      M.padding * 2 +
      2 * d +
      M.gap +
      this.bonusText.width +
      (time === '' ? 0 : M.gap + this.bonusTime.width);
    const left = -width / 2;
    const g = this.bonusPill;
    g.clear();
    g.roundRect(left, -M.height / 2, width, M.height, M.height / 2)
      .fill({ color: BG, alpha: M.fillAlpha })
      .stroke({ width: M.rim.width, color: YOU, alpha: M.rim.alpha });
    // The chevron of a bonus, as on the plan banner, the pill of a planned order and the badges.
    const cx = left + M.padding + d;
    drawBonusChevron(g, cx, 0, M.chevron);
    this.bonusText.position.set(cx + d + M.gap, 0);
    this.bonusTime.position.set(cx + d + M.gap + this.bonusText.width + M.gap, 1);
    this.bonusKey = key;
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
    this.bonus.destroy({ children: true });
    this.bonusStyle.destroy();
    this.bonusTimeStyle.destroy();
    this.comet.destroy();
    this.etaStyle.destroy();
    this.band.destroy();
    this.lines.destroy();
    this.ghosts.destroy();
    this.ring.destroy();
    this.hoverFrame.destroy();
    this.frame.destroy();
  }

  /**
   * The city highlights (Fine rings, ui-style 55p, #847): a reachable target, one that needs a split
   * first, the hovered city and the selected one, each its own stroke round the capacity ring.
   */
  private drawRing(state: OverlayState): void {
    const g = this.ring;
    g.clear();
    this.drawReach(g, state);
    const selected = state.selection;
    const hovered = state.hover?.group == null ? (state.hover?.node ?? null) : null;
    // A hovered target keeps its target mark alone: the hover ring would lie over it.
    const target =
      hovered !== null && (state.reach.includes(hovered) || state.split.includes(hovered));
    if (hovered !== null && !target && !(selected?.kind === 'node' && selected.id === hovered)) {
      const at = nodePoint(this.map, hovered);
      if (at !== undefined) drawHoverRing(g, at, ringRadius(this.radiusOf(hovered)));
    }
    if (selected?.kind !== 'node') return;
    const at = nodePoint(this.map, selected.id);
    if (at === undefined) return;
    drawSelectRings(g, at, ringRadius(this.radiusOf(selected.id)));
  }

  /** The nodes the selected group can go to: a ring of ticks; a dashed amber ring where it must split first. */
  private drawReach(g: Graphics, state: OverlayState): void {
    for (const id of state.reach) {
      const at = nodePoint(this.map, id);
      if (at !== undefined) drawTargetTicks(g, at, ringRadius(this.radiusOf(id)));
    }
    for (const id of state.split) {
      const at = nodePoint(this.map, id);
      if (at !== undefined) drawSplitRing(g, at, ringRadius(this.radiusOf(id)));
    }
  }

  /**
   * The selection: a white `--paper` outline on a dark halo (9.5) round the token: a line round the
   * whole helmet, strap included (#784).
   */
  private drawFrame(at: TokenSpot, key: string): void {
    const g = this.frame;
    g.clear();
    // Engraved (#847): a dark casing with two ink hairlines along it, round the whole helmet.
    const S = HELMET_SELECT;
    g.poly(framePolygon(at, HELMET_FRAME.select)).stroke({
      width: S.casing,
      color: CASING,
      alpha: 0.9,
      join: 'round',
    });
    for (const offset of [-S.offset, S.offset]) {
      g.poly(framePolygon(at, HELMET_FRAME.select + offset)).stroke({
        width: S.ink,
        color: INK,
        join: 'round',
      });
    }
    this.frameKey = key;
  }

  /** The hover outline: the selection frame's shape, closer, thinner and faint (#762). */
  private drawHoverFrame(at: TokenSpot, key: string): void {
    const g = this.hoverFrame;
    g.clear();
    const poly = framePolygon(at, HELMET_FRAME.hover);
    const H = HELMET_SELECT.hover;
    g.poly(poly).stroke({ width: H.casing, color: CASING, alpha: H.alpha, join: 'round' });
    g.poly(poly).stroke({ width: H.ink, color: INK, alpha: H.alpha, join: 'round' });
    this.hoverKey = key;
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
      // The ghost of the planned order (#793): the look of a sent order's arrow, along the
      // server's route; the controller gives a preview only for a target `reach` lists.
      this.drawGhost(
        g,
        { from: preview.from, dest: preview.to, planned: true, path: preview.path },
        0,
      );
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
    // The cut-off arrow (#762): a move the CP did not pay for, bolder, red, crossed out, longer.
    const cut = status === 'rejected' && ghost.rejectCode === CP_REJECT;
    const base = cut ? GHOST_CP.alpha : status === 'accepted' ? 1 : ORDER_GHOST_ALPHA;
    const look = ghostLook(
      status,
      ghost.rejectedAt == null ? 0 : now - ghost.rejectedAt,
      base,
      reducedMotion(),
      ghost.rejectCode ?? null,
    );
    if (look.alpha <= 0) return;
    // The server's path starts at the group's node; the unanswered arrow goes straight to `dest`.
    const nodes = ghost.path ?? [ghost.from, ghost.dest];
    const points = nodes
      .map((id) => nodePoint(this.map, id))
      .filter((p): p is Point => p !== undefined)
      .map((p) => ({ x: p.x + look.dx, y: p.y }));
    const color = cut ? GHOST_CP.color : YOU;
    const width = cut ? GHOST_CP.width : ORDER_GHOST_WIDTH;
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
    const fade = Math.min(1, look.alpha / base);
    const outline = cut ? { ...ARROW_OUTLINE, width: ARROW_OUTLINE.width + 2 } : ARROW_OUTLINE;
    for (const pass of [
      { ...outline, alpha: outline.alpha * fade },
      { width, color, alpha: look.alpha },
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
    if (cut) this.drawCross(g, before, head?.end ?? last, look.alpha);
  }

  /** The cross of the cut-off arrow, on the middle of its last road: a dark halo, then white. */
  private drawCross(g: Graphics, a: Point, b: Point, alpha: number): void {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const r = GHOST_CP.cross;
    const bars = (): void => {
      g.moveTo(mid.x - r, mid.y - r).lineTo(mid.x + r, mid.y + r);
      g.moveTo(mid.x - r, mid.y + r).lineTo(mid.x + r, mid.y - r);
    };
    bars();
    g.stroke({ width: GHOST_CP.crossWidth + 3, color: BG, alpha: 0.9 * alpha, cap: 'round' });
    bars();
    g.stroke({ width: GHOST_CP.crossWidth, color: PAPER, alpha, cap: 'round' });
  }
}
