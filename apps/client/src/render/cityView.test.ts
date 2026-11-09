import type { Container } from 'pixi.js';
import { setReducedMotion } from './motion.ts';
import { buildMark } from './progressLayout.ts';
import type { BakedSprite } from './bake.ts';
import { buildMarkSpec, cityBodySpec, provinceBodySpec, stockColor } from './bakedShapes.ts';
import { pipAlertSpec, towerBackSpec, warehouseMarksSpec } from './pieceShapes.ts';
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

/** The barracks tower of the city `id` (#847): the baked back it shows (`null`: none drawn). */
function barracksMark(nodes: Container, id: number): string | null {
  const city = nodes.children.find((c) => c.label === `node-${String(id)}`) as Container;
  const tower = city.children.find((c) => c.label === 'tower-barracks') as Container;
  const back = tower.children[0] as BakedSprite;
  return tower.visible ? (back.spec?.key ?? null) : null;
}

describe('CityView: the barracks of an enemy city next door (DEC-31)', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws the same tower as on an own city, hatched as the enemy, and drops it when no longer next door', () => {
    const snapshot = devSnapshot(map, DEV_RULES, 100);
    const own = snapshot.view.nodes.find((n) => n.owner === 0 && n.has_barracks === true);
    const enemy = map.nodes.find((n) => n.start_owner === 1 && n.kind !== 'province');
    expect(own).toBeDefined();
    expect(enemy).toBeDefined();
    if (own === undefined || enemy === undefined) return;
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    const nodes = layers.layer.nodes;

    // Next to an own node, barracks built: the same tower as on an own city (its shape says
    // «barracks»); the owner's hatch, at 45 degrees for the enemy, says whose.
    view.update(withBarracks(snapshot, enemy.id, true), null, UPGRADES);
    const drawn = barracksMark(nodes, enemy.id);
    expect(drawn).toBe(towerBackSpec('barracks', 'built', ENEMY, true).key);
    expect(barracksMark(nodes, own.id)).toBe(towerBackSpec('barracks', 'built', YOU, false).key);

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
        warehouseMarksSpec(cap, 1, stockColor('you'), (top - level) * gain).key,
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
      warehouseMarksSpec(
        own.warehouse_cap ?? own.capacity,
        own.warehouse ?? 0,
        stockColor('you'),
        0,
      ).key,
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
      warehouseMarksSpec(foreign.warehouse, foreign.warehouse, stockColor('enemy'), 0).key,
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
    expect(bodyOf(nodes, ownProvince.id).spec?.key).toMatch(/^province:you:/);
    expect(bodyOf(nodes, neutralProvince.id).spec?.key).toBe(provinceBodySpec('neutral').key);
    expect(bodyOf(nodes, ownCity.id).spec?.key).toMatch(
      new RegExp(`^${cityBodySpec('you', view.radiusOf(ownCity.id), false).key}`),
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
    // body, ring, warehouse, the crown, the paid lozenges, tower and ring of the barracks and of the
    // factory, the recruits, the build plate, the alert ring, the bunker badge and the plate of its
    // build: no VP badge after them.
    expect(container.children).toHaveLength(16);
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

  /** The recruits of a city (#847, 55k Pips): the small helmets shown. */
  const recruits = (nodes: Container, id: number): Container[] => {
    const layer = (
      nodes.children.find((c) => c.label === `node-${String(id)}`) as Container
    ).children.find((c) => c.label === 'recruits') as Container;
    return layer.children.filter((c) => c.visible);
  };
  /** The back of a recruit's helmet: `solid` (in the queue) or `dashed` (a free slot). */
  const look = (pip: Container): string =>
    ((pip.children[0] as BakedSprite).spec?.key ?? '').includes(':dashed') ? 'free' : 'unit';
  const level = (pip: Container): boolean => (pip.children[1] as BakedSprite).visible;
  const tower = (nodes: Container, id: number, kind: string): Container =>
    (nodes.children.find((c) => c.label === `node-${String(id)}`) as Container).children.find(
      (c) => c.label === `tower-${kind}`,
    ) as Container;

  it('draws the queue as small helmets on the ring: the first fills, the rest are hatched', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ recruit_queue: 3, recruit_progress: 15 }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    const pips = recruits(nodes, own.id);
    expect(pips.map(look)).toEqual(['unit', 'unit', 'unit']);
    expect(pips.map(level)).toEqual([true, false, false]);
    expect(sprite(nodes, own.id, 'progress-alert').visible).toBe(false);
    view.destroy();
  });

  it('shows no recruits for an empty queue, and none on a foreign city', () => {
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 0 }), rules.unitTicks, UPGRADES, rules.queueMax);
    expect(recruits(nodes, own.id)).toHaveLength(0);
    expect(recruits(nodes, foreign.id)).toHaveLength(0);
    view.destroy();
  });

  it('shows the free slots, beaded, only on the selected city', () => {
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 1 }), rules.unitTicks, UPGRADES, rules.queueMax);
    expect(recruits(nodes, own.id).map(look)).toEqual(['unit']);
    view.setSelected(own.id);
    const free = Array.from({ length: rules.queueMax - 1 }, () => 'free');
    expect(recruits(nodes, own.id).map(look)).toEqual(['unit', ...free]);
    // Another selection takes the slots away again.
    view.setSelected(foreign.id);
    expect(recruits(nodes, own.id).map(look)).toEqual(['unit']);
    view.setSelected(own.id);
    view.setSelected(null);
    expect(recruits(nodes, own.id).map(look)).toEqual(['unit']);
    view.destroy();
  });

  it('shows the free slots of an empty queue of the selected city, but not where it cannot recruit', () => {
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 0 }), rules.unitTicks, UPGRADES, rules.queueMax);
    view.setSelected(own.id);
    expect(recruits(nodes, own.id).map(look)).toEqual(
      Array.from({ length: rules.queueMax }, () => 'free'),
    );
    // The same city without a barracks (the city development is on): the menu has no recruit.
    view.update(
      withCity({ recruit_queue: 0, has_barracks: false }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(recruits(nodes, own.id)).toHaveLength(0);
    view.destroy();
  });

  it('rings the first recruit when it is ready with no room, its helmet full', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ recruit_queue: 2, recruit_progress: rules.unitTicks, recruit_waiting: true }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    const ring = sprite(nodes, own.id, 'progress-alert');
    expect(ring.visible).toBe(true);
    expect(ring.spec?.key).toBe(pipAlertSpec(8).key);
    expect(recruits(nodes, own.id).map(level)).toEqual([true, false]);
    view.destroy();
  });

  it('rings the production stopped by a fight in the city, and only while the fight lasts', () => {
    const { view, nodes } = make();
    const change = { recruit_queue: 2, recruit_progress: 10 };
    view.update(withCity(change, true), rules.unitTicks, UPGRADES, rules.queueMax);
    const ring = sprite(nodes, own.id, 'progress-alert');
    expect(ring.visible).toBe(true);
    // The first helmet keeps showing how far the unit got.
    expect(recruits(nodes, own.id).map(level)).toEqual([true, false]);
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

  it('builds the barracks as a tower under the Crown arc: a plan while owed, then it fills', () => {
    const { view, nodes } = make();
    const upgrades = { ...UPGRADES, barracksCharges: 3 };
    view.update(
      withCity({ has_barracks: false, building: { kind: 'barracks', done_tick: null, owed: 2 } }),
      rules.unitTicks,
      upgrades,
      rules.queueMax,
    );
    const root = tower(nodes, own.id, 'barracks');
    const crown = sprite(nodes, own.id, 'crown-barracks');
    expect(root.visible).toBe(true);
    expect((root.children[0] as BakedSprite).spec?.key).toContain(':plan:');
    expect(crown.visible).toBe(true);
    // Three charges, one paid: the key names the cost and what is paid.
    expect(crown.spec?.key).toContain(':barracks:3:1:');
    // Paid in full: the time runs from `done_tick`, the tower fills from its base.
    view.update(
      withCity({
        has_barracks: false,
        building: { kind: 'barracks', done_tick: NOW + 50, owed: 0 },
      }),
      rules.unitTicks,
      upgrades,
      rules.queueMax,
    );
    view.setTick(NOW);
    view.advance(16);
    expect((root.children[0] as BakedSprite).spec?.key).toContain(':rising:');
    expect((root.children[1] as BakedSprite).visible).toBe(true);
    // No plate above the city for a barracks build any more.
    expect(sprite(nodes, own.id, 'build').visible).toBe(false);
    view.destroy();
  });

  it('fades the arc and opens a ring from the tower when the build is done', () => {
    setReducedMotion(false);
    const { view, nodes } = make();
    const upgrades = { ...UPGRADES, barracksCharges: 3 };
    view.update(
      withCity({
        has_barracks: false,
        building: { kind: 'barracks', done_tick: NOW + 5, owed: 0 },
      }),
      rules.unitTicks,
      upgrades,
      rules.queueMax,
    );
    view.update(withCity({ has_barracks: true, building: null }), rules.unitTicks, upgrades);
    const ring = sprite(nodes, own.id, 'tower-ring-barracks');
    const crown = sprite(nodes, own.id, 'crown-barracks');
    expect(ring.visible).toBe(true);
    view.advance(200);
    expect(crown.alpha).toBeLessThan(1);
    view.advance(2000);
    expect(ring.visible).toBe(false);
    expect(crown.visible).toBe(false);
    expect((tower(nodes, own.id, 'barracks').children[0] as BakedSprite).spec?.key).toContain(
      ':built:',
    );
    view.destroy();
  });

  it('flies a paid charge into the arc, pops it, then runs the lozenges into the tower (#872)', () => {
    setReducedMotion(false);
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    const nodes = layers.layer.nodes;
    const upgrades = { ...UPGRADES, barracksCharges: 3 };
    const flights = (): BakedSprite[] =>
      (
        layers.layer.effects.children.find((c) => c.label === 'build-pay') as Container
      ).children.filter((c) => c.visible) as BakedSprite[];
    const loose = (): Container =>
      (nodes.children.find((c) => c.label === `node-${String(ownId)}`) as Container).children.find(
        (c) => c.label === 'pay-barracks',
      ) as Container;
    const paid = (tick: number, warehouse: number, units: number, owed: number) => ({
      type: 'event' as const,
      tick,
      kind: 'build_paid',
      data: { player: 0, node: ownId, kind: 'barracks', warehouse, units, owed },
    });
    // The second charge of three is paid at NOW from the warehouse.
    view.update(
      withCity({ has_barracks: false, building: { kind: 'barracks', done_tick: null, owed: 1 } }),
      rules.unitTicks,
      upgrades,
      rules.queueMax,
    );
    const events = [paid(NOW, 1, 0, 1)];
    const frame = (tick: number): void => {
      view.setTick(tick);
      view.setPayments(events, 10, () => null);
      view.advance(16);
    };
    const crown = sprite(nodes, own.id, 'crown-barracks');
    frame(NOW + 2);
    expect(flights()).toHaveLength(1);
    // In the air its lozenge is still owed: one of three shown paid.
    expect(crown.spec?.key).toContain(':barracks:3:1:');
    frame(NOW + 5.5);
    expect(flights()).toHaveLength(0);
    expect(crown.spec?.key).toContain(':barracks:3:2:');
    expect(loose().visible).toBe(true);
    // Paid in full by the group standing there: the last flight lands, the lozenges run in.
    view.update(
      {
        ...withCity({
          has_barracks: false,
          building: { kind: 'barracks', done_tick: NOW + 110, owed: 0 },
        }),
        tick: NOW + 10,
      },
      rules.unitTicks,
      upgrades,
      rules.queueMax,
    );
    events.push(paid(NOW + 10, 0, 1, 0));
    frame(NOW + 12);
    expect(flights()).toHaveLength(1);
    expect((tower(nodes, own.id, 'barracks').children[0] as BakedSprite).spec?.key).toContain(
      ':plan:',
    );
    frame(NOW + 16);
    expect(flights()).toHaveLength(0);
    expect(loose().visible).toBe(true);
    expect((tower(nodes, own.id, 'barracks').children[0] as BakedSprite).spec?.key).toContain(
      ':rising:',
    );
    frame(NOW + 40);
    expect(loose().visible).toBe(false);
    view.destroy();
  });

  it('moves nothing with "less motion": the state of the snapshot at once', () => {
    setReducedMotion(true);
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    view.update(
      withCity({ has_barracks: false, building: { kind: 'barracks', done_tick: null, owed: 1 } }),
      rules.unitTicks,
      { ...UPGRADES, barracksCharges: 3 },
      rules.queueMax,
    );
    const event = {
      type: 'event' as const,
      tick: NOW,
      kind: 'build_paid',
      data: { player: 0, node: ownId, kind: 'barracks', warehouse: 1, units: 0, owed: 1 },
    };
    view.setTick(NOW + 2);
    view.setPayments([event], 10, () => null);
    view.advance(16);
    const layer = layers.layer.effects.children.find((c) => c.label === 'build-pay') as Container;
    expect(layer.children.filter((c) => c.visible)).toHaveLength(0);
    expect(sprite(layers.layer.nodes, own.id, 'crown-barracks').spec?.key).toContain(
      ':barracks:3:2:',
    );
    view.destroy();
  });

  it('keeps the plate of a warehouse build (economy v1)', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ building: { kind: 'warehouse', done_tick: NOW + 50, owed: 0 } }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    const build = sprite(nodes, own.id, 'build');
    expect(build.visible).toBe(true);
    expect(build.spec?.key).toBe(buildMarkSpec(buildMark('warehouse', 0.5)).key);
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
      withCity({ building: { kind: 'warehouse', done_tick: NOW - 5, owed: 0 } }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(sprite(nodes, own.id, 'build').spec?.key).toBe(
      buildMarkSpec(buildMark('warehouse', 1)).key,
    );
    view.update(
      withCity({ building: { kind: 'warehouse', done_tick: NOW + 500, owed: 0 } }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(sprite(nodes, own.id, 'build').spec?.key).toBe(
      buildMarkSpec(buildMark('warehouse', 0)).key,
    );
    view.destroy();
  });

  it('hides the queue, the build and the alert in the Supply view (Canal keeps the towers) and brings them back', () => {
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
    const marks = ['recruits', 'build', 'progress-alert', 'tower-barracks'].map(
      (l) => sprite(nodes, own.id, l) as Container,
    );
    expect(marks.map((m) => m.visible)).toEqual([true, true, true, true]);
    view.setSupplyMode(true);
    expect(marks.map((m) => m.visible)).toEqual([false, false, false, true]);
    view.setSupplyMode(false);
    expect(marks.map((m) => m.visible)).toEqual([true, true, true, true]);
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
    expect(bodyOf(nodes, own.id).spec?.key).toMatch(
      new RegExp(
        `^${
          cityBodySpec(
            'you',
            view.radiusOf(own.id),
            own.id === map.nodes.find((n) => n.capital_of === 0)?.id,
          ).key
        }`,
      ),
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

describe('CityView: the warehouse of an own province under economy v2 (DEC-41, item 13, #679)', () => {
  const pool = BUNDLED_MAPS.find((m) => m.meta.name === 'crossroads') as MapFile;
  const snapshot = devSnapshot(pool, DEV_RULES, 100);
  const ownProvince = pool.nodes.find((n) => n.kind === 'province' && n.start_owner === 0);
  const neutralProvince = pool.nodes.find((n) => n.kind === 'province' && n.start_owner === null);

  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  /** The snapshot where province `id` holds `warehouse` charges. */
  function holding(id: number, warehouse: number): SnapshotMsg {
    const nodes = snapshot.view.nodes.map((n) => (n.id === id ? { ...n, warehouse } : n));
    return { ...snapshot, view: { ...snapshot.view, nodes } };
  }

  it('shows the places of the province warehouse and the charge a line delivered', () => {
    if (ownProvince === undefined) throw new Error('no own province');
    const layers = createLayers();
    const view = new CityView(pool, layers, 0, 1, testSprites());
    view.update(holding(ownProvince.id, 1), null, UPGRADES, null, 1);
    const bar = barOf(layers.layer.nodes, ownProvince.id);
    expect(bar.visible).toBe(true);
    expect(bar.spec?.key).toBe(warehouseMarksSpec(1, 1, stockColor('you'), 0).key);
    view.update(holding(ownProvince.id, 0), null, UPGRADES, null, 1);
    expect(barOf(layers.layer.nodes, ownProvince.id).spec?.key).toBe(
      warehouseMarksSpec(1, 0, stockColor('you'), 0).key,
    );
    view.destroy();
  });

  it('draws nothing under economy v1 (no province warehouse) and on a province that is not own', () => {
    if (ownProvince === undefined || neutralProvince === undefined) throw new Error('no province');
    const layers = createLayers();
    const view = new CityView(pool, layers, 0, 1, testSprites());
    view.update(holding(ownProvince.id, 1), null, UPGRADES, null, 0);
    expect(barOf(layers.layer.nodes, ownProvince.id).visible).toBe(false);
    view.update(holding(neutralProvince.id, 1), null, UPGRADES, null, 1);
    expect(barOf(layers.layer.nodes, neutralProvince.id).visible).toBe(false);
    view.destroy();
  });
});
