import { BlurFilter, Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Point } from './camera.ts';
import type {
  EdgeView,
  HalfView,
  MapFile,
  NodeView,
  PlayerId,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { edgeEnds, triangleHeight, triangleSide } from './layout.ts';
import { neverSeen } from './roadLayout.ts';
import {
  ageLabel,
  borderPoint,
  ghostAlpha,
  halfMarkerPoint,
  nodeMarkerPoint,
  sameVeil,
  veilCities,
  veilFrontier,
  veilPolygon,
} from './fogLayout.ts';
import { knownOfSeen } from './rangeLabel.ts';
import { symbolScale } from './camera.ts';
import type { MapLayers } from './layers.ts';
import { Token, type EntityKit } from './shapes.ts';
import {
  FOG_FRONT,
  FOG_VEIL,
  GHOST_AGE_FONT_SIZE,
  GHOST_AGE_STROKE,
  BORDER_MARK,
  GLYPH_COLOR,
  GHOST_HIDE_S,
  ROAD_UNKNOWN,
  roadSpan,
} from './style.ts';

/** The dashes of the rim of a "?" mark, and the angles of the points of its hook (radians, y down). */
const RIM_DASHES = 8;
const HOOK_ANGLES = [0.95, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5].map((n) => Math.PI * n);

/** Where a snapshot says an enemy was last seen in a place that is hidden now. */
type Memory = NodeView['seen'];

/** A marker of what was last seen in a hidden place: a faded dashed enemy triangle and its age. */
class Ghost {
  readonly view = new Container({ visible: false });
  readonly token: Token;
  readonly age: Text;
  private shown = '';

  constructor(kit: EntityKit, style: TextStyle, resolution: number) {
    this.token = new Token(kit, resolution);
    this.age = new Text({ text: '', style, anchor: { x: 0.5, y: 1 }, resolution });
    this.view.addChild(this.token.view, this.age);
  }

  labels(): Text[] {
    return [...this.token.labels(), this.age];
  }

  hide(): void {
    this.view.visible = false;
  }

  /** Sets the symbol scale (the minimum size on screen) and keeps the age above the triangle. */
  setScale(scale: number): void {
    this.token.setScale(scale);
    this.age.position.set(0, (-triangleHeight(this.token.side) / 2 - 3) * scale);
  }

  show(
    memory: NonNullable<Memory>,
    enemy: PlayerId,
    seconds: number,
    age: string,
    at: Point,
    cameraScale: number,
  ): void {
    const alpha = ghostAlpha(seconds);
    if (alpha <= 0) {
      this.hide();
      return;
    }
    const { counts, range } = knownOfSeen(memory);
    this.token.set({ owner: enemy, modes: memory.enemy_modes, counts, range, ghost: true });
    this.token.setLabel(true);
    this.setScale(symbolScale(this.token.side, cameraScale));
    this.view.alpha = alpha;
    if (age !== this.shown) {
      this.shown = age;
      this.age.text = age;
    }
    this.view.position.set(at.x, at.y);
    this.view.visible = true;
  }
}

/**
 * The fog layer (CLI-05, #61; the haze F1, #346): what the snapshot says is hidden, drawn as hidden.
 *
 * The server decides visibility: a node or an edge with `detail: 'fog'` is hidden, anything else
 * is (at least partly) seen. The client lays a cool grey veil over the Voronoi cell of every hidden
 * city: the cells are filled in one Graphics, blurred by one `BlurFilter` and cached as a texture
 * (`cacheAsTexture`), so a frame draws one sprite; the cache is rebuilt only when the SET of hidden
 * cities changes (a snapshot with the same set costs nothing). The veil darkens what lies under the
 * fog layer: the terrain, the roads and the cities; the intents lie above it (`LAYER_ORDER`). The half
 * of a road in fog has dotted lanes (`MapView`), and a road never seen carries a "?" at its border
 * point (its level is the 1 of DEC-17, not a known one). It puts a "last seen" ghost on a hidden
 * place when the snapshot still carries a `Seen` with enemy groups in it: the enemy token, faded,
 * with its age as `-m:ss`. A place that is seen again loses its veil and its ghost on the next
 * snapshot. Nothing is inferred: no ghost without a `Seen`, no numbers the `Seen` has not got.
 *
 * Redrawn once per snapshot (`update` does nothing when `base` is the same object); the "?" of the
 * roads never seen are one Graphics. `destroy()` releases everything.
 */
export class FogView {
  /** The veil: the hidden cells filled; blurred and cached through `veilCache`. */
  private readonly veil = new Graphics({ label: 'fog-veil-cells' });
  private readonly blur = new BlurFilter({
    strength: FOG_VEIL.blur,
    quality: FOG_VEIL.blurQuality,
    resolution: FOG_VEIL.blurResolution,
  });
  /** The blur is a filter of this container, INSIDE the cached one: it runs only when the cache is built. */
  private readonly veilBlur = new Container({ label: 'fog-veil-blur' });
  /** The map edge cuts the veil (and what the blur spreads past it). */
  private readonly veilMask = new Graphics({ label: 'fog-veil-mask' });
  private readonly veilClip = new Container({ label: 'fog-veil-clip' });
  private readonly veilCache = new Container({ label: 'fog-veil', visible: false });
  /** A thin light line along the front of the haze (drawn with the veil, not blurred). */
  private readonly front = new Graphics({ label: 'fog-front' });
  private hiddenCities: number[] = [];
  /**
   * The "?" of the roads that were never seen: one Graphics for all of them (a Container with a
   * Graphics and a Text per road was the cost of a tenth of the frame in the software renderer),
   * redrawn when the set of the roads or the zoom changes.
   */
  private readonly unknownMarks = Object.assign(new Graphics(), { label: 'fog-unknown-roads' });
  private unknownRoads: Point[] = [];
  private unknownKey = '';
  private readonly nodeGhosts: (Ghost | null)[];
  /** The memory of a half of a road in fog, by `edge * 2 + half`. */
  private readonly halfGhosts: (Ghost | null)[];
  /** A tick across every road at its border point (DEC-21, item 5). */
  private readonly borders = new Graphics();
  private readonly shadeLayer = new Container({ label: 'fog-shades' });
  private readonly ghostLayer = new Container({ label: 'fog-ghosts' });
  private readonly ageStyle: TextStyle;
  private readonly enemy: PlayerId;
  private base: SnapshotMsg | null = null;
  private cameraScale = 1;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    me: PlayerId,
    private readonly kit: EntityKit,
    private labelResolution: number,
    private tickHz: number,
    /** The Voronoi cells of the cities (`MapView.cells`). */
    private readonly cells: readonly (readonly Point[])[],
    /** Radius of a city now (`CityView.radiusOf`). */
    private readonly radiusOf: (node: number) => number,
  ) {
    this.enemy = me === 0 ? 1 : 0;
    this.ageStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: GHOST_AGE_FONT_SIZE,
      fontWeight: '700',
      fill: GLYPH_COLOR,
      stroke: GHOST_AGE_STROKE,
    });
    this.veilMask.rect(0, 0, map.meta.width, map.meta.height).fill(0xffffff);
    this.veilBlur.filters = [this.blur];
    this.veilBlur.addChild(this.veil);
    this.veilClip.addChild(this.veilBlur, this.veilMask);
    this.veilClip.mask = this.veilMask;
    this.veilCache.addChild(this.veilClip);
    this.veilCache.cacheAsTexture({ resolution: 1, antialias: true });
    this.shadeLayer.addChild(this.veilCache, this.front);
    this.nodeGhosts = map.nodes.map(() => null);
    this.halfGhosts = map.edges.flatMap(() => [null, null]);
    layers.layer.fog.addChild(this.shadeLayer, this.borders, this.unknownMarks, this.ghostLayer);
  }

  /** Ticks per second, for the age of a memory; set when the ruleset is known. */
  setTickHz(tickHz: number): void {
    if (tickHz === this.tickHz) return;
    this.tickHz = tickHz;
    // The next update rebuilds the ages.
    this.base = null;
  }

  /** Camera scale for the minimum size of the ghosts on screen; they are redrawn at once. */
  setCameraScale(scale: number): void {
    if (scale === this.cameraScale) return;
    this.cameraScale = scale;
    for (const ghost of [...this.nodeGhosts, ...this.halfGhosts]) {
      if (ghost !== null && ghost.view.visible) {
        ghost.setScale(symbolScale(ghost.token.side, scale));
      }
    }
    this.drawUnknown();
  }

  /** The "?" of a road never seen keeps the minimum size of a symbol on screen (ui-style 22). */
  private markScale(): number {
    return symbolScale(2 * ROAD_UNKNOWN.radius, this.cameraScale);
  }

  setLabelResolution(resolution: number): void {
    this.labelResolution = resolution;
    for (const ghost of [...this.nodeGhosts, ...this.halfGhosts]) {
      if (ghost === null) continue;
      for (const text of ghost.labels()) {
        if (text.resolution !== resolution) text.resolution = resolution;
      }
    }
  }

  /** Redraws the fog when `base` is a snapshot not drawn yet; otherwise does nothing. */
  update(base: SnapshotMsg): void {
    if (base === this.base) return;
    this.base = base;
    const { nodes, edges } = base.view;
    this.setRegions(nodes);
    for (const node of nodes) this.setNode(node, base.tick);
    this.borders.clear();
    this.unknownRoads = [];
    for (const edge of edges) this.setEdge(edge, base.tick);
    this.drawUnknown();
    this.borders.stroke({
      width: BORDER_MARK.width,
      color: BORDER_MARK.color,
      alpha: BORDER_MARK.alpha,
    });
  }

  destroy(): void {
    this.borders.destroy();
    this.shadeLayer.destroy({ children: true });
    this.blur.destroy();
    this.unknownMarks.destroy();
    this.ghostLayer.destroy({ children: true });
    this.ageStyle.destroy();
  }

  // --- Shapes -------------------------------------------------------------------------------

  /** Collects the border point of a road that was never seen; hidden once it has been (`drawUnknown`). */
  private setUnknown(edge: EdgeView): void {
    const at = neverSeen(edge) ? borderPoint(this.map, edge.id) : undefined;
    if (at !== undefined) this.unknownRoads.push(at);
  }

  /**
   * The "?" of every road never seen, at its border point: a dark disc with a dashed rim (what is
   * not known is dashed, ui-style 21) and a question mark of strokes, not text: this is one
   * Graphics for all of them. Not mended when nothing changed.
   */
  private drawUnknown(): void {
    const k = this.markScale();
    const key = `${String(k)}|${this.unknownRoads.map((p) => `${String(p.x)},${String(p.y)}`).join(';')}`;
    if (key === this.unknownKey) return;
    this.unknownKey = key;
    const g = this.unknownMarks.clear();
    const { radius, fill, stroke, dash } = ROAD_UNKNOWN;
    const r = radius * k;
    for (const at of this.unknownRoads) g.circle(at.x, at.y, r);
    g.fill(fill);
    // The rim and the hook are polylines of a few straight pieces: arcs would cost hundreds of
    // vertices a disc, and there are a disc for every road never seen.
    for (const at of this.unknownRoads) {
      for (let i = 0; i < RIM_DASHES; i++) {
        const from = (2 * Math.PI * i) / RIM_DASHES;
        const to = from + ((2 * Math.PI) / RIM_DASHES) * dash;
        g.moveTo(at.x + r * Math.cos(from), at.y + r * Math.sin(from));
        g.lineTo(at.x + r * Math.cos(to), at.y + r * Math.sin(to));
      }
    }
    g.stroke({ ...stroke, width: stroke.width * k });
    // The question mark: a hook over a stem, and a dot.
    const { glyph } = ROAD_UNKNOWN;
    for (const at of this.unknownRoads) {
      const top = at.y - glyph.up * k;
      HOOK_ANGLES.forEach((angle, i) => {
        const x = at.x + glyph.hook * k * Math.cos(angle);
        const y = top + glyph.hook * k * Math.sin(angle);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.lineTo(at.x, at.y + glyph.stem * k);
    }
    g.stroke({ width: glyph.width * k, color: GLYPH_COLOR, join: 'round' });
    for (const at of this.unknownRoads) {
      g.rect(
        at.x - glyph.dotRadius * k,
        at.y + (glyph.dot - glyph.dotRadius) * k,
        2 * glyph.dotRadius * k,
        2 * glyph.dotRadius * k,
      );
    }
    g.fill(GLYPH_COLOR);
  }

  /**
   * The veil over the cells of the hidden cities. Redrawn (and the cache rebuilt) only when the set
   * of hidden cities changes; with none hidden the veil is not drawn at all.
   */
  private setRegions(nodes: readonly NodeView[]): void {
    const hidden = veilCities(nodes);
    if (sameVeil(hidden, this.hiddenCities)) return;
    this.hiddenCities = hidden;
    const veil = this.veil.clear();
    const bounds = { width: this.map.meta.width, height: this.map.meta.height };
    let drawn = 0;
    for (const id of hidden) {
      const cell = this.cells[id];
      if (cell === undefined) continue;
      veil.poly(veilPolygon(cell, bounds, FOG_VEIL.margin));
      drawn++;
    }
    veil.fill({ color: FOG_VEIL.color, alpha: FOG_VEIL.alpha });
    this.veilCache.visible = drawn > 0;
    this.veilCache.updateCacheTexture();
    const front = this.front.clear();
    const lines = veilFrontier(this.cells, hidden);
    for (const { a, b } of lines) front.moveTo(a.x, a.y).lineTo(b.x, b.y);
    if (lines.length > 0) front.stroke(FOG_FRONT);
  }

  // --- Snapshot-driven part -----------------------------------------------------------------

  private ghost(list: (Ghost | null)[], id: number): Ghost {
    const existing = list[id];
    if (existing !== undefined && existing !== null) return existing;
    const ghost = new Ghost(this.kit, this.ageStyle, this.labelResolution);
    list[id] = ghost;
    this.ghostLayer.addChild(ghost.view);
    return ghost;
  }

  private showGhost(
    list: (Ghost | null)[],
    id: number,
    memory: NonNullable<Memory>,
    tick: number,
    at: Point,
  ): void {
    const ago = tick - memory.tick;
    const seconds = this.tickHz > 0 ? ago / this.tickHz : 0;
    // After `GHOST_HIDE_S` the memory is no longer drawn (the `PlayerView` still carries it).
    if (seconds >= GHOST_HIDE_S) {
      list[id]?.hide();
      return;
    }
    this.ghost(list, id).show(
      memory,
      this.enemy,
      seconds,
      ageLabel(ago, this.tickHz),
      at,
      this.cameraScale,
    );
  }

  /** A ghost needs a hidden place and a memory of enemies in it. */
  private remembered(hidden: boolean, seen: Memory): NonNullable<Memory> | null {
    return hidden && seen !== null && seen.enemy_modes.length > 0 ? seen : null;
  }

  private setNode(node: NodeView, tick: number): void {
    const hidden = node.detail === 'fog';
    const memory = this.remembered(hidden, node.seen);
    const existing = this.nodeGhosts[node.id] ?? null;
    if (memory === null) {
      existing?.hide();
      return;
    }
    const side = triangleSide(
      memory.level === 'exact' && memory.enemy_units !== null ? memory.enemy_units : null,
    );
    const at = nodeMarkerPoint(this.map, node.id, side, this.radiusOf(node.id));
    if (at === undefined) return;
    this.showGhost(this.nodeGhosts, node.id, memory, tick, at);
  }

  /**
   * One road: the tick at the border point, the "?" of a road never seen, and the memory of each
   * half in fog (DEC-21, item 8; DEC-33, detail 8: no position, a ghost at the border point with
   * its age). The half in fog itself is drawn by `MapView` (dotted lanes), by the half's own
   * `detail`, not the road's.
   */
  private setEdge(edge: EdgeView, tick: number): void {
    const border = borderPoint(this.map, edge.id);
    const ends = edgeEnds(this.map, edge.id);
    if (border !== undefined && ends !== undefined) {
      const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
      if (length > 0) {
        const reach = roadSpan(edge.width) / 2 + BORDER_MARK.overhang;
        const nx = (-(ends.b.y - ends.a.y) / length) * reach;
        const ny = ((ends.b.x - ends.a.x) / length) * reach;
        this.borders.moveTo(border.x - nx, border.y - ny).lineTo(border.x + nx, border.y + ny);
      }
    }
    this.setUnknown(edge);
    edge.halves.forEach((half, i) => {
      const side = i === 0 ? 0 : 1;
      this.setHalf(edge, half, side, tick);
    });
  }

  private setHalf(edge: EdgeView, half: HalfView, side: 0 | 1, tick: number): void {
    const hidden = half.detail === 'fog';
    const memory = this.remembered(hidden, half.seen);
    const existing = this.halfGhosts[edge.id * 2 + side] ?? null;
    const at = halfMarkerPoint(this.map, edge.id, side);
    if (memory === null || at === undefined) {
      existing?.hide();
      return;
    }
    this.showGhost(this.halfGhosts, edge.id * 2 + side, memory, tick, at);
  }
}
