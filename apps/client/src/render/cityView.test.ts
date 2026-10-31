import type { Container } from 'pixi.js';
import { setReducedMotion } from './motion.ts';
import { buildMark, queueMark } from './progressLayout.ts';
import type { BakedSprite } from './bake.ts';
import {
  barracksSpec,
  buildMarkSpec,
  cityBodySpec,
  progressAlertSpec,
  provinceBodySpec,
  queueMarkSpec,
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

describe('CityView: a province is a pale dot (PB, #431, DEC-23)', () => {
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

  it('is drawn as a dot, not as a city body, in every state of ownership', () => {
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
    // body, ring, bar, queue, build, the alert ring and the barracks house: no badge after them.
    expect(container.children).toHaveLength(7);
    expect(barracksMark(layers.layer.nodes, ownProvince.id)).toBeNull();
    view.destroy();
  });
});

describe('CityView: progress cells of an own city (variant A, #439)', () => {
  const rules = { unitTicks: DEV_RULES.recruit.unit_ticks, queueMax: DEV_RULES.recruit.queue_max };
  const base = devSnapshot(map, DEV_RULES, 100);
  const own = base.view.nodes.find((n) => n.owner === 0 && n.has_barracks === true);
  const foreign = base.view.nodes.find((n) => n.owner === 1);
  if (own === undefined || foreign === undefined) throw new Error('no cities to look at');
  const NOW = base.tick;
  const ownId = own.id;

  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setReducedMotion(null);
  });

  /** The snapshot with the own city changed, and optionally a fight in it. */
  function withCity(change: Partial<NodeView>, fight = false): SnapshotMsg {
    const nodes = base.view.nodes.map((n) => (n.id === ownId ? { ...n, ...change } : n));
    const fights = fight ? [{ ...FIGHT, node: ownId }] : [];
    return { ...base, view: { ...base.view, nodes, fights } };
  }
  const FIGHT = {
    id: 'f',
    node: null,
    edge: null,
    point: null,
    attacker: 1,
    start_tick: 0,
    next_round_tick: 0,
    groups: [],
    enemy_units: 0,
    enemy_charged: 0,
    shots: [0, 0],
    losses: [0, 0],
    virtual_left: [0, 0],
    mute: [0, 0],
    last_round: null,
  } as unknown as SnapshotMsg['view']['fights'][number];

  const sprite = (nodes: Container, id: number, label: string): BakedSprite => {
    const city = nodes.children.find((c) => c.label === `node-${String(id)}`) as Container;
    return city.children.find((c) => c.label === label) as BakedSprite;
  };
  const make = (): { view: CityView; nodes: Container } => {
    const layers = createLayers();
    return { view: new CityView(map, layers, 0, 1, testSprites()), nodes: layers.layer.nodes };
  };

  it('draws the queue as cells: the first by its progress, the rest queued', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ recruit_queue: 3, recruit_progress: 15 }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    const plate = queueMark({
      count: 3,
      progress: 15,
      unitTicks: rules.unitTicks,
      waiting: false,
      paused: false,
      slots: 0,
    });
    if (plate === null) throw new Error('no plate');
    const queue = sprite(nodes, own.id, 'queue');
    expect(queue.visible).toBe(true);
    expect(queue.spec?.key).toBe(queueMarkSpec(plate).key);
    expect(sprite(nodes, own.id, 'progress-alert').visible).toBe(false);
    view.destroy();
  });

  it('shows no queue plate for an empty queue, and none on a foreign city', () => {
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 0 }), rules.unitTicks, UPGRADES, rules.queueMax);
    expect(sprite(nodes, own.id, 'queue').visible).toBe(false);
    expect(sprite(nodes, foreign.id, 'queue').visible).toBe(false);
    view.destroy();
  });

  it('shows the free slots, dashed, only on the selected city', () => {
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 1 }), rules.unitTicks, UPGRADES, rules.queueMax);
    const queue = sprite(nodes, own.id, 'queue');
    const plain = queue.spec?.key;
    view.setSelected(own.id);
    expect(queue.spec?.key).not.toBe(plain);
    expect(queue.spec?.key).toContain('qss');
    // Another selection takes the slots away again.
    view.setSelected(foreign.id);
    expect(queue.spec?.key).toBe(plain);
    view.setSelected(own.id);
    view.setSelected(null);
    expect(queue.spec?.key).toBe(plain);
    view.destroy();
  });

  it('shows the free slots of an empty queue of the selected city, but not where it cannot recruit', () => {
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 0 }), rules.unitTicks, UPGRADES, rules.queueMax);
    view.setSelected(own.id);
    expect(sprite(nodes, own.id, 'queue').visible).toBe(true);
    expect(sprite(nodes, own.id, 'queue').spec?.key).toBe('queue:sss');
    // The same city without a barracks (the city development is on): the menu has no recruit.
    view.update(
      withCity({ recruit_queue: 0, has_barracks: false }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(sprite(nodes, own.id, 'queue').visible).toBe(false);
    view.destroy();
  });

  it('rings the first cell of a unit that is ready with no room', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ recruit_queue: 2, recruit_progress: rules.unitTicks, recruit_waiting: true }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    const ring = sprite(nodes, own.id, 'progress-alert');
    expect(ring.visible).toBe(true);
    expect(ring.spec?.key).toBe(progressAlertSpec(16 + 2 * 2, 10 + 2 * 2).key);
    // The ready cell is solid, the one behind it queued.
    expect(sprite(nodes, own.id, 'queue').spec?.key).toBe('queue:rq');
    view.destroy();
  });

  it('rings the production stopped by a fight in the city, and only while the fight lasts', () => {
    const { view, nodes } = make();
    const change = { recruit_queue: 2, recruit_progress: 10 };
    view.update(withCity(change, true), rules.unitTicks, UPGRADES, rules.queueMax);
    const ring = sprite(nodes, own.id, 'progress-alert');
    expect(ring.visible).toBe(true);
    // The progress cell keeps showing how far the unit got.
    expect(sprite(nodes, own.id, 'queue').spec?.key).toBe('queue:a4q');
    view.update(withCity(change, false), rules.unitTicks, UPGRADES, rules.queueMax);
    expect(ring.visible).toBe(false);
    view.destroy();
  });

  it('a fight on a road is not a fight in the city', () => {
    const { view, nodes } = make();
    const road = { ...FIGHT, id: 'r', node: null, edge: 0, point: 1000 };
    const snapshot = withCity({ recruit_queue: 2, recruit_progress: 10 });
    view.update(
      { ...snapshot, view: { ...snapshot.view, fights: [road] } },
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(sprite(nodes, own.id, 'progress-alert').visible).toBe(false);
    view.destroy();
  });

  it('draws a barracks and a warehouse build with the same plate, told by the badge', () => {
    const { view, nodes } = make();
    const left = (ticks: number) => ({ done_tick: NOW + ticks, owed: 0 });
    view.update(
      withCity({ building: { kind: 'barracks', ...left(50) } }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    const build = sprite(nodes, own.id, 'build');
    expect(build.visible).toBe(true);
    expect(build.spec?.key).toBe(buildMarkSpec(buildMark('barracks', 0.5)).key);
    const y = build.y;
    view.update(
      withCity({ building: { kind: 'warehouse', ...left(50) } }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(build.spec?.key).toBe(buildMarkSpec(buildMark('warehouse', 0.5)).key);
    expect(build.y).toBe(y);
    view.destroy();
  });

  it('stacks the build plate above the queue plate', () => {
    const { view, nodes } = make();
    view.update(
      withCity({
        recruit_queue: 1,
        recruit_progress: 5,
        building: { kind: 'warehouse', done_tick: NOW + 20, owed: 0 },
      }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(sprite(nodes, own.id, 'build').y).toBeLessThan(sprite(nodes, own.id, 'queue').y);
    view.destroy();
  });

  it('draws no build plate without the city development, or for a road build', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ building: { kind: 'warehouse', done_tick: NOW + 20, owed: 0 } }),
      rules.unitTicks,
      null,
      rules.queueMax,
    );
    expect(sprite(nodes, own.id, 'build').visible).toBe(false);
    view.update(
      withCity({ building: { kind: 'road', done_tick: NOW + 20, owed: 0 } }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(sprite(nodes, own.id, 'build').visible).toBe(false);
    view.destroy();
  });

  it('clamps a build that is past its end or has not started', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ building: { kind: 'barracks', done_tick: NOW - 5, owed: 0 } }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(sprite(nodes, own.id, 'build').spec?.key).toBe(
      buildMarkSpec(buildMark('barracks', 1)).key,
    );
    view.update(
      withCity({ building: { kind: 'barracks', done_tick: NOW + 500, owed: 0 } }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(sprite(nodes, own.id, 'build').spec?.key).toBe(
      buildMarkSpec(buildMark('barracks', 0)).key,
    );
    view.destroy();
  });

  it('hides the marks in the Supply view and brings them back', () => {
    const { view, nodes } = make();
    view.update(
      withCity({
        recruit_queue: 1,
        recruit_waiting: true,
        recruit_progress: rules.unitTicks,
        building: { kind: 'warehouse', done_tick: NOW + 20, owed: 0 },
      }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    const marks = ['queue', 'build', 'progress-alert'].map((l) => sprite(nodes, own.id, l));
    expect(marks.map((m) => m.visible)).toEqual([true, true, true]);
    view.setSupplyMode(true);
    expect(marks.map((m) => m.visible)).toEqual([false, false, false]);
    view.setSupplyMode(false);
    expect(marks.map((m) => m.visible)).toEqual([true, true, true]);
    view.destroy();
  });

  it('pulses the ring, and holds it steady with "less motion"', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ recruit_queue: 1, recruit_waiting: true, recruit_progress: rules.unitTicks }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    const ring = sprite(nodes, own.id, 'progress-alert');
    setReducedMotion(false);
    view.pulse(0);
    const low = ring.alpha;
    view.pulse(400);
    expect(ring.alpha).toBeGreaterThan(low);
    setReducedMotion(true);
    view.pulse(0);
    expect(ring.alpha).toBe(1);
    view.destroy();
  });
});

describe('CityView: a captured city cross-fades its body (#508)', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  const captured = (snapshot: SnapshotMsg, id: number): SnapshotMsg => ({
    ...snapshot,
    view: {
      ...snapshot.view,
      nodes: snapshot.view.nodes.map((n) => (n.id === id ? { ...n, owner: 1 } : n)),
    },
  });

  it('keeps the old body over the new one, fading out, and removes it', () => {
    const snapshot = devSnapshot(map, DEV_RULES, 100);
    const own = snapshot.view.nodes.find(
      (n) => n.owner === 0 && map.nodes[n.id]?.kind !== 'province',
    );
    if (own === undefined) throw new Error('no own city');
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    const nodes = layers.layer.nodes;
    view.update(snapshot);
    const before = city(nodes, own.id).children.length;
    expect(bodyOf(nodes, own.id).spec?.key).toBe(
      cityBodySpec(
        'you',
        view.radiusOf(own.id),
        own.id === map.nodes.find((n) => n.capital_of === 0)?.id,
      ).key,
    );

    view.update(captured(snapshot, own.id));
    const body = city(nodes, own.id);
    expect(body.children.length).toBe(before + 1);
    const ghost = body.children[1] as BakedSprite;
    expect(ghost.alpha).toBe(1);
    expect(ghost.spec?.key).not.toBe(bodyOf(nodes, own.id).spec?.key);
    view.advance(100);
    expect(ghost.alpha).toBeLessThan(1);
    expect(ghost.alpha).toBeGreaterThan(0);
    view.advance(2000);
    expect(city(nodes, own.id).children.length).toBe(before);
    view.destroy();
  });

  it('shows the first snapshot and "less motion" with no fade', () => {
    const snapshot = devSnapshot(map, DEV_RULES, 100);
    const own = snapshot.view.nodes.find(
      (n) => n.owner === 0 && map.nodes[n.id]?.kind !== 'province',
    );
    if (own === undefined) throw new Error('no own city');
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    view.update(snapshot);
    setReducedMotion(true);
    const before = city(layers.layer.nodes, own.id).children.length;
    view.update(captured(snapshot, own.id));
    expect(city(layers.layer.nodes, own.id).children.length).toBe(before);
    setReducedMotion(null);
    view.destroy();
  });
});
