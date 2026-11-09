import type { Container, Graphics, Text } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { DEV_RULES_FLOW, devSnapshot } from '../hud/devFeed.ts';
import { BUNDLED_MAPS, DEFAULT_MAP, bundledGeo } from '../map/bundledMaps.ts';
import type { RoadFort, SnapshotMsg } from '../protocol.gen.ts';
import { buildProgress, FortView, fortsOf } from './fortView.ts';
import { ringOrder } from './fortLayout.ts';
import { borderPermille } from './fogLayout.ts';
import { createLayers } from './layers.ts';
import { setReducedMotion } from './motion.ts';
import { ENEMY, YOU } from './style.ts';
import { WALL } from './wallLayout.ts';
import { territoryOf, voronoiTerritory } from './territory.ts';

const map = DEFAULT_MAP;
const territory = voronoiTerritory(map);
const base = devSnapshot(map, DEV_RULES_FLOW, 100);
const TICK = 100;

// A road with an own city at one end and the enemy's at the other, if the map has one; else any road.
const road =
  map.edges.find((e) => {
    const a = base.view.nodes[e.a]?.owner;
    const b = base.view.nodes[e.b]?.owner;
    return a !== b && a !== null && b !== null;
  }) ?? map.edges[0];
if (road === undefined) throw new Error('the map has no road');

function withForts(forts: readonly RoadFort[], tick = TICK): SnapshotMsg {
  return {
    ...base,
    tick,
    view: {
      ...base.view,
      edges: base.view.edges.map((edge) =>
        edge.id === road?.id ? { ...edge, forts: [...forts] } : edge,
      ),
    },
  };
}

const own = (built: boolean, doneTick: number | null = null): RoadFort => ({
  node: road.a,
  owner: 0,
  built,
  done_tick: doneTick,
});
const enemyFort = (built: boolean): RoadFort => ({
  node: road.b,
  owner: 1,
  built,
  done_tick: null,
});

function build() {
  const layers = createLayers();
  const view = new FortView(map, layers, 0, () => territory.edges);
  view.setBuildTicks(100);
  const root = layers.layer.forts.children.find((c) => c.label === 'forts') as Container;
  const part = (label: string): Graphics =>
    root.children.find((c) => c.label === label) as Graphics;
  return {
    layers,
    view,
    walls: part('fort-walls'),
    falls: part('fort-falls'),
    ghosts: part('fort-ghosts'),
    shapes: (g: Graphics) => g.context.instructions.length,
    /** The shapes drawn, every one in every path (a fill of many circles counts each). */
    primitives: (g: Graphics) =>
      g.context.instructions.reduce(
        (n, i) => n + (i.action === 'fill' ? i.data.path.shapePath.shapePrimitives.length : 1),
        0,
      ),
  };
}

/** The colours a Graphics fills with. */
const fillColours = (g: Graphics): number[] =>
  g.context.instructions.flatMap((i) =>
    i.action === 'fill' ? [(i.data.style as { color: number }).color] : [],
  );

describe('fortsOf: the lines of a snapshot', () => {
  it('lists them by node and road, with the owner, the state and the end tick', () => {
    const list = fortsOf(withForts([own(false, 150), enemyFort(true)]).view);
    expect(list.map((f) => [f.node, f.edge, f.owner, f.built, f.doneTick])).toEqual(
      [
        [road.a, road.id, 0, false, 150],
        [road.b, road.id, 1, true, null],
      ].sort((x, y) => (x[0] as number) - (y[0] as number)),
    );
  });
  it('is empty for a snapshot without lines', () => {
    expect(fortsOf(base.view)).toEqual([]);
  });
});

describe('buildProgress: the part of an own build done', () => {
  it('runs from 0 to 1 over the build ticks, in steps, never outside', () => {
    expect(buildProgress(200, 100, 100)).toBe(0);
    expect(buildProgress(200, 150, 100)).toBe(0.5);
    expect(buildProgress(200, 199, 100)).toBeLessThan(1);
    expect(buildProgress(200, 200, 100)).toBe(1);
    expect(buildProgress(200, 300, 100)).toBe(1);
    expect(buildProgress(200, 50, 100)).toBe(0);
  });
  it('knows nothing without the ruleset build time', () => {
    expect(buildProgress(200, 150, 0)).toBe(0);
  });
});

describe('FortView: Set back, two masonries (#858)', () => {
  it('draws nothing without a wall', () => {
    const { view, walls, shapes } = build();
    view.update(base.view, TICK, null);
    expect(shapes(walls)).toBe(0);
    view.destroy();
  });

  it('draws a built wall and says where its gate is: on the road, inside the own cell', () => {
    const { view, walls, shapes } = build();
    view.update(withForts([own(true)]).view, TICK, null);
    expect(shapes(walls)).toBeGreaterThan(3);
    const mark = view.lineAt(road.a, road.id);
    expect(mark).toBeDefined();
    expect(Math.hypot(mark?.nx ?? 0, mark?.ny ?? 0)).toBeCloseTo(1);
    // The gate lies on the road, short of the border point on the own side (nearer the own node).
    const a = map.nodes[road.a];
    const b = map.nodes[road.b];
    if (a === undefined || b === undefined || mark === undefined) throw new Error('no road');
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const along = ((mark.x - a.x) * (b.x - a.x) + (mark.y - a.y) * (b.y - a.y)) / length;
    const off = Math.abs(((mark.x - a.x) * (b.y - a.y) - (mark.y - a.y) * (b.x - a.x)) / length);
    expect(off).toBeLessThan(0.5);
    const border = (borderPermille(map, road.id) / 1000) * length;
    expect(along).toBeLessThan(border);
    expect(along).toBeGreaterThan(border - 3 * WALL.offset);
    // Another end of the road has no wall.
    expect(view.lineAt(road.b, road.id)).toBeUndefined();
    view.destroy();
  });

  it('draws again only when something it shows has changed, not every frame', () => {
    const { view } = build();
    const snapshot = withForts([own(true)]);
    view.update(snapshot.view, TICK, null);
    const before = view.lineAt(road.a, road.id);
    view.update(snapshot.view, TICK + 1, null);
    view.update(snapshot.view, TICK + 2, null);
    // The marks are rebuilt by a redraw, so the same object means the same picture.
    expect(view.lineAt(road.a, road.id)).toBe(before);
    view.setCameraScale(0.4);
    view.update(snapshot.view, TICK + 3, null);
    expect(view.lineAt(road.a, road.id)).not.toBe(before);
    view.destroy();
  });

  it('an own build grows from its gate with the render tick: more of it is drawn later', () => {
    const { view, walls, primitives } = build();
    view.update(withForts([own(false, 200)]).view, 110, null);
    const early = primitives(walls);
    view.update(withForts([own(false, 200)]).view, 190, null);
    // More teeth stand, fewer points of the part not built yet are left.
    expect(primitives(walls)).not.toBe(early);
    const teeth = (g: Graphics): number =>
      g.context.instructions.reduce(
        (n, i) =>
          n +
          (i.action === 'fill' && (i.data.style as { color: number }).color === YOU
            ? i.data.path.shapePath.shapePrimitives.length
            : 0),
        0,
      );
    view.update(withForts([own(false, 200)]).view, 110, null);
    const before = teeth(walls);
    view.update(withForts([own(false, 200)]).view, 190, null);
    expect(teeth(walls)).toBeGreaterThan(before);
    view.destroy();
  });

  it('shows an enemy wall that is being built only as its points and gate, a built one in its colour', () => {
    const { view, walls } = build();
    view.update(withForts([enemyFort(false)]).view, TICK, null);
    expect(walls.context.instructions.length).toBeGreaterThan(0);
    expect(fillColours(walls)).not.toContain(ENEMY);
    view.update(withForts([enemyFort(true)]).view, TICK, null);
    expect(fillColours(walls)).toContain(ENEMY);
    view.destroy();
  });

  it('builds the own wall as a battlement (square towers) and the enemy one as a palisade (round posts)', () => {
    const { view, walls } = build();
    const kinds = (): string[] =>
      walls.context.instructions.flatMap((i) =>
        i.action === 'fill' ? i.data.path.shapePath.shapePrimitives.map((p) => p.shape.type) : [],
      );
    view.update(withForts([own(true)]).view, TICK, null);
    expect(kinds()).not.toContain('circle');
    view.update(withForts([enemyFort(true)]).view, TICK, null);
    expect(kinds()).toContain('circle');
    view.destroy();
  });

  it('draws the enemy wall first, so the own one is never under it', () => {
    const { view, walls } = build();
    view.update(withForts([own(true), enemyFort(true)]).view, TICK, null);
    const colours = fillColours(walls);
    expect(colours.indexOf(ENEMY)).toBeGreaterThanOrEqual(0);
    expect(colours.indexOf(ENEMY)).toBeLessThan(colours.indexOf(YOU));
    view.destroy();
  });

  it('keeps no memory of an enemy wall: it is gone from the picture when the snapshot drops it', () => {
    const { view, walls, shapes } = build();
    view.update(withForts([enemyFort(true)]).view, TICK, null);
    expect(shapes(walls)).toBeGreaterThan(0);
    view.update(base.view, TICK + 1, null);
    expect(shapes(walls)).toBe(0);
    expect(view.lineAt(road.b, road.id)).toBeUndefined();
    // The node did not change hands: nothing falls.
    expect(view.falling()).toBe(0);
    view.destroy();
  });

  it('draws both sides of one road, each in its own half: two gates apart, facing each other', () => {
    const { view } = build();
    view.update(withForts([own(true), enemyFort(true)]).view, TICK, null);
    const a = view.lineAt(road.a, road.id);
    const b = view.lineAt(road.b, road.id);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // The two walls face each other: their outward vectors point opposite ways.
    expect((a?.nx ?? 0) * (b?.nx ?? 0) + (a?.ny ?? 0) * (b?.ny ?? 0)).toBeLessThan(0);
    // A strip between the gates: each is set back from the border point.
    expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0))).toBeGreaterThan(
      1.5 * WALL.offset,
    );
    view.destroy();
  });

  it('a captured node: its walls fall once the winner has walked in, then are gone', () => {
    const { view, falls, shapes } = build();
    view.update(withForts([own(true)]).view, TICK, null);
    view.setCaptureDelays(new Map([[road.a, 300]]));
    const taken = withForts([]);
    const nodes = taken.view.nodes.map((n) => (n.id === road.a ? { ...n, owner: 1 as const } : n));
    view.update({ ...taken.view, nodes }, TICK + 1, null);
    expect(view.falling()).toBe(1);
    // Standing until the walk-in is over, then breaking up.
    view.advance(100);
    const standing = shapes(falls);
    expect(standing).toBeGreaterThan(0);
    view.advance(500);
    expect(shapes(falls)).toBeGreaterThan(0);
    view.advance(WALL.fall.ms);
    expect(view.falling()).toBe(0);
    view.advance(16);
    expect(shapes(falls)).toBe(0);
    view.destroy();
  });

  it('with less motion a captured wall is just gone', () => {
    setReducedMotion(true);
    try {
      const { view } = build();
      view.update(withForts([own(true)]).view, TICK, null);
      const taken = withForts([]);
      const nodes = taken.view.nodes.map((n) =>
        n.id === road.a ? { ...n, owner: 1 as const } : n,
      );
      view.update({ ...taken.view, nodes }, TICK + 1, null);
      expect(view.falling()).toBe(0);
      view.destroy();
    } finally {
      setReducedMotion(null);
    }
  });
});

describe('FortView: the pick of "Fortify road" (P1 Ghosts)', () => {
  const roads = map.edges.filter((e) => e.a === road.a || e.b === road.a).map((e) => e.id);
  const pick = (hover: number | null) => ({
    node: road.a,
    edges: roads,
    hover,
    cost: '1.5 CP',
    amount: '1.5',
  });
  const priceOf = (view: ReturnType<typeof build>['layers']) =>
    (view.layer.forts.children[0] as Container).children
      .flatMap((c) => (c.label === 'fort-labels' ? c.children : []))
      .find((c) => c.label === 'fort-price') as Text | undefined;

  it('lays a ghost on every road offered, and tells where the pointer hits each', () => {
    const { view, ghosts, shapes } = build();
    view.update(base.view, TICK, pick(null));
    expect(shapes(ghosts)).toBeGreaterThan(0);
    expect(
      view
        .pickTargets()
        .map((t) => t.edge)
        .sort(),
    ).toEqual([...roads].sort());
    view.destroy();
  });

  it('shows the price beside the hovered ghost only', () => {
    const { view, layers } = build();
    view.update(base.view, TICK, pick(null));
    expect(priceOf(layers)?.visible ?? false).toBe(false);
    view.update(base.view, TICK, pick(road.id));
    const price = priceOf(layers);
    expect(price?.visible).toBe(true);
    // The number beside the CP mark (drawn with the ghosts), not the word.
    expect(price?.text).toBe('1.5');
    view.update(base.view, TICK, null);
    expect(priceOf(layers)?.visible).toBe(false);
    view.destroy();
  });

  it('leaves no ghost and no target when the pick ends', () => {
    const { view, ghosts, shapes } = build();
    view.update(base.view, TICK, pick(road.id));
    view.update(base.view, TICK, null);
    expect(shapes(ghosts)).toBe(0);
    expect(view.pickTargets()).toEqual([]);
    view.destroy();
  });

  it('puts the ghost of a second line on the stretch where one stands further in', () => {
    const { view } = build();
    // The road has a line of the node already: the pick offers the others, and where they overlap the
    // first one's stretch the ghost lies one level in (checked by the stack level; here: no crash, targets kept).
    view.update(withForts([own(true)]).view, TICK, {
      node: road.a,
      edges: roads.filter((id) => id !== road.id),
      hover: null,
      cost: '1.5 CP',
    });
    expect(view.pickTargets().every((t) => t.edge !== road.id)).toBe(true);
    view.destroy();
  });
});

describe('FortView: a wall covers the whole shared border on a geography map (#734)', () => {
  const narrows = BUNDLED_MAPS.find((m) => m.meta.name === 'narrows');
  if (narrows === undefined) throw new Error('the map narrows is not bundled');
  const land = territoryOf(narrows, bundledGeo(narrows));
  // The Narrows (14) and Far Fork (17): the road 45 crosses their smooth shared border about 35
  // units from one end and 156 from the other (the owner's playtest, #734).
  const NODE = 14;
  const TO = 17;
  const ROAD = 45;
  const border = ringOrder(land.edges.filter((e) => e.cell === NODE)).filter(
    (e) => e.neighbour === TO,
  );
  const ends = [border[0]?.a, border[border.length - 1]?.b];

  it('the ghost of the pick reaches both ends of the border with the cell the road leads to', () => {
    const layers = createLayers();
    const view = new FortView(narrows, layers, 0, () => land.edges);
    const snap = devSnapshot(narrows, DEV_RULES_FLOW, TICK);
    view.update(snap.view, TICK, { node: NODE, edges: [ROAD], hover: null, cost: '1.5 CP' });
    const line = view.pickTargets().find((t) => t.edge === ROAD)?.line ?? [];
    expect(line.length).toBeGreaterThan(1);
    const first = line[0];
    const last = line[line.length - 1];
    if (first === undefined || last === undefined) throw new Error('no line');
    // The wall lies a few units inside the cell (its offset), so its ends are that close to the
    // ends of the border, whichever way round the run goes.
    const near = (p: { x: number; y: number }) =>
      Math.min(...ends.map((q) => (q === undefined ? Infinity : Math.hypot(p.x - q.x, p.y - q.y))));
    expect(near(first)).toBeLessThan(12);
    expect(near(last)).toBeLessThan(12);
    view.destroy();
  });
});
