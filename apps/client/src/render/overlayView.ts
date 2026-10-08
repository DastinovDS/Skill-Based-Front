import { Graphics } from 'pixi.js';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { EMPTY_OVERLAY, type GhostArrow, type OverlayState } from './interaction.ts';
import type { MapLayers } from './layers.ts';
import { TOKEN_FULL, arrowGeometry, dashSegments, edgeEnds, nodePoint } from './layout.ts';
import {
  ARROW_HEAD,
  ARROW_OUTLINE,
  CAPITAL_RADIUS,
  ORDER_GHOST_ALPHA,
  ORDER_GHOST_DASH,
  ORDER_GHOST_GAP,
  ORDER_GHOST_WIDTH,
  NODE_RADIUS,
  PICK_BAND,
  PLAYER_COLOR,
  PREVIEW_ALPHA,
  PREVIEW_DASH,
  PREVIEW_GAP,
  PREVIEW_WIDTH,
  ROAD_LIGHT_ALPHA,
  ROAD_LIGHT_EXTRA,
  roadThickness,
  SELECT_COLOR,
  SELECT_RING_GAP,
  SELECT_TOKEN_GAP,
  SELECT_WIDTH,
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
  private overlay: OverlayState = EMPTY_OVERLAY;
  private frameDrawn = false;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
  ) {
    layers.layer.intents.addChild(this.lines, this.ring, this.frame);
    this.frame.visible = false;
  }

  /** `groupPoint`: the drawn centre of an own group's token. */
  update(next: OverlayState, groupPoint: (id: string) => Point | undefined): void {
    if (next !== this.overlay) {
      this.overlay = next;
      this.drawLines(next);
      this.drawRing(next);
    }
    const selected = next.selection;
    const at = selected?.kind === 'group' ? groupPoint(selected.id) : undefined;
    this.frame.visible = at !== undefined;
    if (at !== undefined) {
      if (!this.frameDrawn) {
        this.drawFrame();
      }
      this.frame.position.set(at.x, at.y);
    }
  }

  destroy(): void {
    this.lines.destroy();
    this.ring.destroy();
    this.frame.destroy();
  }

  private drawRing(state: OverlayState): void {
    const g = this.ring;
    g.clear();
    const selected = state.selection;
    if (selected?.kind !== 'node') return;
    const at = nodePoint(this.map, selected.id);
    if (at === undefined) return;
    const radius =
      (this.map.nodes[selected.id]?.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS) +
      SELECT_RING_GAP;
    g.circle(at.x, at.y, radius + SELECT_WIDTH).stroke({ width: 2, color: 0xf0f6fc });
    g.circle(at.x, at.y, radius).stroke({ width: SELECT_WIDTH, color: SELECT_COLOR });
  }

  private drawFrame(): void {
    const g = this.frame;
    g.clear();
    const w = TOKEN_FULL.width + 2 * SELECT_TOKEN_GAP;
    const h = TOKEN_FULL.height + 2 * SELECT_TOKEN_GAP;
    g.roundRect(-w / 2 - 2, -h / 2 - 2, w + 4, h + 4, 8).stroke({ width: 2, color: 0xf0f6fc });
    g.roundRect(-w / 2, -h / 2, w, h, 6).stroke({ width: SELECT_WIDTH, color: SELECT_COLOR });
    this.frameDrawn = true;
  }

  private drawLines(state: OverlayState): void {
    const g = this.lines;
    g.clear();
    this.drawCandidates(g, state.candidates);
    const road = state.road === null ? undefined : edgeEnds(this.map, state.road);
    if (road !== undefined && state.road !== null) {
      const width = this.map.edges[state.road]?.base_width ?? 1;
      g.moveTo(road.a.x, road.a.y).lineTo(road.b.x, road.b.y);
      g.stroke({
        width: roadThickness(width) + ROAD_LIGHT_EXTRA,
        color: SELECT_COLOR,
        alpha: ROAD_LIGHT_ALPHA,
        cap: 'round',
      });
    }
    for (const ghost of state.ghosts) this.drawGhost(g, ghost);
    const preview = state.preview;
    if (preview !== null) {
      const from = nodePoint(this.map, preview.from);
      const to = nodePoint(this.map, preview.to);
      if (from !== undefined && to !== undefined) {
        for (const [a, b] of dashSegments(from, to, PREVIEW_DASH, PREVIEW_GAP)) {
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        }
        g.stroke({
          width: PREVIEW_WIDTH,
          color: preview.planned ? SELECT_COLOR : PLAYER_COLOR[this.me],
          alpha: PREVIEW_ALPHA,
          cap: 'round',
        });
      }
    }
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
      width: roadThickness(5) + PICK_BAND.extra,
      color: SELECT_COLOR,
      alpha: PICK_BAND.alpha,
      cap: 'butt',
    });
  }

  private radius(node: number): number {
    return this.map.nodes[node]?.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS;
  }

  /** Dashed arrow along the server's path, or straight to the destination while unanswered. */
  private drawGhost(g: Graphics, ghost: GhostArrow): void {
    // The server's path starts at the group's node; the unanswered arrow goes straight to `dest`.
    const nodes = ghost.path ?? [ghost.from, ghost.dest];
    const points = nodes
      .map((id) => nodePoint(this.map, id))
      .filter((p): p is Point => p !== undefined);
    const color = PLAYER_COLOR[this.me];
    const last = points.at(-1);
    const before = points.at(-2);
    if (last === undefined || before === undefined) return;
    const head = arrowGeometry(
      before,
      last,
      0,
      NODE_RADIUS + 2,
      ARROW_HEAD.length,
      ARROW_HEAD.width,
    );
    for (const pass of [
      ARROW_OUTLINE,
      { width: ORDER_GHOST_WIDTH, color, alpha: ORDER_GHOST_ALPHA },
    ]) {
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = i === points.length - 1 && head !== null ? head.end : points[i];
        if (a === undefined || b === undefined) continue;
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
