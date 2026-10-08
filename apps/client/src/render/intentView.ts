import { Container, Graphics } from 'pixi.js';
import type { RenderFrame, RenderGroup } from '../net/interpolate.ts';
import type { IntentView as WireIntent, MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { MapLayers } from './layers.ts';
import { arrowGeometry, dashSegments, nodePoint, sideways } from './layout.ts';
import type { EntityKit } from './shapes.ts';
import {
  ARROW_DASH,
  ARROW_GAP,
  ARROW_HEAD,
  ARROW_OUTLINE,
  ARROW_WIDTH,
  INTENT_ICON_ANGLE,
  INTENT_ICON_DISTANCE,
  ORDER_LINE_ALPHA,
  ownerColor,
  PLATE_FILL,
} from './style.ts';

function around(distance: number, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  return { x: distance * Math.cos(rad), y: distance * Math.sin(rad) };
}

/**
 * What the players intend, on the map: the public intents of planned orders and modes (both
 * sides) and the order lines of own groups. Moved out of `EntityView` (ui-style, package C).
 */
export class IntentView {
  private readonly orders = new Graphics();
  private readonly arrows = new Graphics();
  private readonly icons = new Container({ label: 'intent-icons' });
  private readonly iconPool: Container[] = [];
  private base: RenderFrame['base'] | null = null;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly kit: EntityKit,
    private readonly radiusOf: (node: number) => number,
  ) {
    // Order lines go under the tokens of the groups they belong to; arrows of intents on top.
    layers.layer.groups.addChildAt(this.orders, 0);
    layers.layer.intents.addChild(this.arrows, this.icons);
  }

  update(frame: RenderFrame, spots: ReadonlyMap<string, Point>): void {
    if (frame.base !== this.base) {
      this.base = frame.base;
      this.drawIntents(frame.base.view.intents);
    }
    this.drawOrders(frame.groups, spots);
  }

  destroy(): void {
    this.arrows.destroy();
    this.orders.destroy();
    this.icons.destroy({ children: true });
  }

  private drawIntents(intents: readonly WireIntent[]): void {
    const g = this.arrows;
    g.clear();
    let icons = 0;
    for (const intent of intents) {
      const from = nodePoint(this.map, intent.origin);
      if (from === undefined) continue;
      const to = intent.target === null ? undefined : nodePoint(this.map, intent.target);
      if (intent.kind === 'planned_move' && to !== undefined) {
        this.drawArrow(g, intent, from, to);
      } else if (intent.kind !== 'planned_move') {
        this.placeIcon(icons++, intent, from);
      }
    }
    // Hide the icons left over from the previous snapshot.
    for (let i = icons; i < this.iconPool.length; i++) {
      const icon = this.iconPool[i];
      if (icon !== undefined) icon.visible = false;
    }
  }

  private drawArrow(g: Graphics, intent: WireIntent, from: Point, to: Point): void {
    const color = ownerColor(this.me, intent.owner);
    // Both players' arrows on one road run side by side instead of on top of each other.
    const lane = intent.owner === 0 ? 5 : -5;
    const start = sideways(from, to, from, lane);
    const end = sideways(from, to, to, lane);
    const arrow = arrowGeometry(
      start,
      end,
      this.radiusOf(intent.origin) + 6,
      this.radiusOf(intent.target ?? intent.origin) + 6,
      ARROW_HEAD.length,
      ARROW_HEAD.width,
    );
    if (arrow === null) return;
    const dashes = dashSegments(arrow.start, arrow.end, ARROW_DASH, ARROW_GAP);
    for (const [a, b] of dashes) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    g.stroke(ARROW_OUTLINE);
    for (const [a, b] of dashes) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    g.stroke({ width: ARROW_WIDTH, color });
    const [tip, left, right] = arrow.head;
    g.poly([tip.x, tip.y, left.x, left.y, right.x, right.y])
      .fill(color)
      .stroke({ width: 1.5, color: PLATE_FILL });
    // The tail tells the side without colour: a dot for own, a hollow diamond for the opponent.
    const { x, y } = arrow.start;
    if (intent.owner === this.me) {
      g.circle(x, y, 4).fill(color).stroke({ width: 1.5, color: PLATE_FILL });
    } else {
      g.poly([x, y - 5.5, x + 5.5, y, x, y + 5.5, x - 5.5, y])
        .fill(PLATE_FILL)
        .stroke({ width: 2, color });
    }
  }

  private placeIcon(index: number, intent: WireIntent, at: Point): void {
    let icon = this.iconPool[index];
    if (icon === undefined) {
      icon = this.icons.addChild(new Container());
      icon.addChild(new Graphics(this.kit.iconDisc[0]));
      // The only intent without a destination is "Defense" (DEC-08).
      icon.addChild(new Graphics(this.kit.glyph.defense));
      this.iconPool.push(icon);
    }
    const [disc] = icon.children as [Graphics, Graphics];
    disc.context = this.kit.iconDisc[intent.owner];
    const radius = this.radiusOf(intent.origin);
    const offset = around(radius + INTENT_ICON_DISTANCE, INTENT_ICON_ANGLE);
    icon.position.set(at.x + offset.x, at.y + offset.y);
    icon.visible = true;
  }

  private drawOrders(groups: readonly RenderGroup[], points: ReadonlyMap<string, Point>): void {
    const g = this.orders;
    g.clear();
    for (const { group, owner } of groups) {
      const color = ownerColor(this.me, owner ?? this.me);
      const from = points.get(group.id);
      if (group.order === null || from === undefined) continue;
      g.moveTo(from.x, from.y);
      for (const id of group.order.path) {
        const step = nodePoint(this.map, id);
        if (step !== undefined) g.lineTo(step.x, step.y);
      }
      g.stroke({ width: 2, color, alpha: ORDER_LINE_ALPHA });
      const dest = nodePoint(this.map, group.order.dest);
      if (dest !== undefined)
        g.circle(dest.x, dest.y, this.radiusOf(group.order.dest) + 5).stroke({
          width: 2,
          color,
          alpha: ORDER_LINE_ALPHA,
        });
    }
  }
}
