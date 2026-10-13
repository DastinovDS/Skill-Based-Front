import { Graphics } from 'pixi.js';
import type { MapFile, SnapshotMsg } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { SupplyOverlay } from './interaction.ts';
import type { MapLayers } from './layers.ts';
import { arrowGeometry, dashSegments, nodePoint } from './layout.ts';
import { ARROW_HEAD, ARROW_OUTLINE, BG, PAPER, SELECT_COLOR, SELECT_WIDTH, YOU } from './style.ts';
import { priorityMarks, signCorners, signPoint, supplyRoutes } from './supplyLayout.ts';

/** Size of a priority sign (world px). */
const SIGN = 18;
/** Line of an automatic packet and of a transfer (wider and dashed: told by shape, not colour). */
const ROUTE = { width: 2.5, alpha: 0.85 } as const;
const TRANSFER = { width: 4.5, alpha: 0.95, dash: 10, gap: 6 } as const;
const TARGET = { dash: 6, gap: 5, ring: 7 } as const;

/**
 * The «Supply» map mode (DEC-18, item 7): a sign of the priority at each own city (up triangle,
 * circle, down triangle), the routes of own packets to their destinations (transfers dashed and
 * wider), and during a transfer pick the source ring and dashed rings around the cities a click
 * would pick. Hidden on the normal map. Redrawn only when the snapshot or the overlay changes.
 */
export class SupplyView {
  private readonly g = new Graphics();
  private base: SnapshotMsg | null = null;
  private supply: SupplyOverlay | null = null;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly radiusOf: (node: number) => number,
  ) {
    layers.layer.intents.addChild(this.g);
    this.g.visible = false;
  }

  update(base: SnapshotMsg | null, supply: SupplyOverlay | null): void {
    if (base === this.base && supply === this.supply) return;
    this.base = base;
    this.supply = supply;
    this.g.clear();
    this.g.visible = supply !== null && base !== null;
    if (supply === null || base === null) return;
    this.drawRoutes(base);
    this.drawSigns(base);
    this.drawPick(supply);
  }

  destroy(): void {
    this.g.destroy();
  }

  private point(node: number): Point | undefined {
    return nodePoint(this.map, node);
  }

  private drawRoutes(base: SnapshotMsg): void {
    const g = this.g;
    for (const route of supplyRoutes(base.view)) {
      const points = route.nodes
        .map((n) => this.point(n))
        .filter((p): p is Point => p !== undefined);
      const last = points.at(-1);
      const before = points.at(-2);
      const dest = route.nodes.at(-1);
      if (last === undefined || before === undefined || dest === undefined) continue;
      const head = arrowGeometry(
        before,
        last,
        0,
        this.radiusOf(dest) + 2,
        ARROW_HEAD.length,
        ARROW_HEAD.width,
      );
      const look = route.transfer ? TRANSFER : ROUTE;
      for (const pass of [
        { width: look.width + ARROW_OUTLINE.width - 3, color: BG, alpha: ARROW_OUTLINE.alpha },
        { width: look.width, color: YOU, alpha: look.alpha },
      ]) {
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1];
          const b = i === points.length - 1 && head !== null ? head.end : points[i];
          if (a === undefined || b === undefined) continue;
          if (route.transfer) {
            for (const [s, e] of dashSegments(a, b, TRANSFER.dash, TRANSFER.gap)) {
              g.moveTo(s.x, s.y).lineTo(e.x, e.y);
            }
          } else {
            g.moveTo(a.x, a.y).lineTo(b.x, b.y);
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

  private drawSigns(base: SnapshotMsg): void {
    const g = this.g;
    for (const mark of priorityMarks(base.view)) {
      const city = this.point(mark.node);
      if (city === undefined) continue;
      const at = signPoint(city, this.radiusOf(mark.node), SIGN);
      const corners = signCorners(mark.priority, at, SIGN);
      if (corners.length === 0) {
        g.circle(at.x, at.y, SIGN / 2 - 1);
      } else {
        g.poly(corners.flatMap((p) => [p.x, p.y]));
      }
      g.fill({ color: PAPER }).stroke({ width: 3, color: BG, join: 'round' });
    }
  }

  private drawPick(supply: SupplyOverlay): void {
    const g = this.g;
    if (supply.source === null) return;
    const source = this.point(supply.source);
    if (source !== undefined) {
      const r = this.radiusOf(supply.source) + TARGET.ring;
      g.circle(source.x, source.y, r + SELECT_WIDTH).stroke({ width: 2, color: BG });
      g.circle(source.x, source.y, r).stroke({ width: SELECT_WIDTH, color: SELECT_COLOR });
    }
    for (const node of supply.targets) {
      const at = this.point(node);
      if (at === undefined) continue;
      const r = this.radiusOf(node) + TARGET.ring;
      const steps = Math.max(8, Math.round((2 * Math.PI * r) / (TARGET.dash + TARGET.gap)));
      for (let i = 0; i < steps; i++) {
        const a0 = (i / steps) * 2 * Math.PI;
        const a1 = a0 + (TARGET.dash / (TARGET.dash + TARGET.gap)) * ((2 * Math.PI) / steps);
        g.moveTo(at.x + r * Math.cos(a0), at.y + r * Math.sin(a0));
        g.arc(at.x, at.y, r, a0, a1);
      }
      g.stroke({ width: 2, color: SELECT_COLOR, alpha: 0.9 });
    }
  }
}
