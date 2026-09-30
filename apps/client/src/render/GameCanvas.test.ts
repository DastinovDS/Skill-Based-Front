import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameCanvas from './GameCanvas.svelte';

// A stand-in for pixi.js Application: init() resolves when the test says so.
const pixi = vi.hoisted(() => {
  class FakeApplication {
    static instances: FakeApplication[] = [];

    readonly stage = { addChild: vi.fn() };
    readonly screen = { width: 800, height: 600 };
    readonly renderer = { on: vi.fn() };
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
  return { FakeApplication };
});

vi.mock('pixi.js', () => ({ Application: pixi.FakeApplication }));
vi.mock('./testScene.ts', () => ({
  createTestScene: () => ({ position: { set: vi.fn() } }),
}));

const { FakeApplication } = pixi;

function lastApp(): InstanceType<typeof FakeApplication> {
  const app = FakeApplication.instances.at(-1);
  if (app === undefined) {
    throw new Error('Application was not created');
  }
  return app;
}

// Lets the promise callbacks of init() run.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('GameCanvas', () => {
  let target: HTMLElement;

  beforeEach(() => {
    FakeApplication.instances = [];
    target = document.createElement('div');
    document.body.appendChild(target);
  });

  afterEach(() => {
    target.remove();
  });

  it('destroys the application on each of 20 mount/unmount cycles', async () => {
    for (let i = 0; i < 20; i += 1) {
      const component = mount(GameCanvas, { target });
      flushSync();
      lastApp().resolveInit();
      await settle();
      expect(lastApp().init).toHaveBeenCalledWith(
        expect.objectContaining({ canvas: target.querySelector('canvas') }),
      );
      expect(lastApp().stage.addChild).toHaveBeenCalledTimes(1);
      await unmount(component);
    }

    expect(FakeApplication.instances).toHaveLength(20);
    const destroyCalls = FakeApplication.instances.reduce(
      (sum, app) => sum + app.destroy.mock.calls.length,
      0,
    );
    expect(destroyCalls).toBe(20);
  });

  it('destroys the application when init() finishes after unmount', async () => {
    const component = mount(GameCanvas, { target });
    flushSync();
    await unmount(component);
    const app = lastApp();
    expect(app.destroy).not.toHaveBeenCalled();

    app.resolveInit();
    await settle();

    expect(app.destroy).toHaveBeenCalledTimes(1);
    expect(app.stage.addChild).not.toHaveBeenCalled();
  });

  it('reports a failed init() and does not destroy an uninitialized application', async () => {
    const onerror = vi.fn();
    const component = mount(GameCanvas, { target, props: { onerror } });
    flushSync();
    const failure = new Error('WebGL is not supported');
    lastApp().rejectInit(failure);
    await settle();

    expect(onerror).toHaveBeenCalledWith(failure);
    await unmount(component);
    expect(lastApp().destroy).not.toHaveBeenCalled();
  });
});
