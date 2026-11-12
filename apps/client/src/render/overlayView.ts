import { Assets, Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';
import { t } from '../i18n/index.ts';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import { badgeScale } from './alertLayout.ts';
import { chevronHalfWidth, drawBonusChevron } from './bonusChevron.ts';
import { etaPlace, secondsRight } from './etaLayout.ts';
import hourglassUrl from './glyphs/hourglass.png';
import type { Point } from './camera.ts';
import {
  EMPTY_OVERLAY,
  type GhostArrow,
  type OverlayState,
  type WorldRect,
} from './interaction.ts';
import { normRect, routeRuns } from './groupOrderLayout.ts';
import { CP_REJECT, ghostLook, ribbonShape, tailStart } from './intentLayout.ts';
import { drawCasedArrow, pathLength, pointAlong, slicePath, trimPath } from './casedArrow.ts';
import { hairFloor } from './engraving.ts';
import { easeSettle } from '../theme/tokens.ts';
import { reducedMotion } from './motion.ts';
import type { MapLayers } from './layers.ts';
import { CornerTicks } from './cornerTicks.ts';
import { nodePoint, type TokenSpot } from './layout.ts';
import { ringRadius } from './cityLayout.ts';
import {
  BONUS_MARK,
  GROUP_ORDER,
  ETA_FONT_SIZE,
  ETA_MARK,
  BG,
  CAPITAL_RADIUS,
  CASED,
  DARK_PLATE,
  GHOST_CP,
  ORDER_GHOST_ALPHA,
  NODE_RADIUS,
  PATH_SHADOW,
  REFUSED,
  RIBBON_ENGRAVED,
  PAPER,
  YOU,
  REACH_RING,
  WARN,
  CASING,
  FINE_RING,
  INK,
} from './style.ts';

// --- Fine rings (ui-style 55p; mockup `highlight4`, H3) -----------------------------------------------
// One weight system round the capacity ring `R`: a 1 px ink line on a 2.6 px casing at R + 5, 8, 11.

/** Selected: two ink rings over a dark band, four lozenges on the outer one. */
function drawSelectRings(g: Graphics, at: Point, R: number): void {
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

/** A reachable target: a ring of ink ticks, every fourth longer. */
function drawTargetTicks(g: Graphics, at: Point, R: number): void {
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
function drawSplitRing(g: Graphics, at: Point, R: number): void {
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

/**
 * The player's own input on the map (CLI-06, #62): the selection outline, dashed ghost arrows of
 * orders not yet in a snapshot, and the dotted preview of where a click would send the group.
 * Static parts (node ring, lines) are redrawn only when the overlay object changes; the frame
 * of a selected group follows its token every frame.
 */
export class OverlayView {
  private readonly ring = new Graphics();
  /** The four corner ticks of the selected group (B6, #949). */
  private readonly frame = new CornerTicks('select-frame');
  /** The two ticks of the own group under the pointer (#762): what a click would pick. */
  private readonly hoverFrame = new CornerTicks('hover-frame');
  private readonly lines = new Graphics({ label: 'order-lines' });
  /** Ghost arrows of sent orders: redrawn every frame while one shakes and fades. */
  private readonly ghosts = new Graphics();
  private overlay: OverlayState = EMPTY_OVERLAY;
  /**
   * The time to the hovered reachable node (E4 "Hourglass", #627): a disc with the hourglass glyph
   * beside the road, the seconds on its far side; no window. The disc is drawn once, only the
   * container moves.
   */
  private readonly eta = new Container({ label: 'order-eta', visible: false });
  private readonly etaDisc = new Graphics();
  private readonly etaGlyph = new Sprite();
  private readonly etaText: Text;
  /**
   * The path on hover (Cased running, hollow, 54i, #851): the shadow of the order a click would
   * make, along the server's route (`ReachNode.path`); redrawn every frame while shown (the burin
   * points run).
   */
  private readonly path = new Graphics({ label: 'order-path' });
  /** The route shown (nodes joined), its points from ring to ring, and when it was first shown (ms). */
  private pathKey = '';
  private pathPoints: Point[] = [];
  private pathSince = 0;
  private pathDrawn = false;
  /** Whether ghosts were drawn last frame (they are cleared once when the last one goes). */
  private ghostsDrawn = false;
  private deviceResolution = 1;
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
  /** The text the pill was drawn for (empty: not drawn yet). */
  private bonusKey = '';
  private readonly bonusStyle = new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: BONUS_MARK.fontSize,
    fontWeight: '700',
    fill: PAPER,
  });
  private tickHz = 10;
  private cameraScale = 1;
  /**
   * The groups selected together (DEC-48, item K8, A1 and A2): a frame round each and a lozenge seal
   * with its place in the selection; one entry per place, kept for the next selection.
   */
  private readonly picks: {
    readonly frame: CornerTicks;
    readonly seal: Container;
    readonly plate: Graphics;
    readonly text: Text;
  }[] = [];
  private readonly pickLayer = new Container({ label: 'group-picks' });
  private readonly sealStyle = new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: GROUP_ORDER.seal.fontSize,
    fontWeight: '600',
    fill: INK,
  });
  /** The Shift+drag box (A1): a dark band with an ink hairline either side and lozenge corners. */
  private readonly boxShape = new Graphics({ label: 'select-box' });
  private box: WorldRect | null = null;
  private boxDrawn = false;
  /** The preview of a group order (DEC-48, item K4): a line, or with E held a ribbon (D2), a member. */
  private readonly groupLines = new Graphics({ label: 'group-preview' });
  private groupDrawn = false;
  /** The routes of the group order preview drawn (joined), and when they were first shown (ms). */
  private groupKey = '';
  private groupSince = 0;
  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    // The viewing player: the selection, the previews and the ghosts are theirs.
    _me: PlayerId,
    /** Radius of a city now (`CityView.radiusOf`); the class radius of the city kind by default. */
    private readonly radiusOf: (node: number) => number = (node) =>
      map.nodes[node]?.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS,
    /** The viewer's colour (DEC-49); Lapis by default. */
    private readonly own: number = YOU,
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
    this.bonus.addChild(this.bonusPill, this.bonusText);
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
    layers.layer.intents.addChild(
      this.lines,
      this.path,
      this.groupLines,
      this.ring,
      this.hoverFrame.view,
      this.frame.view,
      this.pickLayer,
      this.eta,
      this.bonus,
      this.boxShape,
      // Last: a rejected order's ghost lies over everything of the overlay.
      this.ghosts,
    );
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
    this.placeEta(next);
    this.placeBonus(next);
    this.drawPath(now);
    // Ghosts run their burin points, shake and fade with the clock: redrawn every frame while any.
    if (next.ghosts.length > 0 || this.ghostsDrawn) this.drawGhosts(next, now);
    const selected = next.selection;
    const at = selected?.kind === 'group' ? groupSpot(selected.id) : undefined;
    this.frame.update(selected?.kind === 'group' ? selected.id : '', at, 'select', now);
    this.placePicks(next.picks ?? [], groupSpot, now);
    this.drawBox();
    if (next.group != null || this.groupDrawn) this.drawGroupPreview(next, now);
    // The group under the pointer gets a light outline, unless it is the selected one.
    const hovered = next.hover?.group ?? null;
    const spot =
      hovered === null ||
      (selected?.kind === 'group' && selected.id === hovered) ||
      next.picks?.includes(hovered) === true
        ? undefined
        : groupSpot(hovered);
    this.hoverFrame.update(hovered ?? '', spot, 'hover', now);
  }

  setLabelResolution(resolution: number): void {
    const texts = [this.etaText, this.bonusText, ...this.picks.map((p) => p.text)];
    for (const text of texts) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
    this.labelResolution = resolution;
  }

  private labelResolution = 1;

  /** The selection box being dragged, world units (DEC-48, item K1); `null`: none. */
  setBox(box: WorldRect | null): void {
    this.box = box;
  }

  /**
   * The groups selected together (A1 and A2): the selection's corner ticks round each and, at the
   * top left of its helmet as drawn, a lozenge seal with its place in the selection (the order decides the
   * remainder of a planned bonus, DEC-48, item F2). They follow their tokens every frame.
   */
  private placePicks(
    ids: readonly string[],
    groupSpot: (id: string) => TokenSpot | undefined,
    now: number,
  ): void {
    ids.forEach((id, i) => {
      const pick = this.pick(i);
      const at = groupSpot(id);
      pick.frame.update(id, at, 'select', now);
      pick.seal.visible = at !== undefined;
      if (at === undefined) return;
      // The seal sits on the helmet as drawn (fitted into a ring or not), not on its full size.
      const w = at.width * at.scale;
      const S = GROUP_ORDER.seal;
      pick.seal.position.set(at.x + w * S.dx, at.y + w * S.dy);
      pick.seal.scale.set(at.scale);
      const label = String(i + 1);
      if (pick.text.text !== label) pick.text.text = label;
    });
    for (let i = ids.length; i < this.picks.length; i++) {
      const pick = this.picks[i];
      if (pick === undefined) continue;
      pick.frame.update('', undefined, 'select', now);
      pick.seal.visible = false;
    }
  }

  /** The frame and the seal of the place `i` of the selection, made the first time it is needed. */
  private pick(i: number): (typeof this.picks)[number] {
    const known = this.picks[i];
    if (known !== undefined) return known;
    const S = GROUP_ORDER.seal;
    const plate = new Graphics();
    const h = S.half * Math.SQRT2;
    const lozenge = (r: number): number[] => [0, -r, r, 0, 0, r, -r, 0];
    plate.poly(lozenge(h + S.casing)).fill(CASING);
    plate.poly(lozenge(h)).fill(DARK_PLATE);
    plate.poly(lozenge(h - 1.2)).stroke({ width: S.ink, color: INK, join: 'miter' });
    const text = new Text({
      text: '',
      style: this.sealStyle,
      anchor: 0.5,
      resolution: this.labelResolution,
    });
    const seal = new Container({ label: 'group-seal' });
    seal.addChild(plate, text);
    const frame = new CornerTicks('group-frame');
    this.pickLayer.addChild(frame.view, seal);
    const made = { frame, seal, plate, text };
    this.picks[i] = made;
    return made;
  }

  /**
   * The Shift+drag box (A1): a faint paper ground, a dark band, an ink hairline outside and a
   * fainter one inside, a lozenge at each corner. Kept in world units, the line widths in screen px.
   */
  private drawBox(): void {
    const g = this.boxShape;
    const box = this.box;
    if (box === null) {
      if (this.boxDrawn) g.clear();
      this.boxDrawn = false;
      return;
    }
    const { x, y, width, height } = normRect(box);
    const k = 1 / Math.max(this.cameraScale, 1e-6);
    const B = GROUP_ORDER.box;
    g.clear();
    this.boxDrawn = true;
    if (width < 2 * k || height < 2 * k) return;
    g.rect(x, y, width, height).fill({ color: INK, alpha: B.fill });
    g.rect(x, y, width, height).stroke({
      width: B.band * k,
      color: CASING,
      alpha: B.bandAlpha,
      join: 'miter',
    });
    const o = B.offset * k;
    g.rect(x - o, y - o, width + 2 * o, height + 2 * o).stroke({
      width: B.ink * k,
      color: INK,
      join: 'miter',
    });
    g.rect(x + o, y + o, width - 2 * o, height - 2 * o).stroke({
      width: B.ink * k * 0.8,
      color: INK,
      alpha: B.inner,
      join: 'miter',
    });
    const r = (B.corner * Math.SQRT2 * k) / 2;
    for (const [cx, cy] of [
      [x, y],
      [x + width, y],
      [x, y + height],
      [x + width, y + height],
    ] as const) {
      g.poly([
        cx,
        cy - r - 1.1 * k,
        cx + r + 1.1 * k,
        cy,
        cx,
        cy + r + 1.1 * k,
        cx - r - 1.1 * k,
        cy,
      ]).fill(CASING);
      g.poly([cx, cy - r, cx + r, cy, cx, cy + r, cx - r, cy]).fill(INK);
    }
  }

  /**
   * The order a click would give the groups selected together (DEC-48, item K4): each member's
   * way along the route the server gave it (`reach`, #1004), the hollow Cased arrow of the path on
   * hover (54i), drawn out as it is; a road several members share is drawn once, a member's way
   * that runs into it ends at the ring of the city where it joins (`routeRuns`). With `E` held the
   * same routes, as the path of a single planned order (#1004: the routes replace the ribbons of
   * D2); the bonus counter over the target says "planned". A member without a route has no line.
   * The seal over the target is `GroupOrderView`'s.
   */
  private drawGroupPreview(state: OverlayState, now: number): void {
    const g = this.groupLines;
    g.clear();
    const preview = state.group ?? null;
    this.groupDrawn = preview !== null;
    if (preview === null) {
      this.groupKey = '';
      return;
    }
    const key = preview.routes.map((r) => r.join('>')).join(';');
    if (key !== this.groupKey) {
      this.groupKey = key;
      this.groupSince = now;
    }
    const reduced = reducedMotion();
    const grow = reduced ? 1 : easeSettle((now - this.groupSince) / PATH_SHADOW.growMs);
    for (const run of routeRuns(preview.routes)) {
      const first = run.nodes[0];
      const last = run.nodes[run.nodes.length - 1];
      if (first === undefined || last === undefined) continue;
      const points = this.routePoints(run.nodes, !run.head);
      const drawn = slicePath(points, 0, pathLength(points) * grow);
      if (drawn.length < 2) continue;
      drawCasedArrow(g, drawn, {
        color: this.own,
        ghost: true,
        seconds: reduced ? 0 : now / 1000,
        noHead: !run.head,
        hair: this.hair(),
        zoom: this.cameraScale,
      });
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

  /** The device pixel ratio: the hairlines of the arrows keep one device pixel. */
  setDeviceResolution(resolution: number): void {
    this.deviceResolution = resolution;
  }

  /** One device pixel in world units now. */
  private hair(): number {
    return hairFloor(this.cameraScale, this.deviceResolution);
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
      M.roadGap * scale,
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
   * The bonus counter over the target (#793): "^ +3" (the green chevron of a bonus, #797) in a pill
   * just above the city's ring, as big on screen at any zoom, with no gathering time (owner
   * 2026-11-11, #940: the fill of the order says it). The pill is drawn again only when its text
   * changes.
   */
  private placeBonus(state: OverlayState): void {
    const mark = state.bonus ?? null;
    const at = mark === null ? undefined : nodePoint(this.map, mark.node);
    if (mark === null || at === undefined) {
      this.bonus.visible = false;
      return;
    }
    const value = `+${String(mark.bonus)}`;
    if (value !== this.bonusKey) this.drawBonus(value);
    const M = BONUS_MARK;
    const scale = badgeScale(this.cameraScale);
    // The ring is in world units, the pill and its lift keep their size on screen.
    const lift = this.radiusOf(mark.node) + REACH_RING.gap + (M.lift + M.height / 2) * scale;
    this.bonus.scale.set(scale);
    this.bonus.position.set(at.x, at.y - lift);
    this.bonus.visible = true;
  }

  private drawBonus(value: string): void {
    const M = BONUS_MARK;
    this.bonusText.text = value;
    const d = chevronHalfWidth(M.chevron);
    const width = M.padding * 2 + 2 * d + M.gap + this.bonusText.width;
    const left = -width / 2;
    const g = this.bonusPill;
    g.clear();
    g.roundRect(left, -M.height / 2, width, M.height, M.height / 2)
      .fill({ color: BG, alpha: M.fillAlpha })
      .stroke({ width: M.rim.width, color: this.own, alpha: M.rim.alpha });
    // The chevron of a bonus, as on the plan banner, the pill of a planned order and the badges.
    const cx = left + M.padding + d;
    drawBonusChevron(g, cx, 0, M.chevron);
    this.bonusText.position.set(cx + d + M.gap, 0);
    this.bonusKey = value;
  }

  /**
   * The path on hover (54i): the hollow Cased arrow along the server's route from the ring of the
   * group's city to the ring of the target, drawn out over `PATH_SHADOW.growMs` when the route
   * changes, its burin points running; "less motion" draws it whole and still.
   */
  private drawPath(now: number): void {
    const g = this.path;
    if (this.pathPoints.length < 2) {
      if (this.pathDrawn) g.clear();
      this.pathDrawn = false;
      return;
    }
    const reduced = reducedMotion();
    if (Number.isNaN(this.pathSince)) this.pathSince = now;
    const grow = reduced ? 1 : easeSettle((now - this.pathSince) / PATH_SHADOW.growMs);
    const points = slicePath(this.pathPoints, 0, pathLength(this.pathPoints) * grow);
    g.clear();
    drawCasedArrow(g, points, {
      color: this.own,
      ghost: true,
      seconds: reduced ? 0 : now / 1000,
      hair: this.hair(),
      zoom: this.cameraScale,
    });
    this.pathDrawn = true;
  }

  /**
   * The polyline of `route` (nodes) from the ring of its first city to the ring of its last; a
   * way that `joins` another there stops as far from that ring as a way starts from its own.
   */
  private routePoints(route: readonly number[], joins = false): Point[] {
    const points: Point[] = [];
    for (const id of route) {
      const at = nodePoint(this.map, id);
      if (at === undefined) return [];
      points.push(at);
    }
    const first = route[0];
    const last = route[route.length - 1];
    if (first === undefined || last === undefined || points.length < 2) return [];
    return trimPath(
      points,
      ringRadius(this.radius(first)) + CASED.startGap,
      ringRadius(this.radius(last)) + (joins ? CASED.startGap : CASED.endGap),
    );
  }

  destroy(): void {
    this.destroyed = true;
    // The glyph texture belongs to the Assets cache: only the sprite goes.
    this.etaGlyph.texture = Texture.EMPTY;
    this.eta.destroy({ children: true });
    this.bonus.destroy({ children: true });
    this.bonusStyle.destroy();
    this.path.destroy();
    this.etaStyle.destroy();
    this.lines.destroy();
    this.ghosts.destroy();
    this.ring.destroy();
    this.hoverFrame.destroy();
    this.frame.destroy();
    this.pickLayer.destroy({ children: true });
    this.sealStyle.destroy();
    this.boxShape.destroy();
    this.groupLines.destroy();
  }

  /**
   * The city highlights (Fine rings, ui-style 55p, #847): a reachable target, one that needs a split
   * first, the hovered city and the selected one, each its own stroke round the capacity ring.
   */
  private drawRing(state: OverlayState): void {
    const g = this.ring;
    g.clear();
    this.drawReach(g, state);
    // A hovered city gets no ring of its own (owner 2026-11-10, #928): the light on its area
    // (`setHover`, #762) and the arrow of the order a click would give say enough.
    const selected = state.selection;
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

  private drawLines(state: OverlayState): void {
    const g = this.lines;
    g.clear();
    // The path on hover (54i) is the shadow of the order a click would make, ordinary or planned
    // (#793): the server's route to the hovered target (`ReachNode.path`), drawn by `drawPath`; to a
    // target only the part that fits reaches, the route of that part (`ReachSplit.path`, #1004).
    const route = state.eta?.path ?? state.preview?.path ?? [];
    const key = route.join('>');
    if (key !== this.pathKey) {
      this.pathKey = key;
      this.pathPoints = this.routePoints(route);
      this.pathSince = Number.NaN;
    }
  }

  private radius(node: number): number {
    return this.radiusOf(node);
  }

  /**
   * The ghosts of sent orders (54h): an ordinary one is the hollow Cased arrow along the server's
   * route until the snapshot shows the order (its arrow is then the picture), a planned one the
   * outline of its ribbon; a refused one shakes and fades, a refusal for CP is the red arrow, crossed.
   */
  private drawGhosts(state: OverlayState, now: number): void {
    this.ghosts.clear();
    for (const ghost of state.ghosts) this.drawGhost(this.ghosts, ghost, now);
    this.ghostsDrawn = state.ghosts.length > 0;
  }

  private drawGhost(g: Graphics, ghost: GhostArrow, now: number): void {
    const status = ghost.status ?? 'pending';
    // The cut-off arrow (#762): a move the CP did not pay for, red and crossed out, longer.
    const cut = status === 'rejected' && ghost.rejectCode === CP_REJECT;
    const base = cut ? GHOST_CP.alpha : status === 'rejected' ? REFUSED.alpha : ORDER_GHOST_ALPHA;
    const reduced = reducedMotion();
    const look = ghostLook(
      status,
      ghost.rejectedAt == null ? 0 : now - ghost.rejectedAt,
      base,
      reduced,
      ghost.rejectCode ?? null,
    );
    if (look.alpha <= 0) return;
    const route = ghost.path ?? [ghost.from, ghost.dest];
    if (ghost.planned && status !== 'rejected') {
      this.drawRibbonGhost(g, ghost.from, ghost.dest, route, look.alpha);
      return;
    }
    const points = this.routePoints(route).map((p) => ({ x: p.x + look.dx, y: p.y }));
    if (points.length < 2) return;
    drawCasedArrow(g, points, {
      color: cut ? GHOST_CP.color : this.own,
      ghost: !cut,
      alpha: look.alpha,
      seconds: reduced || status === 'rejected' ? null : now / 1000,
      hair: this.hair(),
      zoom: this.cameraScale,
    });
    if (cut) this.drawCross(g, points, look.alpha);
  }

  /** The ghost of a planned order before the snapshot shows its ribbon: the outline alone. */
  private drawRibbonGhost(
    g: Graphics,
    from: number,
    dest: number,
    route: readonly number[],
    alpha: number,
  ): void {
    const origin = nodePoint(this.map, from);
    const target = nodePoint(this.map, dest);
    if (origin === undefined || target === undefined) return;
    const via = route
      .filter((id) => id !== from && id !== dest)
      .map((id) => nodePoint(this.map, id))
      .filter((p): p is Point => p !== undefined);
    const shape = ribbonShape(
      origin,
      target,
      via,
      tailStart(origin, target, this.radius(from)),
      ringRadius(this.radius(dest)) + CASED.endGap,
      this.cameraScale,
    );
    if (shape === null) return;
    const poly = shape.ribbon.outline.flatMap((p) => [p.x, p.y]);
    const G = RIBBON_ENGRAVED.ghost;
    g.poly(poly).fill({ color: this.own, alpha: G.fill * alpha });
    g.poly(poly).stroke({ width: G.casing, color: CASING, alpha, join: 'round' });
    g.poly(poly).stroke({ width: Math.max(G.ink, this.hair()), color: INK, alpha, join: 'round' });
  }

  /** The cross of a refusal for CP: a dark lozenge with an ink X, `REFUSED.at` along the arrow. */
  private drawCross(g: Graphics, points: readonly Point[], alpha: number): void {
    const { at } = pointAlong(points, pathLength(points) * REFUSED.at);
    const h = REFUSED.half * Math.SQRT2;
    const lozenge = [at.x, at.y - h, at.x + h, at.y, at.x, at.y + h, at.x - h, at.y];
    g.poly(lozenge)
      .fill({ color: DARK_PLATE, alpha })
      .stroke({ width: Math.max(REFUSED.ink, this.hair()), color: INK, alpha, join: 'miter' });
    const r = REFUSED.cross;
    g.moveTo(at.x - r, at.y - r).lineTo(at.x + r, at.y + r);
    g.moveTo(at.x + r, at.y - r).lineTo(at.x - r, at.y + r);
    g.stroke({ width: REFUSED.crossWidth, color: INK, alpha, cap: 'round' });
  }
}
