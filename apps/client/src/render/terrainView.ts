import { Container, Graphics, Sprite, type Renderer, type Texture } from 'pixi.js';
import type { MapFile, Terrain } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { stampPoints, type Segment } from './regionLayout.ts';
import {
  BG,
  PAPER,
  SNOW_ALPHA,
  STAMPS,
  STAMP_CITY_CLEARANCE,
  STAMP_ROAD_CLEARANCE,
} from './style.ts';

/** Resolution of the stamp textures: stamps stay crisp up to a 4x zoom of the map. */
const STAMP_RESOLUTION = 4;

/** Draw the stamp of a terrain around (0, 0): dark ink, drawn once and baked into a texture. */
function drawStamp(terrain: Terrain): Graphics {
  const ink = { color: BG, alpha: STAMPS[terrain].alpha };
  const g = new Graphics();
  switch (terrain) {
    case 'forest':
      // Two fir trees: a triangle on a stem each.
      for (const [x, y] of [
        [-6, -2],
        [7, 5],
      ] as const) {
        g.poly([x, y - 7, x + 6, y + 4, x - 6, y + 4]).fill(ink);
        g.moveTo(x, y + 4).lineTo(x, y + 7);
      }
      g.stroke({ ...ink, width: 1.5 });
      break;
    case 'mountains':
      // Two peaks, the near one with a white cap (chevrons, not filled).
      for (const [x, y, size] of [
        [-8, 5, 0.75],
        [7, 7, 1],
      ] as const) {
        g.moveTo(x - 11 * size, y + 5 * size)
          .lineTo(x, y - 9 * size)
          .lineTo(x + 11 * size, y + 5 * size);
      }
      g.stroke({ ...ink, width: 2, join: 'round' });
      g.moveTo(3.5, 2.5).lineTo(7, -2).lineTo(10.5, 2.5);
      g.stroke({ color: PAPER, alpha: SNOW_ALPHA, width: 1.6, join: 'round' });
      break;
    case 'plains':
      // A tuft of grass: three short blades.
      g.moveTo(-4, 2).lineTo(-2, -2).moveTo(0, 2).lineTo(0, -3).moveTo(4, 2).lineTo(2, -2);
      g.stroke({ ...ink, width: 1.3, cap: 'round' });
      break;
  }
  return g;
}

/**
 * Terrain stamps of the map (ui-style.md 9.2): in the Voronoi cell of every city, dark stamps of
 * its terrain (fir trees, peaks with a white cap, tufts of grass) on a grid whose rows alternate,
 * shifted by the id of the city. Each stamp is drawn once, baked into a texture with
 * `renderer.generateTexture` and laid out as sprites; there is no randomness, so the picture is the
 * same at every start. `destroy()` releases the sprites and the textures.
 */
export class TerrainView {
  private readonly container = new Container({ label: 'terrain-stamps', eventMode: 'none' });
  private readonly textures: Texture[] = [];

  constructor(
    map: MapFile,
    cells: readonly (readonly Point[])[],
    parent: Container,
    renderer: Renderer,
    /** Index in `parent` to insert the container at; the top by default. */
    at?: number,
  ) {
    const stamp = new Map<Terrain, { texture: Texture; anchor: Point }>();
    for (const terrain of ['forest', 'mountains', 'plains'] as const) {
      const g = drawStamp(terrain);
      const bounds = g.getLocalBounds();
      const texture = renderer.generateTexture({
        target: g,
        resolution: STAMP_RESOLUTION,
        antialias: true,
      });
      g.destroy();
      this.textures.push(texture);
      stamp.set(terrain, {
        texture,
        anchor: { x: -bounds.x / bounds.width, y: -bounds.y / bounds.height },
      });
    }
    const roads: Segment[] = [];
    for (const edge of map.edges) {
      const a = map.nodes[edge.a];
      const b = map.nodes[edge.b];
      if (a !== undefined && b !== undefined) roads.push({ a, b });
    }
    for (const node of map.nodes) {
      const cell = cells[node.id];
      const baked = stamp.get(node.terrain);
      if (cell === undefined || baked === undefined) continue;
      const points = stampPoints(
        cell,
        STAMPS[node.terrain].cell,
        node.id,
        node,
        roads,
        STAMP_CITY_CLEARANCE,
        STAMP_ROAD_CLEARANCE,
      );
      for (const p of points) {
        const sprite = new Sprite({ texture: baked.texture, anchor: baked.anchor, x: p.x, y: p.y });
        sprite.eventMode = 'none';
        this.container.addChild(sprite);
      }
    }
    if (at === undefined) parent.addChild(this.container);
    else parent.addChildAt(this.container, at);
  }

  setVisible(visible: boolean): void {
    this.container.visible = visible;
  }

  /** Number of stamps drawn (tests and the performance check). */
  get count(): number {
    return this.container.children.length;
  }

  destroy(): void {
    this.container.destroy({ children: true });
    for (const texture of this.textures) texture.destroy(true);
  }
}
