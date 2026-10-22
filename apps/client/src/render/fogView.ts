import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import { fogHatching } from './regionLayout.ts';
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
import {
  ageLabel,
  BORDER_PERMILLE,
  borderPoint,
  ghostAlpha,
  halfMarkerPoint,
  nodeMarkerPoint,
} from './fogLayout.ts';
import { knownOfSeen } from './rangeLabel.ts';
import { symbolScale } from './camera.ts';
import type { MapLayers } from './layers.ts';
import { Token, type EntityKit } from './shapes.ts';
import {
  FOG_ALPHA,
  FOG_COLOR,
  FOG_HATCH,
  FOG_BAND_WIDTH,
  FOG_HATCH_SPACING,
  FOG_ROAD_ALPHA,
  GHOST_AGE_FONT_SIZE,
  GHOST_AGE_STROKE,
  BORDER_MARK,
  GLYPH_COLOR,
  GHOST_HIDE_S,
  roadThickness,
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
 * The fog layer (CLI-05, #61): what the snapshot says is hidden, drawn as hidden.
 *
 * The server decides visibility: a node or an edge with `detail: 'fog'` is hidden, anything else
 * is (at least partly) seen. The client darkens the Voronoi cell of a hidden city (softly, 9.8)
 * and hatches a band along the border of what is seen, so the border reads without colour; a
 * hidden road is shaded dark (still a solid line). It puts a "last seen" ghost on a hidden place when the snapshot
 * still carries a `Seen` with enemy groups in it: the enemy token, faded, with its age as
 * `-m:ss`. A place that is seen again loses its shade and its ghost on the next snapshot.
 * Nothing is inferred: no ghost without a `Seen`, no numbers the `Seen` has not got.
 *
 * Redrawn once per snapshot (`update` does nothing when `base` is the same object). Shades reuse
 * a few GraphicsContexts (one per city size, one for the road shade); `destroy()` releases them.
 */
export class FogView {
  private readonly contexts: GraphicsContext[] = [];
  private edgeShadeContext: GraphicsContext | null = null;
  private readonly regions = new Graphics();
  private readonly hatching = new Graphics();
  private hiddenKey = '';
  /** The shade of the half of a road that is in fog, by `edge * 2 + half`. */
  private readonly halfShades: (Graphics | null)[];
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
    this.shadeLayer.addChild(this.regions, this.hatching);
    this.halfShades = map.edges.flatMap(() => [null, null]);
    this.nodeGhosts = map.nodes.map(() => null);
    this.halfGhosts = map.edges.flatMap(() => [null, null]);
    layers.layer.fog.addChild(this.shadeLayer, this.borders, this.ghostLayer);
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
    this.borders.clear();
    for (const edge of edges) this.setEdge(edge, base.tick);
    this.borders.stroke({
      width: BORDER_MARK.width,
      color: BORDER_MARK.color,
      alpha: BORDER_MARK.alpha,
    });
  }

  destroy(): void {
    // Shades use shared contexts (Graphics leaves those alone); containers go first, then the
    // contexts and the style.
    this.regions.destroy();
    this.hatching.destroy();
    this.borders.destroy();
    this.shadeLayer.destroy({ children: true });
    this.ghostLayer.destroy({ children: true });
    for (const context of this.contexts) context.destroy();
    this.ageStyle.destroy();
  }

  // --- Shapes -------------------------------------------------------------------------------

  private context(draw: (g: GraphicsContext) => GraphicsContext): GraphicsContext {
    const context = draw(new GraphicsContext());
    this.contexts.push(context);
    return context;
  }

  /** A dark solid line along +x on a road of `length`, a unit high; the road scales it to its width. */
  private edgeContext(): GraphicsContext {
    this.edgeShadeContext ??= this.context((g) =>
      g.rect(0, -0.5, 1, 1).fill({ color: FOG_COLOR, alpha: FOG_ROAD_ALPHA }),
    );
    return this.edgeShadeContext;
  }

  /**
   * The shade of one half of a road: from the end `a` to the border point (half 0) or from there
   * to the end `b` (half 1).
   */
  private halfShade(id: number, half: 0 | 1): Graphics | null {
    const index = id * 2 + half;
    const existing = this.halfShades[index];
    if (existing !== undefined && existing !== null) return existing;
    const ends = edgeEnds(this.map, id);
    if (ends === undefined) return null;
    const { a, b } = ends;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const split = BORDER_PERMILLE / 1000;
    const shade = new Graphics(this.edgeContext());
    const start = half === 0 ? a : { x: a.x + (b.x - a.x) * split, y: a.y + (b.y - a.y) * split };
    shade.position.set(start.x, start.y);
    shade.rotation = Math.atan2(b.y - a.y, b.x - a.x);
    shade.scale.x = length * (half === 0 ? split : 1 - split);
    this.halfShades[index] = this.shadeLayer.addChild(shade);
    return shade;
  }

  /** Darken the cells of hidden cities and hatch the band along the border of the seen area. */
  private setRegions(nodes: readonly NodeView[]): void {
    const hidden = nodes.map((node) => node.detail === 'fog');
    const key = hidden.map((h) => (h ? '1' : '0')).join('');
    if (key === this.hiddenKey) return;
    this.hiddenKey = key;
    const regions = this.regions.clear();
    hidden.forEach((isHidden, i) => {
      const cell = this.cells[i];
      if (isHidden && cell !== undefined) regions.poly([...cell]);
    });
    regions.fill({ color: FOG_COLOR, alpha: FOG_ALPHA });
    const hatching = this.hatching.clear();
    for (const { a, b } of fogHatching(this.cells, hidden, FOG_BAND_WIDTH, FOG_HATCH_SPACING)) {
      hatching.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    hatching.stroke(FOG_HATCH);
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
   * One road: a shade on each half in fog (by the half's own `detail`, not the road's), the tick at
   * the border point, and the memory of each half in fog (DEC-21, item 8; DEC-33, detail 8: no
   * position, a ghost at the border point with its age).
   */
  private setEdge(edge: EdgeView, tick: number): void {
    const border = borderPoint(this.map, edge.id);
    const ends = edgeEnds(this.map, edge.id);
    if (border !== undefined && ends !== undefined) {
      const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
      if (length > 0) {
        const reach = roadThickness(edge.width) / 2 + BORDER_MARK.overhang;
        const nx = (-(ends.b.y - ends.a.y) / length) * reach;
        const ny = ((ends.b.x - ends.a.x) / length) * reach;
        this.borders.moveTo(border.x - nx, border.y - ny).lineTo(border.x + nx, border.y + ny);
      }
    }
    edge.halves.forEach((half, i) => {
      const side = i === 0 ? 0 : 1;
      this.setHalf(edge, half, side, tick);
    });
  }

  private setHalf(edge: EdgeView, half: HalfView, side: 0 | 1, tick: number): void {
    const hidden = half.detail === 'fog';
    if (hidden) {
      const shade = this.halfShade(edge.id, side);
      if (shade !== null) {
        shade.visible = true;
        shade.scale.y = roadThickness(edge.width);
      }
    } else {
      const shade = this.halfShades[edge.id * 2 + side];
      if (shade !== undefined && shade !== null) shade.visible = false;
    }
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
