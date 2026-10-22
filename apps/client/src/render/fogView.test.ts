import { CanvasTextMetrics, Container, Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { EdgeView, HalfView, Seen, SnapshotMsg } from '../protocol.gen.ts';
import { borderPoint, halfMarkerPoint } from './fogLayout.ts';
import { FogView } from './fogView.ts';
import { createLayers, type MapLayers } from './layers.ts';
import { EntityKit } from './shapes.ts';

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
const unknownMarks = (layers: MapLayers): Container[] => {
  const layer = layers.layer.fog.children.find((c) => c.label === 'fog-unknown-roads');
  return (layer?.children ?? []).filter((c) => c.visible);
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
    kit = new EntityKit(0);
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
    expect(layers.layer.fog.children.find((c) => c.label === 'fog-shades')?.children).toHaveLength(
      2,
    );
  });
});

describe('FogView, the "?" of a road that was never seen', () => {
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
    kit = new EntityKit(0);
    view = new FogView(map, layers, 0, kit, 1, 10, [], () => 17);
  });
  afterEach(() => {
    view.destroy();
    kit.destroy();
    vi.restoreAllMocks();
  });

  it('puts a "?" at the border point of a road in fog that has no sighting at all', () => {
    view.update(withRoad('fog', half('fog', null), half('fog', null)));
    const [mark, ...rest] = unknownMarks(layers);
    expect(rest).toEqual([]);
    const border = borderPoint(map, road.id);
    expect(mark?.x).toBeCloseTo(border?.x ?? NaN);
    expect(mark?.y).toBeCloseTo(border?.y ?? NaN);
    const text = mark?.children.find((c): c is Text => c instanceof Text);
    expect(text?.text).toBe('?');
  });

  it('does not mark a road that is in sight, or one that was seen before (a sighting of a half)', () => {
    view.update(withRoad('presence', half('exact', null), half('fog', null)));
    expect(unknownMarks(layers)).toEqual([]);
    view.update(withRoad('fog', half('fog', seen({ enemy_modes: [] })), half('fog', null)));
    expect(unknownMarks(layers)).toEqual([]);
  });

  it('takes the "?" away when the road is seen, and brings it back when it is not (same mark)', () => {
    view.update(withRoad('fog', half('fog', null), half('fog', null)));
    const [mark] = unknownMarks(layers);
    view.update(withRoad('presence', half('exact', null), half('exact', null)));
    expect(unknownMarks(layers)).toEqual([]);
    view.update(withRoad('fog', half('fog', null), half('fog', null)));
    expect(unknownMarks(layers)[0]).toBe(mark);
  });

  it('keeps the "?" at least 20 px wide on screen when the map is zoomed out', () => {
    view.update(withRoad('fog', half('fog', null), half('fog', null)));
    view.setCameraScale(0.5);
    // 13 world units wide: 20 px needs a scale of at least 20 / (13 * 0.5).
    expect(unknownMarks(layers)[0]?.scale.x).toBeGreaterThanOrEqual(20 / (13 * 0.5) - 1e-9);
    view.setCameraScale(4);
    expect(unknownMarks(layers)[0]?.scale.x).toBe(1);
  });
});
