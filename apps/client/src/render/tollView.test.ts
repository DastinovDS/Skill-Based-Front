import type { Container, Text } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { EventMsg } from '../protocol.gen.ts';
import type { EnemyAnchors } from './entityView.ts';
import type { TokenSpot } from './layout.ts';
import { createLayers } from './layers.ts';
import { setReducedMotion } from './motion.ts';
import { ParticleLayer, type ParticleSpec } from './particles.ts';
import { WARN } from './style.ts';
import { TollView } from './tollView.ts';
import { HIT_AT_MS } from './tollLayout.ts';

const map = DEFAULT_MAP;
const edge = map.edges[0];
if (edge === undefined) throw new Error('the map has no road');
const MARK = { x: 10, y: 20, nx: 1, ny: 0 };
const paid: EventMsg = {
  type: 'event',
  tick: 100,
  kind: 'toll_paid',
  data: { player: 0, group: 'g1', node: edge.a, edge: edge.id, charges: 2 },
};
const taken: EventMsg = {
  type: 'event',
  tick: 100,
  kind: 'toll_taken',
  data: { player: 0, node: edge.a, edge: edge.id, charges: 1 },
};
const spots = new Map<string, TokenSpot>([['g1', { x: 60, y: 20, side: 30, scale: 1 }]]);
const enemies: EnemyAnchors = {
  nodePoint: () => undefined,
  nearestOnEdge: () => ({ x: 80, y: 40 }),
};

function build() {
  const layers = createLayers();
  const put = vi.spyOn(ParticleLayer.prototype, 'put');
  const view = new TollView(layers.layer.tolls, map, 0, 1, () => MARK);
  const root = layers.layer.tolls.children.find((c) => c.label === 'tolls') as Container;
  const plates = () => root.children.filter((c) => c.visible);
  const text = (c: Container): string => (c.children.find((x) => 'text' in x) as Text).text;
  const emitted = (): ParticleSpec[] => put.mock.calls.map(([spec]) => spec);
  const run = (events: EventMsg[], ticks: number) =>
    view.update(events, 100 + ticks, spots, enemies, 10, 1);
  return { view, layers, plates, text, emitted, run };
}

afterEach(() => {
  setReducedMotion(null);
  vi.restoreAllMocks();
});

describe('TollView', () => {
  it('lives in a layer of its own that the Supply mode does not hide', () => {
    const { layers } = build();
    const hidden = [
      layers.layer.groups,
      layers.layer.intents,
      layers.layer.fog,
      layers.layer.effects,
    ];
    expect(hidden).not.toContain(layers.layer.tolls);
    expect(layers.layer.tolls.children.length).toBeGreaterThan(0);
  });

  it('draws nothing before an event, after the effect, or without tolls', () => {
    const { run, plates, emitted } = build();
    run([paid], -1);
    run([paid], 8);
    run([], 1);
    run([{ ...paid, kind: 'fight_ended' }], 1);
    expect(plates()).toHaveLength(0);
    expect(emitted()).toHaveLength(0);
  });

  it('a toll the viewer paid: the beam to its group, the dashed amber ring, a plate with -N', () => {
    const { run, plates, text, emitted } = build();
    run([paid], 1);
    // The beam starts at the line and ends at the own group.
    const beam = emitted().filter((p) => p.kind === 'square' && p.aspect !== undefined);
    expect(beam.length).toBeGreaterThan(0);
    expect(emitted().some((p) => p.kind === 'dashRing' && p.color === WARN)).toBe(true);
    // At 0.1 s the hit has just landed: the plate shows.
    expect(plates()).toHaveLength(1);
    expect(text(plates()[0] as Container)).toBe('-2');
  });

  it('a toll the own line took: the enemy figure on the road is hit, a plain plate, no amber ring', () => {
    const { run, plates, text, emitted } = build();
    run([taken], 3);
    expect(emitted().some((p) => p.kind === 'dashRing')).toBe(false);
    expect(emitted().some((p) => p.kind === 'ring')).toBe(true);
    expect(plates()).toHaveLength(1);
    expect(text(plates()[0] as Container)).toBe('-1');
    // The plate stands over the figure the anchors found, not over the line.
    expect((plates()[0] as Container).x).toBeCloseTo(80);
  });

  it('tells a loss of the viewer from the enemy one by more than the hue: another frame on the plate', () => {
    const a = build();
    a.run([paid], 3);
    const b = build();
    b.run([taken], 3);
    const frameOf = (plate: Container) =>
      (plate.children[0] as unknown as { context: unknown }).context;
    expect(frameOf(a.plates()[0] as Container)).not.toBe(frameOf(b.plates()[0] as Container));
  });

  it('swells the token that was hit', () => {
    const { run } = build();
    const punches = run([paid], 2);
    expect(punches).toHaveLength(1);
    expect(punches[0]?.scale).toBeGreaterThan(1);
    expect(punches[0]?.at).toEqual({ x: 60, y: 20 });
  });

  it('with less motion: no beam, no particles, no swell, the plate and the ring held still', () => {
    setReducedMotion(true);
    const { run, plates, emitted } = build();
    const punches = run([paid], 0);
    expect(punches).toEqual([]);
    // Only the ring that tells the loss to the viewer is there, and the plate, from the first frame.
    expect(emitted().every((p) => p.kind === 'dashRing')).toBe(true);
    expect(plates()).toHaveLength(1);
    expect((plates()[0] as Container).y).toBeCloseTo(20 - 24);
    expect(run([paid], HIT_AT_MS / 100 + 3)).toEqual([]);
    expect((plates()[0] as Container).y).toBeCloseTo(20 - 24);
  });

  it('keeps the plates of two tolls apart and hides the plate of a finished one', () => {
    const { run, plates } = build();
    run([paid, taken], 3);
    expect(plates()).toHaveLength(2);
    run([paid, taken], 9);
    expect(plates()).toHaveLength(0);
  });

  it('puts a plate over the line when the group or the figure is not drawn', () => {
    const { view, plates } = build();
    view.update([paid], 103, new Map(), null, 10, 1);
    expect((plates()[0] as Container).x).toBeCloseTo(MARK.x);
  });

  it('reads the events again only when the list changed', () => {
    const { view, plates } = build();
    const events = [paid];
    view.update(events, 102, spots, enemies, 10, 1);
    expect(plates()).toHaveLength(1);
    // The same array and length: the tolls found before stay.
    events.splice(0, 1, taken);
    view.update(events, 102, spots, enemies, 10, 1);
    expect(plates()).toHaveLength(1);
    events.push(paid);
    view.update(events, 102, spots, enemies, 10, 1);
    expect(plates()).toHaveLength(2);
  });
});
