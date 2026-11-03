import { CanvasTextMetrics, type Container, type Text } from 'pixi.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEV_RULES_FLOW, devSnapshot } from '../hud/devFeed.ts';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import type { MapFile } from '../protocol.gen.ts';
import { AlertView } from './alertView.ts';
import { createLayers } from './layers.ts';

// A pool map with provinces (DEC-23, DEC-27).
const found = BUNDLED_MAPS.find((m) => m.meta.name === 'crossroads');
if (found === undefined) throw new Error('the map crossroads is not bundled');
const map: MapFile = found;
const base = devSnapshot(map, DEV_RULES_FLOW, 100);
const TICK_HZ = 10;
const NOW_MS = 1000;

const province = base.view.nodes.find((n, i) => map.nodes[i]?.kind === 'province' && n.owner === 0);
const city = base.view.nodes.find((n, i) => map.nodes[i]?.kind !== 'province' && n.owner === 0);
if (province === undefined || city === undefined) {
  throw new Error('the map needs an own province and an own city');
}

// jsdom has no canvas: a label is as wide as its characters, 6 px each.
beforeAll(() => {
  vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
    (text) => ({ width: text.length * 6, height: 12 }) as CanvasTextMetrics,
  );
});

/** The starvation countdown of one own node (DEC-19), as the view gets it in a snapshot. */
function build(id: number, ticks: number | null) {
  const layers = createLayers();
  const view = new AlertView(map, layers, 0, () => 10);
  const nodes = base.view.nodes.map((n) => (n.id === id ? { ...n, starve_in: ticks } : n));
  view.update(nodes, TICK_HZ, null, NOW_MS);
  const root = layers.layer.effects.children.find((c) => c.label === 'alerts') as Container;
  const badges = root.children.filter((c) => c.label === 'overflow-badge' && c.visible);
  const texts = badges.map((b) => (b.children[2] as Text).text);
  return { badges, texts };
}

describe('AlertView: the starvation countdown (DEC-19, DEC-41 pockets)', () => {
  it('shows it on an own province like on an own city', () => {
    const onCity = build(city.id, 73);
    const onProvince = build(province.id, 73);
    expect(onCity.texts).toEqual(['starving in 7.3 s']);
    expect(onProvince.texts).toEqual(onCity.texts);
  });

  it('shows nothing for a province that is not cut off', () => {
    expect(build(province.id, null).texts).toEqual([]);
  });
});
