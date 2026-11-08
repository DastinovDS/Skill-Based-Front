import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import type { Point } from './camera.ts';
import type {
  EdgeView,
  HalfView,
  MapFile,
  NodeView,
  PlayerId,
  SnapshotMsg,
} from '../protocol.gen.ts';
import { dashSegments, edgeEnds, unitSide } from './layout.ts';
import {
  ageLabel,
  ghostAlpha,
  borderPoint,
  halfMarkerPoint,
  nodeMarkerPoint,
} from './fogLayout.ts';
import { knownOfSeen } from './rangeLabel.ts';
import { symbolScale } from './camera.ts';
import type { MapLayers } from './layers.ts';
import { Token, type EntityKit } from './shapes.ts';
import {
  GHOST_AGE_FONT_SIZE,
  GHOST_AGE_STROKE,
  GLYPH_COLOR,
  GHOST_HIDE_S,
  ENEMY,
} from './style.ts';

/** Where a snapshot says an enemy was last seen in a place that is hidden now. */
type Memory = NodeView['seen'];

/** A marker of what was last seen in a hidden place: a faded dashed enemy helmet and its age. */
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

  /** Sets the symbol scale (the minimum size on screen) and keeps the age above the helmet. */
  setScale(scale: number): void {
    this.token.setScale(scale);
    this.age.position.set(0, (this.token.top - 3) * scale);
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
 * is (at least partly) seen. The veil over the areas of the hidden cities is the Ruled veil of
 * `MapView` (`VeilView`, #842), which lies at the bottom of the fog layer; this view draws the
 * memory over it. The intents lie above the fog layer (`LAYER_ORDER`). The half
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
  private readonly nodeGhosts: (Ghost | null)[];
  /** The memory of a half of a road in fog, by `edge * 2 + half`. */
  private readonly halfGhosts: (Ghost | null)[];
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
    this.nodeGhosts = map.nodes.map(() => null);
    this.halfGhosts = map.edges.flatMap(() => [null, null]);
    layers.layer.fog.addChild(this.halfTicks, this.ghostLayer);
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
    this.halfTicks.destroy();
    this.ghostLayer.destroy({ children: true });
    this.ageStyle.destroy();
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
    const side = unitSide(
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
