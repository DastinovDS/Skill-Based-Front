import { CanvasTextMetrics, Container, Graphics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { RenderEnemy } from '../net/interpolate.ts';
import type { EnemyGroup } from '../protocol.gen.ts';
import { FIGURE } from './figureLayout.ts';
import { FigureView } from './figureView.ts';
import { borderPermille } from './fogLayout.ts';
import { edgeEnds } from './layout.ts';
import { setReducedMotion } from './motion.ts';
import { EntityKit } from './shapes.ts';
import { testSprites } from './testSprites.ts';

const map = DEFAULT_MAP;
const edge = map.edges[0];
if (edge === undefined) throw new Error('no roads');
const ends = edgeEnds(map, edge.id);
if (ends === undefined) throw new Error('no ends');
const border = borderPermille(map, edge.id);
const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
/** The position `units` world units on the `b` side of the border point. */
const beyond = (units: number): number => border + (units / length) * 1000;

const figure = (fields: Partial<EnemyGroup> = {}): EnemyGroup => ({
  id: 'f1',
  pos: beyond(100),
  toward_b: true,
  detail: 'exact',
  mode: 'attack',
  units: 4,
  charged: 3,
  units_range: null,
  ...fields,
});
const enemy = (f: EnemyGroup): RenderEnemy => ({ edge: edge.id, figure: f, pos: f.pos });

function setup() {
  const layer = new Container();
  const marksLayer = new Container();
  const kit = new EntityKit(0, testSprites());
  const view = new FigureView(map, layer, marksLayer, kit, 1, 1);
  let stamp = 0;
  return {
    layer,
    marksLayer,
    view,
    update: (enemies: RenderEnemy[], tick = 100) => {
      stamp++;
      view.update(enemies, tick, 10, 1, stamp);
    },
    destroy: () => {
      view.destroy();
      layer.destroy({ children: true });
      marksLayer.destroy({ children: true });
      kit.destroy();
    },
  };
}

describe('FigureView (EF2 "Pointer", #354)', () => {
  beforeEach(() => {
    setLocale('en');
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setReducedMotion(null);
  });

  it('draws one figure per enemy group, and none for a group that is gone', () => {
    const t = setup();
    t.update([enemy(figure()), enemy(figure({ id: 'f2', pos: beyond(200) }))]);
    expect(t.layer.children).toHaveLength(2);
    t.update([enemy(figure())]);
    expect(t.layer.children).toHaveLength(1);
    t.update([]);
    expect(t.layer.children).toHaveLength(0);
    t.destroy();
  });

  it('keeps the same figure while its id lasts, and makes a new one for a new id', () => {
    const t = setup();
    t.update([enemy(figure())]);
    const first = t.layer.children[0];
    t.update([enemy(figure({ pos: beyond(120) }))]);
    expect(t.layer.children[0]).toBe(first);
    t.update([enemy(figure({ id: 'f9', pos: beyond(120) }))]);
    expect(t.layer.children[0]).not.toBe(first);
    t.destroy();
  });

  it('dissolves the figure in from the border point and not further than 24 units', () => {
    const t = setup();
    t.update([enemy(figure({ pos: beyond(0) }))]);
    expect(t.layer.children[0]?.alpha).toBeCloseTo(0);
    t.update([enemy(figure({ pos: beyond(FIGURE.dissolve / 2) }))]);
    expect(t.layer.children[0]?.alpha).toBeCloseTo(0.5);
    t.update([enemy(figure({ pos: beyond(FIGURE.dissolve) }))]);
    expect(t.layer.children[0]?.alpha).toBe(1);
    // Inside the other half the same rule counts from the border point.
    t.update([enemy(figure({ pos: border - (FIGURE.dissolve / length) * 500 }))]);
    expect(t.layer.children[0]?.alpha).toBeCloseTo(0.5);
    t.destroy();
  });

  it('puts the level in a plate: exact, range, and none at presence', () => {
    const t = setup();
    const plate = () => {
      const view = t.layer.children[0] as Container;
      return view.children[2] as Container;
    };
    const text = () => (plate().children[1] as unknown as { text: string }).text;
    t.update([enemy(figure())]);
    expect(plate().visible).toBe(true);
    expect(text()).toBe('4 · 3●');
    t.update([
      enemy(
        figure({ detail: 'range', units: null, charged: null, units_range: { low: 3, high: 5 } }),
      ),
    ]);
    expect(text()).toBe('3-5');
    t.update([enemy(figure({ detail: 'presence', units: null, charged: null }))]);
    expect(plate().visible).toBe(false);
    t.destroy();
  });

  it('draws the head again only when the direction changes', () => {
    const t = setup();
    t.update([enemy(figure())]);
    const head = (t.layer.children[0] as Container).children[0] as Graphics;
    const drawn = head.context.instructions.length;
    t.update([enemy(figure({ pos: beyond(150) }))]);
    expect(head.context.instructions).toHaveLength(drawn);
    t.update([enemy(figure({ pos: beyond(150), toward_b: false }))]);
    expect(head.context.instructions.length).toBeGreaterThan(0);
    t.destroy();
  });

  it('draws what the frame gives and nothing else: no figure, nothing on the layer', () => {
    // A group in a fight is not in `enemy_groups` (the fight shows it): nothing is added for it.
    const t = setup();
    t.update([]);
    expect(t.layer.children).toHaveLength(0);
    expect(t.view.tokens()).toHaveLength(0);
    t.destroy();
  });

  describe('coming out of the fog', () => {
    const marks = (t: ReturnType<typeof setup>): number =>
      (t.marksLayer.children[0] as Graphics).context.instructions.length;

    it('puts a ring and a tick on the border point for a figure first seen there', () => {
      const t = setup();
      t.update([], 100);
      t.update([enemy(figure({ pos: beyond(3) }))], 101);
      expect(marks(t)).toBeGreaterThan(0);
      // After 2 s there is nothing left.
      t.update([enemy(figure({ pos: beyond(60) }))], 122);
      expect(marks(t)).toBe(0);
      t.destroy();
    });

    it('puts nothing for a figure that was already there when the view started', () => {
      const t = setup();
      t.update([enemy(figure({ pos: beyond(3) }))], 100);
      expect(marks(t)).toBe(0);
      t.destroy();
    });

    it('puts nothing for a figure first seen deep in its half (it did not come out of the fog)', () => {
      const t = setup();
      t.update([], 100);
      t.update([enemy(figure({ pos: beyond(FIGURE.entryNear + 30) }))], 101);
      expect(marks(t)).toBe(0);
      t.destroy();
    });

    it('draws only the tick with "less motion"', () => {
      setReducedMotion(true);
      const t = setup();
      t.update([], 100);
      t.update([enemy(figure({ pos: beyond(3) }))], 101);
      const instructions = (t.marksLayer.children[0] as Graphics).context
        .instructions as unknown as {
        action: string;
        data: { path: { shapePath: { shapePrimitives: { shape: { type: string } }[] } } };
      }[];
      const circles = instructions.flatMap((i) =>
        i.data.path.shapePath.shapePrimitives.filter((p) => p.shape.type === 'circle'),
      );
      expect(circles).toHaveLength(0);
      expect(instructions.length).toBeGreaterThan(0);
      t.destroy();
    });
  });
});
