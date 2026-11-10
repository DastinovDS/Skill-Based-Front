import { Container } from 'pixi.js';
import type { MapFile, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { BakedSprite, SpriteCache } from './bake.ts';
import { starveMarkSpec } from './bakedShapes.ts';
import type { Point } from './camera.ts';
import { flowOn, starvingNodes } from './flowLayout.ts';
import { nodePoint } from './layout.ts';
import type { MapLayers } from './layers.ts';
import { FLOW_BATTLE } from './style.ts';

/**
 * The supply flow on the normal map, the "battle mode" (DEC-43, ui-style 42): alerts only, the
 * starving mark on each node that is starving or about to. Nothing else of the supply is drawn here
 * (no level fill, no chevrons, no hover marks; the «Supply» layer was removed, DEC-50, #928). The marks are baked sprites in one small pool, redrawn
 * only when the snapshot changes.
 */
export class FlowView {
  /** The marks lie over the cities, in the intents layer (not in the fog). */
  private readonly markRoot = new Container({ label: 'flow-marks', visible: false });
  private readonly marks: BakedSprite[] = [];
  private base: SnapshotMsg | null = null;
  private on = false;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly radiusOf: (node: number) => number,
    private readonly sprites: SpriteCache,
  ) {
    layers.layer.intents.addChild(this.markRoot);
  }

  update(base: SnapshotMsg | null): void {
    const show = base !== null && flowOn(base.view);
    if (show !== this.on) {
      this.on = show;
      this.markRoot.visible = show;
      this.base = null;
    }
    if (!show) return;
    if (base === this.base) return;
    this.base = base;
    this.draw(base);
  }

  destroy(): void {
    this.marks.length = 0;
    this.markRoot.destroy({ children: true });
  }

  private draw(base: SnapshotMsg): void {
    let used = 0;
    for (const node of starvingNodes(base.view, this.me)) {
      const city = nodePoint(this.map, node);
      if (city === undefined) continue;
      let sprite = this.marks[used];
      if (sprite === undefined) {
        sprite = this.sprites.sprite(starveMarkSpec());
        this.markRoot.addChild(sprite);
        this.marks.push(sprite);
      }
      used++;
      const at = starvePoint(city, this.radiusOf(node));
      sprite.position.set(at.x, at.y);
      sprite.visible = true;
    }
    for (let i = used; i < this.marks.length; i++) {
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
