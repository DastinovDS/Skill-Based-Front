import { describe, expect, it } from 'vitest';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import { ENTRY_MAP, MENU_MAP, MENU_WORLD } from './menuMap.ts';
import {
  COVER_ZOOM,
  FOG_FADE,
  FOG_WIDTH,
  PIECES_PX,
  layoutEntry,
  layoutScene,
  menuCityRadius,
  pieceScale,
  starPoints,
} from './menuScene.ts';

const POOL = BUNDLED_MAPS.filter((m) =>
  ['crossroads', 'highway', 'narrows', 'ridge'].includes(m.meta.name),
);
// The menu map first: the client draws it; the pool maps keep the layout general.
const MAPS = [MENU_MAP, ...POOL];

// The windows the menu has to work in: the smallest supported, a laptop, a desktop, an ultrawide.
const WINDOWS = [
  { width: 1024, height: 640 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1080 },
] as const;

describe('layoutScene (#471; over the whole window since #866)', () => {
  it('finds the pool maps to test with', () => {
    expect(POOL).toHaveLength(4);
  });

  for (const map of MAPS) {
    for (const size of WINDOWS) {
      describe(`${map.meta.name} in ${String(size.width)}x${String(size.height)}`, () => {
        const scene = layoutScene(map, size.width, size.height);

        it('covers the window with the map, a little larger than it takes (cropped)', () => {
          const cover = Math.max(size.width / map.meta.width, size.height / map.meta.height);
          expect(scene.scale).toBeCloseTo(cover * COVER_ZOOM, 6);
          expect(scene.origin.x).toBeLessThanOrEqual(0.001);
          expect(scene.origin.y).toBeLessThanOrEqual(0.001);
          expect(scene.origin.x + map.meta.width * scene.scale).toBeGreaterThanOrEqual(
            size.width - 0.001,
          );
          expect(scene.origin.y + map.meta.height * scene.scale).toBeGreaterThanOrEqual(
            size.height - 0.001,
          );
        });

        it('puts the enemy capital right of the own one, in the fog, in the window', () => {
          expect(scene.enemyCapital.x).toBeGreaterThan(scene.ownCapital.x);
          expect(scene.enemyCapital.x).toBeGreaterThan(scene.fogStart);
          expect(scene.enemyCapital.x).toBeLessThan(size.width);
        });

        it('has a fog band at the right edge', () => {
          expect(size.width - scene.fogStart).toBeGreaterThanOrEqual(FOG_WIDTH);
          expect(scene.fadeStart).toBe(scene.fogStart - FOG_FADE);
        });

        it('has a road from one capital to the other', () => {
          expect(scene.front.length).toBeGreaterThan(2);
          expect(scene.front[0]).toEqual(scene.ownCapital);
          expect(scene.front.at(-1)).toEqual(scene.enemyCapital);
        });

        it('keeps the world position of every node for the map layer', () => {
          for (const node of scene.nodes) {
            expect(node.x).toBeCloseTo(scene.origin.x + node.world.x * scene.scale, 6);
            expect(node.y).toBeCloseTo(scene.origin.y + node.world.y * scene.scale, 6);
          }
        });
      });
    }
  }

  describe('the menu map (#866)', () => {
    it('is the 48-node map marches, outside the server pool', () => {
      expect(MENU_MAP.meta.name).toBe('marches');
      expect(MENU_MAP.nodes).toHaveLength(48);
      expect(BUNDLED_MAPS.map((m) => m.meta.name)).not.toContain('marches');
    });

    for (const size of WINDOWS) {
      it(`keeps the front road under the bar, in the window, at ${String(size.width)}x${String(size.height)}`, () => {
        const scene = layoutScene(MENU_MAP, size.width, size.height);
        for (const point of scene.front) {
          expect(point.y).toBeGreaterThan(76);
          expect(point.y).toBeLessThan(size.height);
        }
      });
    }
  });

  it('takes the owners of the picture over those of the map file', () => {
    const scene = layoutScene(MENU_MAP, 1280, 800, MENU_WORLD.owners);
    for (const node of scene.nodes) expect(node.owner).toBe(MENU_WORLD.owners[node.id]);
    const plain = layoutScene(MENU_MAP, 1280, 800);
    expect(plain.nodes.filter((n) => n.owner === 0).length).toBeLessThan(
      scene.nodes.filter((n) => n.owner === 0).length,
    );
  });

  it('marks the own roads and the owners from the map file', () => {
    const map = POOL[0];
    if (map === undefined) throw new Error('no pool map');
    const scene = layoutScene(map, 1280, 720);
    for (const edge of scene.edges.filter((e) => e.own)) {
      expect(edge.a.owner).toBe(0);
      expect(edge.b.owner).toBe(0);
    }
    expect(scene.edges.some((e) => e.own)).toBe(true);
    expect(scene.edges.some((e) => !e.own)).toBe(true);
  });

  it('survives a map without capitals', () => {
    const empty = { ...(POOL[0] as (typeof POOL)[number]), nodes: [], edges: [] };
    const scene = layoutScene(empty, 1280, 720);
    expect(scene.nodes).toEqual([]);
    expect(scene.front).toEqual([]);
  });
});

describe('layoutEntry (#839, the entry of out-of-game-style-r3.html)', () => {
  it('lays the valley under the entry screen, another map than the menus (#866)', () => {
    expect(ENTRY_MAP.meta.name).toBe('valley');
    expect(ENTRY_MAP.meta.name).not.toBe(MENU_MAP.meta.name);
  });

  it('covers the window with the whole entry map, centred, without fog', () => {
    for (const [width, height] of [
      [1280, 800],
      [1280, 720],
      [800, 500],
      [2560, 1080],
    ] as const) {
      const scene = layoutEntry(ENTRY_MAP, width, height);
      expect(scene.fog).toBe(false);
      expect(scene.fadeStart).toBeGreaterThanOrEqual(width);
      expect(scene.origin.x).toBeLessThanOrEqual(0.001);
      expect(scene.origin.y).toBeLessThanOrEqual(0.001);
      expect(scene.origin.x + ENTRY_MAP.meta.width * scene.scale).toBeGreaterThanOrEqual(
        width - 0.001,
      );
      expect(scene.origin.y + ENTRY_MAP.meta.height * scene.scale).toBeGreaterThanOrEqual(
        height - 0.001,
      );
      expect(scene.origin.x * 2 + ENTRY_MAP.meta.width * scene.scale).toBeCloseTo(width, 6);
    }
  });

  it('lays the map out as the mockup does at 1280x800: Highhold at 63 px, Stormcrown at 1103', () => {
    const scene = layoutEntry(ENTRY_MAP, 1280, 800);
    expect(scene.scale).toBeCloseTo(1.6, 6);
    expect(scene.ownCapital.x).toBeCloseTo(64, 6);
    expect(scene.enemyCapital.x).toBeCloseTo(1104, 6);
  });
});

describe('pieceScale', () => {
  it('keeps the pieces at most PIECES_PX px a unit on the screen, never above the match size', () => {
    const big = layoutEntry(ENTRY_MAP, 1280, 800);
    expect(pieceScale(big) * big.scale).toBeCloseTo(PIECES_PX, 6);
    const small = layoutEntry(ENTRY_MAP, 400, 280);
    expect(pieceScale(small)).toBe(1);
  });
});

describe('menuCityRadius', () => {
  it('sizes a city by its kind as the match sizes it by the capacity of the kind', () => {
    expect(menuCityRadius('capital')).toBe(20);
    expect(menuCityRadius('city_medium')).toBe(17);
    expect(menuCityRadius('city_small')).toBe(14);
    expect(menuCityRadius('province')).toBe(8);
  });
});

describe('starPoints', () => {
  it('draws five tips and five dents', () => {
    expect(starPoints(10, 10, 5).split(' ')).toHaveLength(10);
  });
});
