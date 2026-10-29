import { CanvasTextMetrics, Container, Graphics, Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import type { EnemyGroup, GroupView, NodeView, PacketView, SnapshotMsg } from '../protocol.gen.ts';
import { EntityView } from './entityView.ts';
import { createLayers } from './layers.ts';
import { edgeEnds, edgePoint, nodePoint } from './layout.ts';
import { PACKET_SIDE, PACKET_TRANSFER, ROAD_TAPE, YOU } from './style.ts';
import { testSprites } from './testSprites.ts';

const map = DEFAULT_MAP;
const base = devSnapshot(map, DEV_RULES, 100);
const node = base.view.nodes.find((n) => n.owner === 0);
if (node === undefined) throw new Error('small map');
const nodeId = node.id;

/** A snapshot where the player sees `units` enemy units in `node` and has `groups` of his own. */
function frameWith(groups: GroupView[], exact: boolean) {
  const nodes: NodeView[] = base.view.nodes.map((n) =>
    n.id === nodeId
      ? {
          ...n,
          detail: exact ? 'exact' : 'presence',
          seen: {
            tick: 100,
            level: exact ? 'exact' : 'presence',
            enemy_modes: ['attack'],
            enemy_units: exact ? 3 : null,
            enemy_charged: exact ? 1 : null,
            enemy_range: null,
          },
        }
      : { ...n, seen: null },
  );
  const snapshot: SnapshotMsg = { ...base, view: { ...base.view, nodes, groups } };
  return interpolateFrame(snapshot, null, snapshot.tick);
}

function enemyTokenAt(layers: ReturnType<typeof createLayers>) {
  const enemy = layers.layer.groups.children.find((c) => c.label === 'enemy');
  return enemy?.children.find((c) => c.visible);
}

describe('EntityView, enemies seen in a city', () => {
  it('stands in the middle of the city like an own group, with or without numbers', () => {
    const city = nodePoint(map, nodeId);
    for (const exact of [true, false]) {
      const layers = createLayers();
      const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
      view.update(frameWith([], exact));
      const token = enemyTokenAt(layers);
      expect(token?.position.x).toBeCloseTo(city?.x ?? NaN);
      expect(token?.position.y).toBeCloseTo(city?.y ?? NaN);
      view.destroy();
    }
  });

  it('steps beside the city only while an own icon holds the middle', () => {
    const city = nodePoint(map, nodeId);
    const own: GroupView = {
      id: 'g',
      units: 2,
      charged: 2,
      mode: 'attack',
      location: { kind: 'node', node: nodeId },
      order: null,
      defense_bonus: null,
      defense_cap: null,
    };
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWith([own], true));
    const token = enemyTokenAt(layers);
    expect(token?.position.x).toBeGreaterThan((city?.x ?? 0) + 10);
    view.update(frameWith([], true));
    expect(token?.position.x).toBeCloseTo(city?.x ?? NaN);
    view.destroy();
  });
});

describe('EntityView, the Defense bonus beside the shield (DEC-30)', () => {
  beforeEach(() => {
    // jsdom has no canvas to measure text on: seven units a letter.
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  const defender = (bonus: number | null, cap: number | null): GroupView => ({
    id: 'd',
    units: 3,
    charged: 3,
    mode: 'defense',
    location: { kind: 'node', node: nodeId },
    order: null,
    defense_bonus: bonus,
    defense_cap: cap,
  });
  const texts = (layers: ReturnType<typeof createLayers>): string[] => {
    const found: string[] = [];
    const visit = (item: Container): void => {
      if (!item.visible) return;
      if (item instanceof Text && item.text !== '') found.push(item.text);
      for (const child of item.children) visit(child);
    };
    visit(layers.layer.groups);
    return found;
  };

  it('shows "+N / M" by the shield of an own group in Defense, from the view', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWith([defender(1, 3)], false));
    expect(texts(layers)).toContain('+1 / 3');
    // It follows the snapshot: the bonus grows.
    view.update(frameWith([defender(2, 3)], false));
    expect(texts(layers)).toContain('+2 / 3');
    expect(texts(layers)).not.toContain('+1 / 3');
    view.destroy();
  });

  it('shows nothing for a group that is not in Defense, or has no numbers', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWith([{ ...defender(1, 3), mode: 'attack' }], false));
    expect(texts(layers).filter((text) => text.startsWith('+'))).toEqual([]);
    view.update(frameWith([defender(null, null)], false));
    expect(texts(layers).filter((text) => text.startsWith('+'))).toEqual([]);
    view.destroy();
  });

  it('never shows a number for the opponent: its icon has the shield and no bonus', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    // A replay shows both sides; even if the data of the opponent's group had the numbers, the
    // icon would show the mode only (the server never sends them: DEC-30, item 5).
    const frame = frameWith([defender(2, 3)], false);
    view.update({ ...frame, groups: frame.groups.map((g) => ({ ...g, owner: 1 as const })) });
    expect(texts(layers).filter((text) => text.startsWith('+'))).toEqual([]);
    view.destroy();
  });
});

describe('EntityView, enemy figures on roads (DEC-33)', () => {
  const edge = map.edges[0];
  if (edge === undefined) throw new Error('no roads');

  function frameWithFigures(figures: EnemyGroup[]) {
    const edges = base.view.edges.map((e) =>
      e.id === edge?.id ? { ...e, enemy_groups: figures } : e,
    );
    const snapshot: SnapshotMsg = { ...base, view: { ...base.view, edges, groups: [] } };
    return interpolateFrame(snapshot, null, snapshot.tick);
  }

  const figure: EnemyGroup = {
    id: 'f1',
    pos: 250,
    toward_b: true,
    // Without numbers: a count label would measure its text, which needs a canvas.
    detail: 'presence',
    mode: 'attack',
    units: null,
    charged: null,
    units_range: null,
  };

  it('draws one token per figure near its position, and drops a figure that is gone', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWithFigures([figure, { ...figure, id: 'f2', pos: 900, toward_b: false }]));
    const enemy = layers.layer.groups.children.find((c) => c.label === 'enemy');
    const before = enemy?.children.length ?? 0; // the enemies seen in cities, and the figures
    expect(before).toBeGreaterThanOrEqual(2);
    const ends = edgeEnds(map, edge.id);
    const at = ends === undefined ? undefined : edgePoint(ends.a, ends.b, true, 250);
    const first = enemy?.children[before - 2];
    expect(
      Math.hypot((first?.x ?? 0) - (at?.x ?? NaN), (first?.y ?? 0) - (at?.y ?? NaN)),
    ).toBeLessThan(12);
    view.update(frameWithFigures([figure]));
    expect(enemy?.children.length).toBe(before - 1);
    view.destroy();
  });
});

describe('EntityView, ranges and moving figures (DEC-21, DEC-33)', () => {
  const edge = map.edges[0];
  if (edge === undefined) throw new Error('no roads');

  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const figure = (fields: Partial<EnemyGroup> = {}): EnemyGroup => ({
    id: 'f1',
    pos: 200,
    toward_b: true,
    detail: 'range',
    mode: 'attack',
    units: null,
    charged: null,
    units_range: { low: 3, high: 5 },
    ...fields,
  });
  function snapshotWith(tick: number, figures: EnemyGroup[]): SnapshotMsg {
    const edges = base.view.edges.map((e) =>
      e.id === edge?.id ? { ...e, enemy_groups: figures } : { ...e, enemy_groups: [] },
    );
    return { ...base, tick, view: { ...base.view, edges, groups: [] } };
  }
  const texts = (layers: ReturnType<typeof createLayers>): string[] => {
    const found: string[] = [];
    const visit = (item: Container): void => {
      if (!item.visible) return;
      if (item instanceof Text && item.text !== '') found.push(item.text);
      for (const child of item.children) visit(child);
    };
    visit(layers.layer.groups);
    return found;
  };

  it('writes the range of a figure seen as a range, and nothing about its charges', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    // Even if the data had charges at this level, the range token does not show them.
    const snapshot = snapshotWith(100, [figure({ charged: 7 })]);
    view.update(interpolateFrame(snapshot, null, 100));
    expect(texts(layers)).toContain('3-5');
    expect(texts(layers)).not.toContain('7');
    // Open range: «21+».
    view.update(
      interpolateFrame(
        snapshotWith(110, [figure({ units_range: { low: 21, high: null } })]),
        null,
        110,
      ),
    );
    expect(texts(layers)).toContain('21+');
    view.destroy();
  });

  it('writes the range of a city seen as a range', () => {
    const nodes: NodeView[] = base.view.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            detail: 'range',
            seen: {
              tick: 100,
              level: 'range',
              enemy_modes: ['attack'],
              enemy_units: null,
              enemy_charged: null,
              enemy_range: { low: 6, high: 10 },
            },
          }
        : { ...n, seen: null },
    );
    const snapshot: SnapshotMsg = { ...base, view: { ...base.view, nodes, groups: [] } };
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(interpolateFrame(snapshot, null, snapshot.tick));
    expect(texts(layers)).toContain('6-10');
    view.destroy();
  });

  it('moves a figure smoothly between two snapshots, along the road, and keeps its token', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    const a = snapshotWith(100, [figure({ pos: 200 })]);
    const b = snapshotWith(110, [figure({ pos: 400 })]);
    const enemy = layers.layer.groups.children.find((c) => c.label === 'enemy');
    const ends = edgeEnds(map, edge.id);
    if (ends === undefined) throw new Error('no ends');
    const along = (frameTick: number) => {
      view.update(interpolateFrame(a, b, frameTick));
      const token = enemy?.children[enemy.children.length - 1];
      return { token, x: token?.x ?? NaN, y: token?.y ?? NaN };
    };
    const first = along(100);
    const middle = along(105);
    const last = along(110);
    expect(middle.token).toBe(first.token);
    expect(last.token).toBe(first.token);
    // Each step moves the same way along the road (the lane offset stays the same).
    const dx = ends.b.x - ends.a.x;
    const dy = ends.b.y - ends.a.y;
    const step1 = (middle.x - first.x) * dx + (middle.y - first.y) * dy;
    const step2 = (last.x - middle.x) * dx + (last.y - middle.y) * dy;
    expect(step1).toBeGreaterThan(0);
    expect(step2).toBeCloseTo(step1);
    view.destroy();
  });
});

describe('EntityView, supply packets (a charge is a square, ui-style 21)', () => {
  const edge = map.edges[0];
  if (edge === undefined) throw new Error('no roads');

  interface Drawn {
    readonly action: string;
    readonly type: string;
    readonly color: number;
    readonly alpha: number;
    readonly width: number;
  }
  /** Every fill and stroke of a Graphics: the kind of shape, its colour and opacity, its width. */
  function drawn(g: Graphics): Drawn[] {
    const instructions = g.context.instructions as unknown as {
      action: string;
      data: {
        style: { color: number; alpha: number };
        path: { shapePath: { shapePrimitives: { shape: { type: string; width?: number } }[] } };
      };
    }[];
    return instructions
      .filter((i) => i.action === 'fill' || i.action === 'stroke')
      .flatMap((i) =>
        i.data.path.shapePath.shapePrimitives.map((p) => ({
          action: i.action,
          type: p.shape.type,
          color: i.data.style.color,
          alpha: i.data.style.alpha,
          width: p.shape.width ?? 0,
        })),
      );
  }

  function frameWithPacket(transfer: boolean) {
    const packet: PacketView = {
      id: 'p1',
      edge: edge?.id ?? 0,
      from_node: edge?.a ?? 0,
      charges: 1,
      depart_tick: 100,
      arrive_tick: 200,
      path: [edge?.b ?? 0],
      dest_tick: 200,
      transfer,
    };
    const snapshot: SnapshotMsg = {
      ...base,
      view: { ...base.view, packets: [packet], groups: [] },
    };
    return interpolateFrame(snapshot, null, 150);
  }
  const packetView = (layers: ReturnType<typeof createLayers>): Container => {
    const layer = layers.layer.groups.children.find((c) => c.label === 'packets');
    const found = layer?.children[0];
    if (found === undefined) throw new Error('no packet drawn');
    return found;
  };

  it('draws a packet as a filled square of its owner with a tail of two fainter squares', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWithPacket(false));
    const [far, near, dot] = packetView(layers).children as Graphics[];
    expect(dot).toBeDefined();
    const square = drawn(dot as Graphics);
    expect(square.map((s) => [s.action, s.type])).toEqual([
      ['fill', 'rectangle'],
      ['stroke', 'rectangle'],
    ]);
    expect(square[0]?.color).toBe(YOU);
    expect(square[0]?.width).toBe(PACKET_SIDE);
    // Smaller and fainter the farther behind: the nearer square first in the list of the tail.
    expect(drawn(near as Graphics)[0]).toMatchObject({ type: 'rectangle', alpha: 0.6, width: 6 });
    expect(drawn(far as Graphics)[0]).toMatchObject({ type: 'rectangle', alpha: 0.3, width: 5 });
    view.destroy();
  });

  it('puts the tail behind the packet, against its way, whichever end it leaves from', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    const ends = edgeEnds(map, edge.id);
    if (ends === undefined) throw new Error('no ends');
    const way = { x: ends.b.x - ends.a.x, y: ends.b.y - ends.a.y };
    view.update(frameWithPacket(false));
    const [far, first] = packetView(layers).children as Graphics[];
    let near = first;
    // Leaving `a` for `b`: both squares of the tail are on the side of `a`.
    expect((near?.x ?? 0) * way.x + (near?.y ?? 0) * way.y).toBeLessThan(0);
    expect(Math.hypot(near?.x ?? 0, near?.y ?? 0)).toBeCloseTo(8);
    expect(Math.hypot(far?.x ?? 0, far?.y ?? 0)).toBeCloseTo(14);
    // Leaving `b` for `a`: the other way round.
    const back = frameWithPacket(false);
    const packet = back.packets[0];
    if (packet === undefined) throw new Error('no packet');
    packet.packet = { ...packet.packet, from_node: edge.b };
    view.update(back);
    near = packetView(layers).children[1] as Graphics | undefined;
    expect((near?.x ?? 0) * way.x + (near?.y ?? 0) * way.y).toBeGreaterThan(0);
    view.destroy();
  });

  it('tells a transfer by a bigger square with a second outline apart from it', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWithPacket(true));
    const dot = packetView(layers).children[2] as Graphics;
    const shapes = drawn(dot);
    expect(shapes.map((s) => [s.action, s.type, s.width])).toEqual([
      ['fill', 'rectangle', PACKET_TRANSFER.side],
      ['stroke', 'rectangle', PACKET_TRANSFER.side],
      ['stroke', 'rectangle', PACKET_TRANSFER.ring],
    ]);
    view.destroy();
  });

  it('draws no circle for a packet, whoever it belongs to', () => {
    for (const transfer of [false, true]) {
      const layers = createLayers();
      const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
      view.update(frameWithPacket(transfer));
      const graphics = packetView(layers).children.filter(
        (c): c is Graphics => c instanceof Graphics,
      );
      expect(graphics).toHaveLength(3);
      for (const g of graphics) {
        expect(drawn(g).filter((s) => s.type === 'circle')).toEqual([]);
      }
      view.destroy();
    }
  });
});

describe('EntityView, the road build (R1, #345)', () => {
  const edge = map.edges[0];
  if (edge === undefined) throw new Error('no roads');

  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function frameWithBuild(width: number, doneTick: number | null, tick = 100) {
    const edges = base.view.edges.map((e) =>
      e.id === edge?.id ? { ...e, width, build: { done_tick: doneTick } } : e,
    );
    const snapshot: SnapshotMsg = { ...base, tick, view: { ...base.view, edges, groups: [] } };
    return interpolateFrame(snapshot, null, tick);
  }
  const plates = (layers: ReturnType<typeof createLayers>): Container[] => {
    const layer = layers.layer.intents.children.find((c) => c.label === 'builds');
    return (layer?.children ?? []).filter((c) => c.visible);
  };
  const texts = (item: Container): string[] =>
    item.children.filter((c): c is Text => c instanceof Text && c.visible).map((c) => c.text);
  const tape = (layers: ReturnType<typeof createLayers>): Graphics =>
    layers.layer.roads.children[0] as Graphics;
  /** The polygons the tape fills, in order, with their colour, opacity and corner points. */
  function filled(g: Graphics) {
    const instructions = g.context.instructions as unknown as {
      action: string;
      data: {
        style: { color: number; alpha: number };
        path: { shapePath: { shapePrimitives: { shape: { points: number[] } }[] } };
      };
    }[];
    return instructions
      .filter((i) => i.action === 'fill')
      .map((i) => ({
        color: i.data.style.color,
        alpha: i.data.style.alpha,
        polygons: i.data.path.shapePath.shapePrimitives.map((p) => p.shape.points),
      }));
  }

  it('draws the tape under the lanes: a dark band, the warning stripes, the part done on top', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.setBuildTicks(150);
    // 75 of the 150 ticks are left: half is done.
    view.update(frameWithBuild(1, 175));
    const fills = filled(tape(layers));
    expect(fills.map((f) => [f.color, f.alpha])).toEqual([
      [ROAD_TAPE.base.color, ROAD_TAPE.base.alpha],
      [ROAD_TAPE.stripeColor.color, ROAD_TAPE.stripeColor.alpha],
      [ROAD_TAPE.done.color, ROAD_TAPE.done.alpha],
    ]);
    expect(fills[1]?.polygons.length).toBeGreaterThan(3);
    const ends = edgeEnds(map, edge.id);
    if (ends === undefined) throw new Error('no ends');
    const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
    const [done] = fills[2]?.polygons ?? [];
    // The first side of the done polygon runs along the road: half its length.
    expect(
      Math.hypot((done?.[2] ?? 0) - (done?.[0] ?? 0), (done?.[3] ?? 0) - (done?.[1] ?? 0)),
    ).toBeCloseTo(length / 2);
    // The tape lies first in the layer of the roads: under the casings and the lanes.
    expect(layers.layer.roads.children[0]).toBe(tape(layers));
    view.destroy();
  });

  it('shows no part done for an enemy build (no `done_tick`), and none without the duration', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.setBuildTicks(150);
    view.update(frameWithBuild(1, null));
    expect(filled(tape(layers))).toHaveLength(2);
    view.setBuildTicks(0);
    view.update(frameWithBuild(1, 175, 101));
    expect(filled(tape(layers))).toHaveLength(2);
    view.destroy();
  });

  it('puts a plate with the change of level in the middle of the road, and the time left of an own build', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.setTickHz(10);
    view.update(frameWithBuild(2, 175));
    const [plate, ...rest] = plates(layers);
    expect(rest).toEqual([]);
    expect(texts(plate as Container).sort()).toEqual(['0:08', '2→3']);
    const ends = edgeEnds(map, edge.id);
    expect(plate?.x).toBeCloseTo(((ends?.a.x ?? 0) + (ends?.b.x ?? 0)) / 2);
    expect(plate?.y).toBeCloseTo(((ends?.a.y ?? 0) + (ends?.b.y ?? 0)) / 2);
    // An enemy build: the plate without a time.
    view.update(frameWithBuild(1, null, 101));
    expect(texts(plates(layers)[0] as Container)).toEqual(['1→2']);
    view.destroy();
  });

  it('removes the plate when the build is over, and keeps it at least 20 px high on screen', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWithBuild(1, 175));
    view.setCameraScale(0.5);
    // 16 world units high: 20 px needs a scale of at least 20 / (16 * 0.5).
    expect(plates(layers)[0]?.scale.x).toBeGreaterThanOrEqual(20 / (16 * 0.5) - 1e-9);
    view.update(interpolateFrame({ ...base, tick: 102 }, null, 102));
    expect(plates(layers)).toEqual([]);
    expect(filled(tape(layers))).toEqual([]);
    view.destroy();
  });
});

describe('EntityView, where the groups of a fight stand and the token pop (E3, #351)', () => {
  it('tells where an enemy marker stands in a city, and nowhere else', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWith([], true));
    const city = nodePoint(map, nodeId);
    expect(view.nodePoint(nodeId)).toEqual({ x: city?.x, y: city?.y });
    const other = map.nodes.find((n) => n.id !== nodeId)?.id ?? 0;
    expect(view.nodePoint(other)).toBeUndefined();
    view.destroy();
  });

  it('swells the token standing at a point for a frame, and puts the marker back', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWith([], true));
    const at = view.nodePoint(nodeId);
    if (at === undefined) throw new Error('no marker');
    const token = enemyTokenAt(layers);
    const size = token?.scale.x ?? NaN;
    view.punch([{ at, scale: 1.4 }]);
    expect(token?.scale.x).toBeCloseTo(size * 1.4);
    // A punch somewhere else leaves it alone, and the next call puts it back.
    view.punch([{ at: { x: at.x + 50, y: at.y }, scale: 2 }]);
    expect(token?.scale.x).toBeCloseTo(size);
    view.destroy();
  });

  it('swells an own group token and gets its size back with the next frame', () => {
    const own: GroupView = {
      id: 'g',
      units: 2,
      charged: 2,
      mode: 'attack',
      location: { kind: 'node', node: nodeId },
      order: null,
      defense_bonus: null,
      defense_cap: null,
    };
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWith([own], false));
    const spot = view.groupPoints().get('g');
    if (spot === undefined) throw new Error('no spot');
    const token = layers.layer.groups.children
      .find((c) => c.label === 'own-groups')
      ?.children.find((c) => c.visible);
    view.punch([{ at: spot, scale: 1.5 }]);
    expect(token?.scale.x).toBeCloseTo(spot.scale * 1.5);
    view.update(frameWith([own], false));
    expect(token?.scale.x).toBeCloseTo(spot.scale);
    view.destroy();
  });
});

describe('EntityView, tokens that come and go (#508)', () => {
  const own = (id: string, units = 2): GroupView => ({
    id,
    units,
    charged: units,
    mode: 'attack',
    location: { kind: 'node', node: nodeId },
    order: null,
    defense_bonus: null,
    defense_cap: null,
  });
  const entries = (layers: ReturnType<typeof createLayers>): Container[] =>
    layers.layer.groups.children.find((c) => c.label === 'own-groups')?.children as Container[];
  const tokenOf = (entry: Container | undefined): Container => {
    const token = entry?.children[0];
    if (token === undefined) throw new Error('no token');
    return token as Container;
  };

  it('shows the first frame as it is, and fades in what appears later', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWith([], false));
    view.update(frameWith([own('a')], false));
    const entry = entries(layers)[0];
    expect(tokenOf(entry).alpha).toBe(0);
    view.advance(60);
    expect(tokenOf(entry).alpha).toBeGreaterThan(0);
    view.advance(1000);
    expect(tokenOf(entry).alpha).toBe(1);
    view.destroy();

    const first = createLayers();
    const other = new EntityView(map, first, 0, 1, () => 17, testSprites());
    other.update(frameWith([own('a')], false));
    expect(tokenOf(entries(first)[0]).alpha).toBe(1);
    other.destroy();
  });

  it('fades a token that left the snapshot out where it stood, then removes it', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWith([own('a')], false));
    view.update(frameWith([], false));
    // Still there, fading.
    expect(entries(layers)).toHaveLength(1);
    view.advance(100);
    const alpha = tokenOf(entries(layers)[0]).alpha;
    expect(alpha).toBeLessThan(1);
    expect(alpha).toBeGreaterThan(0);
    view.advance(1000);
    view.update(frameWith([], false));
    expect(entries(layers)).toHaveLength(0);
    view.destroy();
  });

  it('takes a token back when it returns while it is still fading', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWith([own('a')], false));
    view.update(frameWith([], false));
    view.advance(100);
    view.update(frameWith([own('a')], false));
    view.advance(1000);
    expect(entries(layers)).toHaveLength(1);
    expect(tokenOf(entries(layers)[0]).alpha).toBe(1);
    view.destroy();
  });

  it('swells a token when its number of units changes, and settles', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17, testSprites());
    view.update(frameWith([own('a', 2)], false));
    const token = tokenOf(entries(layers)[0]);
    expect(token.scale.x).toBe(1);
    view.update(frameWith([own('a', 3)], false));
    expect(token.scale.x).toBeGreaterThan(1);
    view.advance(1000);
    expect(token.scale.x).toBe(1);
    view.destroy();
  });
});
