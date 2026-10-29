import { Container, Text, TextStyle } from 'pixi.js';
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import type { BakedSprite, SpriteCache } from './bake.ts';
import { defenseCounterSpec } from './bakedShapes.ts';
import { columnKinds, columnSlots, counterLayout, markScale } from './defenseLayout.ts';
import { signCounts, type DefenseSign } from './defenseSigns.ts';
import type { MapLayers } from './layers.ts';
import { nodePoint } from './layout.ts';
import { DEFENSE_PIPS, PAPER, ownerColor } from './style.ts';

/** One sign on the map: the baked badge (and capsule) and the two numbers of a big cap. */
interface Sign {
  readonly view: Container;
  readonly sprite: BakedSprite;
  readonly gathered: Text;
  readonly room: Text;
}

/**
 * The sign of "Defense" at a city (D1 "Diamond pips" in the left column L1, #349; ui-style 35): the
 * shield badge and, for an own group with places, a capsule of diamonds growing outward, filled for
 * the bonus gathered, hollow for room. One sign per city and side (`defenseSigns`): from the group's
 * mode where it is seen, from the public intent elsewhere. The opponent shows the badge alone, so
 * its bonus never reaches the screen. It lies over the fog (the intents layer), is baked (one
 * texture per look) and keeps 16 px on screen at any zoom (`markScale`). The barracks mark of the
 * city is the top of the same column (`CityView`).
 */
export class DefenseView {
  private readonly root = new Container({ label: 'defense-signs' });
  private readonly pool: Sign[] = [];
  private readonly style = new TextStyle({
    fontFamily: 'system-ui, sans-serif',
    fontSize: DEFENSE_PIPS.fontSize,
    fontWeight: '700',
    fill: PAPER,
  });
  private cameraScale = 1;
  private resolution = 1;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private readonly sprites: SpriteCache,
    private readonly radiusOf: (node: number) => number,
    private readonly hasBarracks: (node: number) => boolean,
  ) {
    layers.layer.intents.addChild(this.root);
  }

  /** Camera scale: the signs keep their size on screen below zoom 1. */
  setCameraScale(scale: number): void {
    this.cameraScale = scale;
    this.setTextResolution();
  }

  /** Texture pixels per world unit of the text (the numbers of a big cap). */
  setLabelResolution(resolution: number): void {
    this.resolution = resolution;
    this.setTextResolution();
  }

  private setTextResolution(): void {
    const resolution = this.resolution * markScale(this.cameraScale);
    for (const { gathered, room } of this.pool) {
      if (gathered.resolution !== resolution) gathered.resolution = resolution;
      if (room.resolution !== resolution) room.resolution = resolution;
    }
  }

  /** Draws `signs` (what `defenseSigns` gave this frame) and hides the pool's rest. */
  update(signs: readonly DefenseSign[]): void {
    const scale = markScale(this.cameraScale);
    const counts = signCounts(signs);
    const seen = new Map<number, number>();
    let used = 0;
    for (const sign of signs) {
      const at = nodePoint(this.map, sign.node);
      if (at === undefined) continue;
      const index = seen.get(sign.node) ?? 0;
      seen.set(sign.node, index + 1);
      const barracks = this.hasBarracks(sign.node);
      const kinds = columnKinds(barracks, counts.get(sign.node) ?? 1);
      const slot = columnSlots(this.radiusOf(sign.node), kinds, scale)[index + (barracks ? 1 : 0)];
      if (slot === undefined) continue;
      const entry = this.entry(used++);
      entry.view.position.set(at.x + slot.x, at.y + slot.y);
      entry.view.scale.set(scale);
      entry.view.visible = true;
      this.show(entry, sign);
    }
    for (let i = used; i < this.pool.length; i++) {
      const entry = this.pool[i];
      if (entry !== undefined) entry.view.visible = false;
    }
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.style.destroy();
  }

  private show(entry: Sign, sign: DefenseSign): void {
    const enemy = sign.owner !== this.me;
    const color = ownerColor(this.me, sign.owner);
    const pips = enemy ? null : sign.pips;
    entry.sprite.set(defenseCounterSpec(color, enemy, pips));
    const layout = pips === null ? null : counterLayout(pips);
    const numbers = layout?.numbers ?? [];
    const left = layout === null ? 0 : -DEFENSE_PIPS.gap - layout.width;
    for (const [i, text] of [entry.gathered, entry.room].entries()) {
      const number = numbers[i];
      text.visible = number !== undefined;
      if (number === undefined) continue;
      if (text.text !== number.text) text.text = number.text;
      text.position.set(left + number.x, 0.4);
    }
  }

  private entry(index: number): Sign {
    let entry = this.pool[index];
    if (entry === undefined) {
      const view = this.root.addChild(new Container({ label: 'defense' }));
      const sprite = view.addChild(this.sprites.sprite());
      const text = (): Text =>
        view.addChild(
          new Text({
            text: '',
            style: this.style,
            anchor: { x: 0, y: 0.5 },
            resolution: this.resolution * markScale(this.cameraScale),
            visible: false,
          }),
        );
      entry = { view, sprite, gathered: text(), room: text() };
      this.pool.push(entry);
    }
    return entry;
  }
}
