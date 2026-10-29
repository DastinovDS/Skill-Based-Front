import { Container } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { CameraController } from './cameraController.ts';

function setup() {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  element.setPointerCapture = () => undefined;
  element.releasePointerCapture = () => undefined;
  element.hasPointerCapture = () => true;
  const clicks: { x: number; y: number; shift: boolean }[] = [];
  const hovers: ({ x: number; y: number } | null)[] = [];
  const world = new Container();
  const controller = new CameraController(
    element,
    world,
    { width: 1000, height: 600 },
    { width: 800, height: 600 },
    () => undefined,
  );
  controller.setHandlers({
    onclick: (at, shift) => clicks.push({ ...at, shift }),
    onhover: (at) => hovers.push(at),
  });
  const fire = (type: string, x: number, y: number, init: MouseEventInit = {}) => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, ...init });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    element.dispatchEvent(event);
  };
  return { element, controller, clicks, hovers, fire, world };
}

describe('CameraController clicks', () => {
  let controller: CameraController | undefined;
  afterEach(() => {
    controller?.destroy();
  });

  it('reports a press that stayed put as a click, with the shift state', () => {
    const s = setup();
    controller = s.controller;
    s.fire('pointerdown', 100, 50);
    s.fire('pointerup', 101, 51, { shiftKey: true });
    expect(s.clicks).toEqual([{ x: 101, y: 51, shift: true }]);
  });

  it('does not report a drag as a click', () => {
    const s = setup();
    controller = s.controller;
    s.fire('pointerdown', 100, 50);
    s.fire('pointermove', 160, 50);
    s.fire('pointerup', 160, 50);
    expect(s.clicks).toEqual([]);
  });

  it('does not click with the secondary button', () => {
    const s = setup();
    controller = s.controller;
    s.fire('pointerdown', 10, 10, { button: 2 });
    s.fire('pointerup', 10, 10, { button: 2 });
    expect(s.clicks).toEqual([]);
  });

  it('does not click after a cancelled press', () => {
    const s = setup();
    controller = s.controller;
    s.fire('pointerdown', 10, 10);
    s.fire('pointercancel', 10, 10);
    expect(s.clicks).toEqual([]);
  });

  it('reports hovering without a press, and leaving the canvas', () => {
    const s = setup();
    controller = s.controller;
    s.fire('pointermove', 30, 40);
    s.fire('pointerleave', 30, 40);
    expect(s.hovers).toEqual([{ x: 30, y: 40 }, null]);
    s.fire('pointerdown', 30, 40);
    s.fire('pointermove', 31, 40);
    expect(s.hovers).toHaveLength(2); // a press is not hovering
  });
});

describe('CameraController panning', () => {
  let controller: CameraController | undefined;
  afterEach(() => {
    controller?.destroy();
  });

  it('pans with the right button, and a drag is no click', () => {
    const s = setup();
    controller = s.controller;
    s.controller.focus({ x: 700, y: 300 });
    const before = s.world.position.x;
    s.fire('pointerdown', 400, 300, { button: 2 });
    s.fire('pointermove', 340, 300, { button: 2 });
    s.fire('pointerup', 340, 300, { button: 2 });
    expect(s.world.position.x).not.toBe(before);
    expect(s.clicks).toEqual([]);
  });

  it('does not pan with the left button', () => {
    const s = setup();
    controller = s.controller;
    s.controller.focus({ x: 700, y: 300 });
    const before = s.world.position.x;
    s.fire('pointerdown', 400, 300);
    s.fire('pointermove', 340, 300);
    s.fire('pointerup', 340, 300);
    expect(s.world.position.x).toBe(before);
    expect(s.clicks).toEqual([]);
  });

  it('suppresses the context menu of the canvas', () => {
    const s = setup();
    controller = s.controller;
    const event = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    s.element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('CameraController easing (#508)', () => {
  let controller: CameraController | undefined;
  afterEach(() => {
    controller?.destroy();
  });

  const wheel = (s: ReturnType<typeof setup>, deltaY: number) => {
    const event = new WheelEvent('wheel', { deltaY, clientX: 400, clientY: 300, cancelable: true });
    s.element.dispatchEvent(event);
  };

  it('eases a wheel zoom toward its goal around the pointer instead of jumping', () => {
    const s = setup();
    controller = s.controller;
    const start = s.controller.current.scale;
    wheel(s, -100);
    // Nothing moved yet: the goal is set, the frames do the moving.
    expect(s.controller.current.scale).toBe(start);
    expect(s.controller.easing).toBe(true);
    s.controller.step(16);
    const first = s.controller.current.scale;
    expect(first).toBeGreaterThan(start);
    const goal = start * Math.exp(0.2);
    expect(first).toBeLessThan(goal);
    for (let i = 0; i < 60; i++) s.controller.step(16);
    expect(s.controller.current.scale).toBeCloseTo(goal, 2);
    expect(s.controller.easing).toBe(false);
  });

  it('adds up the notches of a fast spin and stays inside the zoom limits', () => {
    const s = setup();
    controller = s.controller;
    for (let i = 0; i < 40; i++) wheel(s, -250);
    for (let i = 0; i < 200; i++) s.controller.step(16);
    const top = s.controller.current.scale;
    expect(top).toBeLessThanOrEqual(6);
    expect(top).toBeGreaterThan(2);
    // The goal is clamped, so more spinning does not push it further.
    for (let i = 0; i < 10; i++) wheel(s, -250);
    for (let i = 0; i < 200; i++) s.controller.step(16);
    expect(s.controller.current.scale).toBeCloseTo(top, 6);
  });

  it('glides to a focus point and lands on it; a drag takes over', () => {
    const s = setup();
    controller = s.controller;
    s.controller.focus({ x: 700, y: 300 });
    const at = s.controller.current.x;
    s.controller.step(100);
    const mid = s.controller.current.x;
    expect(mid).not.toBe(at);
    s.controller.step(1000);
    expect(s.controller.easing).toBe(false);
    const landed = s.controller.current.x;
    s.controller.focus({ x: 100, y: 300 });
    s.fire('pointerdown', 400, 300, { button: 2 });
    s.fire('pointermove', 340, 300, { button: 2 });
    expect(s.controller.easing).toBe(false);
    expect(s.controller.current.x).not.toBe(landed);
  });
});
