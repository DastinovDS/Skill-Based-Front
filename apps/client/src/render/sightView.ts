import { Container, Graphics } from 'pixi.js';
import type { MapFile, NodeView, PlayerId } from '../protocol.gen.ts';
import type { MapLayers } from './layers.ts';
import { nodePoint } from './layout.ts';
import { SIGHT_BARS, SIGHT_MIN_SCALE, showsSight, sightLevel, signAt } from './sightLayout.ts';
import { BG, PAPER } from './style.ts';

/**
 * The sight signs of the terrain map mode (#429): three bars beside every place that is not yours
 * and that you see now. One Graphics, redrawn when a level changes (a snapshot at most), not every
 * frame. Hidden while the mode is off and when the map is zoomed too far out to read them.
 */
export class SightView {
  private readonly root = new Container({ label: 'sight', visible: false });
  private readonly signs = this.root.addChild(new Graphics());
  private key = '';

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly radiusOf: (node: number) => number,
  ) {
    layers.layer.nodes.addChild(this.root);
  }

  /** `scale`: the camera scale (world to CSS px). */
  update(on: boolean, nodes: readonly NodeView[], scale: number): void {
    this.root.visible = on && scale >= SIGHT_MIN_SCALE;
    if (!on) return;
    const levels = nodes.map((node) =>
      showsSight(node.owner, this.me, node.detail) ? sightLevel(node.detail) : 0,
    );
    const key = levels.join('');
    if (key === this.key) return;
    this.key = key;
    this.draw(levels);
  }

  private draw(levels: readonly number[]): void {
    const { width, gap, heights, pad, radius, base } = SIGHT_BARS;
    const total = 3 * width + 2 * gap;
    const g = this.signs.clear();
    levels.forEach((level, id) => {
      const center = nodePoint(this.map, id);
      if (level === 0 || center === undefined) return;
      const at = signAt(center, this.radiusOf(id));
      g.roundRect(at.x - total / 2 - pad.x, at.y - pad.top, total + 2 * pad.x, pad.height, radius)
        .fill({ color: BG, alpha: 0.9 })
        .stroke({ color: PAPER, alpha: 0.5, width: 1 });
      heights.forEach((h, i) => {
        const x = at.x - total / 2 + i * (width + gap);
        const y = at.y + base - h;
        if (i < level) g.rect(x, y, width, h).fill(PAPER);
        else
          g.rect(x + 0.4, y + 0.4, width - 0.8, h - 0.8).stroke({
            color: PAPER,
            alpha: 0.55,
            width: 0.8,
          });
      });
    });
  }

  destroy(): void {
    this.root.destroy({ children: true });
  }
}
