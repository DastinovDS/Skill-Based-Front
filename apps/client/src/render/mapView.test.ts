import { Graphics, type Renderer } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

describe('MapView, the roads of R1', () => {
  let layers: MapLayers;
  let view: MapView;
  /** The four parts of the road 0 as the view made them. */
  const parts = (): { casings: Graphics[]; lanes: Graphics[] } => {
    const group = (label: string) =>
      (layers.layer.roads.children.find((c) => c.label === label)?.children ?? []) as Graphics[];
    const per = map.edges.length;
    expect(group('road-casings')).toHaveLength(per * 2);
    return {
      casings: group('road-casings').slice(0, 2),
      lanes: group('road-lanes').slice(0, 2),
    };
  };
  const laneRects = (g: Graphics): Rect[] => fillsOf(g).flatMap((f) => f.rects);

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
      const rects = laneRects(lanes[0] as Graphics);
      expect(rects.length).toBeGreaterThan(4);
      expect(rects[0]?.width).toBe(ROAD_BUFFER.dash);
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
    view.setOwners(owners(0, 1));
    expect(laneRects(parts().lanes[0] as Graphics)[0]?.width).toBe(ROAD_BUFFER.dash);
    view.setOwners(owners(0, 0));
    expect(laneRects(parts().lanes[0] as Graphics)).toHaveLength(1);
  });

  it('dots the lanes of a road in fog, whoever its ends belong to', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({ width: 2, halves: halves('fog', 'fog') })));
    const { casings, lanes } = parts();
    // Both halves alike: one stretch over the whole road, the second one is not drawn.
    expect(lanes[1]?.visible).toBe(false);
    const rects = laneRects(lanes[0] as Graphics);
    expect(rects[0]?.width).toBe(ROAD_FOG.dash);
    expect(rects.length).toBeGreaterThan(10);
    expect(fillsOf(casings[0] as Graphics)[0]).toMatchObject({
      color: BG,
      alpha: ROAD_FOG.casingAlpha,
    });
  });

  it('draws only the half in fog dotted: two stretches that meet at the border point', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({ width: 1, halves: halves('exact', 'fog') })));
    const { casings, lanes } = parts();
    expect(lanes.map((l) => l.visible)).toEqual([true, true]);
    expect(laneRects(lanes[0] as Graphics)).toHaveLength(1);
    expect(laneRects(lanes[1] as Graphics)[0]?.width).toBe(ROAD_FOG.dash);
    // The second stretch begins where the first ends.
    const a = map.nodes[edge.a];
    const b = map.nodes[edge.b];
    const length = Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0));
    expect(casings[0]?.scale.x).toBeCloseTo(length / 2);
    expect(casings[1]?.scale.x).toBeCloseTo(length / 2);
    const first = casings[0] as Graphics;
    const second = casings[1] as Graphics;
    const along = Math.hypot(second.x - first.x, second.y - first.y);
    expect(along).toBeCloseTo(length / 2);
  });

  it('does not redraw a road whose look did not change', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({ width: 2 })));
    const before = (parts().lanes[0] as Graphics).context;
    view.setRoads(map.edges.map(() => ({ width: 2 })));
    view.setOwners(owners(0, 0));
    expect((parts().lanes[0] as Graphics).context).toBe(before);
  });
});
