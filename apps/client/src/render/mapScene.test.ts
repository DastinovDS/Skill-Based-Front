import { CanvasTextMetrics, Container, Sprite, type Application, type Texture } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import { MapScene, type SceneSprites } from './mapScene.ts';
import type { RenderSource } from './source.ts';
import { testSprites } from './testSprites.ts';

// `Assets` caches a texture by URL: a second load of the URL gets the same texture; an unload
// destroys it (as pixi.js does, after the load it waits for).
const assets = vi.hoisted(() => {
  const cache = new Map<string, unknown>();
  return {
    cache,
    load: vi.fn(),
    unload: vi.fn(),
  };
});

vi.mock('pixi.js', async (original) => {
  const pixi = await original<typeof import('pixi.js')>();
  assets.load.mockImplementation((url: string) => {
    let texture = assets.cache.get(url);
    if (texture === undefined) {
      texture = new pixi.Texture({ source: new pixi.TextureSource({ width: 8, height: 8 }) });
      assets.cache.set(url, texture);
    }
    return Promise.resolve(texture);
  });
  assets.unload.mockImplementation((url: string) => {
    (assets.cache.get(url) as Texture | undefined)?.destroy(true);
    assets.cache.delete(url);
    return Promise.resolve();
  });
  return { ...pixi, Assets: assets };
});

const URL = 'crossroads.bg.webp';
const map = DEFAULT_MAP;
const snapshot = devSnapshot(map, DEV_RULES, 100);

/** The parts of an Application a scene uses, without WebGL (jsdom). */
function fakeApp(): Application {
  const stage = new Container();
  return {
    stage,
    canvas: document.createElement('canvas'),
    screen: { width: 800, height: 600 },
    renderer: { on: vi.fn(), off: vi.fn(), resolution: 1, screen: { width: 800, height: 600 } },
    ticker: { add: vi.fn(), remove: vi.fn() },
  } as unknown as Application;
}

const source: RenderSource = {
  frame: () => interpolateFrame(snapshot, null, snapshot.tick),
  events: () => [],
};

/** The textures of the sprites under a container, at any depth. */
function textures(root: Container): Texture[] {
  const out: Texture[] = [];
  const walk = (node: Container): void => {
    if (node instanceof Sprite) out.push(node.texture);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('MapScene', () => {
  beforeEach(() => {
    assets.cache.clear();
    assets.load.mockClear();
    assets.unload.mockClear();
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // #617: the replay's "View as" rebuilds the scene of the same map. The old scene unloaded the
  // background in destroy(), which destroyed the very texture the next scene got from the cache:
  // the renderer threw on it every frame and the map went black.
  it('keeps the background and the shared shapes alive over rebuilds of the same map', async () => {
    const app = fakeApp();
    const sprites: SceneSprites = { world: testSprites(), screen: testSprites() };
    const states: string[] = [];
    let scene: MapScene | null = null;

    for (const player of [0, 1, 0, 1, 0] as const) {
      scene?.destroy();
      scene = new MapScene(app, map, undefined, {
        sprites,
        source,
        player,
        backgroundUrl: URL,
        onbackground: (state) => states.push(state),
      });
      await settle();

      // The scene is on the stage alone, with its layers, and shows the background alive.
      expect(app.stage.children).toEqual([scene.layers.world]);
      expect(scene.layers.layer.background.children.length).toBeGreaterThan(0);
      const background = textures(scene.layers.layer.background).find(
        (t) => t === assets.cache.get(URL),
      );
      expect(background?.destroyed).toBe(false);
    }

    expect(states).toEqual(['loaded', 'loaded', 'loaded', 'loaded', 'loaded']);
    // The scene never unloads the background: its owner does, once no scene shows it.
    expect(assets.unload).not.toHaveBeenCalled();
    expect(assets.load).toHaveBeenCalledTimes(5);
    scene?.destroy();
    expect(assets.unload).not.toHaveBeenCalled();
  });

  it('does not unload the background when it is destroyed before the load finishes', async () => {
    const app = fakeApp();
    const sprites: SceneSprites = { world: testSprites(), screen: testSprites() };
    const first = new MapScene(app, map, undefined, { sprites, backgroundUrl: URL });
    first.destroy();
    const second = new MapScene(app, map, undefined, { sprites, backgroundUrl: URL });
    await settle();

    expect(assets.unload).not.toHaveBeenCalled();
    const texture = assets.cache.get(URL) as Texture;
    expect(texture.destroyed).toBe(false);
    expect(textures(second.layers.layer.background)).toContain(texture);
    second.destroy();
  });
});
