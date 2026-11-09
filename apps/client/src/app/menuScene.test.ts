import { describe, expect, it } from 'vitest';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import { MENU_MAP } from './menuMap.ts';
import {
  BAR_BOTTOM,
  DOCK_PANEL,
  FOG_FADE,
  FOG_TOP_FADE,
  FOG_WIDTH,
  RAIL,
  RAIL_BESIDE_MIN_WIDTH,
  dockOwnLeft,
  dockPanelRight,
  layoutEntry,
  layoutScene,
  menuCityRadius,
  railRight,
  starPoints,
} from './menuScene.ts';

const POOL = BUNDLED_MAPS.filter((m) =>
  ['crossroads', 'highway', 'narrows', 'ridge'].includes(m.meta.name),
);
// The menu map (#474) first: the client draws it; the pool maps keep the layout general.
const MAPS = [MENU_MAP, ...POOL];

// The windows the menu has to work in: the smallest supported, a laptop, a desktop, an ultrawide.
const WINDOWS = [
  { width: 1024, height: 640 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1080 },
] as const;

describe('layoutScene (#471)', () => {
  it('finds the pool maps to test with', () => {
    expect(POOL).toHaveLength(4);
  });

  for (const map of MAPS) {
    for (const size of WINDOWS) {
      describe(`${map.meta.name} in ${String(size.width)}x${String(size.height)}`, () => {
        const scene = layoutScene(map, size.width, size.height);

        it('puts the own capital right of the text rail, the enemy one in the fog', () => {
          // #474: also at 1024 px, where 40% of the width put it under the key hints of the rail.
          expect(size.width).toBeGreaterThanOrEqual(RAIL_BESIDE_MIN_WIDTH);
          expect(scene.ownCapital.x).toBeGreaterThanOrEqual(railRight(size.width));
          expect(scene.enemyCapital.x).toBeGreaterThan(scene.ownCapital.x);
          expect(scene.enemyCapital.x).toBeGreaterThan(scene.fogStart);
          expect(scene.enemyCapital.x).toBeLessThan(size.width);
        });

        it('has a fog band at the right edge that never reaches the title bar (owner, #471)', () => {
          // The chip of the player is in the top right corner, above the fog: no edge under it.
          expect(size.width - scene.fogStart).toBeGreaterThanOrEqual(FOG_WIDTH);
          expect(scene.fadeStart).toBe(scene.fogStart - FOG_FADE);
          expect(BAR_BOTTOM).toBeGreaterThanOrEqual(28 + 36);
          for (const node of scene.nodes) expect(node.y).toBeGreaterThan(BAR_BOTTOM + FOG_TOP_FADE);
        });

        it('fits every node into the window', () => {
          for (const node of scene.nodes) {
            expect(node.x).toBeGreaterThan(0);
            expect(node.x).toBeLessThan(size.width);
            expect(node.y).toBeGreaterThan(0);
            expect(node.y).toBeLessThan(size.height);
          }
        });

        it('has a road from one capital to the other', () => {
          expect(scene.front.length).toBeGreaterThan(2);
          expect(scene.front[0]).toEqual(scene.ownCapital);
          expect(scene.front.at(-1)).toEqual(scene.enemyCapital);
        });
      });
    }
  }

  describe('the menu map (#474)', () => {
    it('is the valley map, outside the server pool', () => {
      expect(MENU_MAP.meta.name).toBe('valley');
      expect(BUNDLED_MAPS.map((m) => m.meta.name)).not.toContain('valley');
    });

    for (const size of WINDOWS) {
      it(`puts no node under the text rail in ${String(size.width)}x${String(size.height)}`, () => {
        const scene = layoutScene(MENU_MAP, size.width, size.height);
        for (const node of scene.nodes) {
          expect(node.x).toBeGreaterThanOrEqual(railRight(size.width));
        }
      });
    }

    it('puts the own capital right of the rail of #845 at 1280x800, the map at one scale', () => {
      const scene = layoutScene(MENU_MAP, 1280, 800);
      // The rail: 128 px from the left, 540 px wide, then the room of the capital's ring.
      expect(railRight(1280)).toBe(RAIL.left + RAIL.width + 34);
      expect(scene.ownCapital).toEqual({ x: railRight(1280), y: 420 });
      // The baked ground starts at the map's 0,0: the capital (40, 280) is at 40 units from it.
      expect(scene.origin.x + 40 * scene.scale).toBeCloseTo(scene.ownCapital.x, 6);
      expect(scene.origin.y + 280 * scene.scale).toBeCloseTo(scene.ownCapital.y, 6);
    });

    it('keeps the world position of every node for the map layer', () => {
      const scene = layoutScene(MENU_MAP, 1280, 800);
      for (const node of scene.nodes) {
        expect(node.x).toBeCloseTo(scene.origin.x + node.world.x * scene.scale, 6);
        expect(node.y).toBeCloseTo(scene.origin.y + node.world.y * scene.scale, 6);
      }
    });

    it('runs the front road down the middle of the valley', () => {
      const scene = layoutScene(MENU_MAP, 1280, 800);
      expect(scene.front.length).toBe(5);
      for (const point of scene.front) expect(point.y).toBe(scene.ownCapital.y);
    });
  });

  it('moves the rail in by 64 px under 1280 px (front.css)', () => {
    expect(railRight(1279)).toBe(RAIL.narrowLeft + RAIL.width + 34);
  });

  it('flows the map under the rail in a small window, where the rail is over the picture', () => {
    const scene = layoutScene(MENU_MAP, 800, 500);
    expect(scene.ownCapital.x).toBe(320);
  });

  it('marks the own roads and the owners from the map file', () => {
    const map = POOL[0];
    if (map === undefined) throw new Error('no pool map');
    const scene = layoutScene(map, 1280, 720);
    const mine = scene.nodes.filter((n) => n.owner === 0);
    expect(mine.length).toBeGreaterThan(0);
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

describe('the map behind the Dock panel (#473, the panel of #845)', () => {
  const map = POOL[0] as (typeof POOL)[number];

  it('knows where the panel ends: 64 px short of the edge (24 under 1280 px), at most 960 wide', () => {
    expect(dockPanelRight(1024)).toBe(1024 - DOCK_PANEL.narrowRight);
    expect(dockPanelRight(1280)).toBe(1280 - DOCK_PANEL.right);
    expect(dockPanelRight(2560)).toBe(DOCK_PANEL.left + DOCK_PANEL.maxWidth);
  });

  it('moves the whole map out from under the panel in a wide window', () => {
    for (const width of [1920, 2560]) {
      const left = dockOwnLeft(width);
      expect(left).toBeGreaterThan(dockPanelRight(width));
      const scene = layoutScene(map, width, 1080, left);
      for (const node of scene.nodes) expect(node.x).toBeGreaterThan(dockPanelRight(width));
      expect(scene.enemyCapital.x).toBeLessThan(width);
      expect(width - scene.fogStart).toBeGreaterThanOrEqual(FOG_WIDTH);
    }
  });

  it('leaves the map of the main screen under the translucent panel where there is no room', () => {
    for (const width of [800, 1024, 1280, 1600]) expect(dockOwnLeft(width)).toBeUndefined();
  });
});

describe('layoutEntry (#839, the entry of out-of-game-style-r3.html)', () => {
  it('covers the window with the whole menu map, centred, without fog', () => {
    for (const [width, height] of [
      [1280, 800],
      [1280, 720],
      [800, 500],
      [2560, 1080],
    ] as const) {
      const scene = layoutEntry(MENU_MAP, width, height);
      expect(scene.fog).toBe(false);
      expect(scene.fadeStart).toBeGreaterThanOrEqual(width);
      expect(scene.origin.x).toBeLessThanOrEqual(0.001);
      expect(scene.origin.y).toBeLessThanOrEqual(0.001);
      expect(scene.origin.x + MENU_MAP.meta.width * scene.scale).toBeGreaterThanOrEqual(
        width - 0.001,
      );
      expect(scene.origin.y + MENU_MAP.meta.height * scene.scale).toBeGreaterThanOrEqual(
        height - 0.001,
      );
      expect(scene.origin.x * 2 + MENU_MAP.meta.width * scene.scale).toBeCloseTo(width, 6);
    }
  });

  it('lays the map out as the mockup does at 1280x800: Highhold at 63 px, Stormcrown at 1103', () => {
    const scene = layoutEntry(MENU_MAP, 1280, 800);
    expect(scene.scale).toBeCloseTo(1.6, 6);
    expect(scene.ownCapital.x).toBeCloseTo(64, 6);
    expect(scene.enemyCapital.x).toBeCloseTo(1104, 6);
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
