import type { Container, Graphics, Sprite, Text } from 'pixi.js';
import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import { flowSnapshot } from '../dev/flowScene.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import type { SnapshotMsg } from '../protocol.gen.ts';
import { CANAL } from './canalLayout.ts';
import { FlowView } from './flowView.ts';
import { createLayers } from './layers.ts';
import { setReducedMotion } from './motion.ts';
import { CASING, INK, YOU } from './style.ts';
import { SupplyView } from './supplyView.ts';
import { testSprites } from './testSprites.ts';

// The «Supply» layer and the battle mode under the supply flow (DEC-43, #705): what they draw is read
// from the fields of the snapshot; the artery map of the dev scenes has roads and cities of every kind.
const map = BUNDLED_MAPS.find((m) => m.meta.name === 'artery');
if (map === undefined) throw new Error('the artery map is not bundled');
const snapshot = flowSnapshot(map, 0);

const mockText = () =>
  vi
    .spyOn(CanvasTextMetrics, 'measureText')
    .mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );

const visible = (c: Container) => c.children.filter((x) => x.visible);
const shown = (texts: Container) =>
  texts.children.filter((c) => c.visible).map((c) => (c as Text).text);

/** The parts of the SupplyView: the root of the layer (supply) and what lies in it, and the canals. */
function parts(layers: ReturnType<typeof createLayers>) {
  const [root] = layers.layer.supply.children as Container[];
  const children = root?.children ?? [];
  const find = (label: string) => children.find((c) => c.label === label) as Container;
  const pipeRoot = layers.layer.roads.children.find((c) => c.label === 'supply-pipes') as Container;
  return {
    marks: find('supply-marks'),
    texts: find('supply-texts'),
    canals: pipeRoot.children[0] as Graphics,
    running: pipeRoot.children.find((c) => c.label === 'canal-run') as Graphics,
  };
}

/** The strokes of a Graphics: colour, width and the number of lines in each. */
function strokesOf(g: Graphics): { color: number; width: number; lines: number }[] {
  const instructions = g.context.instructions as unknown as {
    action: string;
    data: {
      style: { color: number; width: number };
      path: { shapePath: { shapePrimitives: unknown[] } };
    };
  }[];
  return instructions
    .filter((i) => i.action === 'stroke')
    .map((i) => ({
      color: i.data.style.color,
      width: i.data.style.width,
      lines: i.data.path.shapePath.shapePrimitives.length,
    }));
}

const downhill = (s: SnapshotMsg): number =>
  s.view.nodes.reduce((n, x) => n + (x.flow_down?.length ?? 0), 0);

describe('SupplyView under the flow', () => {
  beforeEach(() => {
    mockText();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setReducedMotion(null);
  });

  function draw(base: SnapshotMsg, tick = base.tick) {
    const layers = createLayers();
    const view = new SupplyView(map as NonNullable<typeof map>, layers, 0, () => 14, testSprites());
    view.setProvinceWarehouse(1);
    const supply = { source: null, targets: [], draft: [] };
    view.update(interpolateFrame(base, null, tick), supply);
    return { layers, view, supply, ...parts(layers) };
  }

  it('lays a canal on every downhill road: a casing, two ink rails, a V at the receiving ring (#858)', () => {
    const { canals, view } = draw(snapshot);
    const strokes = strokesOf(canals);
    const casing = strokes[0];
    expect(casing?.color).toBe(CASING);
    expect(casing?.width).toBeCloseTo(2 * (CANAL.half + CANAL.casing));
    expect(casing?.lines).toBe(downhill(snapshot));
    // The rails, two a canal, in ink; the heads, one a canal, ink over a casing.
    const rails = strokes.find((st) => st.color === INK && st.width === CANAL.rail);
    expect(rails?.lines).toBe(2 * downhill(snapshot));
    const heads = strokes.filter((st) => st.width === CANAL.head.ink && st.color === INK);
    expect(heads[0]?.lines).toBe(downhill(snapshot));
    view.destroy();
  });

  it('runs the hachures of the roads that carry a packet, the idle ones faint and still', () => {
    const { canals, running, view } = draw(snapshot);
    // The roads 3-4, 9-10, 0-3 and 12-7 carry a packet in the scene; the others are idle.
    const idle = strokesOf(canals).find((st) => st.color === YOU);
    expect(idle).toBeDefined();
    const run = strokesOf(running);
    expect(run).toHaveLength(1);
    expect(run[0]?.color).toBe(YOU);
    expect(run[0]?.lines).toBeGreaterThan(0);
    view.destroy();
  });

  it('a shifted level has fewer roads that flow: only the ones the server lists', () => {
    const shifted = flowSnapshot(map, 1);
    expect(downhill(shifted)).toBeLessThan(downhill(snapshot));
    const { canals, view } = draw(shifted);
    expect(strokesOf(canals)[0]?.lines).toBe(downhill(shifted));
    view.destroy();
  });

  it('rings the nodes of the level: the own colour on a casing, an ink ring outside', () => {
    const { layers, view } = draw(snapshot);
    const [root] = layers.layer.supply.children as Container[];
    const plates = root?.children[1] as Graphics;
    const level = snapshot.view.nodes.filter(
      (n) => n.owner === 0 && n.front_dist === snapshot.view.me.leaf_shift,
    );
    expect(level.length).toBeGreaterThan(0);
    const rings = strokesOf(plates).filter(
      (st) => st.color === YOU && st.width === CANAL.level.width,
    );
    expect(rings).toHaveLength(level.length);
    view.destroy();
  });

  it('marks the starving nodes with the triangle, one sprite each, besides the chevrons', () => {
    const { marks, view } = draw(snapshot);
    // The scene's starving nodes at the front: Bluff (7, empty level) and West Shoulder (14, pocket).
    const bangs = visible(marks).filter(
      (c) => (c as Sprite).alpha === 1 && (c as Sprite).rotation === 0,
    );
    expect(bangs.length).toBeGreaterThanOrEqual(2);
    view.destroy();
  });

  it('says "No source" for a pocket and draws no number on the roads', () => {
    const { texts, view } = draw(snapshot);
    expect(shown(texts)).toEqual(['No source']);
    view.destroy();
  });
});

describe('the battle mode (FlowView): alerts only', () => {
  function draw(base: SnapshotMsg, active = true) {
    const layers = createLayers();
    const view = new FlowView(map as NonNullable<typeof map>, layers, 0, () => 14, testSprites());
    view.update(base, active);
    const marks = layers.layer.intents.children.find((c) => c.label === 'flow-marks') as Container;
    return { view, layers, marks };
  }

  it('draws the starving marks and nothing else: no chevrons on the roads', () => {
    const { view, layers, marks } = draw(snapshot);
    expect(visible(marks).length).toBeGreaterThanOrEqual(2);
    expect(layers.layer.roads.children.find((c) => c.label === 'flow-roads')).toBeUndefined();
    view.destroy();
  });

  it('is hidden on the «Supply» layer, and under the lines supply it draws nothing', () => {
    const supply = draw(snapshot, false);
    expect(supply.marks.visible).toBe(false);
    supply.view.destroy();
    const lines = draw({
      ...snapshot,
      view: { ...snapshot.view, me: { ...snapshot.view.me, leaf_shift: null } },
    });
    expect(lines.marks.visible).toBe(false);
    lines.view.destroy();
  });
});
