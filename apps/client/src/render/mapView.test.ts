import { Graphics, type Renderer } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Detail } from '../protocol.gen.ts';
import { createLayers, type MapLayers } from './layers.ts';
import { MapView } from './mapView.ts';
import { BG, ROAD_BUFFER, ROAD_FOG, ROAD_OWN, YOU, ENEMY } from './style.ts';

// The roads read without colour (R1, #345): the level is the number of lanes, an own road has solid
// lanes on a band of its owner's colour, a buffer road dashed lanes, and a half in fog dotted ones.

const map = DEFAULT_MAP;
const edge = map.edges[0];
if (edge === undefined) throw new Error('a map without roads');
const owners = (a: number | null, b: number | null) =>
  map.nodes.map((n) => (n.id === edge.a ? a : n.id === edge.b ? b : null)) as (0 | 1 | null)[];
const halves = (a: Detail, b: Detail) => [{ detail: a }, { detail: b }];

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
interface Fill {
  readonly color: number;
  readonly alpha: number;
  readonly rects: Rect[];
}

/** What a Graphics fills: its colour, opacity and rectangles. */
function fillsOf(g: Graphics): Fill[] {
  const instructions = g.context.instructions as unknown as {
    action: string;
    data: {
      style: { color: number; alpha: number };
      path: { shapePath: { shapePrimitives: { shape: Rect & { type: string } }[] } };
    };
  }[];
  return instructions
    .filter((i) => i.action === 'fill')
    .map((i) => ({
      color: i.data.style.color,
      alpha: i.data.style.alpha,
      rects: i.data.path.shapePath.shapePrimitives
        .filter((p) => p.shape.type === 'rectangle')
        .map((p) => p.shape),
    }));
}

interface Quad {
  readonly points: { x: number; y: number }[];
  readonly color: number;
}

/** The quadrilaterals a Graphics fills (the dashes), each with the colour of its fill. */
function quadsOf(g: Graphics): Quad[] {
  const instructions = g.context.instructions as unknown as {
    action: string;
    data: {
      style: { color: number };
      path: { shapePath: { shapePrimitives: { shape: { points: number[] } }[] } };
    };
  }[];
  return instructions
    .filter((i) => i.action === 'fill')
    .flatMap((i) =>
      i.data.path.shapePath.shapePrimitives.map((p) => {
        const flat = p.shape.points;
        return {
          color: i.data.style.color,
          points: [0, 2, 4, 6].map((k) => ({ x: flat[k] ?? NaN, y: flat[k + 1] ?? NaN })),
        };
      }),
    );
}

describe('MapView, the roads of R1', () => {
  let layers: MapLayers;
  let view: MapView;
  /** The four parts of the road 0 as the view made them. */
  const parts = (): { casings: Graphics[]; lanes: Graphics[] } => {
    const group = (label: string) =>
      (layers.layer.roads.children.find((c) => c.label === label)?.children ?? []) as Graphics[];
    const per = map.edges.length;
    expect(group('road-casings')).toHaveLength(per * 2);
    // The first of the lanes is the one Graphics of all the dashes.
    expect(group('road-lanes')).toHaveLength(per * 2 + 1);
    return {
      casings: group('road-casings').slice(0, 2),
      lanes: group('road-lanes').slice(1, 3),
    };
  };
  const laneRects = (g: Graphics): Rect[] => fillsOf(g).flatMap((f) => f.rects);

  // The road 0 in the world: its ends and where a point stands along it and across it.
  const a0 = map.nodes[edge.a] ?? { x: 0, y: 0 };
  const b0 = map.nodes[edge.b] ?? { x: 0, y: 0 };
  const length0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const ux = (b0.x - a0.x) / length0;
  const uy = (b0.y - a0.y) / length0;
  const along = (p: { x: number; y: number }) => (p.x - a0.x) * ux + (p.y - a0.y) * uy;
  const across = (p: { x: number; y: number }) => -(p.x - a0.x) * uy + (p.y - a0.y) * ux;
  /** The dashes of the road 0: quadrilaterals on its line, away from the cities where other roads begin. */
  const dashesOfRoad0 = (): Quad[] => {
    const layer = layers.layer.roads.children.find((c) => c.label === 'road-lanes');
    const dashes = layer?.children[0] as Graphics;
    return quadsOf(dashes).filter((quad) => {
      const middle = (along(quad.points[0] ?? a0) + along(quad.points[2] ?? a0)) / 2;
      return (
        middle > 40 && middle < length0 - 40 && quad.points.every((p) => Math.abs(across(p)) < 6)
      );
    });
  };
  /** The lengths along the road and the offsets across it that the dashes have. */
  const dashLength = (quad: Quad) =>
    Math.abs(along(quad.points[1] ?? a0) - along(quad.points[0] ?? a0));
  const laneAt = (quad: Quad) => +across(quad.points[0] ?? a0).toFixed(2);

  beforeEach(() => {
    layers = createLayers();
    view = new MapView(map, layers, 0, {} as Renderer, true);
  });
  afterEach(() => {
    view.destroy();
  });

  it('draws one, two or three lanes for level 1, 2 and 3', () => {
    view.setOwners(owners(0, 0));
    for (const level of [1, 2, 3]) {
      view.setRoads(map.edges.map((e) => ({ width: e.id === edge.id ? level : 1 })));
      expect(laneRects(parts().lanes[0] as Graphics)).toHaveLength(level);
    }
  });

  it('puts the lanes of a level across the road, not along it', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map((e) => ({ width: e.id === edge.id ? 3 : 1 })));
    const rects = laneRects(parts().lanes[0] as Graphics);
    expect(rects.map((r) => +(r.y + r.height / 2).toFixed(2))).toEqual([-3.7, 0, 3.7]);
    expect(new Set(rects.map((r) => r.height))).toEqual(new Set([2]));
  });

  it('gives an own road solid lanes on a band of its owner, and an enemy one the band of the enemy', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({ width: 2 })));
    const own = parts();
    const solid = laneRects(own.lanes[0] as Graphics);
    // Solid: each lane is one rectangle over the unit length (the view scales it to the road).
    expect(solid.map((r) => r.width)).toEqual([1, 1]);
    expect(fillsOf(own.casings[0] as Graphics)[0]).toMatchObject({
      color: YOU,
      alpha: ROAD_OWN.bandAlpha,
    });
    expect(fillsOf(own.lanes[0] as Graphics)[0]).toMatchObject({ alpha: ROAD_OWN.laneAlpha });
    view.setOwners(owners(1, 1));
    expect(fillsOf(parts().casings[0] as Graphics)[0]?.color).toBe(ENEMY);
  });

  it('gives a buffer road dashed lanes and a dark casing, without the band of an owner', () => {
    view.setRoads(map.edges.map(() => ({ width: 2 })));
    for (const pair of [owners(0, 1), owners(0, null), owners(null, null)]) {
      view.setOwners(pair);
      const { casings, lanes } = parts();
      // The dashes of all roads are drawn together; the solid lanes of this road are not.
      expect(lanes[0]?.visible).toBe(false);
      const dashes = dashesOfRoad0();
      expect(dashes.length).toBeGreaterThan(4);
      expect(dashes[0]?.color).toBe(ROAD_BUFFER.lane);
      expect(dashLength(dashes[0] as Quad)).toBeCloseTo(ROAD_BUFFER.dash);
      // Two lanes, the level 2 (3.7 apart across the road, the width of a lane to each side).
      expect([...new Set(dashes.map(laneAt))].sort((p, q) => p - q)).toEqual([-2.85, 0.85]);
      expect(fillsOf(casings[0] as Graphics)[0]).toMatchObject({
        color: BG,
        alpha: ROAD_BUFFER.casingAlpha,
      });
    }
  });

  it('turns a road into a buffer road when an end changes hands, and back', () => {
    view.setRoads(map.edges.map(() => ({ width: 1 })));
    view.setOwners(owners(0, 0));
    expect(laneRects(parts().lanes[0] as Graphics)).toHaveLength(1);
    expect(dashesOfRoad0()).toEqual([]);
    view.setOwners(owners(0, 1));
    expect(dashesOfRoad0().length).toBeGreaterThan(4);
    view.setOwners(owners(0, 0));
    expect(laneRects(parts().lanes[0] as Graphics)).toHaveLength(1);
    expect(dashesOfRoad0()).toEqual([]);
  });

  it('dots the lanes of a road in fog, whoever its ends belong to', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({ width: 2, halves: halves('fog', 'fog') })));
    const { casings, lanes } = parts();
    // Both halves alike: one stretch over the whole road, the second one is not drawn.
    expect(lanes.map((l) => l.visible)).toEqual([false, false]);
    const dots = dashesOfRoad0();
    expect(dots.length).toBeGreaterThan(10);
    expect(dots[0]?.color).toBe(ROAD_FOG.lane);
    expect(dashLength(dots[0] as Quad)).toBeCloseTo(ROAD_FOG.dash);
    expect(fillsOf(casings[0] as Graphics)[0]).toMatchObject({
      color: BG,
      alpha: ROAD_FOG.casingAlpha,
    });
  });

  it('draws only the half in fog dotted: two stretches that meet at the border point', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({ width: 1, halves: halves('exact', 'fog') })));
    const { casings, lanes } = parts();
    // The half in sight has its solid lane, the half in fog the dots and no solid lane.
    expect(lanes.map((l) => l.visible)).toEqual([true, false]);
    expect(laneRects(lanes[0] as Graphics)).toHaveLength(1);
    const dots = dashesOfRoad0();
    expect(dots.length).toBeGreaterThan(5);
    // Every dot lies in the half of the end b: past the border point (the middle of the road).
    expect(
      Math.min(...dots.map((d) => along(d.points[0] as { x: number; y: number }))),
    ).toBeGreaterThanOrEqual(length0 / 2 - 1e-6);
    // The second stretch begins where the first ends.
    expect(casings[0]?.scale.x).toBeCloseTo(length0 / 2);
    expect(casings[1]?.scale.x).toBeCloseTo(length0 / 2);
    const first = casings[0] as Graphics;
    const second = casings[1] as Graphics;
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeCloseTo(length0 / 2);
  });

  it('does not redraw a road whose look did not change', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({ width: 2 })));
    const before = (parts().lanes[0] as Graphics).context;
    view.setRoads(map.edges.map(() => ({ width: 2 })));
    view.setOwners(owners(0, 0));
    expect((parts().lanes[0] as Graphics).context).toBe(before);
    // Nor the dashes of the buffer roads: they are drawn again only when one of them changes.
    const layer = layers.layer.roads.children.find((c) => c.label === 'road-lanes');
    const dashes = layer?.children[0] as Graphics;
    const redraw = vi.spyOn(dashes, 'clear');
    view.setRoads(map.edges.map(() => ({ width: 2 })));
    view.setOwners(owners(0, 0));
    expect(redraw).not.toHaveBeenCalled();
    view.setOwners(owners(0, 1));
    expect(redraw).toHaveBeenCalledTimes(1);
  });
});
