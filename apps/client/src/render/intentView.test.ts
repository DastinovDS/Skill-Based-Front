import { CanvasTextMetrics, Container, Text, type Graphics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import type { GroupView, IntentView as WireIntent, SnapshotMsg } from '../protocol.gen.ts';
import { IntentView } from './intentView.ts';
import { createLayers } from './layers.ts';
import { nodePoint } from './layout.ts';
import { setReducedMotion } from './motion.ts';
import { EntityKit } from './shapes.ts';
import { BG, RIBBON } from './style.ts';

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
  view.setDelays({ planned: 30 });
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

interface Paint {
  readonly action: string;
  readonly color: number;
  readonly alpha: number;
  readonly width: number;
}

/** The fills and strokes drawn into a Graphics, in order. */
function paints(g: unknown): Paint[] {
  const instructions = (g as Graphics).context.instructions as unknown as {
    action: string;
    data: { style: { color: number; alpha: number; width?: number } };
  }[];
  return instructions.map((i) => ({
    action: i.action,
    color: i.data.style.color,
    alpha: i.data.style.alpha,
    width: i.data.style.width ?? 0,
  }));
}

// jsdom has no canvas to measure text on: seven units a letter.
beforeEach(() => {
  vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
    (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** Pixi's label is `null` until set, whatever its type says. */
const labelOf = (node: { label: string | null }): string => node.label ?? '';

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

  it('bends one smooth curve toward the server path of an own planned order, enemy stays straight', () => {
    const { view, draw, ribbons, kit } = setup();
    const own = intent({ owner: 0, origin: home, target: far });
    draw([own]);
    const straight = ribbons?.getLocalBounds();
    const h0 = straight?.height ?? 0;
    const w0 = straight?.width ?? 0;
    const group: GroupView = {
      id: 'g',
      units: 2,
      charged: 2,
      mode: 'attack',
      location: { kind: 'node', node: home },
      order: { dest: far, path: [via, far], planned: true, bonus: 2 },
      defense_bonus: null,
      defense_cap: null,
    };
    draw([own], [group]);
    const bent = ribbons?.getLocalBounds();
    const a = nodePoint(map, home);
    const b = nodePoint(map, far);
    const v = nodePoint(map, via);
    expect(w0).toBeGreaterThan(0);
    // The curve leaves the straight line, but only toward the waypoint, not through it.
    if (a !== undefined && b !== undefined && v !== undefined) {
      const side =
        ((v.x - a.x) * (b.y - a.y) - (v.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
      if (Math.abs(side) > 20) {
        expect((bent?.height ?? 0) + (bent?.width ?? 0)).not.toBeCloseTo(h0 + w0, 0);
      }
    }
    // The opponent's intent has no path: the same bounds as without any group.
    draw([intent({})], [group]);
    const enemy = ribbons?.getLocalBounds();
    draw([intent({})]);
    expect(enemy?.width).toBeCloseTo(ribbons?.getLocalBounds().width ?? NaN);
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

  it('shows the shield disc of Defense without a delay arc, and hides it when gone', () => {
    const { view, draw, layers, kit } = setup();
    const icons = layers.layer.intents.children[2];
    const arcs = layers.layer.intents.children[3];
    // DEC-30: no delay, the bonus grows; the disc has no arc from the first tick.
    draw([intent({ owner: 0, kind: 'defense', origin: home, target: null, created_tick: 95 })]);
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
      order: { dest: via, path: [via], planned: false, bonus: 0 },
      defense_bonus: null,
      defense_cap: null,
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

describe('IntentView: opaque arcs that pulse (#325)', () => {
  const edge = map.edges[0];
  if (edge === undefined) throw new Error('a map with a road');
  const [a, b] = [edge.a, edge.b];

  it('lays an opaque dark underlay under the tint, so the road does not show through', () => {
    const { view, draw, ribbons, kit } = setup();
    draw([intent({ owner: 0, origin: a, target: b })]);
    const fills = paints(ribbons).filter((p) => p.action === 'fill');
    const underlay = fills.find((p) => p.color === RIBBON.underlay.color);
    expect(underlay?.alpha).toBeGreaterThanOrEqual(0.9);
    // The underlay comes before every tint.
    expect(fills[0]).toEqual(underlay);
    // The enemy's arrow has it too.
    draw([intent({ owner: 1, origin: a, target: b })]);
    expect(paints(ribbons).some((p) => p.color === RIBBON.underlay.color && p.alpha >= 0.9)).toBe(
      true,
    );
    view.destroy();
    kit.destroy();
  });

  it('draws an order to a neighbour as an arc: opposite orders on one road do not overlap', () => {
    const { view, draw, ribbons, kit } = setup();
    const from = nodePoint(map, a);
    const to = nodePoint(map, b);
    if (from === undefined || to === undefined) throw new Error('no points');
    const centre = (): { x: number; y: number } => {
      const box = ribbons?.getLocalBounds();
      return {
        x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
        y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
      };
    };
    draw([intent({ owner: 0, origin: a, target: b })]);
    const there = centre();
    draw([intent({ owner: 1, origin: b, target: a })]);
    const back = centre();
    // The two arrows swing to opposite sides of the road: their middles lie apart, across it.
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const across = Math.abs(
      ((back.x - there.x) * (to.y - from.y) - (back.y - there.y) * (to.x - from.x)) / length,
    );
    expect(across).toBeGreaterThan(RIBBON.body);
    // Each one bulges to the left of its way (y down on the screen): the cross product is negative.
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const sideOf = (p: { x: number; y: number }): number =>
      Math.sign((to.x - from.x) * (p.y - mid.y) - (to.y - from.y) * (p.x - mid.x));
    // there goes a -> b, bulging left: the centre is on the side of negative cross product.
    expect(sideOf(there)).toBe(-1);
    expect(sideOf(back)).toBe(1);
    view.destroy();
    kit.destroy();
  });

  it('pulses once when the delay ends and leaves the contour stronger', () => {
    const { view, draw, ribbons, kit } = setup();
    const widthAt = (tick: number, created = 100): number => {
      draw([intent({ owner: 0, origin: a, target: b, created_tick: created })], [], tick);
      const strokes = paints(ribbons).filter((p) => p.action === 'stroke' && p.color !== BG);
      return Math.max(...strokes.map((p) => p.width));
    };
    // The delay is 30 ticks: it ends at 130.
    const running = widthAt(120);
    const peak = widthAt(134);
    const locked = widthAt(145);
    expect(running).toBeCloseTo(RIBBON.contour.width);
    expect(peak).toBeGreaterThan(locked);
    expect(locked).toBeCloseTo(RIBBON.locked.width);
    expect(locked).toBeGreaterThan(running);
    // It stays locked, not pulsing again.
    expect(widthAt(300)).toBeCloseTo(RIBBON.locked.width);
    view.destroy();
    kit.destroy();
  });

  it('with less motion locks at once, without a pulse', () => {
    setReducedMotion(true);
    try {
      const { view, draw, ribbons, kit } = setup();
      draw([intent({ owner: 0, origin: a, target: b, created_tick: 100 })], [], 134);
      const widths = paints(ribbons)
        .filter((p) => p.action === 'stroke' && p.color !== BG)
        .map((p) => p.width);
      expect(Math.max(...widths)).toBeCloseTo(RIBBON.locked.width);
      view.destroy();
      kit.destroy();
    } finally {
      setReducedMotion(null);
    }
  });
});

describe('IntentView, the bonus of an own plan at the head of its ribbon (DEC-29)', () => {
  const own = intent({ owner: 0, origin: home, target: far });
  const planned = (bonus: number, planned = true): GroupView => ({
    id: 'g',
    units: 2,
    charged: 2,
    mode: 'attack',
    location: { kind: 'node', node: home },
    order: { dest: far, path: [via, far], planned, bonus },
    defense_bonus: null,
    defense_cap: null,
  });
  /** The pills drawn: the text and whether it is a forecast or locked. */
  function pills(layers: ReturnType<typeof createLayers>): { text: string; state: string }[] {
    const found: { text: string; state: string }[] = [];
    const visit = (node: Container): void => {
      if (!node.visible) return;
      if (labelOf(node).startsWith('plan-bonus-pill:')) {
        const text = node.children.find((c): c is Text => c instanceof Text);
        found.push({
          text: text?.text ?? '',
          state: labelOf(node).slice('plan-bonus-pill:'.length),
        });
      }
      for (const child of node.children) visit(child);
    };
    visit(layers.layer.intents);
    return found;
  }

  it('shows "+N" with the number of the server for an own planned order', () => {
    const { layers, draw, view } = setup();
    draw([own], [planned(2)]);
    expect(pills(layers).map((p) => p.text)).toEqual(['+2']);
    // It follows the view: the forecast changes with the charged units.
    draw([own], [planned(1)]);
    expect(pills(layers).map((p) => p.text)).toEqual(['+1']);
    view.destroy();
  });

  it('is a forecast while the delay runs and locked once it is over', () => {
    const { layers, draw, view } = setup();
    draw([own], [planned(2)], 100);
    expect(pills(layers).map((p) => p.state)).toEqual(['forecast']);
    // The delay is 30 ticks (setup): from the tick after it the group leaves.
    draw([own], [planned(2)], 140);
    expect(pills(layers).map((p) => p.state)).toEqual(['locked']);
    view.destroy();
  });

  it('shows nothing for a plan with no bonus, for an ordinary order, or without the group', () => {
    const { layers, draw, view } = setup();
    draw([own], [planned(0)]);
    expect(pills(layers)).toEqual([]);
    draw([own], [planned(2, false)]);
    expect(pills(layers)).toEqual([]);
    draw([own], []);
    expect(pills(layers)).toEqual([]);
    view.destroy();
  });

  it('shows nothing at the ribbon of the opponent: its intent has no size and no bonus', () => {
    const { layers, draw, view } = setup();
    draw([intent({ owner: 1, origin: far, target: home })], [planned(2)]);
    expect(pills(layers)).toEqual([]);
    view.destroy();
  });

  it('keeps the pill the same size on screen at any zoom', () => {
    for (const scale of [0.6, 2]) {
      const { layers, draw, view } = setup();
      view.setCameraScale(scale);
      draw([own], [planned(2)]);
      const pill = layers.layer.intents.children
        .flatMap((c) => (c instanceof Container ? c.children : []))
        .find((c) => labelOf(c).startsWith('plan-bonus-pill:'));
      expect(pill?.scale.x).toBeCloseTo(1 / scale);
      view.destroy();
    }
  });
});
