import { CanvasTextMetrics, type Container, type Graphics, type Renderer } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { SnapshotMsg } from '../protocol.gen.ts';
import { ENGRAVE, RULED_VEIL } from './engraving.ts';
import { FogView } from './fogView.ts';
import { createLayers, type MapLayers } from './layers.ts';
import { MapView } from './mapView.ts';
import { EntityKit } from './shapes.ts';
import { TERRAIN_FILL } from './style.ts';
import { testSprites } from './testSprites.ts';
import { greyPixels, greyed } from './veilView.ts';

// The Ruled veil (#829 round 3, topic n; #842): it covers only the areas the snapshot hides, keeps
// the owner's band and borders of those areas over it, and draws the edge of sight between them
// and the seen ones.

const map = DEFAULT_MAP;

interface Fill {
  readonly color: number;
  readonly alpha: number;
  readonly shapes: number;
  readonly textured: boolean;
}

function fillsOf(g: Container | undefined): Fill[] {
  const instructions = ((g as Graphics | undefined)?.context.instructions ?? []) as unknown as {
    action: string;
    data: {
      style: { color: number; alpha: number; textureSpace: string };
      path: { shapePath: { shapePrimitives: unknown[] } };
    };
  }[];
  return instructions
    .filter((i) => i.action === 'fill')
    .map((i) => ({
      color: i.data.style.color,
      alpha: i.data.style.alpha,
      shapes: i.data.path.shapePath.shapePrimitives.length,
      textured: i.data.style.textureSpace === 'global',
    }));
}

const strokes = (g: Container | undefined): number =>
  ((g as Graphics | undefined)?.context.instructions ?? []).filter((i) => i.action === 'stroke')
    .length;

describe('greyed and greyPixels', () => {
  it('take the share of the saturation out, keeping the luma', () => {
    expect(greyed(0x808080, 0.9)).toBe(0x808080);
    const red = greyed(0xff0000, 1);
    expect(red >> 16).toBe(red & 255);
    expect(greyed(0x336699, 0)).toBe(0x336699);
  });

  it('grey every pixel of a picture as greyed greys one colour, alpha kept', () => {
    const colours = [0x336699, 0xc8a050, 0x808080, 0x0b0a08];
    const data = new Uint8ClampedArray(
      colours.flatMap((c) => [c >> 16, (c >> 8) & 255, c & 255, 200]),
    );
    greyPixels(data, 0.9);
    colours.forEach((c, i) => {
      const got =
        ((data[i * 4] ?? 0) << 16) | ((data[i * 4 + 1] ?? 0) << 8) | (data[i * 4 + 2] ?? 0);
      const want = greyed(c, 0.9);
      // Within one level per channel (ties round to even in a clamped array).
      for (const shift of [16, 8, 0]) {
        expect(Math.abs(((got >> shift) & 255) - ((want >> shift) & 255))).toBeLessThanOrEqual(1);
      }
      expect(data[i * 4 + 3]).toBe(200);
    });
  });
});

describe('MapView, the Ruled veil over the hidden areas', () => {
  let layers: MapLayers;
  let view: MapView;
  const part = (label: string): Container | undefined =>
    layers.layer.fog.children
      .find((c) => c.label === 'fog-veil')
      ?.children.find((c) => c.label === label);
  const ground = (): Container | undefined =>
    layers.layer.background.children.find((c) => c.label === 'fog-ground');
  /** The first half of the cities player 0's, the second half player 1's. */
  const halves = (): (0 | 1)[] => map.nodes.map((_, i) => (i < map.nodes.length / 2 ? 0 : 1));

  beforeEach(() => {
    layers = createLayers();
    view = new MapView(map, layers, 0, {} as Renderer, true);
    view.setOwners(halves());
  });
  afterEach(() => {
    view.destroy();
  });

  it('is not drawn while nothing is hidden', () => {
    view.setHidden([]);
    expect(fillsOf(part('fog-veil-rules'))).toEqual([]);
    expect(ground()?.visible).toBe(false);
  });

  it('veils the hidden areas only: one fill of the tile with the dark veil and the rules (#854)', () => {
    view.setHidden([1, 2]);
    const fills = fillsOf(part('fog-veil-rules'));
    expect(fills).toHaveLength(1);
    // The tile carries the colours (`paintRows`): the fill draws it untinted.
    expect(fills[0]).toMatchObject({ color: 0xffffff, alpha: 1, shapes: 2, textured: true });
  });

  it('greys the ground of the hidden areas (without a picture: the terrain colour greyed)', () => {
    view.setHidden([1]);
    expect(ground()?.visible).toBe(true);
    const terrain = map.nodes[1]?.terrain;
    if (terrain === undefined) throw new Error('no node 1');
    expect(fillsOf(ground()).map((f) => f.color)).toEqual([
      greyed(TERRAIN_FILL[terrain], RULED_VEIL.grey),
    ]);
    // The ground goes in the terrain mode.
    view.setTerrainMode(true);
    expect(ground()?.visible).toBe(false);
    view.setTerrainMode(false);
    expect(ground()?.visible).toBe(true);
  });

  it('keeps the band and the borders of the hidden areas over the veil, and of no other area', () => {
    // Every area hidden: the band of both owners is drawn again over the veil, as are the lines.
    view.setHidden(map.nodes.map((n) => n.id));
    const band = fillsOf(part('fog-band'));
    expect(band.every((f) => f.textured)).toBe(true);
    expect(band.map((f) => f.color).sort()).toEqual([ENGRAVE.own, ENGRAVE.enemy].sort());
    expect(strokes(part('fog-borders'))).toBeGreaterThan(0);
    // One owner everywhere: no border, nothing of it over the veil.
    view.setOwners(map.nodes.map(() => 0));
    expect(fillsOf(part('fog-band'))).toEqual([]);
    expect(strokes(part('fog-borders'))).toBe(0);
    // Nothing hidden: nothing of the band over a veil either.
    view.setOwners(halves());
    view.setHidden([]);
    expect(fillsOf(part('fog-band'))).toEqual([]);
  });

  it('draws the edge of sight where a hidden area meets a seen one, and none when all are hidden', () => {
    view.setHidden([1]);
    expect(strokes(part('fog-edge'))).toBe(2);
    view.setHidden(map.nodes.map((n) => n.id));
    expect(strokes(part('fog-edge'))).toBe(0);
  });

  it('is redrawn when the set of hidden areas changes, and only then', () => {
    view.setHidden([1, 2]);
    const veil = part('fog-veil-rules') as Graphics;
    const redraw = vi.spyOn(veil, 'clear');
    view.setHidden([1, 2]);
    expect(redraw).not.toHaveBeenCalled();
    view.setHidden([1, 2, 3]);
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('lies under the memory ghosts of the fog view', () => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
    const kit = new EntityKit(0, testSprites());
    const fog = new FogView(map, layers, 0, kit, 1, 10, () => 17);
    const base: SnapshotMsg = devSnapshot(map, DEV_RULES, 600);
    fog.update(base);
    const order = layers.layer.fog.children.map((c) => c.label);
    expect(order.indexOf('fog-veil')).toBe(0);
    expect(order.indexOf('fog-veil')).toBeLessThan(order.indexOf('fog-ghosts'));
    fog.destroy();
    kit.destroy();
    vi.restoreAllMocks();
  });
});
