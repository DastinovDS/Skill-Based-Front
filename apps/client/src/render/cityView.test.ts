import type { Container } from 'pixi.js';
import type { BakedSprite } from './bake.ts';
import {
  barracksSpec,
  cityBodySpec,
  provinceBodySpec,
  stockColor,
  warehouseBarSpec,
} from './bakedShapes.ts';
import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { BUNDLED_MAPS, DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { MapFile, NodeView, SnapshotMsg } from '../protocol.gen.ts';
import { CityView } from './cityView.ts';
import { createLayers } from './layers.ts';
import { ENEMY, PROVINCE, YOU } from './style.ts';
import { testSprites } from './testSprites.ts';

const map = DEFAULT_MAP;
const UPGRADES = {
  barracks: 100,
  warehouse: 100,
  warehouseMaxLevel: DEV_RULES.city_upgrades.warehouse_max_level,
  warehouseGainPerLevel: DEV_RULES.city_upgrades.warehouse_gain_per_level,
};

/** The snapshot with `has_barracks` of node `id` replaced (the server decides it, DEC-31). */
function withBarracks(base: SnapshotMsg, id: number, value: boolean | null): SnapshotMsg {
  const nodes: NodeView[] = base.view.nodes.map((n) =>
    n.id === id ? { ...n, has_barracks: value } : n,
  );
  return { ...base, view: { ...base.view, nodes } };
}

/** The barracks mark of the city `id`: the baked shape it shows (`null`: none) and whether it is drawn. */
function barracksMark(nodes: Container, id: number): string | null {
  const city = nodes.children.find((c) => c.label === `node-${String(id)}`) as Container;
  const mark = city.children.find((c) => c.label === 'barracks') as BakedSprite;
  return mark.visible ? (mark.spec?.key ?? null) : null;
}

describe('CityView: the barracks of an enemy city next door (DEC-31)', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws the same house as on an own city and drops it when the city is no longer next door', () => {
    const snapshot = devSnapshot(map, DEV_RULES, 100);
    const own = snapshot.view.nodes.find((n) => n.owner === 0 && n.has_barracks === true);
    const enemy = map.nodes.find((n) => n.start_owner === 1 && n.kind !== 'province');
    expect(own).toBeDefined();
    expect(enemy).toBeDefined();
    if (own === undefined || enemy === undefined) return;
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    const nodes = layers.layer.nodes;

    // Next to an own node, barracks built: the same mark as on an own city, the house (not a colour)
    // says «barracks»; only the rim takes the colour of the owner.
    view.update(withBarracks(snapshot, enemy.id, true), null, UPGRADES);
    const drawn = barracksMark(nodes, enemy.id);
    expect(drawn).toBe(barracksSpec(ENEMY).key);
    expect(barracksMark(nodes, own.id)).toBe(barracksSpec(YOU).key);

    // Next door, but no barracks yet (or being built): no mark.
    view.update(withBarracks(snapshot, enemy.id, false), null, UPGRADES);
    expect(barracksMark(nodes, enemy.id)).toBeNull();

    // Built again, then the own neighbour is lost: the server sends `null`, the mark goes.
    view.update(withBarracks(snapshot, enemy.id, true), null, UPGRADES);
    expect(barracksMark(nodes, enemy.id)).toBe(drawn);
    view.update(withBarracks(snapshot, enemy.id, null), null, UPGRADES);
    expect(barracksMark(nodes, enemy.id)).toBeNull();
    view.destroy();
  });
});

const city = (nodes: Container, id: number): Container =>
  nodes.children.find((c) => c.label === `node-${String(id)}`) as Container;
/** The baked body and warehouse bar of a city: its first and third children (`CityView`). */
const bodyOf = (nodes: Container, id: number): BakedSprite =>
  city(nodes, id).children[0] as BakedSprite;
const barOf = (nodes: Container, id: number): BakedSprite =>
  city(nodes, id).children[2] as BakedSprite;
const ringOf = (nodes: Container, id: number): BakedSprite =>
  city(nodes, id).children[1] as BakedSprite;

describe('CityView: the warehouse places of an own city (C1, DEC-26)', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  const snapshot = devSnapshot(map, DEV_RULES, 100);
  const own = snapshot.view.nodes.find((n) => n.owner === 0 && n.warehouse_cap !== null);
  const foreign = snapshot.view.nodes.find((n) => n.owner === 1 && n.warehouse !== null);

  /** The snapshot with the warehouse of node `id` replaced. */
  function withWarehouse(id: number, fields: Partial<NodeView>): SnapshotMsg {
    const nodes = snapshot.view.nodes.map((n) => (n.id === id ? { ...n, ...fields } : n));
    return { ...snapshot, view: { ...snapshot.view, nodes } };
  }

  const top = DEV_RULES.city_upgrades.warehouse_max_level;
  const gain = DEV_RULES.city_upgrades.warehouse_gain_per_level;

  it.each([...Array<number>(top + 1).keys()])(
    'level %i: the places of the levels above it are dashed, after the filled ones and the frames',
    (level) => {
      if (own === undefined || own.warehouse_cap === null) throw new Error('no own city');
      const cap = own.warehouse_cap + level * gain;
      const layers = createLayers();
      const view = new CityView(map, layers, 0, 1, testSprites());
      view.update(
        withWarehouse(own.id, { warehouse_level: level, warehouse_cap: cap, warehouse: 1 }),
        null,
        UPGRADES,
      );
      const bar = barOf(layers.layer.nodes, own.id);
      expect(bar.visible).toBe(true);
      expect(bar.spec?.key).toBe(
        warehouseBarSpec(cap, 1, stockColor('you'), (top - level) * gain).key,
      );
      view.destroy();
    },
  );

  it('draws no dashed place without city development: the warehouse is the capacity', () => {
    if (own === undefined) throw new Error('no own city');
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    view.update(snapshot, null, null);
    const bar = barOf(layers.layer.nodes, own.id);
    expect(bar.spec?.key).toBe(
      warehouseBarSpec(own.warehouse_cap ?? own.capacity, own.warehouse ?? 0, stockColor('you'), 0)
        .key,
    );
    view.destroy();
  });

  it('shows a foreign city only the charges (no frame, no dashed place): its warehouse level is hidden', () => {
    if (foreign === undefined || foreign.warehouse === null) throw new Error('no foreign city');
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    view.update(snapshot, null, UPGRADES);
    const bar = barOf(layers.layer.nodes, foreign.id);
    expect(bar.spec?.key).toBe(
      warehouseBarSpec(foreign.warehouse, foreign.warehouse, stockColor('enemy'), 0).key,
    );
    view.destroy();
  });

  it('draws no bar for a foreign city whose warehouse the view does not give', () => {
    const hidden = snapshot.view.nodes.find((n) => n.owner === 1 && n.warehouse === null);
    if (hidden === undefined) throw new Error('no hidden foreign city');
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    view.update(snapshot, null, UPGRADES);
    expect(barOf(layers.layer.nodes, hidden.id).visible).toBe(false);
    view.destroy();
  });
});

describe('CityView: a province is a hollow ring (C1, DEC-23)', () => {
  // The pool maps (DEC-27) have provinces; the first one starts with two own provinces.
  const pool = BUNDLED_MAPS.find((m) => m.meta.name === 'crossroads') as MapFile;
  const snapshot = devSnapshot(pool, DEV_RULES, 100);
  const ownProvince = pool.nodes.find((n) => n.kind === 'province' && n.start_owner === 0);
  const neutralProvince = pool.nodes.find((n) => n.kind === 'province' && n.start_owner === null);
  const ownCity = pool.nodes.find((n) => n.kind === 'city_medium' && n.start_owner === 0);

  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('is drawn as a ring, not as a city body, in every state of ownership', () => {
    if (ownProvince === undefined || neutralProvince === undefined || ownCity === undefined) {
      throw new Error('the pool map has no provinces to look at');
    }
    const layers = createLayers();
    const view = new CityView(pool, layers, 0, 1, testSprites());
    view.update(snapshot, null, UPGRADES);
    const nodes = layers.layer.nodes;
    expect(bodyOf(nodes, ownProvince.id).spec?.key).toBe(provinceBodySpec('you').key);
    expect(bodyOf(nodes, neutralProvince.id).spec?.key).toBe(provinceBodySpec('neutral').key);
    expect(bodyOf(nodes, ownCity.id).spec?.key).toBe(
      cityBodySpec('you', view.radiusOf(ownCity.id), false).key,
    );
    // The three looks differ by shape, not only by colour.
    const keys = new Set(['you', 'enemy', 'neutral'].map((k) => provinceBodySpec(k as 'you').key));
    expect(keys.size).toBe(3);
    view.destroy();
  });

  it('has its own small radius whatever the capacity, and keeps the capacity ring', () => {
    if (ownProvince === undefined) throw new Error('no province');
    const layers = createLayers();
    const view = new CityView(pool, layers, 0, 1, testSprites());
    expect(view.radiusOf(ownProvince.id)).toBe(PROVINCE.radius);
    view.update(snapshot, null, UPGRADES);
    expect(view.radiusOf(ownProvince.id)).toBe(PROVINCE.radius);
    expect(view.radiusOf(ownProvince.id)).toBeLessThan(view.radiusOf(ownCity?.id ?? 0));
    const ring = ringOf(layers.layer.nodes, ownProvince.id);
    expect(ring.visible).toBe(true);
    expect(ring.spec?.key).toContain(`ring:${String(PROVINCE.radius)}:`);
    view.destroy();
  });

  it('has no warehouse bar, even when the view carries a warehouse of 0 (the empty shading of #348)', () => {
    if (ownProvince === undefined) throw new Error('no province');
    const node = snapshot.view.nodes.find((n) => n.id === ownProvince.id);
    // The server sends `warehouse: 0` for an own node (a vision source): a province still has none.
    expect(node?.warehouse).toBe(0);
    const layers = createLayers();
    const view = new CityView(pool, layers, 0, 1, testSprites());
    view.update(snapshot, null, UPGRADES);
    const bar = barOf(layers.layer.nodes, ownProvince.id);
    expect(bar.visible).toBe(false);
    expect(bar.spec).toBeNull();
    view.destroy();
  });

  it('has no VP badge and no queue or barracks mark', () => {
    if (ownProvince === undefined) throw new Error('no province');
    // Even a map file that gave a province a VP draws none (DEC-23: a province has no VP).
    const forged: MapFile = {
      ...pool,
      nodes: pool.nodes.map((n) => (n.id === ownProvince.id ? { ...n, vp: 2 } : n)),
    };
    const layers = createLayers();
    const view = new CityView(forged, layers, 0, 1, testSprites());
    view.update(snapshot, null, UPGRADES);
    const container = city(layers.layer.nodes, ownProvince.id);
    // body, ring, bar, queue and the barracks house: no badge after them.
    expect(container.children).toHaveLength(5);
    expect(barracksMark(layers.layer.nodes, ownProvince.id)).toBeNull();
    view.destroy();
  });
});
