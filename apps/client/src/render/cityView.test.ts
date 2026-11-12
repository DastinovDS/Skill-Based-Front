import type { Container } from 'pixi.js';
import { setReducedMotion } from './motion.ts';
import type { BakedSprite } from './bake.ts';
import { cityBodySpec, cityRingSpec, provinceBodySpec, stockColor } from './bakedShapes.ts';
import { iconBackSpec, warehouseMarksSpec } from './pieceShapes.ts';
import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { BUNDLED_MAPS, DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { EventMsg, MapFile, NodeView, SnapshotMsg } from '../protocol.gen.ts';
import { CityView } from './cityView.ts';
import { createLayers } from './layers.ts';
import type { BuildingRules } from './renderRules.ts';
import { iconSize, layoutBuildings, roadAngles } from './buildingLayout.ts';
import { ENEMY, FOUNDATION, PROVINCE, YOU, playerColours } from './style.ts';
import { PLAYER_COLOURS } from '../theme/tokens.ts';
import { testSprites } from './testSprites.ts';

const map = DEFAULT_MAP;
const UPGRADES: BuildingRules = {
  barracks: { ticks: 100, charges: null },
  factory: { ticks: 0, charges: null },
};

/** The snapshot with `has_barracks` of node `id` replaced (the server decides it, DEC-31). */
function withBarracks(base: SnapshotMsg, id: number, value: boolean | null): SnapshotMsg {
  const nodes: NodeView[] = base.view.nodes.map((n) =>
    n.id === id ? { ...n, has_barracks: value } : n,
  );
  return { ...base, view: { ...base.view, nodes } };
}

/** The barracks icon of the city `id` (#847): the baked back it shows (`null`: none drawn). */
function barracksMark(nodes: Container, id: number): string | null {
  const city = nodes.children.find((c) => c.label === `node-${String(id)}`) as Container;
  const tower = city.children.find((c) => c.label === 'building-barracks') as Container;
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

  it('draws the same icon as on an own city, hatched as the enemy, and drops it when no longer next door', () => {
    const snapshot = devSnapshot(map, DEV_RULES, 100);
    const own = snapshot.view.nodes.find((n) => n.owner === 0 && n.has_barracks === true);
    const enemy = map.nodes.find((n) => n.start_owner === 1 && n.kind !== 'province');
    expect(own).toBeDefined();
    expect(enemy).toBeDefined();
    if (own === undefined || enemy === undefined) return;
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    const nodes = layers.layer.nodes;

    // Next to an own node, barracks built: the same icon as on an own city (its shape says
    // «barracks»); the owner's hatch, at 45 degrees for the enemy, says whose.
    view.update(withBarracks(snapshot, enemy.id, true), null, UPGRADES);
    const drawn = barracksMark(nodes, enemy.id);
    expect(drawn).toBe(iconBackSpec('barracks', 'built', ENEMY, true).key);
    expect(barracksMark(nodes, own.id)).toBe(iconBackSpec('barracks', 'built', YOU, false).key);

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

  it('inks the icon in when the view turns it on, with no ring, ticks or toast (#972); not for an unknown to a known', () => {
    setReducedMotion(false);
    const snapshot = devSnapshot(map, DEV_RULES, 100);
    const enemy = map.nodes.find((n) => n.start_owner === 1 && n.kind !== 'province');
    if (enemy === undefined) throw new Error('the map has no such city');
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    const nodes = layers.layer.nodes;
    const container = city(nodes, enemy.id);
    const root = container.children.find((c) => c.label === 'building-barracks') as Container;
    const ticks = container.children.find((c) => c.label === 'building-ticks-barracks');
    // Not adjacent (`null`) to built: it just appears.
    view.update(withBarracks(snapshot, enemy.id, null), null, UPGRADES);
    view.update(withBarracks(snapshot, enemy.id, true), null, UPGRADES);
    expect(root.alpha).toBe(1);
    // Known to have none (`false`), then built: a quiet ink-in.
    view.update(withBarracks(snapshot, enemy.id, false), null, UPGRADES);
    view.update(withBarracks(snapshot, enemy.id, true), null, UPGRADES);
    expect(root.alpha).toBe(0);
    view.advance(200);
    expect(root.alpha).toBeGreaterThan(0);
    expect(root.alpha).toBeLessThan(1);
    view.advance(400);
    expect(root.alpha).toBe(1);
    expect(ticks?.visible).toBe(false);
    view.destroy();
  });
});

describe('CityView in the players colours (DEC-49)', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('fills each city and building with the colour of its owner by player id; the shape tells the side', () => {
    const snapshot = devSnapshot(map, DEV_RULES, 100);
    const own = snapshot.view.nodes.find((n) => n.owner === 0 && n.has_barracks === true);
    const enemy = map.nodes.find((n) => n.start_owner === 1 && n.kind !== 'province');
    if (own === undefined || enemy === undefined) throw new Error('the map has no such cities');
    const layers = createLayers();
    // Player 0 chose Shell, player 1 Violet: the viewer is player 0.
    const colours = playerColours(0, ['shell', 'violet']);
    const view = new CityView(map, layers, 0, 1, testSprites(), colours);
    view.update(withBarracks(snapshot, enemy.id, true), null, UPGRADES);
    const nodes = layers.layer.nodes;
    expect(bodyOf(nodes, own.id).spec?.key).toMatch(
      new RegExp(`^city:you:${String(PLAYER_COLOURS.shell)}:`),
    );
    expect(bodyOf(nodes, enemy.id).spec?.key).toMatch(
      new RegExp(`^city:enemy:${String(PLAYER_COLOURS.violet)}:`),
    );
    expect(barracksMark(nodes, own.id)).toBe(
      iconBackSpec('barracks', 'built', PLAYER_COLOURS.shell, false).key,
    );
    expect(barracksMark(nodes, enemy.id)).toBe(
      iconBackSpec('barracks', 'built', PLAYER_COLOURS.violet, true).key,
    );
    view.destroy();
  });

  it('bakes one look per colour: the same city of another colour is another sprite', () => {
    const a = cityBodySpec('you', 14, false, false, PLAYER_COLOURS.glacier).key;
    const b = cityBodySpec('you', 14, false, false, PLAYER_COLOURS.madder).key;
    expect(a).not.toBe(b);
    // Without a colour, today's look (the viewer Lapis, the opponent Minium).
    expect(cityBodySpec('you', 14, false).key).toBe(cityBodySpec('you', 14, false, false, YOU).key);
    expect(provinceBodySpec('enemy').key).toBe(provinceBodySpec('enemy', false, ENEMY).key);
    expect(stockColor('neutral', PLAYER_COLOURS.shell)).not.toBe(PLAYER_COLOURS.shell);
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

  it('draws no dashed place without city development: the warehouse is the capacity', () => {
    if (own === undefined) throw new Error('no own city');
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    view.update(snapshot, null, null);
    const bar = barOf(layers.layer.nodes, own.id);
    expect(bar.spec?.key).toBe(
      warehouseMarksSpec(own.warehouse_cap ?? own.capacity, own.warehouse ?? 0, stockColor('you'))
        .key,
    );
    view.destroy();
  });

  it('shows a foreign city only the charges (no frame): its capacity is hidden', () => {
    if (foreign === undefined || foreign.warehouse === null) throw new Error('no foreign city');
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    view.update(snapshot, null, UPGRADES);
    const bar = barOf(layers.layer.nodes, foreign.id);
    expect(bar.spec?.key).toBe(
      warehouseMarksSpec(foreign.warehouse, foreign.warehouse, stockColor('enemy')).key,
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
    // body, ring, warehouse, then per building (the barracks, the factory): the owed row, the icon, the
    // paying lozenges, the done ring and the ticks; no foundation (it never recruits) and no VP
    // badge after them.
    expect(container.children).toHaveLength(13);
    expect(barracksMark(layers.layer.nodes, ownProvince.id)).toBeNull();
    view.destroy();
  });
});

describe("CityView: the recruit queue on the barracks' foundation (#1005, D2) and the builds", () => {
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

  const tower = (nodes: Container, id: number, kind: string): Container =>
    (nodes.children.find((c) => c.label === `node-${String(id)}`) as Container).children.find(
      (c) => c.label === `building-${kind}`,
    ) as Container;
  /** The row of owed charges by a building (#954): the lozenges shown, and how many of them are paid. */
  const owedRow = (nodes: Container, id: number, kind: string): { shown: number; paid: number } => {
    const row = (
      nodes.children.find((c) => c.label === `node-${String(id)}`) as Container
    ).children.find((c) => c.label === `owed-${kind}`) as Container;
    const marks = row.visible ? (row.children.filter((c) => c.visible) as BakedSprite[]) : [];
    return {
      shown: marks.length,
      paid: marks.filter((m) => (m.spec?.key ?? '').startsWith('owed:paid')).length,
    };
  };

  /** The barracks' foundation of a city (#1005, D2): `null` when it is not on the map. */
  const foundation = (nodes: Container, id: number): Container | null => {
    const found = city(nodes, id).children.find((c) => c.label === 'foundation');
    return found !== undefined && found.visible ? found : null;
  };
  /** What each socket of the foundation shows: `made` (the unit under way or made), `queued`, `free`, `empty`. */
  const sockets = (nodes: Container, id: number): string[] => {
    const root = foundation(nodes, id);
    if (root === null) return [];
    const layer = (label: string): BakedSprite[] =>
      (root.children.find((c) => c.label === label) as Container).children as BakedSprite[];
    const recesses = layer('recesses').filter((_, i) => i % 2 === 0 && _.visible);
    const cells = layer('cells').filter((_, i) => i % 2 === 0);
    return recesses.map((recess, j) => {
      const cell = cells[j];
      if (cell !== undefined && cell.visible) {
        return (cell.spec?.key ?? '').startsWith('socket:queued') ? 'queued' : 'made';
      }
      return recess.spec?.key === 'socket:free' ? 'free' : 'empty';
    });
  };
  /** The amber rim of a foundation that asks for a look (no room, or a fight in the city). */
  const rim = (nodes: Container, id: number): boolean => {
    const root = foundation(nodes, id);
    return (
      root?.children.some(
        (c) => c.visible && ((c as BakedSprite).spec?.key ?? '').startsWith('foundation-alert'),
      ) ?? false
    );
  };
  /** The made part of the unit under way: the share of its socket it fills. */
  const made = (nodes: Container, id: number): number => {
    const root = foundation(nodes, id);
    const fill = root?.children.find(
      (c) => c.visible && ((c as BakedSprite).spec?.key ?? '').startsWith('socket-fill'),
    );
    return fill === undefined ? 0 : fill.scale.x;
  };
  /** The swing of the barracks onto its foundation, played to its end. */
  const settle = (view: CityView): void => {
    view.advance(FOUNDATION.swingMs + 20);
  };

  it('stands the barracks on its foundation while the city recruits: the unit under way, the rest hatched', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ recruit_queue: 2, recruit_progress: 15 }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(sockets(nodes, own.id)).toEqual(['made', 'queued', 'empty']);
    expect(made(nodes, own.id)).toBeCloseTo(15 / rules.unitTicks, 9);
    expect(rim(nodes, own.id)).toBe(false);
    // One piece: the barracks stands where its foundation does.
    const root = foundation(nodes, own.id);
    const barracks = tower(nodes, own.id, 'barracks');
    expect(root?.x).toBeCloseTo(barracks.x, 9);
    expect(root?.y).toBeCloseTo(barracks.y, 9);
    view.destroy();
  });

  it('shows no foundation for an empty queue, and none on a foreign city', () => {
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 0 }), rules.unitTicks, UPGRADES, rules.queueMax);
    expect(foundation(nodes, own.id)).toBeNull();
    expect(foundation(nodes, foreign.id)).toBeNull();
    view.destroy();
  });

  it('dashes the free sockets only on the selected city', () => {
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 1 }), rules.unitTicks, UPGRADES, rules.queueMax);
    expect(sockets(nodes, own.id)).toEqual(['made', 'empty', 'empty']);
    view.setSelected(own.id);
    expect(sockets(nodes, own.id)).toEqual(['made', 'free', 'free']);
    // Another selection takes the slots away again.
    view.setSelected(foreign.id);
    expect(sockets(nodes, own.id)).toEqual(['made', 'empty', 'empty']);
    view.destroy();
  });

  it('stands the barracks on its foundation for a selected city with no queue, but not where it cannot recruit', () => {
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 0 }), rules.unitTicks, UPGRADES, rules.queueMax);
    view.setSelected(own.id);
    settle(view);
    expect(sockets(nodes, own.id)).toEqual(['free', 'free', 'free']);
    // The same city without a barracks (the city development is on): the menu has no recruit.
    view.update(
      withCity({ recruit_queue: 0, has_barracks: false }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    settle(view);
    expect(foundation(nodes, own.id)).toBeNull();
    view.destroy();
  });

  it('swings the barracks round the city onto its foundation and back when the queue empties', () => {
    setReducedMotion(false);
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 0 }), rules.unitTicks, UPGRADES, rules.queueMax);
    const barracks = tower(nodes, own.id, 'barracks');
    const rest = { x: barracks.x, y: barracks.y };
    view.update(withCity({ recruit_queue: 1 }), rules.unitTicks, UPGRADES, rules.queueMax);
    // On its way: the foundation comes in only at the end of the swing.
    view.advance(FOUNDATION.swingMs / 2);
    const half = { x: barracks.x, y: barracks.y };
    expect(Math.hypot(half.x - rest.x, half.y - rest.y)).toBeGreaterThan(0);
    settle(view);
    const seat = { x: barracks.x, y: barracks.y };
    expect(Math.hypot(seat.x - half.x, seat.y - half.y)).toBeGreaterThan(0);
    expect(foundation(nodes, own.id)?.alpha).toBe(1);
    view.update(withCity({ recruit_queue: 0 }), rules.unitTicks, UPGRADES, rules.queueMax);
    settle(view);
    expect(foundation(nodes, own.id)).toBeNull();
    expect(barracks.x).toBeCloseTo(rest.x, 9);
    expect(barracks.y).toBeCloseTo(rest.y, 9);
    view.destroy();
  });

  it('rims the foundation in amber when the unit made has no room, its socket full', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ recruit_queue: 2, recruit_progress: rules.unitTicks, recruit_waiting: true }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    expect(rim(nodes, own.id)).toBe(true);
    expect(sockets(nodes, own.id)).toEqual(['made', 'queued', 'empty']);
    expect(made(nodes, own.id)).toBe(1);
    view.destroy();
  });

  it('rims the production stopped by a fight in the city, and only while the fight lasts', () => {
    const { view, nodes } = make();
    const change = { recruit_queue: 2, recruit_progress: 10 };
    view.update(withCity(change, true), rules.unitTicks, UPGRADES, rules.queueMax);
    expect(rim(nodes, own.id)).toBe(true);
    // The first socket keeps showing how far the unit got.
    expect(made(nodes, own.id)).toBeCloseTo(10 / rules.unitTicks, 9);
    view.update(withCity(change, false), rules.unitTicks, UPGRADES, rules.queueMax);
    expect(rim(nodes, own.id)).toBe(false);
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
    expect(rim(nodes, own.id)).toBe(false);
    view.destroy();
  });

  it('holds the ring cell of a made unit empty while it drops in from its socket, then fills it (#1005)', () => {
    setReducedMotion(false);
    const { view, nodes } = make();
    const garrison = base.view.groups
      .filter((g) => g.location.kind === 'node' && g.location.node === ownId)
      .reduce((sum, g) => sum + g.units, 0);
    const capacity = own.capacity;
    if (garrison < 1 || capacity <= garrison) throw new Error('the city needs a garrison and room');
    const snapshot = withCity({ recruit_queue: 1, recruit_progress: 3 });
    view.update(snapshot, rules.unitTicks, UPGRADES, rules.queueMax);
    const ring = city(nodes, ownId).children[1] as BakedSprite;
    const radius = view.radiusOf(ownId);
    const full = cityRingSpec(radius, capacity, garrison).key;
    expect(ring.spec?.key).toBe(full);
    const recruited: EventMsg = {
      type: 'event',
      tick: NOW,
      kind: 'recruited',
      data: { player: 0, node: ownId, group: 'g-new' },
    };
    // 0.2 s after the event the unit is on its way: the ring shows the garrison without it.
    view.setTick(NOW + 2);
    view.setRecruits([recruited], 10);
    view.advance(16);
    expect(ring.spec?.key).toBe(cityRingSpec(radius, capacity, garrison - 1).key);
    const drop = city(nodes, ownId).children.find((c) => c.label === 'recruit-drop');
    expect(drop?.visible).toBe(true);
    // Landed: the cell is the garrison's again and flashes.
    view.setTick(NOW + 7);
    view.setRecruits([recruited], 10);
    view.advance(16);
    expect(ring.spec?.key).toBe(full);
    expect(drop?.visible).toBe(true);
    // Over.
    view.setTick(NOW + 20);
    view.setRecruits([recruited], 10);
    view.advance(16);
    expect(drop?.visible).toBe(false);
    // A unit that walks to the rally point never drops into the ring.
    const walk: EventMsg = {
      type: 'event',
      tick: NOW + 20,
      kind: 'rally_walk_paid',
      data: { player: 0, group: 'g-walk', node: ownId, target: 0, cost: 50 },
    };
    const walker: EventMsg = {
      ...recruited,
      tick: NOW + 20,
      data: { ...recruited.data, group: 'g-walk' },
    };
    view.update({ ...snapshot, tick: NOW + 20 }, rules.unitTicks, UPGRADES, rules.queueMax);
    view.setTick(NOW + 22);
    view.setRecruits([recruited, walker, walk], 10);
    view.advance(16);
    expect(ring.spec?.key).toBe(full);
    expect(drop?.visible).toBe(false);
    view.destroy();
  });

  it('moves no made unit with "less motion": the snapshot at once', () => {
    setReducedMotion(true);
    const { view, nodes } = make();
    view.update(withCity({ recruit_queue: 1 }), rules.unitTicks, UPGRADES, rules.queueMax);
    view.setTick(NOW + 2);
    view.setRecruits(
      [
        {
          type: 'event',
          tick: NOW,
          kind: 'recruited',
          data: { player: 0, node: ownId, group: 'g' },
        },
      ],
      10,
    );
    view.advance(16);
    const drop = city(nodes, ownId).children.find((c) => c.label === 'recruit-drop');
    expect(drop?.visible).toBe(false);
    expect(foundation(nodes, own.id)?.alpha).toBe(1);
    view.destroy();
  });

  it('builds the barracks as a plan with a row of owed charges, then the icon fills', () => {
    const { view, nodes } = make();
    const upgrades = { ...UPGRADES, barracks: { ticks: 100, charges: 3 } };
    view.update(
      withCity({ has_barracks: false, building: { kind: 'barracks', done_tick: null, owed: 2 } }),
      rules.unitTicks,
      upgrades,
      rules.queueMax,
    );
    const root = tower(nodes, own.id, 'barracks');
    expect(root.visible).toBe(true);
    expect((root.children[0] as BakedSprite).spec?.key).toContain(':plan:');
    // Three charges, one paid: three lozenges beside the icon, one of them solid.
    expect(owedRow(nodes, own.id, 'barracks')).toEqual({ shown: 3, paid: 1 });
    // Paid in full: the time runs from `done_tick`, the icon fills from its base, the row is gone.
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
    expect(owedRow(nodes, own.id, 'barracks').shown).toBe(0);
    view.destroy();
  });

  it('opens a ring from the icon when the build is done', () => {
    setReducedMotion(false);
    const { view, nodes } = make();
    const upgrades = { ...UPGRADES, barracks: { ticks: 100, charges: 3 } };
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
    const ring = sprite(nodes, own.id, 'building-ring-barracks');
    expect(ring.visible).toBe(true);
    view.advance(200);
    expect(ring.alpha).toBeLessThan(1);
    view.advance(2000);
    expect(ring.visible).toBe(false);
    expect((tower(nodes, own.id, 'barracks').children[0] as BakedSprite).spec?.key).toContain(
      ':built:',
    );
    view.destroy();
  });

  describe('the finish of a build (#972, V12)', () => {
    const finish = (): {
      view: CityView;
      ticks: Container | undefined;
      root: Container;
      grown: number;
    } => {
      const { view, nodes } = make();
      const upgrades = { ...UPGRADES, barracks: { ticks: 100, charges: 3 } };
      view.update(
        withCity({
          has_barracks: false,
          building: { kind: 'barracks', done_tick: NOW + 5, owed: 0 },
        }),
        rules.unitTicks,
        upgrades,
        rules.queueMax,
      );
      const root = tower(nodes, own.id, 'barracks');
      const grown = root.scale.x;
      view.update(withCity({ has_barracks: true, building: null }), rules.unitTicks, upgrades);
      const ticks = city(nodes, own.id).children.find((c) => c.label === 'building-ticks-barracks');
      return { view, ticks, root, grown };
    };

    it('draws the icon 1.25 times larger while it is built, back to its size when done', () => {
      setReducedMotion(false);
      const { view, root, grown } = finish();
      expect(grown / root.scale.x).toBeCloseTo(1.25, 5);
      view.destroy();
    });

    it('stands four corner ticks round the new icon for 3 s, then takes them away', () => {
      setReducedMotion(false);
      const { view, ticks } = finish();
      expect(ticks?.visible).toBe(true);
      view.advance(2900);
      expect(ticks?.visible).toBe(true);
      view.advance(600);
      expect(ticks?.visible).toBe(false);
      view.destroy();
    });

    it('keeps the ticks under less motion, still (and no ring)', () => {
      setReducedMotion(true);
      const { view, ticks, root } = finish();
      expect(ticks?.visible).toBe(true);
      expect(root.parent?.children.find((c) => c.label === 'building-ring-barracks')?.visible).toBe(
        false,
      );
      view.advance(2900);
      expect(ticks?.visible).toBe(true);
      view.advance(600);
      expect(ticks?.visible).toBe(false);
      setReducedMotion(false);
      view.destroy();
    });
  });

  it('flies a paid charge into the row, pops it, then runs the lozenges into the icon (#872)', () => {
    setReducedMotion(false);
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    const nodes = layers.layer.nodes;
    const upgrades = { ...UPGRADES, barracks: { ticks: 100, charges: 3 } };
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
    frame(NOW + 2);
    expect(flights()).toHaveLength(1);
    // In the air its lozenge is still owed: one of three shown paid.
    expect(owedRow(nodes, own.id, 'barracks')).toEqual({ shown: 3, paid: 1 });
    frame(NOW + 5.5);
    expect(flights()).toHaveLength(0);
    expect(owedRow(nodes, own.id, 'barracks')).toEqual({ shown: 3, paid: 2 });
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
    // Paid in full: the row gives way to the lozenges that run into the icon.
    expect(owedRow(nodes, own.id, 'barracks').shown).toBe(0);
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
      { ...UPGRADES, barracks: { ticks: 100, charges: 3 } },
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
    expect(owedRow(layers.layer.nodes, own.id, 'barracks')).toEqual({ shown: 3, paid: 2 });
    view.destroy();
  });

  it('pulses the amber rim, and holds it steady with "less motion"', () => {
    const { view, nodes } = make();
    view.update(
      withCity({ recruit_queue: 1, recruit_waiting: true, recruit_progress: rules.unitTicks }),
      rules.unitTicks,
      UPGRADES,
      rules.queueMax,
    );
    const ring = foundation(nodes, own.id)?.children.find((c) =>
      ((c as BakedSprite).spec?.key ?? '').startsWith('foundation-alert'),
    ) as BakedSprite;
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
    expect(bar.spec?.key).toBe(warehouseMarksSpec(1, 1, stockColor('you')).key);
    view.update(holding(ownProvince.id, 0), null, UPGRADES, null, 1);
    expect(barOf(layers.layer.nodes, ownProvince.id).spec?.key).toBe(
      warehouseMarksSpec(1, 0, stockColor('you')).key,
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

describe('CityView: the buildings stand on the free side of the city (#954, P2)', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setReducedMotion(null);
  });

  const base = devSnapshot(map, DEV_RULES, 100);
  const own = base.view.nodes.find((n) => n.owner === 0 && n.has_barracks === true);
  if (own === undefined) throw new Error('no own city');
  const ownId = own.id;
  const withBoth = (): SnapshotMsg => {
    const nodes = base.view.nodes.map((n) =>
      n.id === ownId ? { ...n, has_barracks: true, factory: true } : n,
    );
    return { ...base, view: { ...base.view, nodes } };
  };
  const icon = (nodes: Container, kind: string): Container =>
    city(nodes, ownId).children.find((c) => c.label === `building-${kind}`) as Container;

  it('seats both icons where the layout says, from the roads of the map', () => {
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    view.update(withBoth(), null, UPGRADES);
    const expected = layoutBuildings({
      radius: view.radiusOf(ownId),
      roads: roadAngles(map)[ownId] ?? [],
      vp: map.nodes[ownId]?.vp !== 0,
      kinds: ['barracks', 'factory'],
      size: iconSize(1),
    });
    for (const kind of ['barracks', 'factory'] as const) {
      const root = icon(layers.layer.nodes, kind);
      expect(root.visible).toBe(true);
      expect(root.x).toBeCloseTo(expected.items[kind]?.x ?? Number.NaN, 6);
      expect(root.y).toBeCloseTo(expected.items[kind]?.y ?? Number.NaN, 6);
      expect(root.scale.x).toBeCloseTo(iconSize(1) / 26, 6);
    }
    view.destroy();
  });

  it('keeps the icons their size on screen when the map zooms out, and seats them again', () => {
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    view.update(withBoth(), null, UPGRADES);
    const near = icon(layers.layer.nodes, 'factory').x;
    view.setCameraScale(0.5);
    const root = icon(layers.layer.nodes, 'factory');
    expect(root.scale.x * 26 * 0.5).toBeGreaterThanOrEqual(13 - 1e-6);
    expect(root.x).not.toBe(near);
    view.destroy();
  });

  it('hides the icon of a building the view does not give: nothing is guessed', () => {
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    const nodes = base.view.nodes.map((n) =>
      n.id === ownId ? { ...n, has_barracks: null, factory: false } : n,
    );
    view.update({ ...base, view: { ...base.view, nodes } }, null, UPGRADES);
    expect(icon(layers.layer.nodes, 'barracks').visible).toBe(false);
    expect(icon(layers.layer.nodes, 'factory').visible).toBe(false);
    view.destroy();
  });

  it('a captured city keeps the old icon over the new one until it fades', () => {
    setReducedMotion(false);
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1, testSprites());
    const held = (owner: 0 | 1): SnapshotMsg => {
      const nodes = base.view.nodes.map((n) =>
        n.id === ownId ? { ...n, owner, has_barracks: true, factory: false } : n,
      );
      return { ...base, view: { ...base.view, nodes } };
    };
    view.update(held(1), null, UPGRADES);
    const ghosts = (): number =>
      city(layers.layer.nodes, ownId).children.filter((c) => /^building-ghost/.test(c.label))
        .length;
    expect(ghosts()).toBe(0);
    view.update(held(0), null, UPGRADES);
    expect(ghosts()).toBe(1);
    expect((icon(layers.layer.nodes, 'barracks').children[0] as BakedSprite).spec?.key).toBe(
      iconBackSpec('barracks', 'built', YOU, false).key,
    );
    view.advance(5000);
    expect(ghosts()).toBe(0);
    view.destroy();
  });
});
