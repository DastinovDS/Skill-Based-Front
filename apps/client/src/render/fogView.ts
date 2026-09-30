import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { Point } from './camera.ts';
import type { EdgeView, MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import { TOKEN_COMPACT, TOKEN_FULL, edgeEnds } from './layout.ts';
import {
  ageLabel,
  edgeMarkerPoint,
  fogDashes,
  hatchChords,
  nodeMarkerPoint,
  nodeRadius,
} from './fogLayout.ts';
import type { MapLayers } from './layers.ts';
import { Token, type EntityKit } from './shapes.ts';
import {
  FOG_ALPHA,
  FOG_COLOR,
  FOG_DASH,
  FOG_GAP,
  FOG_HATCH,
  FOG_HATCH_SPACING,
  FOG_NODE_MARGIN,
  FOG_ROAD_EXTRA,
  GHOST_AGE_FONT_SIZE,
  GHOST_AGE_STROKE,
  GHOST_ALPHA,
  GLYPH_COLOR,
  ROAD_CASING_EXTRA,
  roadThickness,
} from './style.ts';

/** Where a snapshot says an enemy was last seen in a place that is hidden now. */
type Memory = NodeView['seen'];

/** A marker of what was last seen in a hidden place: a faded enemy token and its age. */
class Ghost {
  readonly view = new Container({ visible: false });
  readonly token: Token;
  readonly age: Text;
  private shown = '';

  constructor(kit: EntityKit, style: TextStyle, resolution: number) {
    this.token = new Token(kit, resolution);
    this.token.view.alpha = GHOST_ALPHA;
    this.age = new Text({ text: '', style, anchor: { x: 0.5, y: 0 }, resolution });
    this.view.addChild(this.token.view, this.age);
  }

  labels(): Text[] {
    return [this.token.text, this.age];
  }

  hide(): void {
    this.view.visible = false;
  }

  show(memory: NonNullable<Memory>, enemy: PlayerId, age: string, at: Point): void {
    const exact =
      memory.level === 'exact' && memory.enemy_units !== null && memory.enemy_charged !== null;
    this.token.set({
      owner: enemy,
      modes: memory.enemy_modes,
      counts: exact ? { units: memory.enemy_units ?? 0, charged: memory.enemy_charged ?? 0 } : null,
    });
    const height = exact ? TOKEN_FULL.height : TOKEN_COMPACT.height;
    this.age.position.set(0, height / 2 + 3);
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
 * is (at least partly) seen. The client shades hidden cities (dark disc with hatching) and
 * hidden roads (dark dashes), and puts a "last seen" ghost on a hidden place when the snapshot
 * still carries a `Seen` with enemy groups in it: the enemy token, faded, with its age as
 * `-m:ss`. A place that is seen again loses its shade and its ghost on the next snapshot.
 * Nothing is inferred: no ghost without a `Seen`, no numbers the `Seen` has not got.
 *
 * Redrawn once per snapshot (`update` does nothing when `base` is the same object). Shades reuse
 * a few GraphicsContexts (one per city size, one per road length); `destroy()` releases them.
 */
export class FogView {
  private readonly contexts: GraphicsContext[] = [];
  private readonly nodeContexts = new Map<number, GraphicsContext>();
  private readonly edgeContexts = new Map<number, GraphicsContext>();
  private readonly nodeShades: Graphics[];
  private readonly edgeShades: (Graphics | null)[];
  private readonly nodeGhosts: (Ghost | null)[];
  private readonly edgeGhosts: (Ghost | null)[];
  private readonly shadeLayer = new Container({ label: 'fog-shades' });
  private readonly ghostLayer = new Container({ label: 'fog-ghosts' });
  private readonly ageStyle: TextStyle;
  private readonly enemy: PlayerId;
  private base: SnapshotMsg | null = null;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    me: PlayerId,
    private readonly kit: EntityKit,
    private labelResolution: number,
    private tickHz: number,
  ) {
    this.enemy = me === 0 ? 1 : 0;
    this.ageStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: GHOST_AGE_FONT_SIZE,
      fontWeight: '700',
      fill: GLYPH_COLOR,
      stroke: GHOST_AGE_STROKE,
    });
    this.nodeShades = map.nodes.map((node) => {
      const shade = new Graphics(this.nodeContext(nodeRadius(map, node.id)));
      shade.position.set(node.x, node.y);
      shade.visible = false;
      return this.shadeLayer.addChild(shade);
    });
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
    for (const node of nodes) this.setNode(node, base.tick);
    for (const edge of edges) this.setEdge(edge, base.tick);
  }

  destroy(): void {
    // Shades use shared contexts (Graphics leaves those alone); containers go first, then the
    // contexts and the style.
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

  /** A dark disc with diagonal hatching, one per city size. */
  private nodeContext(radius: number): GraphicsContext {
    let context = this.nodeContexts.get(radius);
    if (context === undefined) {
      const r = radius + FOG_NODE_MARGIN;
      context = this.context((g) => {
        g.circle(0, 0, r).fill({ color: FOG_COLOR, alpha: FOG_ALPHA });
        for (const [from, to] of hatchChords(r, FOG_HATCH_SPACING)) {
          g.moveTo(from.x, from.y).lineTo(to.x, to.y);
        }
        return g.stroke(FOG_HATCH);
      });
      this.nodeContexts.set(radius, context);
    }
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
        return g.fill({ color: FOG_COLOR, alpha: FOG_ALPHA });
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

  // --- Snapshot-driven part -----------------------------------------------------------------

  private ghost(list: (Ghost | null)[], id: number): Ghost {
    const existing = list[id];
    if (existing !== undefined && existing !== null) return existing;
    const ghost = new Ghost(this.kit, this.ageStyle, this.labelResolution);
    list[id] = ghost;
    this.ghostLayer.addChild(ghost.view);
    return ghost;
  }

  /** A ghost needs a hidden place and a memory of enemies in it. */
  private remembered(hidden: boolean, seen: Memory): NonNullable<Memory> | null {
    return hidden && seen !== null && seen.enemy_modes.length > 0 ? seen : null;
  }

  private setNode(node: NodeView, tick: number): void {
    const hidden = node.detail === 'fog';
    const shade = this.nodeShades[node.id];
    if (shade !== undefined) shade.visible = hidden;
    const memory = this.remembered(hidden, node.seen);
    const existing = this.nodeGhosts[node.id] ?? null;
    if (memory === null) {
      existing?.hide();
      return;
    }
    const width = memory.level === 'exact' ? TOKEN_FULL.width : TOKEN_COMPACT.width;
    const at = nodeMarkerPoint(this.map, node.id, width);
    if (at === undefined) return;
    this.ghost(this.nodeGhosts, node.id).show(
      memory,
      this.enemy,
      ageLabel(tick - memory.tick, this.tickHz),
      at,
    );
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
    this.ghost(this.edgeGhosts, edge.id).show(
      memory,
      this.enemy,
      ageLabel(tick - memory.tick, this.tickHz),
      at,
    );
  }
}
