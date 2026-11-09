import type { Container, Graphics, Text } from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { EventMsg } from '../protocol.gen.ts';
import type { EnemyAnchors } from './entityView.ts';
import type { TokenSpot } from './layout.ts';
import { createLayers } from './layers.ts';
import { setReducedMotion } from './motion.ts';
import { ENEMY, YOU } from './style.ts';
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
  const view = new TollView(layers.layer.tolls, map, 0, 1, () => MARK);
  const root = layers.layer.tolls.children.find((c) => c.label === 'tolls') as Container;
  const lines = root.children.find((c) => c.label === 'toll-lines') as Graphics;
  const plates = () => root.children.filter((c) => c.label === 'toll-tag' && c.visible);
  const text = (c: Container): string => (c.children.find((x) => 'text' in x) as Text).text;
  /** The colours the strikes and hits are stroked in. */
  const strokes = (): number[] =>
    lines.context.instructions.flatMap((i) =>
      i.action === 'stroke' ? [(i.data.style as { color: number }).color] : [],
    );
  const run = (events: EventMsg[], ticks: number) =>
    view.update(events, 100 + ticks, spots, enemies, 10, 1);
  return { view, layers, plates, text, strokes, run };
}

afterEach(() => {
  setReducedMotion(null);
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
    const { run, plates, view } = build();
    run([paid], -1);
    run([paid], 12);
    run([], 1);
    run([{ ...paid, kind: 'fight_ended' }], 1);
    expect(plates()).toHaveLength(0);
    expect(view.drawing()).toBe(false);
  });

  it('a toll the viewer paid: the strike of the enemy wall runs to the own group, then -N', () => {
    const { run, plates, text, strokes, view } = build();
    run([paid], 1);
    // At 0.1 s the strike is on its way: the hairlines of the enemy's colour, no tag yet.
    expect(view.drawing()).toBe(true);
    expect(strokes()).toContain(ENEMY);
    expect(plates()).toHaveLength(0);
    // From the hit on, the tag over the group.
    run([paid], 4);
    expect(plates()).toHaveLength(1);
    expect(text(plates()[0] as Container)).toBe('\u22122');
    expect((plates()[0] as Container).x).toBeCloseTo(60);
  });

  it('a toll the own wall took: the strike in the own colour, the enemy figure on the road is hit', () => {
    const { run, plates, text, strokes } = build();
    run([taken], 1);
    expect(strokes()).toContain(YOU);
    run([taken], 5);
    expect(plates()).toHaveLength(1);
    expect(text(plates()[0] as Container)).toBe('\u22121');
    // The tag stands over the figure the anchors found, not over the wall.
    expect((plates()[0] as Container).x).toBeCloseTo(80);
  });

  it('swells the token that was hit', () => {
    const { run } = build();
    const punches = run([paid], 4);
    expect(punches).toHaveLength(1);
    expect(punches[0]?.scale).toBeGreaterThan(1);
    expect(punches[0]?.at).toEqual({ x: 60, y: 20 });
  });

  it('with less motion: no strike, no hit, no swell, the tag held still from the first frame', () => {
    setReducedMotion(true);
    const { run, plates, view } = build();
    const punches = run([paid], 0);
    expect(punches).toEqual([]);
    expect(view.drawing()).toBe(false);
    expect(plates()).toHaveLength(1);
    expect((plates()[0] as Container).y).toBeCloseTo(20 - 22);
    expect(run([paid], HIT_AT_MS / 100 + 3)).toEqual([]);
    expect((plates()[0] as Container).y).toBeCloseTo(20 - 22);
  });

  it('keeps the plates of two tolls apart and hides the plate of a finished one', () => {
    const { run, plates } = build();
    run([paid, taken], 5);
    expect(plates()).toHaveLength(2);
    run([paid, taken], 12);
    expect(plates()).toHaveLength(0);
  });

  it('puts a plate over the line when the group or the figure is not drawn', () => {
    const { view, plates } = build();
    view.update([paid], 105, new Map(), null, 10, 1);
    expect((plates()[0] as Container).x).toBeCloseTo(MARK.x);
  });

  it('reads the events again only when the list changed', () => {
    const { view, plates } = build();
    const events = [paid];
    view.update(events, 105, spots, enemies, 10, 1);
    expect(plates()).toHaveLength(1);
    // The same array and length: the tolls found before stay.
    events.splice(0, 1, taken);
    view.update(events, 105, spots, enemies, 10, 1);
    expect(plates()).toHaveLength(1);
    events.push(paid);
    view.update(events, 105, spots, enemies, 10, 1);
    expect(plates()).toHaveLength(2);
  });
});
