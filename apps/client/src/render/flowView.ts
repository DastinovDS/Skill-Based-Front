import { Container } from 'pixi.js';
import type { MapFile, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { BakedSprite, SpriteCache } from './bake.ts';
import { lineChevronSpec, starveMarkSpec } from './bakedShapes.ts';
import type { Point } from './camera.ts';
import { downhillRoads, flowOn, starvingNodes } from './flowLayout.ts';
import { nodePoint } from './layout.ts';
import type { MapLayers } from './layers.ts';
import { pipeSpan } from './pipeLayout.ts';
import { FLOW_BATTLE, SUPPLY_PIPE } from './style.ts';
import { edgeIndex, type EdgeIndex } from './supplyLayout.ts';

/**
 * The supply flow on the normal map, the "battle mode" (DEC-43, ui-style 42): one faint static
 * chevron on each downhill road and the starving mark on the nodes that are starving. No hover
 * marks; the level fill is `MapView.setLevel` at half strength, the packets are the entity layer's
 * dots. The «Supply» layer draws the full picture itself (`SupplyView`), this view is hidden then.
 * Everything is baked sprites in two small pools, redrawn only when the snapshot changes.
 */
export class FlowView {
  /** The chevrons lie on the roads, under the cities; the marks over the cities (not in the fog). */
  private readonly roadRoot = new Container({ label: 'flow-roads', visible: false });
  private readonly markRoot = new Container({ label: 'flow-marks', visible: false });
  private readonly chevrons: BakedSprite[] = [];
  private readonly marks: BakedSprite[] = [];
  private readonly index: EdgeIndex;
  private base: SnapshotMsg | null = null;
  private on = false;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly radiusOf: (node: number) => number,
    private readonly sprites: SpriteCache,
  ) {
    this.index = edgeIndex(map);
    layers.layer.roads.addChild(this.roadRoot);
    layers.layer.intents.addChild(this.markRoot);
  }

  /** `active`: the normal map (not the «Supply» layer) is on screen. */
  update(base: SnapshotMsg | null, active: boolean): void {
    const show = active && base !== null && flowOn(base.view);
    if (show !== this.on) {
      this.on = show;
      this.roadRoot.visible = show;
      this.markRoot.visible = show;
      this.base = null;
    }
    if (!show) return;
    if (base === this.base) return;
    this.base = base;
    this.draw(base);
  }

  destroy(): void {
    this.chevrons.length = 0;
    this.marks.length = 0;
    this.roadRoot.destroy({ children: true });
    this.markRoot.destroy({ children: true });
  }

  private pooled(pool: BakedSprite[], root: Container, used: number, make: () => BakedSprite) {
    let sprite = pool[used];
    if (sprite === undefined) {
      sprite = make();
      root.addChild(sprite);
      pool.push(sprite);
    }
    return sprite;
  }

  private draw(base: SnapshotMsg): void {
    const view = base.view;
    let chevrons = 0;
    for (const road of downhillRoads(view, this.me, this.index)) {
      const a = nodePoint(this.map, road.from);
      const b = nodePoint(this.map, road.to);
      if (a === undefined || b === undefined) continue;
      const span = pipeSpan(
        a,
        b,
        this.radiusOf(road.from) + SUPPLY_PIPE.inset,
        this.radiusOf(road.to) + SUPPLY_PIPE.inset,
      );
      if (span === null || span.length < SUPPLY_PIPE.minFlow) continue;
      const sprite = this.pooled(this.chevrons, this.roadRoot, chevrons, () =>
        this.sprites.sprite(lineChevronSpec()),
      );
      chevrons++;
      sprite.position.set((span.start.x + span.end.x) / 2, (span.start.y + span.end.y) / 2);
      sprite.rotation = Math.atan2(span.end.y - span.start.y, span.end.x - span.start.x);
      sprite.alpha = FLOW_BATTLE.chevronAlpha;
      sprite.visible = true;
    }
    for (let i = chevrons; i < this.chevrons.length; i++) {
      const sprite = this.chevrons[i];
      if (sprite !== undefined) sprite.visible = false;
    }
    let marks = 0;
    for (const node of starvingNodes(view, this.me)) {
      const city = nodePoint(this.map, node);
      if (city === undefined) continue;
      const sprite = this.pooled(this.marks, this.markRoot, marks, () =>
        this.sprites.sprite(starveMarkSpec()),
      );
      marks++;
      const at = starvePoint(city, this.radiusOf(node));
      sprite.position.set(at.x, at.y);
      sprite.visible = true;
    }
    for (let i = marks; i < this.marks.length; i++) {
      const sprite = this.marks[i];
      if (sprite !== undefined) sprite.visible = false;
    }
  }
}

/** Where the starving mark of a node sits: off its lower right rim. */
export function starvePoint(city: Point, radius: number): Point {
  const rad = (FLOW_BATTLE.starveAngle * Math.PI) / 180;
  const r = radius + FLOW_BATTLE.starveGap;
  return { x: city.x + r * Math.cos(rad), y: city.y + r * Math.sin(rad) };
}
