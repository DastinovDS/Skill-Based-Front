import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import { fogHatching } from './regionLayout.ts';
import type { Point } from './camera.ts';
import type { EdgeView, MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import { edgeEnds, triangleHeight, triangleSide } from './layout.ts';
import { ageLabel, edgeMarkerPoint, fogDashes, ghostAlpha, nodeMarkerPoint } from './fogLayout.ts';
import { symbolScale } from './camera.ts';
import type { MapLayers } from './layers.ts';
import { Token, type EntityKit } from './shapes.ts';
import {
  FOG_ALPHA,
  FOG_COLOR,
  FOG_DASH,
  FOG_GAP,
  FOG_HATCH,
  FOG_BAND_WIDTH,
  FOG_HATCH_SPACING,
  FOG_ROAD_ALPHA,
  FOG_ROAD_EXTRA,
  GHOST_AGE_FONT_SIZE,
  GHOST_AGE_STROKE,
  GLYPH_COLOR,
  GHOST_HIDE_S,
  ROAD_CASING_EXTRA,
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
    const exact =
      memory.level === 'exact' && memory.enemy_units !== null && memory.enemy_charged !== null;
    this.token.set({
      owner: enemy,
      modes: memory.enemy_modes,
      counts: exact ? { units: memory.enemy_units ?? 0, charged: memory.enemy_charged ?? 0 } : null,
      ghost: true,
    });
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
 * hidden road also gets dark dashes. It puts a "last seen" ghost on a hidden place when the snapshot
 * still carries a `Seen` with enemy groups in it: the enemy token, faded, with its age as
 * `-m:ss`. A place that is seen again loses its shade and its ghost on the next snapshot.
 * Nothing is inferred: no ghost without a `Seen`, no numbers the `Seen` has not got.
 *
 * Redrawn once per snapshot (`update` does nothing when `base` is the same object). Shades reuse
 * a few GraphicsContexts (one per city size, one per road length); `destroy()` releases them.
 */
export class FogView {
  private readonly contexts: GraphicsContext[] = [];
  private readonly edgeContexts = new Map<number, GraphicsContext>();
  private readonly regions = new Graphics();
  private readonly hatching = new Graphics();
  private hiddenKey = '';
  private readonly edgeShades: (Graphics | null)[];
  private readonly nodeGhosts: (Ghost | null)[];
  private readonly edgeGhosts: (Ghost | null)[];
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
    this.edgeShades = map.edges.map(() => null);
    this.nodeGhosts = map.nodes.map(() => null);
    this.edgeGhosts = map.edges.map(() => null);
    layers.layer.fog.addChild(this.shadeLayer, this.ghostLayer);
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
    for (const ghost of [...this.nodeGhosts, ...this.edgeGhosts]) {
      if (ghost !== null && ghost.view.visible) {
        ghost.setScale(symbolScale(ghost.token.side, scale));
      }
    }
  }

  setLabelResolution(resolution: number): void {
    this.labelResolution = resolution;
    for (const ghost of [...this.nodeGhosts, ...this.edgeGhosts]) {
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
    for (const edge of edges) this.setEdge(edge, base.tick);
  }

  destroy(): void {
    // Shades use shared contexts (Graphics leaves those alone); containers go first, then the
    // contexts and the style.
    this.regions.destroy();
    this.hatching.destroy();
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

  /** Dark dashes along +x on a road of `length`, a unit high; the road scales it to its width. */
  private edgeContext(length: number): GraphicsContext {
    const key = Math.round(length);
    let context = this.edgeContexts.get(key);
    if (context === undefined) {
      context = this.context((g) => {
        for (const [from, to] of fogDashes(key, FOG_DASH, FOG_GAP)) {
          g.rect(from, -0.5, to - from, 1);
        }
        return g.fill({ color: FOG_COLOR, alpha: FOG_ROAD_ALPHA });
      });
      this.edgeContexts.set(key, context);
    }
    return context;
  }

  private edgeShade(id: number): Graphics | null {
    const existing = this.edgeShades[id];
    if (existing !== undefined && existing !== null) return existing;
    const ends = edgeEnds(this.map, id);
    if (ends === undefined) return null;
    const { a, b } = ends;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const shade = new Graphics(this.edgeContext(length));
    shade.position.set(a.x, a.y);
    shade.rotation = Math.atan2(b.y - a.y, b.x - a.x);
    // The dashes are built for the rounded length; stretch to the exact one.
    shade.scale.x = length / Math.max(1, Math.round(length));
    this.edgeShades[id] = this.shadeLayer.addChild(shade);
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

  private setEdge(edge: EdgeView, tick: number): void {
    const hidden = edge.detail === 'fog';
    if (hidden) {
      const shade = this.edgeShade(edge.id);
      if (shade !== null) {
        shade.visible = true;
        shade.scale.y = roadThickness(edge.width) + ROAD_CASING_EXTRA + FOG_ROAD_EXTRA;
      }
    } else {
      const shade = this.edgeShades[edge.id];
      if (shade !== undefined && shade !== null) shade.visible = false;
    }
    const memory = this.remembered(hidden, edge.seen);
    const existing = this.edgeGhosts[edge.id] ?? null;
    const at = edgeMarkerPoint(this.map, edge.id);
    if (memory === null || at === undefined) {
      existing?.hide();
      return;
    }
    this.showGhost(this.edgeGhosts, edge.id, memory, tick, at);
  }
}
