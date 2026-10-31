import { describe, expect, it } from 'vitest';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import { MENU_MAP } from './menuMap.ts';
import {
  BAR_BOTTOM,
  DOCK_NARROW_LEFT,
  DOCK_PANEL_LEFT,
  DOCK_PANEL_RIGHT,
  FOG_FADE,
  FOG_TOP_FADE,
  FOG_WIDTH,
  RAIL_BESIDE_MIN_WIDTH,
  RAIL_RIGHT,
  dockOwnLeft,
  layoutScene,
  starPoints,
} from './menuScene.ts';

const POOL = BUNDLED_MAPS.filter((m) => ['crossroads', 'highway', 'narrows', 'ridge'].includes(m.meta.name));
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
          expect(scene.ownCapital.x).toBeGreaterThanOrEqual(RAIL_RIGHT);
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
        for (const node of scene.nodes) expect(node.x).toBeGreaterThanOrEqual(RAIL_RIGHT);
      });
    }

    it('lays out as drawn in the mockup at 1280x800: one world unit is one px', () => {
      const scene = layoutScene(MENU_MAP, 1280, 800);
      expect(scene.scale).toBe(1);
      expect(scene.ownCapital).toEqual({ x: RAIL_RIGHT, y: 420 });
    });

    it('sizes the terrain and the territory by the spacing of the map, as in the mockup', () => {
      const scene = layoutScene(MENU_MAP, 1280, 800);
      expect(Math.round(scene.terrainRadius)).toBe(58);
      expect(Math.round(scene.territoryRadius)).toBe(44);
    });

    it('runs the front road down the middle of the valley', () => {
      const scene = layoutScene(MENU_MAP, 1280, 800);
      expect(scene.front.length).toBe(5);
      for (const point of scene.front) expect(point.y).toBe(scene.ownCapital.y);
    });
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

describe('the map behind the Dock panel (#473)', () => {
  const map = POOL[0] as (typeof POOL)[number];

  it('keeps the own capital between the rail and the panel, and the enemy one right of it', () => {
    for (const width of [1280, 1366, 1600]) {
      const scene = layoutScene(map, width, 720, dockOwnLeft(width));
      // The ring of a capital is about 32 px; the pill with the opponent's nick is 70 px to each side.
      expect(scene.ownCapital.x + 32).toBeLessThanOrEqual(DOCK_PANEL_LEFT);
      expect(scene.enemyCapital.x - 70).toBeGreaterThanOrEqual(DOCK_PANEL_RIGHT);
    }
  });

  it('moves the whole map out from under the panel in a wide window', () => {
    for (const width of [1920, 2560]) {
      const left = dockOwnLeft(width);
      expect(left).toBeGreaterThan(DOCK_PANEL_RIGHT);
      const scene = layoutScene(map, width, 1080, left);
      for (const node of scene.nodes) expect(node.x).toBeGreaterThan(DOCK_PANEL_RIGHT);
      expect(scene.enemyCapital.x).toBeLessThan(width);
      expect(width - scene.fogStart).toBeGreaterThanOrEqual(FOG_WIDTH);
    }
  });

  it('keeps the own capital visible left of a narrower panel in a small window', () => {
    for (const width of [900, 1024, 1099]) {
      const scene = layoutScene(map, width, 640, dockOwnLeft(width));
      expect(scene.ownCapital.x + 32).toBeLessThanOrEqual(DOCK_NARROW_LEFT);
      expect(scene.ownCapital.x).toBeGreaterThan(RAIL_RIGHT - 160);
    }
  });

  it('leaves the default layout in the flowing column of a window under 900 px', () => {
    expect(dockOwnLeft(800)).toBeUndefined();
  });
});

describe('starPoints', () => {
  it('draws five tips and five dents', () => {
    expect(starPoints(10, 10, 5).split(' ')).toHaveLength(10);
  });
});
