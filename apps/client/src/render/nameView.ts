import { Container, Text, TextStyle } from 'pixi.js';
import type { MapFile } from '../protocol.gen.ts';
import type { MapLayers } from './layers.ts';
import {
  CAPTION,
  captionKind,
  captionScale,
  captionTop,
  captionVisible,
  type CaptionKind,
} from './nameLayout.ts';
import { BG, PAPER } from './style.ts';

interface Caption {
  readonly kind: CaptionKind;
  /** At the place, scaled to keep the size on screen. */
  readonly box: Container;
  readonly text: Text;
}

/**
 * The place names (#449): one pooled `Text` per node of the map, under the signs of the place, at a
 * constant size on screen (`nameLayout.ts`), hidden below the zoom threshold of its kind. The
 * names come from the map file only. The text is in screen px (the container is scaled by the
 * inverse of the camera), so it needs the device pixel ratio as its resolution, not the label
 * resolution of the world text. They live in the `nodes` layer, above the cities and under the
 * groups and the fog. `destroy()` releases every object.
 */
export class NameView {
  private readonly holder: Container;
  private readonly captions: (Caption | null)[];
  private readonly styles: Record<CaptionKind, TextStyle>;
  private cameraScale = 1;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly radiusOf: (node: number) => number,
    resolution: number,
  ) {
    const style = (kind: CaptionKind): TextStyle =>
      new TextStyle({
        fontFamily: 'system-ui, sans-serif',
        fontSize: CAPTION[kind].fontSize,
        fontWeight: CAPTION[kind].weight,
        fill: PAPER,
        stroke: { color: BG, width: CAPTION.strokePx, join: 'round' },
      });
    this.styles = { city: style('city'), province: style('province') };
    this.holder = layers.layer.nodes.addChild(new Container({ label: 'node-names' }));
    this.captions = map.nodes.map((node) => {
      if (node.name === '') return null;
      const kind = captionKind(node.kind);
      const box = this.holder.addChild(new Container({ label: `name-${String(node.id)}` }));
      const text = box.addChild(
        new Text({
          text: node.name,
          style: this.styles[kind],
          anchor: { x: 0.5, y: 0 },
          alpha: CAPTION[kind].alpha,
          resolution,
          y: CAPTION.gapPx,
        }),
      );
      box.visible = false;
      return { kind, box, text };
    });
    this.place();
  }

  /** The camera moved: the size on screen, and which captions show. */
  setCameraScale(scale: number): void {
    if (scale === this.cameraScale) return;
    this.cameraScale = scale;
    this.place();
  }

  /** The text resolution: the device pixel ratio. */
  setLabelResolution(resolution: number): void {
    for (const caption of this.captions) {
      if (caption !== null && caption.text.resolution !== resolution) {
        caption.text.resolution = resolution;
      }
    }
  }

  /** A new snapshot may change the size of a city (its capacity class): the captions follow. */
  refresh(): void {
    this.place();
  }

  destroy(): void {
    this.holder.destroy({ children: true });
    this.styles.city.destroy();
    this.styles.province.destroy();
  }

  private place(): void {
    const scale = captionScale(this.cameraScale);
    this.map.nodes.forEach((node, id) => {
      const caption = this.captions[id];
      if (caption === undefined || caption === null) return;
      const visible = captionVisible(caption.kind, this.cameraScale);
      caption.box.visible = visible;
      if (!visible) return;
      caption.box.scale.set(scale);
      caption.box.position.set(node.x, node.y + captionTop(caption.kind, this.radiusOf(id)));
    });
  }
}
