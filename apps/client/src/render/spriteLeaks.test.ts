import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import type { GroupView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import { MAX_BAKED, SpriteCache } from './bake.ts';
import { CityView } from './cityView.ts';
import { EntityView } from './entityView.ts';
import { createLayers } from './layers.ts';
import { fakeBaker } from './testSprites.ts';

const map = DEFAULT_MAP;
const base = devSnapshot(map, DEV_RULES, 100);

/** A deterministic stream of numbers (a test must not depend on `Math.random`). */
function stream(seed: number): (below: number) => number {
  let state = seed;
  return (below) => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state % below;
  };
}

/** A snapshot with owners, stock and groups (counts of every size, both modes) changed by `next`. */
function varied(tick: number, next: (below: number) => number): SnapshotMsg {
  const nodes = base.view.nodes.map((n) => {
    const owner: PlayerId | null = ([0, 1, null] as const).at(next(3)) ?? null;
    return {
      ...n,
      owner,
      warehouse: n.warehouse === null ? null : next(n.capacity + 1),
    };
  });
  const groups: GroupView[] = map.nodes
    .filter(() => next(2) === 0)
    .map((n, i) => {
      const units = 1 + next(40);
      return {
        id: `g${String(i)}`,
        units,
        charged: next(units + 1),
        mode: next(4) === 0 ? 'defense' : 'attack',
        location: { kind: 'node', node: n.id },
        order: null,
        defense_bonus: next(3),
        defense_cap: 3,
      } satisfies GroupView;
    });
  return { ...base, tick, view: { ...base.view, nodes, groups } };
}

describe('the baked sprites over a long scene', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the number of textures bounded by the looks, not by the length of the match', () => {
    const baker = fakeBaker();
    const sprites = new SpriteCache(baker);
    const layers = createLayers();
    const cities = new CityView(map, layers, 0, 1, sprites);
    const entities = new EntityView(map, layers, 0, 1, (id) => cities.radiusOf(id), sprites);
    const next = stream(7);
    const sizes: number[] = [];
    for (let tick = 0; tick < 600; tick++) {
      const snapshot = varied(tick, next);
      cities.update(snapshot, 50, { barracks: 100, warehouse: 100 });
      entities.update(interpolateFrame(snapshot, null, tick));
      sprites.endFrame();
      sizes.push(sprites.size);
    }
    // Counts of units and charges are not part of a token's look (the number is a Text, the fill a
    // scaled sprite). What is left are the looks themselves: the bodies by kind and size, the rings
    // and bars by capacity class and fill (about 150 on this map), the token shapes by side, owner
    // and outline (about 60). They are few, below the cache's own bound, and finite.
    expect(Math.max(...sizes)).toBeLessThan(260);
    expect(Math.max(...sizes)).toBeLessThan(MAX_BAKED);
    expect(baker.textures.length).toBe(sprites.size);
    expect(sprites.bytes).toBeLessThan(8 * 1024 * 1024);
    entities.destroy();
    cities.destroy();
    sprites.destroy();
  });

  it('lets go of every texture when the views are destroyed and finds them again for the next scene', () => {
    const baker = fakeBaker();
    const sprites = new SpriteCache(baker);
    const play = (): void => {
      const layers = createLayers();
      const cities = new CityView(map, layers, 0, 1, sprites);
      const entities = new EntityView(map, layers, 0, 1, (id) => cities.radiusOf(id), sprites);
      const next = stream(11);
      for (let tick = 0; tick < 50; tick++) {
        const snapshot = varied(tick, next);
        cities.update(snapshot, 50, { barracks: 100, warehouse: 100 });
        entities.update(interpolateFrame(snapshot, null, tick));
      }
      expect(sprites.used).toBeGreaterThan(0);
      entities.destroy();
      cities.destroy();
    };
    play();
    // No sprite shows anything any more: nothing is held by a destroyed scene.
    expect(sprites.used).toBe(0);
    const made = baker.textures.length;
    const size = sprites.size;
    expect(size).toBeGreaterThan(0);
    // The same scene again: the textures are found, nothing is baked, the count is as before.
    play();
    expect(sprites.used).toBe(0);
    expect(baker.textures.length).toBe(made);
    expect(sprites.size).toBe(size);
    // The Application goes: every texture is released.
    sprites.destroy();
    expect(sprites.size).toBe(0);
    expect(baker.textures.every((texture) => texture.destroyed)).toBe(true);
  });
});
