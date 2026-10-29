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
import { lighten } from './fightFx.ts';
import { BG, ENEMY, PAPER, PLATE_FILL, RIBBON, WARN, YOU } from './style.ts';
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

  it('ODb: the opponent intent is the same ribbon with a double outline, not a thin arrow', () => {
    const { view, draw, ribbons, kit } = setup();
    draw([intent({})], [], 140);
    const all = paints(ribbons);
    // The same tone of fill as an own ribbon.
    expect(
      all.some((p) => p.action === 'fill' && p.color === ENEMY && p.alpha === RIBBON.fillAlpha),
    ).toBe(true);
    // A wide line in the colour with a narrower plate line on top: two thin lines.
    const wide = all.findIndex(
      (p) => p.action === 'stroke' && p.color === ENEMY && p.width === RIBBON.foe.width,
    );
    expect(wide).toBeGreaterThanOrEqual(0);
    expect(all[wide + 1]).toMatchObject({
      action: 'stroke',
      color: PLATE_FILL,
      width: RIBBON.foe.inner,
    });
    // No casing and no own-style line for the opponent.
    expect(all.some((p) => p.action === 'stroke' && p.width === RIBBON.outline.casingWidth)).toBe(
      false,
    );
    view.destroy();
    kit.destroy();
  });

  it('ODb: the ribbon fills from the tail with a paper line at the front, and a tint ahead of it', () => {
    const { view, draw, ribbons, kit } = setup();
    // The delay is 30 ticks from 100: half way at 115.
    draw([intent({})], [], 115);
    const waiting = paints(ribbons);
    expect(
      waiting.some((p) => p.action === 'fill' && p.color === ENEMY && p.alpha === RIBBON.tintAlpha),
    ).toBe(true);
    expect(
      waiting.some((p) => p.action === 'fill' && p.color === ENEMY && p.alpha === RIBBON.prepAlpha),
    ).toBe(true);
    expect(
      waiting.some(
        (p) => p.action === 'stroke' && p.color === PAPER && p.width === RIBBON.front.width,
      ),
    ).toBe(true);
    draw([intent({})], [], 160);
    const going = paints(ribbons);
    expect(
      going.some((p) => p.action === 'fill' && p.color === ENEMY && p.alpha === RIBBON.prepAlpha),
    ).toBe(false);
    expect(
      going.some(
        (p) => p.action === 'stroke' && p.color === PAPER && p.width === RIBBON.front.width,
      ),
    ).toBe(false);
    view.destroy();
    kit.destroy();
  });

  it('ODb: a soft band runs along the ribbon on the way, not while it waits, nor with less motion', () => {
    const { view, draw, ribbons, kit } = setup();
    const sheen = (tick: number): boolean =>
      paints(ribbons).some(
        (p) => p.action === 'fill' && p.color === PAPER && p.alpha === RIBBON.sheen.alpha,
      ) && tick > 0;
    // The pass is 1.8 s: at 180 ticks the band is at the start, it is on the ribbon some time later.
    const seen = [150, 153, 156, 159, 162, 165, 168, 171].some((tick) => {
      draw([intent({})], [], tick);
      return sheen(tick);
    });
    expect(seen).toBe(true);
    draw([intent({})], [], 110);
    expect(sheen(110)).toBe(false);
    setReducedMotion(true);
    try {
      for (const tick of [150, 156, 162, 168]) {
        draw([intent({})], [], tick);
        expect(sheen(tick)).toBe(false);
      }
    } finally {
      setReducedMotion(null);
    }
    view.destroy();
    kit.destroy();
  });

  it('ODb: the tail of the opponent is a ring in a ring, the own tail a dot', () => {
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
    const theirs = circles(ribbons);
    draw([intent({ owner: 0, origin: home, target: via })], [], 140);
    // Two rings (three instructions: one is filled and stroked) against one dot (two).
    expect(theirs).toBe(3);
    expect(circles(ribbons)).toBe(2);
    view.destroy();
    kit.destroy();
  });

  it('ODb: the ring round the target is dashed and open at the bottom; amber over my city, red elsewhere', () => {
    const { view, draw, layers, kit } = setup();
    const rings = layers.layer.intents.children[1];
    draw([intent({ target: home })], [], 140);
    const strokes = paints(rings).filter((p) => p.action === 'stroke');
    // The casing and the ring, nothing else (no crosshair).
    expect(strokes).toHaveLength(2);
    expect(strokes.filter((p) => p.color === WARN)).toHaveLength(1);
    expect(paints(rings).some((p) => p.color === YOU)).toBe(false);
    // Open at the bottom: nothing is drawn straight below the centre of the target.
    const at = nodePoint(map, home);
    const box = rings?.getLocalBounds();
    if (at === undefined || box === undefined) throw new Error('no ring');
    const reach = 17 + RIBBON.ring.gap;
    expect(box.width).toBeGreaterThan(2 * reach - 4);
    expect(box.maxY).toBeLessThan(at.y + reach - 1);
    draw([intent({ origin: home, target: far, owner: 1 })], [], 140);
    expect(paints(rings).filter((p) => p.color === WARN)).toHaveLength(0);
    expect(paints(rings).filter((p) => p.color === ENEMY)).toHaveLength(1);
    view.destroy();
    kit.destroy();
  });

  it('ODb: the ring pulses over my city, and holds still with less motion', () => {
    const { view, draw, layers, kit } = setup();
    const rings = layers.layer.intents.children[1];
    const ringAlpha = (tick: number) => {
      draw([intent({})], [], tick);
      return paints(rings).filter((p) => p.action === 'stroke')[1]?.alpha;
    };
    // A period is 0.9 s: 9 ticks at 10 Hz; half a period apart it is at its two extremes.
    expect(ringAlpha(144)).toBeCloseTo(RIBBON.ring.pulseLow);
    expect(ringAlpha(148.5)).toBeCloseTo(1);
    setReducedMotion(true);
    try {
      expect(ringAlpha(144)).toBe(1);
      expect(ringAlpha(148.5)).toBe(1);
    } finally {
      setReducedMotion(null);
    }
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
    // The cast shadow is under it, the underlay is under every tint.
    expect(fills[0]).toMatchObject({ color: BG, alpha: RIBBON.shadow.alpha });
    expect(fills[1]).toEqual(underlay);
    // The enemy's arrow has it too.
    draw([intent({ owner: 1, origin: a, target: b })]);
    expect(paints(ribbons).some((p) => p.color === RIBBON.underlay.color && p.alpha >= 0.9)).toBe(
      true,
    );
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
    // The shadow-free middle of the ribbon: its bounds centre; the arc sits above the chord.
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

  it('pulses once when the delay ends: the own line swells, then settles', () => {
    const { view, draw, ribbons, kit } = setup();
    const line = lighten(YOU, RIBBON.outline.lighten);
    const widthAt = (tick: number, created = 100): number => {
      draw([intent({ owner: 0, origin: a, target: b, created_tick: created })], [], tick);
      return paints(ribbons).find((p) => p.action === 'stroke' && p.color === line)?.width ?? NaN;
    };
    // The delay is 30 ticks: it ends at 130; the pulse is 8 ticks, its peak at 134.
    expect(widthAt(120)).toBeCloseTo(RIBBON.outline.width);
    expect(widthAt(134)).toBeCloseTo(RIBBON.outline.width + RIBBON.pulseWidth);
    expect(widthAt(145)).toBeCloseTo(RIBBON.outline.width);
    // It does not pulse again.
    expect(widthAt(300)).toBeCloseTo(RIBBON.outline.width);
    // A flash of paper over the ribbon at the peak, none after.
    draw([intent({ owner: 0, origin: a, target: b, created_tick: 100 })], [], 134);
    expect(
      paints(ribbons).some((p) => p.action === 'fill' && p.color === PAPER && p.alpha > 0.4),
    ).toBe(true);
    view.destroy();
    kit.destroy();
  });

  it('with less motion has no pulse', () => {
    setReducedMotion(true);
    try {
      const { view, draw, ribbons, kit } = setup();
      draw([intent({ owner: 0, origin: a, target: b, created_tick: 100 })], [], 134);
      const line = paints(ribbons).find(
        (p) => p.action === 'stroke' && p.color === lighten(YOU, RIBBON.outline.lighten),
      );
      expect(line?.width).toBeCloseTo(RIBBON.outline.width);
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
