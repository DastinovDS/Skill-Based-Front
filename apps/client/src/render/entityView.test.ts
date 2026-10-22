import { CanvasTextMetrics, Container, Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import type { EnemyGroup, GroupView, NodeView, SnapshotMsg } from '../protocol.gen.ts';
import { EntityView } from './entityView.ts';
import { createLayers } from './layers.ts';
import { edgeEnds, edgePoint, nodePoint } from './layout.ts';

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
      const view = new EntityView(map, layers, 0, 1, () => 17);
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
    const view = new EntityView(map, layers, 0, 1, () => 17);
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
    const view = new EntityView(map, layers, 0, 1, () => 17);
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
    const view = new EntityView(map, layers, 0, 1, () => 17);
    view.update(frameWith([{ ...defender(1, 3), mode: 'attack' }], false));
    expect(texts(layers).filter((text) => text.startsWith('+'))).toEqual([]);
    view.update(frameWith([defender(null, null)], false));
    expect(texts(layers).filter((text) => text.startsWith('+'))).toEqual([]);
    view.destroy();
  });

  it('never shows a number for the opponent: its icon has the shield and no bonus', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17);
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
    const view = new EntityView(map, layers, 0, 1, () => 17);
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
    const view = new EntityView(map, layers, 0, 1, () => 17);
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
    const view = new EntityView(map, layers, 0, 1, () => 17);
    view.update(interpolateFrame(snapshot, null, snapshot.tick));
    expect(texts(layers)).toContain('6-10');
    view.destroy();
  });

  it('moves a figure smoothly between two snapshots, along the road, and keeps its token', () => {
    const layers = createLayers();
    const view = new EntityView(map, layers, 0, 1, () => 17);
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
