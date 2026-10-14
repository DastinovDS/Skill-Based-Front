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
