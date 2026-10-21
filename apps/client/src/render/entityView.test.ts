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
