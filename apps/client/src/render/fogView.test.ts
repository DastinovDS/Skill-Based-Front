import { CanvasTextMetrics, Container, Graphics, Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { EdgeView, HalfView, Seen, SnapshotMsg } from '../protocol.gen.ts';
import { borderPoint, halfMarkerPoint } from './fogLayout.ts';
import { FogView } from './fogView.ts';
import { createLayers, type MapLayers } from './layers.ts';
import { voronoiCells } from './voronoi.ts';
import { EntityKit } from './shapes.ts';
import { testSprites } from './testSprites.ts';

// The fog layer draws what the player's view gives and nothing else (DEC-21, item 8; DEC-33,
// detail 8): a memory of a half only for a half in fog, with the enemies it lists, at the border
// point of its road, and at the level the memory carries.

const map = DEFAULT_MAP;
const base = devSnapshot(map, DEV_RULES, 600);
const road = base.view.edges[0] as EdgeView;

const seen = (fields: Partial<Seen> = {}): Seen => ({
  tick: 390,
  level: 'presence',
  enemy_modes: ['attack'],
  enemy_units: null,
  enemy_charged: null,
  enemy_range: null,
  ...fields,
});
const half = (detail: HalfView['detail'], memory: Seen | null): HalfView => ({
  detail,
  seen: memory,
});

/** The base snapshot where the road 0 has these halves and the others none of the memories. */
function withHalves(a: HalfView, b: HalfView): SnapshotMsg {
  const edges = base.view.edges.map((edge): EdgeView =>
    edge.id === road.id
      ? { ...edge, halves: [a, b], enemy_groups: [] }
      : {
          ...edge,
          halves: [half('exact', null), half('exact', null)],
          enemy_groups: [],
        },
  );
  // No node memories either: only the halves of the road 0 can show a ghost.
  const nodes = base.view.nodes.map((node) => ({ ...node, seen: null }));
  return { ...base, view: { ...base.view, nodes, edges } };
}

const ghosts = (layers: MapLayers): Container[] => {
  const fog = layers.layer.fog.children.find((c) => c.label === 'fog-ghosts');
  return (fog?.children ?? []).filter((c) => c.visible);
};
const textsOf = (item: Container): string[] => {
  const found: string[] = [];
  const visit = (node: Container): void => {
    if (!node.visible) return;
    if (node instanceof Text && node.text !== '' && node.text !== '?') found.push(node.text);
    for (const child of node.children) visit(child);
  };
  visit(item);
  return found;
};
/** The haze (F1): the container of the cached veil and the number of cells filled in it. */
const veilOf = (layers: MapLayers): Container | undefined => {
  const shades = layers.layer.fog.children.find((c) => c.label === 'fog-shades');
  return shades?.children.find((c) => c.label === 'fog-veil');
};
const veilCells = (layers: MapLayers): Graphics | undefined => {
  const find = (node: Container): Graphics | undefined => {
    if (node.label === 'fog-veil-cells') return node as Graphics;
    for (const child of node.children) {
      const found = find(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  const veil = veilOf(layers);
  return veil === undefined ? undefined : find(veil);
};
const veilCellCount = (layers: MapLayers): number => {
  const instructions = (veilCells(layers)?.context.instructions ?? []) as unknown as {
    action: string;
    data: { path: { shapePath: { shapePrimitives: unknown[] } } };
  }[];
  return instructions
    .filter((i) => i.action === 'fill')
    .reduce((n, i) => n + i.data.path.shapePath.shapePrimitives.length, 0);
};

describe('FogView, the memory of the halves of a road', () => {
  let layers: MapLayers;
  let kit: EntityKit;
  let view: FogView;

  beforeEach(() => {
    // jsdom has no canvas to measure text on: seven units a letter.
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
    layers = createLayers();
    kit = new EntityKit(0, testSprites());
    view = new FogView(map, layers, 0, kit, 1, 10, [], () => 17);
  });
  afterEach(() => {
    view.destroy();
    kit.destroy();
    vi.restoreAllMocks();
  });

  it('draws a ghost with its age at the border point for a half in fog that has a memory', () => {
    view.update(withHalves(half('exact', null), half('fog', seen())));
    const [ghost, ...rest] = ghosts(layers);
    expect(rest).toEqual([]);
    expect(textsOf(ghost as Container)).toEqual(['-0:21']);
    const at = halfMarkerPoint(map, road.id, 1);
    const border = borderPoint(map, road.id);
    expect(ghost?.x).toBeCloseTo(at?.x ?? NaN);
    expect(ghost?.y).toBeCloseTo(at?.y ?? NaN);
    // Beside the road, near the border point, not at an end of the road.
    expect(
      Math.hypot((ghost?.x ?? 0) - (border?.x ?? NaN), (ghost?.y ?? 0) - (border?.y ?? NaN)),
    ).toBeLessThan(30);
  });

  it('keeps the two halves apart: each memory is its own ghost, on its own side of the road', () => {
    view.update(withHalves(half('fog', seen({ tick: 300 })), half('fog', seen({ tick: 540 }))));
    const found = ghosts(layers);
    expect(found).toHaveLength(2);
    expect(found.map((g) => textsOf(g)[0]).sort()).toEqual(['-0:06', '-0:30']);
    const [first, second] = found as [Container, Container];
    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(10);
  });

  it('draws nothing for a half that is seen now, even if its `seen` has enemies', () => {
    view.update(withHalves(half('exact', seen()), half('presence', seen())));
    expect(ghosts(layers)).toEqual([]);
  });

  it('draws nothing for a half in fog without a memory, or with a memory of no enemies', () => {
    view.update(withHalves(half('fog', null), half('fog', seen({ enemy_modes: [] }))));
    expect(ghosts(layers)).toEqual([]);
  });

  it('removes the ghost when the half is seen again', () => {
    view.update(withHalves(half('exact', null), half('fog', seen())));
    expect(ghosts(layers)).toHaveLength(1);
    view.update(withHalves(half('exact', null), half('exact', seen({ enemy_modes: [] }))));
    expect(ghosts(layers)).toEqual([]);
  });

  it('writes a remembered range as a range and never shows charges for it', () => {
    const memory = seen({ level: 'range', enemy_range: { low: 3, high: 5 }, enemy_charged: 2 });
    view.update(withHalves(half('exact', null), half('fog', memory)));
    expect(textsOf(ghosts(layers)[0] as Container).sort()).toEqual(['-0:21', '3-5']);
  });

  it('shows the numbers of an exact memory, and no number of a presence memory', () => {
    const exact = seen({ level: 'exact', enemy_units: 4, enemy_charged: 2 });
    view.update(withHalves(half('exact', null), half('fog', exact)));
    expect(textsOf(ghosts(layers)[0] as Container).sort()).toEqual(['-0:21', '4']);
    view.update(withHalves(half('exact', null), half('fog', seen())));
    expect(textsOf(ghosts(layers)[0] as Container)).toEqual(['-0:21']);
  });

  it('draws no dark shade of its own on a half in fog: the dotted lanes of the road carry it', () => {
    view.update(withHalves(half('exact', null), half('fog', null)));
    // Only the haze of the hidden cities (none here, the nodes are all seen): no shade per half.
    expect(veilCellCount(layers)).toBe(0);
    expect(veilOf(layers)?.visible).toBe(false);
  });
});

describe('FogView, a road that was never seen (no "?" mark since #348)', () => {
  let layers: MapLayers;
  let kit: EntityKit;
  let view: FogView;

  /** The base snapshot where the road 0 has this level of detail and these halves. */
  function withRoad(detail: EdgeView['detail'], a: HalfView, b: HalfView): SnapshotMsg {
    const edges = base.view.edges.map((edge): EdgeView =>
      edge.id === road.id
        ? { ...edge, detail, halves: [a, b], enemy_groups: [] }
        : { ...edge, detail: 'exact', halves: [half('exact', null), half('exact', null)] },
    );
    return { ...base, view: { ...base.view, edges } };
  }

  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
    layers = createLayers();
    kit = new EntityKit(0, testSprites());
    view = new FogView(map, layers, 0, kit, 1, 10, [], () => 17);
  });
  afterEach(() => {
    view.destroy();
    kit.destroy();
    vi.restoreAllMocks();
  });

  /** Every visible text in the fog layer, and the labels of its direct children. */
  const fogTexts = (): string[] => {
    const found: string[] = [];
    const visit = (node: Container): void => {
      if (!node.visible) return;
      if (node instanceof Text && node.text !== '') found.push(node.text);
      for (const child of node.children) visit(child);
    };
    visit(layers.layer.fog);
    return found;
  };

  it('draws no "?" at the border point of a road with no sighting at all: the dotted half is all it gets', () => {
    view.update(withRoad('fog', half('fog', null), half('fog', null)));
    const labels = layers.layer.fog.children.map((c) => c.label);
    expect(labels).not.toContain('fog-unknown-roads');
    expect(fogTexts()).not.toContain('?');
    expect(ghosts(layers)).toEqual([]);
  });

  it('draws the same for a road that was seen once or is in sight: nothing marks the road itself', () => {
    const labelsOf = (): string[] => layers.layer.fog.children.map((c) => c.label);
    view.update(withRoad('presence', half('exact', null), half('fog', null)));
    const inSight = labelsOf();
    view.update(withRoad('fog', half('fog', seen({ enemy_modes: [] })), half('fog', null)));
    expect(labelsOf()).toEqual(inSight);
    view.update(withRoad('fog', half('fog', null), half('fog', null)));
    expect(labelsOf()).toEqual(inSight);
  });

  it('keeps the camera scale harmless: no mark to resize', () => {
    view.update(withRoad('fog', half('fog', null), half('fog', null)));
    view.setCameraScale(0.5);
    expect(fogTexts()).not.toContain('?');
  });
});

describe('FogView, the haze F1 over the hidden cities', () => {
  let layers: MapLayers;
  let kit: EntityKit;
  let view: FogView;
  const cells = voronoiCells(map.nodes, { width: map.meta.width, height: map.meta.height });

  /** The base snapshot where exactly the cities `fogged` are in fog (with this memory, if any). */
  function withFog(fogged: readonly number[], memory: Seen | null = null): SnapshotMsg {
    const nodes = base.view.nodes.map((node) =>
      fogged.includes(node.id)
        ? { ...node, detail: 'fog' as const, seen: memory }
        : { ...node, detail: 'exact' as const, seen: null },
    );
    return { ...base, view: { ...base.view, nodes } };
  }

  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
    layers = createLayers();
    kit = new EntityKit(0, testSprites());
    view = new FogView(map, layers, 0, kit, 1, 10, cells, () => 17);
  });
  afterEach(() => {
    view.destroy();
    kit.destroy();
    vi.restoreAllMocks();
  });

  it('is one cached texture of the hidden cells, with the blur inside the cache, not on it', () => {
    view.update(withFog([1, 2]));
    const veil = veilOf(layers);
    expect(veil?.visible).toBe(true);
    expect(veil?.isCachedAsTexture).toBe(true);
    // A filter on the cached container itself would run every frame: it sits on a child.
    expect(veil?.filters ?? []).toHaveLength(0);
    expect(veilCellCount(layers)).toBe(2);
  });

  it('is not drawn at all while nothing is hidden', () => {
    view.update(withFog([]));
    expect(veilOf(layers)?.visible).toBe(false);
    expect(veilCellCount(layers)).toBe(0);
  });

  it('is rebuilt when the set of hidden cities changes, and only then', () => {
    const rebuild = vi.spyOn(Container.prototype, 'updateCacheTexture');
    view.update(withFog([1, 2]));
    expect(rebuild).toHaveBeenCalledTimes(1);
    // A new snapshot of the same set (even with a new memory in it): no rebuild.
    view.update(withFog([2, 1], seen()));
    view.update(withFog([1, 2], seen({ tick: 100 })));
    expect(rebuild).toHaveBeenCalledTimes(1);
    view.update(withFog([1, 2, 3]));
    expect(rebuild).toHaveBeenCalledTimes(2);
    expect(veilCellCount(layers)).toBe(3);
    view.update(withFog([]));
    expect(rebuild).toHaveBeenCalledTimes(3);
    expect(veilOf(layers)?.visible).toBe(false);
  });

  it('keeps a seen city clear: the veil is only over the cities the view says are in fog', () => {
    view.update(withFog([4]));
    expect(veilCellCount(layers)).toBe(1);
    view.update(withFog([]));
    expect(veilCellCount(layers)).toBe(0);
  });

  it('leaves the ghosts of the memories above the veil', () => {
    view.update(withFog([1], seen()));
    const order = layers.layer.fog.children.map((c) => c.label);
    expect(order.indexOf('fog-shades')).toBeLessThan(order.indexOf('fog-ghosts'));
    expect(ghosts(layers).length).toBeGreaterThan(0);
  });
});
