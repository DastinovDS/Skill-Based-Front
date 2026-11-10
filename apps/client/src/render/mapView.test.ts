import { Container, Graphics, type Renderer } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Detail } from '../protocol.gen.ts';
import { GEO_FILE, GEO_MAP } from './geoFixture.ts';
import { createLayers, type MapLayers } from './layers.ts';
import { voronoiTerritory } from './territory.ts';
import { polygonArea } from './voronoi.ts';
import { MapView } from './mapView.ts';
import { BG, CANAL_LAND, ROAD_BUFFER, ROAD_FOG, ROAD_OWN, YOU, ENEMY } from './style.ts';
import { BORDER_BAND, BORDER_ENGRAVING, ENGRAVE, hairFloor } from './engraving.ts';
import { SOFT } from './softness.ts';

// The roads read without colour (R1, #345): an own road has a solid
// lane on a band of its owner's colour, a buffer road dashed lanes, and a half in fog dotted ones.

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

/** The Border band of the territory (#842), in its holder. */
function bandOf(layers: MapLayers): Container | undefined {
  return layers.layer.territory.children
    .find((c) => c.label === 'territory-band-holder')
    ?.children.find((c) => c.label === 'territory-band');
}

interface TextureFill {
  readonly color: number;
  readonly alpha: number;
  readonly shapes: number;
  readonly textured: boolean;
}

/** The fills of a Graphics: colour, opacity, the shapes in each and whether a texture fills them. */
function textureFillsOf(g: Graphics | undefined): TextureFill[] {
  const instructions = (g?.context.instructions ?? []) as unknown as {
    action: string;
    data: {
      style: { color: number; alpha: number; texture: unknown; textureSpace: string };
      path: { shapePath: { shapePrimitives: unknown[] } };
    };
  }[];
  return instructions
    .filter((i) => i.action === 'fill')
    .map((i) => ({
      color: i.data.style.color,
      alpha: i.data.style.alpha,
      shapes: i.data.path.shapePath.shapePrimitives.length,
      textured: i.data.style.textureSpace === 'global',
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
    // The first of the lanes is the one Graphics of all the dashes, the last the dashes of the
    // roads a capture runs out along (#819).
    expect(group('road-lanes')).toHaveLength(per * 2 + 2);
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

  it('keeps an own road under the Canal of the «Supply» mode (#858)', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({})));
    view.setSupplyMode(true);
    expect(parts().lanes[0]?.visible).toBe(true);
    expect(parts().casings[0]?.visible).toBe(true);
  });

  it('keeps a buffer road and an enemy road as they are in the «Supply» mode', () => {
    view.setSupplyMode(true);
    view.setOwners(owners(0, 1));
    view.setRoads(map.edges.map(() => ({})));
    expect(parts().casings[0]?.visible).toBe(true);
    view.setOwners(owners(1, 1));
    expect(parts().casings[0]?.visible).toBe(true);
    expect(parts().lanes[0]?.visible).toBe(true);
  });

  it('gives an own road a solid lane on a band of its owner, and an enemy one the band of the enemy', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({})));
    const own = parts();
    const solid = laneRects(own.lanes[0] as Graphics);
    // Solid: the lane is one rectangle over the unit length (the view scales it to the road).
    expect(solid.map((r) => r.width)).toEqual([1]);
    expect(fillsOf(own.casings[0] as Graphics)[0]).toMatchObject({
      color: YOU,
      alpha: ROAD_OWN.bandAlpha,
    });
    expect(fillsOf(own.lanes[0] as Graphics)[0]).toMatchObject({ alpha: ROAD_OWN.laneAlpha });
    view.setOwners(owners(1, 1));
    expect(fillsOf(parts().casings[0] as Graphics)[0]?.color).toBe(ENEMY);
  });

  it('gives a buffer road a dashed lane and a dark casing, without the band of an owner', () => {
    view.setRoads(map.edges.map(() => ({})));
    for (const pair of [owners(0, 1), owners(0, null), owners(null, null)]) {
      view.setOwners(pair);
      const { casings, lanes } = parts();
      // The dashes of all roads are drawn together; the solid lanes of this road are not.
      expect(lanes[0]?.visible).toBe(false);
      const dashes = dashesOfRoad0();
      expect(dashes.length).toBeGreaterThan(4);
      expect(dashes[0]?.color).toBe(ROAD_BUFFER.lane);
      expect(dashLength(dashes[0] as Quad)).toBeCloseTo(ROAD_BUFFER.dash);
      // One lane, centred on the road (the width of a lane to each side).
      expect([...new Set(dashes.map(laneAt))]).toEqual([-1]);
      expect(fillsOf(casings[0] as Graphics)[0]).toMatchObject({
        color: BG,
        alpha: ROAD_BUFFER.casingAlpha,
      });
    }
  });

  it('turns a road into a buffer road when an end changes hands, and back', () => {
    view.setRoads(map.edges.map(() => ({})));
    view.setOwners(owners(0, 0));
    expect(laneRects(parts().lanes[0] as Graphics)).toHaveLength(1);
    expect(dashesOfRoad0()).toEqual([]);
    view.setOwners(owners(0, 1));
    expect(dashesOfRoad0().length).toBeGreaterThan(4);
    view.setOwners(owners(0, 0));
    expect(laneRects(parts().lanes[0] as Graphics)).toHaveLength(1);
    expect(dashesOfRoad0()).toEqual([]);
  });

  it('dots the lanes of a foreign road in fog', () => {
    view.setOwners(owners(1, 1));
    view.setRoads(map.edges.map(() => ({ halves: halves('fog', 'fog') })));
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
    view.setOwners(owners(1, 1));
    view.setRoads(map.edges.map(() => ({ halves: halves('exact', 'fog') })));
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

  it('never dots the own territory: an own half in fog is drawn as seen (DEC-35)', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({ halves: halves('fog', 'fog') })));
    expect(parts().lanes.map((l) => l.visible)).toEqual([true, false]);
    expect(dashesOfRoad0()).toHaveLength(0);
  });

  it('does not redraw a road whose look did not change', () => {
    view.setOwners(owners(0, 0));
    view.setRoads(map.edges.map(() => ({})));
    const before = (parts().lanes[0] as Graphics).context;
    view.setRoads(map.edges.map(() => ({})));
    view.setOwners(owners(0, 0));
    expect((parts().lanes[0] as Graphics).context).toBe(before);
    // Nor the dashes of the buffer roads: they are drawn again only when one of them changes.
    const layer = layers.layer.roads.children.find((c) => c.label === 'road-lanes');
    const dashes = layer?.children[0] as Graphics;
    const redraw = vi.spyOn(dashes, 'clear');
    view.setRoads(map.edges.map(() => ({})));
    view.setOwners(owners(0, 0));
    expect(redraw).not.toHaveBeenCalled();
    view.setOwners(owners(0, 1));
    expect(redraw).toHaveBeenCalledTimes(1);
  });
});

describe('MapView, the Border band along the borders of the territories (#842)', () => {
  let layers: MapLayers;
  let view: MapView;
  const band = (): Container | undefined => bandOf(layers);
  const bandFills = (owner: 0 | 1): TextureFill[] =>
    textureFillsOf(band()?.children.find((c) => c.label === `band-${String(owner)}`) as Graphics);
  /** Owners: every city of the first half of the map is player 0's, of the second half player 1's. */
  const halves = (): (0 | 1)[] => map.nodes.map((_, i) => (i < map.nodes.length / 2 ? 0 : 1));

  beforeEach(() => {
    layers = createLayers();
    view = new MapView(map, layers, 0, {} as Renderer, true);
  });
  afterEach(() => {
    view.destroy();
  });

  it('is a hatch of each owner, own and enemy colours, under the engraved lines of the border', () => {
    view.setOwners(halves());
    const layer = layers.layer.territory.children;
    const index = (label: string) => layer.findIndex((c) => c.label === label);
    expect(band()?.visible).toBe(true);
    // No filter, no cache: plain textured fills that keep their screen pitch (zoom buckets).
    expect(band()?.filters ?? []).toHaveLength(0);
    expect(band()?.isCachedAsTexture).toBe(false);
    const own = bandFills(0);
    const enemy = bandFills(1);
    expect(own).toHaveLength(1);
    expect(enemy).toHaveLength(1);
    expect(own[0]).toMatchObject({ color: ENGRAVE.own, textured: true });
    expect(enemy[0]).toMatchObject({ color: ENGRAVE.enemy, textured: true });
    expect(own[0]?.alpha).toBeCloseTo(BORDER_BAND.alpha);
    // In a holder that the floods of captures mask (#819), under the line of the border.
    expect(index('territory-band-holder')).toBeGreaterThan(
      layer.findIndex((c) => c instanceof Graphics),
    );
    expect(index('territory-band-holder')).toBeLessThan(layer.length - 1);
    expect(layer[layer.length - 1]).toBeInstanceOf(Graphics);
  });

  it('leaves the inside of the land clear: no tint on the normal map, the own land darkened in «Supply»', () => {
    const half = halves();
    view.setOwners(half);
    const tint = (): TextureFill[] =>
      textureFillsOf(
        layers.layer.territory.children.find((c) => c.label === 'territory') as Graphics,
      );
    expect(tint()).toEqual([]);
    view.setSupplyMode(true);
    // One fill of every own area, in the dark of the Canal (#858); the enemy's land is left alone.
    expect(tint()).toEqual([
      {
        color: CANAL_LAND.shade,
        alpha: CANAL_LAND.shadeAlpha,
        shapes: half.filter((o) => o === 0).length,
        textured: false,
      },
    ]);
    view.setSupplyMode(false);
    expect(tint()).toEqual([]);
  });

  it('is redrawn when an owner changes and not for the same owners', () => {
    view.setOwners(halves());
    const g = band()?.children[0] as Graphics;
    const redraw = vi.spyOn(g, 'clear');
    view.setOwners(halves());
    expect(redraw).not.toHaveBeenCalled();
    const changed = halves();
    changed[0] = 1;
    view.setOwners(changed);
    expect(redraw).toHaveBeenCalled();
  });

  it('is redrawn when the zoom crosses into another bucket of its hatch, not inside one', () => {
    view.setOwners(halves());
    const g = band()?.children[0] as Graphics;
    const redraw = vi.spyOn(g, 'clear');
    view.setCamera(1.2, 1);
    view.setCamera(1.6, 1);
    expect(redraw).not.toHaveBeenCalled();
    view.setCamera(2.1, 1);
    expect(redraw).toHaveBeenCalledTimes(1);
  });

  it('is not shown without a border between owners, and stays in the «Supply» mode (Canal)', () => {
    view.setOwners(map.nodes.map(() => 0));
    expect(band()?.visible).toBe(false);
    view.setOwners(halves());
    expect(band()?.visible).toBe(true);
    view.setSupplyMode(true);
    expect(band()?.visible).toBe(true);
    view.setSupplyMode(false);
    expect(band()?.visible).toBe(true);
  });

  it('engraves the border: a cut for both sides, the own rule doubled, the enemy beads', () => {
    view.setOwners(halves());
    const border = layers.layer.territory.children.find(
      (c) => c.label === 'border-lines',
    ) as Graphics;
    const instructions = border.context.instructions as unknown as {
      action: string;
      data: { style: { color: number; width: number } };
    }[];
    const strokes = instructions.filter((i) => i.action === 'stroke').map((i) => i.data.style);
    const fills = instructions.filter((i) => i.action === 'fill').map((i) => i.data.style);
    expect(strokes.filter((st) => st.color === ENGRAVE.cut)).toHaveLength(1);
    // The own rule and the second own rule; the enemy's rule; the enemy's beads are a fill.
    expect(strokes.filter((st) => st.color === ENGRAVE.own)).toHaveLength(2);
    expect(strokes.filter((st) => st.color === ENGRAVE.enemy)).toHaveLength(1);
    expect(fills.map((f) => f.color)).toEqual([ENGRAVE.enemy]);
  });

  it('keeps every hairline at least `SOFT.weight` device pixels wide when zoomed out', () => {
    view.setOwners(halves());
    const border = layers.layer.territory.children.find(
      (c) => c.label === 'border-lines',
    ) as Graphics;
    const widths = (): number[] =>
      (
        border.context.instructions as unknown as {
          action: string;
          data: { style: { width: number } };
        }[]
      )
        .filter((i) => i.action === 'stroke')
        .map((i) => i.data.style.width);
    expect(Math.min(...widths())).toBeCloseTo(
      Math.max(BORDER_ENGRAVING.rule.width, hairFloor(1, 1)),
    );
    view.setCamera(0.4, 1);
    // 1 / 0.4 = 2.5 world units is one device pixel there.
    expect(Math.min(...widths())).toBeGreaterThanOrEqual(2.5 * SOFT.weight);
  });
});

describe('MapView, a capture floods the area of the node (#819)', () => {
  const map = DEFAULT_MAP;
  let layers: MapLayers;
  let view: MapView;
  beforeEach(() => {
    layers = createLayers();
    view = new MapView(map, layers, 0, {} as Renderer, true);
  });
  afterEach(() => {
    view.destroy();
  });

  /** The fills of the territory tint by colour (the «Supply» tint): the alphas drawn for each. */
  const fills = (): Map<number, number[]> => {
    const g = layers.layer.territory.children.find((c) => c.label === 'territory') as
      Graphics | undefined;
    const instructions = (g?.context.instructions ?? []) as unknown as {
      action: string;
      data: { style: { color: number; alpha: number } };
    }[];
    const byColor = new Map<number, number[]>();
    for (const i of instructions) {
      if (i.action !== 'fill') continue;
      byColor.set(i.data.style.color, [
        ...(byColor.get(i.data.style.color) ?? []),
        i.data.style.alpha,
      ]);
    }
    return byColor;
  };
  const all = (n: 0 | 1 | null): (0 | 1 | null)[] => map.nodes.map(() => n);

  it('shows the first owners and the ones of a call that does not animate at once', () => {
    // The normal map has no tint (#842): the «Supply» mode darkens the own land (Canal, #858).
    view.setSupplyMode(true);
    view.setOwners(all(0));
    expect(fills().get(CANAL_LAND.shade)).toHaveLength(1);
    view.setOwners(all(1));
    expect(fills().get(CANAL_LAND.shade)).toBeUndefined();
  });

  const floods = (): number =>
    layers.layer.territory.children.find((c) => c.label === 'flood-fill')?.children.length ?? 0;

  it('floods a captured area: the flood draws it until it lands, then the map does (#819)', () => {
    view.setOwners(all(0));
    view.setOwners(all(1), true);
    // The areas under way are the floods' (fill, band and rim meshes); the normal map has no tint.
    expect(fills().get(YOU)).toBeUndefined();
    expect(fills().get(ENEMY)).toBeUndefined();
    expect(floods()).toBe(map.nodes.length);
    expect(view.captures).toHaveLength(map.nodes.length);
    // The enemy took them: the calmer look.
    expect(view.captures.every((c) => c.calm && c.from === 0 && c.to === 1)).toBe(true);
    view.advance(500);
    expect(floods()).toBe(map.nodes.length);
    expect(view.captures[0]?.look.pos).toBeGreaterThan(0);
    view.advance(1000);
    expect(floods()).toBe(0);
    expect(view.captures).toHaveLength(0);
    // Done: another call changes nothing.
    view.advance(100);
    expect(floods()).toBe(0);
  });

  it('floods only the areas that changed hands, and an own capture is not calm', () => {
    view.setOwners(all(1));
    const next = all(1);
    next[0] = 0;
    view.setOwners(next, true);
    expect(view.captures.map((c) => [c.node, c.calm])).toEqual([[0, false]]);
    expect(floods()).toBe(1);
  });

  it('keeps a flood running over snapshots that change nothing', () => {
    view.setOwners(all(0));
    view.setOwners(all(1), true);
    view.advance(300);
    view.setOwners(all(1), true);
    expect(view.captures[0]?.ms).toBe(300);
    expect(floods()).toBe(map.nodes.length);
  });

  it('ends the floods at once on a call that does not animate, and in the «Supply» mode', () => {
    view.setOwners(all(0));
    view.setOwners(all(1), true);
    view.setOwners(all(1));
    expect(floods()).toBe(0);
    view.setOwners(all(0), true);
    expect(floods()).toBe(map.nodes.length);
    view.setSupplyMode(true);
    expect(floods()).toBe(0);
  });

  it('holds the floods at an age for the dev scenes', () => {
    view.holdFloods(400);
    view.setOwners(all(0));
    view.setOwners(all(1), true);
    view.advance(16);
    view.advance(5000);
    expect(view.captures[0]?.ms).toBe(400);
    view.holdFloods(null);
    view.advance(1000);
    expect(view.captures).toHaveLength(0);
  });
});

describe('MapView, the terrain mode (#429)', () => {
  const map = DEFAULT_MAP;
  let layers: MapLayers;
  let view: MapView;
  beforeEach(() => {
    layers = createLayers();
    view = new MapView(map, layers, 0, {} as Renderer, true);
  });
  afterEach(() => {
    view.destroy();
  });
  const ground = () => layers.layer.background.children.find((c) => c.label === 'pattern-ground');
  const visibleBackground = () => layers.layer.background.children.filter((c) => c.visible).length;

  it('makes the pattern ground only when the mode is first turned on', () => {
    expect(ground()).toBeUndefined();
    view.setTerrainMode(true);
    expect(ground()?.visible).toBe(true);
  });

  it('swaps the picture for the ground and back, leaving the territory and the roads', () => {
    const before = visibleBackground();
    view.setTerrainMode(true);
    // The terrain colours and the dimming give way to the pattern ground: one fewer than before.
    expect(visibleBackground()).toBe(before - 1);
    view.setTerrainMode(false);
    expect(ground()?.visible).toBe(false);
    expect(visibleBackground()).toBe(before);
    expect(layers.layer.territory.visible).toBe(true);
    expect(layers.layer.roads.visible).toBe(true);
  });

  it('keeps the band of the territory in the terrain mode, unlike «Supply»', () => {
    view.setOwners(map.nodes.map((_, i) => (i % 2 === 0 ? 0 : 1)));
    const band = bandOf(layers);
    expect(band?.visible).toBe(true);
    view.setTerrainMode(true);
    expect(band?.visible).toBe(true);
  });

  it('a flat ground stays flat when «Supply» is switched off while the terrain mode is on', () => {
    view.setTerrainMode(true);
    view.setSupplyMode(true);
    view.setSupplyMode(false);
    expect(ground()?.visible).toBe(true);
  });
});

describe('MapView on a geography (DEC-36, #544)', () => {
  it('takes the areas from the vector file and tints them', () => {
    const view = new MapView(GEO_MAP, createLayers(), 0, {} as Renderer, true, GEO_FILE);
    expect(view.geography).toBe(true);
    // Area 0 is x 0..90 above y = 60 and 0..100 below (9400, the end of the river rounded off a
    // little, #585): not the Voronoi half at x < 100 (10000).
    expect(polygonArea(view.cells[0] ?? [])).toBeCloseTo(9400, -2);
    view.destroy();
  });

  it('draws the thin area line only between two land areas, none along the river', () => {
    const layers = createLayers();
    const view = new MapView(GEO_MAP, layers, 0, {} as Renderer, true, GEO_FILE);
    const line = layers.layer.territory.children[0] as Graphics;
    const box = line.getLocalBounds();
    // The land border is x = 100 from y = 60 to 100; the river banks (x = 90, 110) get no line.
    expect(box.minX).toBeGreaterThan(98);
    expect(box.maxX).toBeLessThan(102);
    expect(box.minY).toBeGreaterThan(58);
    view.destroy();
  });

  it('keeps the Voronoi cells for a map without a usable file', () => {
    const view = new MapView(GEO_MAP, createLayers(), 0, {} as Renderer, true, null);
    expect(view.geography).toBe(false);
    expect(view.cells[0]).toEqual(voronoiTerritory(GEO_MAP).cells[0]);
    view.destroy();
  });
});

describe('MapView: the area under the pointer (#762)', () => {
  it('lights one area, redraws only on a change, and lights nothing for null', () => {
    const layers = createLayers();
    const view = new MapView(GEO_MAP, layers, 0, {} as Renderer, true, null);
    const fill = layers.layer.territory.children.find((c) => c.label === 'hover-area') as Graphics;
    expect(fill.getLocalBounds().width).toBe(0);
    view.setHover(0);
    expect(view.hovered).toBe(0);
    const box = fill.getLocalBounds();
    const cell = view.cells[0] ?? [];
    expect(box.minX).toBeCloseTo(Math.min(...cell.map((p) => p.x)), -1);
    expect(box.maxX).toBeCloseTo(Math.max(...cell.map((p) => p.x)), -1);
    view.setHover(null);
    expect(view.hovered).toBeNull();
    expect(fill.getLocalBounds().width).toBe(0);
    view.destroy();
  });
});
