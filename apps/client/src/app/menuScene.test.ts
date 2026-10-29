import { describe, expect, it } from 'vitest';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import {
  BAR_BOTTOM,
  FOG_FADE,
  FOG_TOP_FADE,
  FOG_WIDTH,
  RAIL_RIGHT,
  layoutScene,
  starPoints,
} from './menuScene.ts';

const POOL = BUNDLED_MAPS.filter((m) => ['crossroads', 'highway', 'ridge'].includes(m.meta.name));

// The windows the menu has to work in: the smallest supported, a laptop, a desktop, an ultrawide.
const WINDOWS = [
  { width: 1024, height: 640 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1080 },
] as const;

describe('layoutScene (#471)', () => {
  it('finds the pool maps to test with', () => {
    expect(POOL).toHaveLength(3);
  });

  for (const map of POOL) {
    for (const size of WINDOWS) {
      describe(`${map.meta.name} in ${String(size.width)}x${String(size.height)}`, () => {
        const scene = layoutScene(map, size.width, size.height);

        it('puts the own capital right of the text rail, the enemy one in the fog', () => {
          expect(scene.ownCapital.x).toBeGreaterThanOrEqual(Math.min(RAIL_RIGHT, size.width * 0.4));
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

describe('starPoints', () => {
  it('draws five tips and five dents', () => {
    expect(starPoints(10, 10, 5).split(' ')).toHaveLength(10);
  });
});
