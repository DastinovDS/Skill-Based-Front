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
import { dashSegments, edgeEnds, triangleHeight, triangleSide } from './layout.ts';
import {
  ageLabel,
  ghostAlpha,
  borderPoint,
  halfMarkerPoint,
  nodeMarkerPoint,
  sameVeil,
  veilCities,
  veilPolygon,
} from './fogLayout.ts';
import { knownOfSeen } from './rangeLabel.ts';
import { symbolScale } from './camera.ts';
import type { MapLayers } from './layers.ts';
import { Token, type EntityKit } from './shapes.ts';
import {
  FOG_VEIL,
  GHOST_AGE_FONT_SIZE,
  GHOST_AGE_STROKE,
  GLYPH_COLOR,
  GHOST_HIDE_S,
  ENEMY,
} from './style.ts';

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
 * of a road in fog has dotted lanes (`MapView`), a road never seen included (its level is the 1
 * of DEC-17, not a known one): it has no mark of its own (the "?" was removed, #348). It puts a "last seen" ghost on a hidden
 * place when the snapshot still carries a `Seen` with enemy groups in it: the enemy token, faded,
 * with its age as `-m:ss`. A place that is seen again loses its veil and its ghost on the next
 * snapshot. Nothing is inferred: no ghost without a `Seen`, no numbers the `Seen` has not got.
 *
 * Redrawn once per snapshot (`update` does nothing when `base` is the same object). `destroy()`
 * releases everything.
 */
export class FogView {
  /** The veil: the hidden cells filled; blurred and cached through `veilCache`. */
  private readonly veil = new Graphics({ label: 'fog-veil-cells' });
  private readonly blur = new BlurFilter({
    strength: FOG_VEIL.blur,
    quality: FOG_VEIL.blurQuality,
    resolution: FOG_VEIL.blurResolution,
    // The filter runs inside the cache texture, which is the size of the world. By default Pixi
    // cuts a filter area to the canvas (the root viewport), so on a screen smaller than the
    // world (a 1920x1080 window at devicePixelRatio 1) the veil would stop at the canvas size
    // (#441). The cache texture is the area that matters here.
    clipToViewport: false,
  });
  /** The blur is a filter of this container, INSIDE the cached one: it runs only when the cache is built. */
  private readonly veilBlur = new Container({ label: 'fog-veil-blur' });
  /** The map edge cuts the veil (and what the blur spreads past it). */
  private readonly veilMask = new Graphics({ label: 'fog-veil-mask' });
  private readonly veilClip = new Container({ label: 'fog-veil-clip' });
  private readonly veilCache = new Container({ label: 'fog-veil', visible: false });
  private hiddenCities: number[] = [];
  private readonly nodeGhosts: (Ghost | null)[];
  /** The memory of a half of a road in fog, by `edge * 2 + half`. */
  private readonly halfGhosts: (Ghost | null)[];
  private readonly shadeLayer = new Container({ label: 'fog-shades' });
  private readonly ghostLayer = new Container({ label: 'fog-ghosts' });
  /** The dashed tick across the road on the border point of a half whose memory is drawn (#354, leaving the haze). */
  private readonly halfTicks = new Graphics({ label: 'fog-half-ticks' });
  private tickMarks: { edge: number; alpha: number }[] = [];
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
    this.shadeLayer.addChild(this.veilCache);
    this.nodeGhosts = map.nodes.map(() => null);
    this.halfGhosts = map.edges.flatMap(() => [null, null]);
    layers.layer.fog.addChild(this.shadeLayer, this.halfTicks, this.ghostLayer);
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
    this.tickMarks = [];
    for (const edge of edges) this.setEdge(edge, base.tick);
    this.drawHalfTicks();
  }

  /**
   * Where a figure left the vision zone the memory of the half stays at the border point; a dashed
   * tick across the road there (the entry tick of `FigureView`, dashed: not seen now) says it is the
   * point it went out at.
   */
  private drawHalfTicks(): void {
    const g = this.halfTicks.clear();
    for (const { edge, alpha } of this.tickMarks) {
      const at = borderPoint(this.map, edge);
      const ends = edgeEnds(this.map, edge);
      if (at === undefined || ends === undefined) continue;
      const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
      if (length === 0) continue;
      const nx = (-(ends.b.y - ends.a.y) / length) * 12;
      const ny = ((ends.b.x - ends.a.x) / length) * 12;
      for (const [from, to] of dashSegments(
        { x: at.x - nx, y: at.y - ny },
        { x: at.x + nx, y: at.y + ny },
        3,
        3,
      )) {
        g.moveTo(from.x, from.y).lineTo(to.x, to.y);
      }
      g.stroke({ width: 3, color: ENEMY, alpha, cap: 'round' });
    }
  }

  destroy(): void {
    this.shadeLayer.destroy({ children: true });
    this.blur.destroy();
    this.halfTicks.destroy();
    this.ghostLayer.destroy({ children: true });
    this.ageStyle.destroy();
  }

  // --- Shapes -------------------------------------------------------------------------------

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
   * One road: the memory of each half in fog (DEC-21, item 8; DEC-33, detail 8: no position, a ghost at the border point with
   * its age). The half in fog itself is drawn by `MapView` (dotted lanes), by the half's own
   * `detail`, not the road's.
   */
  private setEdge(edge: EdgeView, tick: number): void {
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
    const seconds = this.tickHz > 0 ? (tick - memory.tick) / this.tickHz : 0;
    const alpha = ghostAlpha(seconds);
    if (alpha > 0) this.tickMarks.push({ edge: edge.id, alpha });
  }
}
