import { CanvasTextMetrics, Container, Text, Texture, type Graphics } from 'pixi.js';
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
import { CASING, DARK_PLATE, ENEMY, INK, RIBBON_ENGRAVED, WARN, YOU } from './style.ts';
import { testSprites } from './testSprites.ts';

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
  const kit = new EntityKit(0, testSprites());
  const view = new IntentView(map, layers, 0, () => 17);
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
  const [ribbons, rings, flights] = layers.layer.intents.children;
  return { layers, kit, view, draw, ribbons, rings, flights };
}

interface Paint {
  readonly action: string;
  readonly color: number;
  readonly alpha: number;
  readonly width: number;
  /** A fill with a texture: the owner's hatch. */
  readonly hatch: boolean;
  /** The points of the shape, flat. */
  readonly points: number[];
}

/** The fills and strokes drawn into a Graphics, in order. */
function paints(g: unknown): Paint[] {
  const instructions = (g as Graphics).context.instructions as unknown as {
    action: string;
    data: {
      style: { color: number; alpha: number; width?: number; texture?: Texture };
      path?: { shapePath: { shapePrimitives: { shape: { points?: number[] } }[] } };
    };
  }[];
  return instructions.map((i) => ({
    action: i.action,
    color: i.data.style.color,
    alpha: i.data.style.alpha,
    width: i.data.style.width ?? 0,
    hatch: i.data.style.texture !== undefined && i.data.style.texture !== Texture.WHITE,
    points: (i.data.path?.shapePath.shapePrimitives ?? []).flatMap((p) => p.shape.points ?? []),
  }));
}

/** The width of the box round a flat list of points. */
const spanX = (points: readonly number[]): number => {
  const xs = points.filter((_, j) => j % 2 === 0);
  return xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs);
};

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

const group = (over: Partial<GroupView['order'] & object> = {}, planned = true): GroupView => ({
  id: 'g',
  units: 3,
  charged: 3,
  mode: 'attack',
  location: { kind: 'node', node: home },
  order: {
    dest: far,
    path: [via, far],
    planned,
    bonus: 2,
    gathering: false,
    plan: 0,
    next_charge_tick: null,
    depart_tick: null,
    group_order: null,
    arrive_tick: null,
    ...over,
  },
});

describe('IntentView: the ribbons of scheduled orders (#851, Engraved)', () => {
  it('draws a ribbon from the origin to the target of a planned move', () => {
    const { view, draw, ribbons, kit } = setup();
    draw([intent({})]);
    const bounds = ribbons?.getLocalBounds();
    const a = nodePoint(map, far);
    const b = nodePoint(map, home);
    if (a === undefined || b === undefined) throw new Error('no points');
    expect(bounds?.width).toBeGreaterThan(Math.abs(a.x - b.x) * 0.5);
    expect(bounds?.height).toBeGreaterThan(Math.abs(a.y - b.y) * 0.5);
    view.destroy();
    kit.destroy();
  });

  it('bends one smooth curve toward the server path of an own planned order, enemy stays as it is', () => {
    const { view, draw, ribbons, kit } = setup();
    const own = intent({ owner: 0, origin: home, target: far });
    draw([own]);
    const straight = ribbons?.getLocalBounds();
    const h0 = straight?.height ?? 0;
    const w0 = straight?.width ?? 0;
    draw([own], [group()]);
    const bent = ribbons?.getLocalBounds();
    const a = nodePoint(map, home);
    const b = nodePoint(map, far);
    const v = nodePoint(map, via);
    expect(w0).toBeGreaterThan(0);
    if (a !== undefined && b !== undefined && v !== undefined) {
      const side =
        ((v.x - a.x) * (b.y - a.y) - (v.y - a.y) * (b.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
      if (Math.abs(side) > 20) {
        expect((bent?.height ?? 0) + (bent?.width ?? 0)).not.toBeCloseTo(h0 + w0, 0);
      }
    }
    draw([intent({})], [group()]);
    const enemy = ribbons?.getLocalBounds();
    draw([intent({})]);
    expect(enemy?.width).toBeCloseTo(ribbons?.getLocalBounds().width ?? NaN);
    view.destroy();
    kit.destroy();
  });

  it('lays the enemy ribbon as a dark plate under its hatch, an ink outline and a second contour', () => {
    const { view, draw, ribbons, kit } = setup();
    draw([intent({})], [], 140);
    const all = paints(ribbons);
    expect(all[0]).toMatchObject({
      action: 'stroke',
      color: CASING,
      width: RIBBON_ENGRAVED.casing,
    });
    expect(all[1]).toMatchObject({ action: 'fill', color: DARK_PLATE });
    expect(all[2]).toMatchObject({ action: 'fill', color: ENEMY, hatch: true });
    // Hatched only: never a solid enemy fill.
    expect(all.some((p) => p.action === 'fill' && p.color === ENEMY && !p.hatch)).toBe(false);
    const inks = all.filter((p) => p.action === 'stroke' && p.color === INK);
    expect(inks.some((p) => p.alpha === RIBBON_ENGRAVED.inner.alpha)).toBe(true);
    view.destroy();
    kit.destroy();
  });

  it('fills an own ribbon from the tail behind a burin front while it waits, solid once it left', () => {
    const { view, draw, ribbons, kit } = setup();
    const own = intent({ owner: 0, origin: home, target: far });
    // The delay is 30 ticks from 100: half way at 115.
    draw([own], [], 115);
    const waiting = paints(ribbons);
    expect(waiting.some((p) => p.action === 'fill' && p.color === YOU && p.hatch)).toBe(true);
    expect(waiting.some((p) => p.action === 'fill' && p.color === YOU && !p.hatch)).toBe(true);
    expect(
      waiting.some(
        (p) =>
          p.action === 'stroke' && p.color === CASING && p.width === RIBBON_ENGRAVED.front.casing,
      ),
    ).toBe(true);
    draw([own], [], 160);
    const going = paints(ribbons);
    expect(
      going.some(
        (p) =>
          p.action === 'stroke' && p.color === CASING && p.width === RIBBON_ENGRAVED.front.casing,
      ),
    ).toBe(false);
    expect(going.some((p) => p.action === 'fill' && p.color === YOU && !p.hatch)).toBe(true);
    view.destroy();
    kit.destroy();
  });

  it('the tail of the opponent is a ring in a ring, the own tail a dot', () => {
    const { view, draw, ribbons, kit } = setup();
    const circles = (g: unknown): number =>
      (
        (g as Graphics).context.instructions as unknown as {
          data: { path: { shapePath: { shapePrimitives: { shape: { type: string } }[] } } };
        }[]
      )
        .flatMap((i) => i.data.path.shapePath.shapePrimitives)
        .filter((p) => p.shape.type === 'circle').length;
    draw([intent({})], [], 140);
    const enemy = circles(ribbons);
    draw([intent({ owner: 0, origin: home, target: via })], [], 140);
    expect(enemy).toBe(3);
    expect(circles(ribbons)).toBe(2);
    view.destroy();
    kit.destroy();
  });

  it('bulges toward the top of the screen whichever way the order goes', () => {
    const { view, draw, ribbons, kit } = setup();
    const wide = map.edges.find((e) => {
      const p = nodePoint(map, e.a);
      const q = nodePoint(map, e.b);
      return p !== undefined && q !== undefined && Math.abs(p.x - q.x) > 60;
    });
    if (wide === undefined) throw new Error('a map with a wide road');
    const from = nodePoint(map, wide.a);
    const to = nodePoint(map, wide.b);
    if (from === undefined || to === undefined) throw new Error('no points');
    const midY = (from.y + to.y) / 2;
    for (const [origin, target] of [
      [wide.a, wide.b],
      [wide.b, wide.a],
    ] as const) {
      draw([intent({ owner: 0, origin, target })]);
      const box = ribbons?.getLocalBounds();
      const centreY = (box?.y ?? 0) + (box?.height ?? 0) / 2;
      expect(centreY).toBeLessThan(midY);
    }
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

describe('IntentView: the target of an enemy order (Fine rings, under attack)', () => {
  it('draws an arc round the target of an enemy intent, and nothing for an own one', () => {
    const { view, draw, rings, kit } = setup();
    draw([intent({ owner: 0, origin: home, target: via })]);
    expect(rings?.getLocalBounds().width).toBe(0);
    draw([intent({})]);
    expect(rings?.getLocalBounds().width).toBeGreaterThan(5);
    view.destroy();
    kit.destroy();
  });

  it('is amber with three chevrons marching in over my city, the enemy colour elsewhere', () => {
    const { view, draw, rings, kit } = setup();
    draw([intent({ target: home })], [], 140);
    const mine = paints(rings);
    expect(mine.some((p) => p.action === 'stroke' && p.color === WARN)).toBe(true);
    const marching = mine.filter((p) => p.action === 'fill' && p.color === WARN);
    expect(marching.length).toBeGreaterThan(0);
    expect(marching.length).toBeLessThanOrEqual(RIBBON_ENGRAVED.march.count);
    // An arc, not a ring: it does not go round the city.
    const at = nodePoint(map, home);
    const box = rings?.getLocalBounds();
    if (at === undefined || box === undefined) throw new Error('no arc');
    expect(box.width).toBeLessThan(2 * (17 + 7 + 8));
    draw([intent({ origin: home, target: far, owner: 1 })], [], 140);
    const other = paints(rings);
    expect(other.some((p) => p.color === WARN)).toBe(false);
    expect(other.some((p) => p.action === 'stroke' && p.color === ENEMY)).toBe(true);
    view.destroy();
    kit.destroy();
  });

  it('keeps the chevrons with less motion, standing', () => {
    setReducedMotion(true);
    try {
      const { view, draw, rings, kit } = setup();
      const count = (tick: number): number => {
        draw([intent({})], [], tick);
        return paints(rings).filter((p) => p.action === 'fill' && p.color === WARN).length;
      };
      expect(count(140)).toBe(RIBBON_ENGRAVED.march.count);
      expect(count(147)).toBe(RIBBON_ENGRAVED.march.count);
      view.destroy();
      kit.destroy();
    } finally {
      setReducedMotion(null);
    }
  });
});

describe('IntentView: the arrows of ordinary orders (Cased running)', () => {
  it('draws an ordinary order as an arrow under the groups, not as a ribbon, with a ring round its target', () => {
    const { view, ribbons, layers, kit } = setup();
    const spots = new Map([['g', nodePoint(map, home) ?? { x: 0, y: 0 }]]);
    const frame = interpolateFrame(
      {
        ...base,
        view: { ...base.view, intents: [], groups: [group({ dest: via, path: [via] }, false)] },
      },
      null,
      100,
    );
    view.update(frame, spots);
    expect(ribbons?.getLocalBounds().width).toBe(0);
    const arrows = layers.layer.groups.children[0];
    expect(arrows?.getLocalBounds().width).toBeGreaterThan(0);
    const all = paints(arrows);
    // The paper casing, the dark casing, the own core, then the ring round the target.
    expect(all.some((p) => p.action === 'stroke' && p.color === YOU)).toBe(true);
    expect(all.some((p) => p.action === 'stroke' && p.color === CASING)).toBe(true);
    expect(all.some((p) => p.action === 'fill' && p.color === YOU)).toBe(true);
    view.destroy();
    kit.destroy();
  });
});

describe('IntentView, the bonus of an own plan (DEC-29; Eased steps with slots)', () => {
  const own = intent({ owner: 0, origin: home, target: far });
  /** The pills drawn: the text and their kind. */
  function pills(layers: ReturnType<typeof createLayers>): { text: string; state: string }[] {
    const found: { text: string; state: string }[] = [];
    const visit = (node: Container): void => {
      if (!node.visible) return;
      if (labelOf(node).startsWith('plan-bonus-pill:')) {
        const text = node.children.find((c): c is Text => c instanceof Text);
        found.push({
          text: text?.visible === true ? text.text : '',
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
    draw([own], [group({ bonus: 2 })]);
    expect(pills(layers)).toEqual([{ text: '+2', state: 'number' }]);
    draw([own], [group({ bonus: 1 })]);
    expect(pills(layers).map((p) => p.text)).toEqual(['+1']);
    view.destroy();
  });

  it('shows a chevron slot per asked bonus of a gathering plan, solid as gathered', () => {
    const { layers, draw, view } = setup();
    draw([own], [group({ bonus: 1, gathering: true, plan: 3 })]);
    expect(pills(layers)).toEqual([{ text: '', state: 'slots:1/3' }]);
    draw([own], [group({ bonus: 0, gathering: true, plan: 2 })]);
    expect(pills(layers)).toEqual([{ text: '', state: 'slots:0/2' }]);
    view.destroy();
  });

  it('shows nothing for a plan with no bonus, for an ordinary order, or without the group', () => {
    const { layers, draw, view } = setup();
    draw([own], [group({ bonus: 0 })]);
    expect(pills(layers)).toEqual([]);
    draw([own], [group({}, false)]);
    expect(pills(layers)).toEqual([]);
    draw([own], []);
    expect(pills(layers)).toEqual([]);
    view.destroy();
  });

  it('shows nothing at the ribbon of the opponent: its intent has no size and no bonus', () => {
    const { layers, draw, view } = setup();
    draw([intent({ owner: 1, origin: far, target: home })], [group()]);
    expect(pills(layers)).toEqual([]);
    view.destroy();
  });

  it('keeps the pill the same size on screen at any zoom', () => {
    for (const scale of [0.6, 2]) {
      const { layers, draw, view } = setup();
      view.setCameraScale(scale);
      draw([own], [group()]);
      const pill = layers.layer.intents.children
        .flatMap((c) => (c instanceof Container ? c.children : []))
        .find((c) => labelOf(c).startsWith('plan-bonus-pill:'));
      expect(pill?.scale.x).toBeCloseTo(1 / scale);
      view.destroy();
    }
  });

  it('eases each gathered bonus in after the server reported it, and flies the charge in', () => {
    const { draw, view, ribbons, flights } = setup();
    view.setWarehouseSlots(() => ({ x: 0, y: 0 }));
    const gather = (bonus: number) => group({ bonus, gathering: true, plan: 3 });
    const solid = (): number =>
      spanX(
        paints(ribbons)
          .filter((p) => p.action === 'fill' && p.color === YOU && !p.hatch)
          .flatMap((p) => p.points),
      );
    draw([own], [gather(0)], 100);
    expect(solid()).toBe(0);
    draw([own], [gather(1)], 101);
    // Reported now: nothing filled yet, the charge leaves the warehouse.
    expect(solid()).toBe(0);
    expect((flights as Graphics).context.instructions.length).toBeGreaterThan(0);
    draw([own], [gather(1)], 106);
    const early = solid();
    draw([own], [gather(1)], 115);
    const done = solid();
    expect(early).toBeGreaterThan(0);
    expect(done).toBeGreaterThan(early);
    // Landed: the flight is over, the fill holds.
    expect((flights as Graphics).context.instructions).toHaveLength(0);
    draw([own], [gather(1)], 130);
    expect(solid()).toBeCloseTo(done);
    view.destroy();
  });
});
