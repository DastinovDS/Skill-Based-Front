import { describe, expect, it } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import type { GroupView, IntentView as WireIntent, SnapshotMsg } from '../protocol.gen.ts';
import { IntentView } from './intentView.ts';
import { createLayers } from './layers.ts';
import { nodePoint } from './layout.ts';
import { setReducedMotion } from './motion.ts';
import { EntityKit } from './shapes.ts';

const map = DEFAULT_MAP;
const base = devSnapshot(map, DEV_RULES, 100);
const mine = base.view.nodes.filter((n) => n.owner === 0).map((n) => n.id);
const theirs = base.view.nodes.filter((n) => n.owner === 1).map((n) => n.id);
const [home, via] = mine;
const [far] = theirs;
if (home === undefined || via === undefined || far === undefined) throw new Error('small map');

const intent = (over: Partial<WireIntent>): WireIntent => ({
  id: 'i',
  owner: 1,
  kind: 'planned_move',
  origin: far,
  target: home,
  created_tick: 100,
  ...over,
});

function setup() {
  const layers = createLayers();
  const kit = new EntityKit(0);
  const view = new IntentView(map, layers, 0, kit, () => 17);
  view.setDelays({ planned: 30, defense: 30 });
  const draw = (intents: WireIntent[], groups: GroupView[] = [], tick = 100) => {
    const snapshot: SnapshotMsg = {
      ...base,
      tick,
      view: { ...base.view, intents, groups },
    };
    const frame = interpolateFrame(snapshot, null, tick);
    view.update(frame, new Map());
  };
  const [ribbons] = layers.layer.intents.children;
  return { layers, kit, view, draw, ribbons };
}

describe('IntentView', () => {
  it('draws a ribbon from the origin to the target of a planned move', () => {
    const { view, draw, ribbons, kit } = setup();
    draw([intent({})]);
    const bounds = ribbons?.getLocalBounds();
    const a = nodePoint(map, far);
    const b = nodePoint(map, home);
    if (a === undefined || b === undefined) throw new Error('no points');
    expect(bounds?.width).toBeGreaterThan(Math.abs(a.x - b.x) * 0.6);
    expect(bounds?.height).toBeGreaterThan(Math.abs(a.y - b.y) * 0.6);
    view.destroy();
    kit.destroy();
  });

  it('draws an own planned order straight, whatever path the group has (no bends)', () => {
    const { view, draw, ribbons, kit } = setup();
    const own = intent({ owner: 0, origin: home, target: far });
    draw([own]);
    const direct = ribbons?.getLocalBounds();
    const [x0, y0, w0, h0] = [
      direct?.x ?? 0,
      direct?.y ?? 0,
      direct?.width ?? 0,
      direct?.height ?? 0,
    ];
    // The group's path detours through another own city: the ribbon still ignores it.
    const group: GroupView = {
      id: 'g',
      units: 2,
      charged: 2,
      mode: 'attack',
      location: { kind: 'node', node: home },
      order: { dest: far, path: [via, far], planned: true },
    };
    draw([own], [group]);
    const bounds = ribbons?.getLocalBounds();
    expect(w0).toBeGreaterThan(0);
    expect([bounds?.x, bounds?.y, bounds?.width, bounds?.height]).toEqual([x0, y0, w0, h0]);
    view.destroy();
    kit.destroy();
  });

  it('draws the ring round the target of an enemy intent, and nothing for an own one', () => {
    const { view, draw, layers, kit } = setup();
    const rings = layers.layer.intents.children[1];
    draw([intent({ owner: 0, origin: home, target: via })]);
    expect(rings?.getLocalBounds().width).toBe(0);
    draw([intent({})]);
    expect(rings?.getLocalBounds().width).toBeGreaterThan(40);
    view.destroy();
    kit.destroy();
  });

  it('shows the shield disc of Defense with its delay arc, and hides it when gone', () => {
    const { view, draw, layers, kit } = setup();
    const icons = layers.layer.intents.children[2];
    const arcs = layers.layer.intents.children[3];
    draw([intent({ owner: 0, kind: 'defense', origin: home, target: null, created_tick: 95 })]);
    expect(icons?.children[0]?.visible).toBe(true);
    expect(arcs?.getLocalBounds().width).toBeGreaterThan(0);
    // The delay is over: the disc stays, the arc goes.
    draw([intent({ owner: 0, kind: 'defense', origin: home, target: null, created_tick: 10 })]);
    expect(icons?.children[0]?.visible).toBe(true);
    expect(arcs?.getLocalBounds().width).toBe(0);
    draw([]);
    expect(icons?.children[0]?.visible).toBe(false);
    view.destroy();
    kit.destroy();
  });

  it('does not draw an ordinary order as a ribbon, only as a thin line', () => {
    const { view, ribbons, layers, kit } = setup();
    const group: GroupView = {
      id: 'g',
      units: 2,
      charged: 2,
      mode: 'attack',
      location: { kind: 'node', node: home },
      order: { dest: via, path: [via], planned: false },
    };
    const spots = new Map([['g', nodePoint(map, home) ?? { x: 0, y: 0 }]]);
    const frame = interpolateFrame(
      { ...base, view: { ...base.view, intents: [], groups: [group] } },
      null,
      100,
    );
    view.update(frame, spots);
    expect(ribbons?.getLocalBounds().width).toBe(0);
    expect(layers.layer.groups.children[0]?.getLocalBounds().width).toBeGreaterThan(0);
    view.destroy();
    kit.destroy();
  });

  it('draws with less motion too', () => {
    setReducedMotion(true);
    try {
      const { view, draw, ribbons, kit } = setup();
      draw([intent({ created_tick: 0 })], [], 500);
      expect(ribbons?.getLocalBounds().width).toBeGreaterThan(0);
      view.destroy();
      kit.destroy();
    } finally {
      setReducedMotion(null);
    }
  });
});
