import type { Container, Graphics, Sprite, Text } from 'pixi.js';
import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import { flowSnapshot } from '../dev/flowScene.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import type { SnapshotMsg } from '../protocol.gen.ts';
import { FlowView } from './flowView.ts';
import { createLayers } from './layers.ts';
import { setReducedMotion } from './motion.ts';
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

/** The parts of the SupplyView: the root of the layer (supply) and what lies in it. */
function parts(layers: ReturnType<typeof createLayers>) {
  const [root] = layers.layer.supply.children as Container[];
  const children = root?.children ?? [];
  const find = (label: string) => children.find((c) => c.label === label) as Container;
  return {
    marks: find('supply-marks'),
    texts: find('supply-texts'),
    dimmer: children[4] as Graphics,
    chain: children[5] as Graphics,
    ring: children[6] as Graphics,
  };
}

describe('SupplyView under the flow', () => {
  beforeEach(() => {
    mockText();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setReducedMotion(null);
  });

  function draw(base: SnapshotMsg, flow: number | null = null, tick = base.tick) {
    const layers = createLayers();
    const view = new SupplyView(map as NonNullable<typeof map>, layers, 0, () => 14, testSprites());
    view.setProvinceWarehouse(1);
    const supply = { source: null, targets: [], draft: [], flow };
    view.update(interpolateFrame(base, null, tick), supply);
    return { layers, view, supply, ...parts(layers) };
  }

  it('puts a chevron on every downhill road: bright where a packet is, dim where it is idle', () => {
    const { marks, view } = draw(snapshot);
    const chevrons = visible(marks) as Sprite[];
    const bright = chevrons.filter((c) => c.alpha === 1);
    const dim = chevrons.filter((c) => c.alpha < 1);
    // The roads 3-4, 9-10, 0-3 and 12-7 carry a packet in the scene; the others are idle.
    expect(bright.length).toBeGreaterThan(0);
    expect(dim.length).toBeGreaterThan(0);
    // One dim chevron per idle road: 11 downhill roads, 4 with a packet.
    expect(dim).toHaveLength(
      snapshot.view.nodes.reduce((n, x) => n + (x.flow_down?.length ?? 0), 0) - 4,
    );
    view.destroy();
  });

  it('a shifted level has fewer roads that flow: only the ones the server lists', () => {
    const shifted = flowSnapshot(map, 1);
    const roads = (s: SnapshotMsg) =>
      s.view.nodes.reduce((n, x) => n + (x.flow_down?.length ?? 0), 0);
    expect(roads(shifted)).toBeLessThan(roads(snapshot));
    const { marks, view } = draw(shifted);
    // One of the five downhill roads (0-6) carries a packet; the packet 0-1 is on a level road.
    expect(visible(marks).filter((c) => (c as Sprite).alpha < 1)).toHaveLength(roads(shifted) - 1);
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

  it('draws nothing of the hover without a hovered city, and no ring', () => {
    const { dimmer, chain, ring, view } = draw(snapshot);
    expect(dimmer.context.instructions).toHaveLength(0);
    expect(chain.context.instructions).toHaveLength(0);
    expect(ring.context.instructions).toHaveLength(0);
    view.destroy();
  });

  it('a hovered city gets the dimmer, the chain and the ring', () => {
    const { dimmer, chain, ring, view } = draw(snapshot, 0);
    expect(dimmer.context.instructions.length).toBeGreaterThan(0);
    expect(chain.context.instructions.length).toBeGreaterThan(0);
    expect(ring.context.instructions.length).toBeGreaterThan(0);
    view.destroy();
  });

  it('the idle plate says why a node sends nothing, from flow_idle', () => {
    // The node 4 (a leaf) sends nothing: "keeps"; the node 2 (full neighbour) "nobody takes more".
    const keeps = draw(snapshot, 4);
    expect(shown(keeps.texts)).toContain('Keeps: the supply level');
    keeps.view.destroy();
    const full = draw(snapshot, 2);
    expect(shown(full.texts)).toContain('Nobody takes more');
    full.view.destroy();
    const ahead = draw(flowSnapshot(map, 1), 4);
    expect(shown(ahead.texts)).toContain('Frozen: ahead of the level');
    ahead.view.destroy();
  });

  it('the ring is redrawn every frame and loses its arc when the dispatch is due', () => {
    const { view, supply, ring } = draw(snapshot, 0, snapshot.tick);
    const full = ring.context.instructions.length;
    view.update(
      { ...interpolateFrame(snapshot, null, snapshot.tick), tick: snapshot.tick + 5 },
      supply,
    );
    expect(ring.context.instructions).toHaveLength(full);
    // At the tick of the dispatch nothing is left of the arc: its two strokes are not drawn.
    view.update(
      { ...interpolateFrame(snapshot, null, snapshot.tick), tick: snapshot.tick + 10 },
      supply,
    );
    expect(ring.context.instructions.length).toBeLessThan(full);
    view.destroy();
  });
});

describe('the battle mode (FlowView)', () => {
  function draw(base: SnapshotMsg, active = true) {
    const layers = createLayers();
    const view = new FlowView(map as NonNullable<typeof map>, layers, 0, () => 14, testSprites());
    view.update(base, active);
    const roads = layers.layer.roads.children.find((c) => c.label === 'flow-roads') as Container;
    const marks = layers.layer.intents.children.find((c) => c.label === 'flow-marks') as Container;
    return { view, roads, marks };
  }

  it('draws one faint chevron per downhill road and the starving marks, and nothing to hover', () => {
    const { view, roads, marks } = draw(snapshot);
    const downhill = snapshot.view.nodes.reduce((n, x) => n + (x.flow_down?.length ?? 0), 0);
    expect(visible(roads)).toHaveLength(downhill);
    expect(visible(roads).every((c) => (c as Sprite).alpha < 1)).toBe(true);
    expect(visible(marks).length).toBeGreaterThanOrEqual(2);
    view.destroy();
  });

  it('is hidden on the «Supply» layer, and under the lines supply it draws nothing', () => {
    const supply = draw(snapshot, false);
    expect(supply.roads.visible).toBe(false);
    supply.view.destroy();
    const lines = draw({
      ...snapshot,
      view: { ...snapshot.view, me: { ...snapshot.view.me, leaf_shift: null } },
    });
    expect(lines.roads.visible).toBe(false);
    lines.view.destroy();
  });
});
