import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapFile } from '../protocol.gen.ts';
import GameCanvas from './GameCanvas.svelte';

// Stand-ins for pixi.js Application (init() resolves when the test says so) and for MapScene.
const fakes = vi.hoisted(() => {
  class FakeApplication {
    static instances: FakeApplication[] = [];

    readonly ticker = { FPS: 60 };
    readonly destroy = vi.fn();
    resolveInit: () => void = () => undefined;
    rejectInit: (error: unknown) => void = () => undefined;
    readonly init = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          this.resolveInit = resolve;
          this.rejectInit = reject;
        }),
    );

    constructor() {
      FakeApplication.instances.push(this);
    }
  }

  class FakeMapScene {
    static instances: FakeMapScene[] = [];

    readonly fit = vi.fn();
    readonly setSource = vi.fn();
    readonly destroy = vi.fn();

    constructor(
      readonly app: unknown,
      readonly map: unknown,
    ) {
      FakeMapScene.instances.push(this);
    }
  }
  /** The baked shapes the canvas makes per Application (`createSceneSprites`). */
  class FakeSprites {
    static instances: FakeSprites[] = [];

    readonly world = { destroy: vi.fn() };
    readonly screen = { destroy: vi.fn() };

    constructor() {
      FakeSprites.instances.push(this);
    }
  }
  return { FakeApplication, FakeMapScene, FakeSprites };
});

vi.mock('pixi.js', () => ({ Application: fakes.FakeApplication }));
vi.mock('./mapScene.ts', () => ({
  MapScene: fakes.FakeMapScene,
  createSceneSprites: () => new fakes.FakeSprites(),
}));

const { FakeApplication, FakeMapScene, FakeSprites } = fakes;

function mapNamed(name: string): MapFile {
  return {
    meta: { name, version: 1, symmetry: 'rot180', width: 100, height: 100 },
    nodes: [],
    edges: [],
    mirror: { nodes: {}, edges: {} },
  };
}

function last<T>(items: readonly T[]): T {
  const item = items.at(-1);
  if (item === undefined) {
    throw new Error('nothing was created');
  }
  return item;
}

// Lets the promise callbacks of init() run.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function destroyCalls(objects: readonly { destroy: { mock: { calls: unknown[] } } }[]): number {
  return objects.reduce((sum, o) => sum + o.destroy.mock.calls.length, 0);
}

describe('GameCanvas', () => {
  let target: HTMLElement;

  beforeEach(() => {
    FakeApplication.instances = [];
    FakeMapScene.instances = [];
    FakeSprites.instances = [];
    target = document.createElement('div');
    document.body.appendChild(target);
  });

  afterEach(() => {
    target.remove();
  });

  it('destroys the application and the scene on each of 20 mount/unmount cycles', async () => {
    for (let i = 0; i < 20; i += 1) {
      const component = mount(GameCanvas, { target, props: { map: mapNamed('a') } });
      flushSync();
      last(FakeApplication.instances).resolveInit();
      await settle();
      expect(last(FakeApplication.instances).init).toHaveBeenCalledWith(
        expect.objectContaining({ canvas: target.querySelector('canvas') }),
      );
      expect(FakeMapScene.instances).toHaveLength(i + 1);
      await unmount(component);
    }

    expect(FakeApplication.instances).toHaveLength(20);
    expect(destroyCalls(FakeApplication.instances)).toBe(20);
    expect(destroyCalls(FakeMapScene.instances)).toBe(20);
    // The baked shapes live as long as the Application and go with it.
    expect(FakeSprites.instances).toHaveLength(20);
    expect(destroyCalls(FakeSprites.instances.map((sprites) => sprites.world))).toBe(20);
    expect(destroyCalls(FakeSprites.instances.map((sprites) => sprites.screen))).toBe(20);
  });

  it('destroys the application when init() finishes after unmount', async () => {
    const component = mount(GameCanvas, { target, props: { map: mapNamed('a') } });
    flushSync();
    await unmount(component);
    const app = last(FakeApplication.instances);
    expect(app.destroy).not.toHaveBeenCalled();

    app.resolveInit();
    await settle();

    expect(app.destroy).toHaveBeenCalledTimes(1);
    expect(FakeMapScene.instances).toHaveLength(0);
  });

  it('reports a failed init() and does not destroy an uninitialized application', async () => {
    const onerror = vi.fn();
    const component = mount(GameCanvas, { target, props: { map: mapNamed('a'), onerror } });
    flushSync();
    const failure = new Error('WebGL is not supported');
    last(FakeApplication.instances).rejectInit(failure);
    await settle();

    expect(onerror).toHaveBeenCalledWith(failure);
    await unmount(component);
    expect(last(FakeApplication.instances).destroy).not.toHaveBeenCalled();
  });

  it('replaces the scene when the map changes and forwards "fit map"', async () => {
    const props = $state({ map: mapNamed('a') });
    const component = mount(GameCanvas, { target, props });
    flushSync();
    last(FakeApplication.instances).resolveInit();
    await settle();
    const first = last(FakeMapScene.instances);
    expect(first.map).toBe(props.map);

    props.map = mapNamed('b');
    flushSync();

    expect(FakeMapScene.instances).toHaveLength(2);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    const second = last(FakeMapScene.instances);
    expect((second.map as MapFile).meta.name).toBe('b');

    // typescript-eslint cannot see the types of .svelte imports: name the export explicitly.
    (component as { fitMap: () => void }).fitMap();
    expect(second.fit).toHaveBeenCalledTimes(1);

    await unmount(component);
    expect(second.destroy).toHaveBeenCalledTimes(1);
  });
});
