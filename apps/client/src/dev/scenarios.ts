/**
 * Scenes of the dev screen (CLI-04, #60): three fixtures from
 * `packages/protocol/fixtures/server/` (`snapshot`, `snapshot_fog`, `snapshot_clash`), each on
 * its map, frozen at the tick of the snapshot. The Playwright test (`visual/`) takes its reference
 * screenshots from them. The live `demo` scene is the dev server's match (CLI-06, #62).
 */
import { DEV_RULES } from '../hud/devFeed.ts';
import { BUNDLED_MAPS } from '../map/bundledMaps.ts';
import { interpolateFrame, type RenderFrame } from '../net/interpolate.ts';
import type {
  Detail,
  EdgeView,
  EnemyGroup,
  EventMsg,
  HalfView,
  NodeView,
  Seen,
  SnapshotMsg,
} from '../protocol.gen.ts';
import type { RenderSource } from '../render/source.ts';
import { ARTERY_TICK, ARTERY_VIEW, arterySnapshot } from './arteryScene.ts';
import { PROVINCES_VIEW, provincesSnapshot } from './provincesScene.ts';

const files = import.meta.glob<SnapshotMsg>(
  '../../../../packages/protocol/fixtures/server/snapshot*.json',
  { eager: true, import: 'default' },
);

function fixture(name: string): SnapshotMsg {
  const found = Object.entries(files).find(([path]) => path.endsWith(`/${name}.json`));
  if (found === undefined) throw new Error(`fixture ${name}.json is missing`);
  return found[1];
}

type Where = { node: number } | { edge: number; point: number };

function place(where: Where) {
  return {
    node: 'node' in where ? where.node : null,
    edge: 'edge' in where ? where.edge : null,
    // The meeting point on an edge (DEC-24, C3): twice the position in thousandths from `a`.
    point: 'edge' in where ? where.point : null,
  };
}

/** A finished fight (DEC-24): `winner` `null`: both sides bounced. */
function fight(
  tick: number,
  where: Where,
  l0: number,
  l1: number,
  winner: 0 | 1 | null = 0,
  captured = false,
) {
  const event: EventMsg = {
    type: 'event',
    tick,
    kind: 'fight_ended',
    data: {
      fight: `dev-fight-${String(tick)}`,
      ...place(where),
      attacker: 'node' in where ? 0 : null,
      start: tick - 20,
      winner,
      captured,
      shots_0: 2,
      losses_0: l0,
      losses_1: l1,
    },
  };
  return event;
}

/**
 * One round of a fight (protocol 19: both sides in the event): own shots, and the enemy's as many
 * as it hit (its hits are the own losses), no bonus shots; the losses of both sides.
 */
function round(tick: number, where: Where, shots: number, l0: number, l1: number) {
  const event: EventMsg = {
    type: 'event',
    tick,
    kind: 'fight_round',
    data: {
      fight: `dev-fight-${String(tick)}`,
      ...place(where),
      shots_0: shots,
      shots_1: l0,
      virtual_0: 0,
      virtual_1: 0,
      losses_0: l0,
      losses_1: l1,
      spent_0: shots,
      spent_1: l0,
    },
  };
  return event;
}

/**
 * The `snapshot` fixture with two overcrowded own cities (ui-style 12): city 1 holds five units
 * where three fit and loses one in 1.8 s, city 0 holds six where five fit and is still in the
 * grace after a capture (3 s). Made here, not a fixture of the protocol: the numbers of the
 * countdown only need to be on screen.
 */
function overflowSnapshot(): SnapshotMsg {
  const base = fixture('snapshot');
  return {
    ...base,
    view: {
      ...base.view,
      nodes: base.view.nodes.map((n) =>
        n.id === 1 ? { ...n, attrition_in: 18 } : n.id === 0 ? { ...n, grace_left: 30 } : n,
      ),
      groups: base.view.groups.map((g) =>
        g.location.kind === 'node' && g.location.node === 1
          ? { ...g, units: 5, charged: 3 }
          : g.location.kind === 'node' && g.location.node === 0
            ? { ...g, units: 6, charged: 2 }
            : g,
      ),
    },
  };
}

/**
 * The `snapshot_clash` fixture with four fights going on at once (ui-style 9.9, 27): charged,
 * discharged and dead units on both sides, a round where both sides shot (one with a bonus shot),
 * one where only a side did, one without round data (an old replay), more than eight chips on a
 * side ("+N"), the stock of bonus shots of both sides and a silent charge (plains, DEC-24 F2).
 * Made here, not a fixture of the protocol.
 *
 * `moment` picks the tick the scene is frozen at, so that the tracers of the shots (#352) are seen in the
 * air, not only after the hit: `phases` (400) has each fight in the moment of its effects after the
 * hit; `kill` (395): a shot of the enemy about to kill a unit of the own group in city 3, an own bonus
 * shot half way to city 0, the shots on the road not yet fired; `flight` (398): the two shots on the
 * road (an own bonus shot against a real one) a moment before they meet, the own bonus shot about to
 * land in city 0, the kill in city 3 just landed.
 */
function fightsSnapshot(moment: 'phases' | 'kill' | 'flight' = 'phases'): SnapshotMsg {
  const base = fixture('snapshot_clash');
  const [road] = base.view.fights;
  if (road === undefined) throw new Error('the clash fixture lists a fight');
  // Each fight is in another moment of the effects of its last round (20 ticks a round, the hit
  // lands 6 ticks after it, 3 when two shots meet): the shots of the road just met, the city 0
  // is hit, the city 3 lost a unit, the city 1 is in the wind-up of its first round.
  const round = (
    tick: number,
    shots: [number, number],
    virtual: [number, number],
    losses: [number, number] = [0, 1],
  ) => ({
    tick,
    shots,
    virtual,
    spent: [shots[0] - virtual[0], shots[1] - virtual[1]] as [number, number],
    losses,
  });
  // The rounds of the moments with a shot in the air: bonus shots (all of a side's shots virtual) where
  // the tracers differ from the real ones.
  const bonus = moment !== 'phases';
  return {
    ...base,
    tick: { phases: 400, kill: 395, flight: 398 }[moment],
    view: {
      ...base.view,
      fights: [
        {
          ...road,
          start_tick: 330,
          next_round_tick: 416,
          last_round: bonus ? round(396, [1, 1], [1, 0]) : round(396, [3, 2], [1, 0]),
        },
        {
          ...road,
          id: 'dev-fight-city-0',
          node: 0,
          edge: null,
          point: null,
          attacker: 1,
          groups: ['6f708192a3b4c5d6'],
          enemy_units: 11,
          enemy_charged: 9,
          losses: [1, 0],
          virtual_left: [1, 2],
          mute: [0, 1],
          start_tick: 330,
          next_round_tick: 413,
          last_round: bonus
            ? round(393, [1, 0], [1, 0], [0, 0])
            : round(393, [2, 0], [0, 0], [0, 0]),
        },
        {
          ...road,
          id: 'dev-fight-city-3',
          node: 3,
          edge: null,
          point: null,
          attacker: 1,
          // Own: four units and twelve, sixteen chips: eight and "+8".
          groups: ['1a2b3c4d5e6f7081', '2b3c4d5e6f708192'],
          enemy_units: 2,
          enemy_charged: 0,
          losses: [0, 2],
          virtual_left: [0, 0],
          mute: [0, 0],
          start_tick: 330,
          next_round_tick: 411,
          last_round: round(391, [0, 1], [0, 0], [1, 0]),
        },
        {
          ...road,
          id: 'dev-fight-city-1',
          node: 1,
          edge: null,
          point: null,
          attacker: 0,
          groups: ['3c4d5e6f708192a3'],
          enemy_units: 3,
          enemy_charged: 3,
          losses: [0, 0],
          virtual_left: [0, 1],
          mute: [0, 1],
          start_tick: moment === 'phases' ? 397 : 394,
          next_round_tick: 401,
          last_round: null,
        },
      ],
    },
  };
}

/** The `fight_round` events of the last rounds of the fights of the snapshot (a round is an event of its tick). */
function fightRoundEvents(snapshot: SnapshotMsg): EventMsg[] {
  return snapshot.view.fights.flatMap((fight) => {
    const last = fight.last_round;
    if (last === null) return [];
    const event: EventMsg = {
      type: 'event',
      tick: last.tick,
      kind: 'fight_round',
      data: {
        fight: fight.id,
        node: fight.node,
        edge: fight.edge,
        point: fight.point,
        shots_0: last.shots[0],
        shots_1: last.shots[1],
        virtual_0: last.virtual[0],
        virtual_1: last.virtual[1],
        spent_0: last.spent[0],
        spent_1: last.spent[1],
        losses_0: last.losses[0],
        losses_1: last.losses[1],
      },
    };
    return [event];
  });
}

/**
 * What DEC-21 and DEC-33 show about enemies (#359), on the `diamond` map at tick 600: a city seen
 * as a range («21+»), figures on road halves seen exactly, as a range and as presence, and the
 * memory of cities and halves in fog (a range, exact numbers, presence) with their ages. The
 * border point holds the memory ghosts of the halves. Made here, not a fixture of the protocol.
 */
function rangesSnapshot(): SnapshotMsg {
  const base = fixture('snapshot');
  const tick = 600;
  const seen = (
    ago: number,
    level: Seen['level'],
    modes: Seen['enemy_modes'],
    fields: Partial<Seen> = {},
  ): Seen => ({
    tick: tick - ago,
    level,
    enemy_modes: modes,
    enemy_units: null,
    enemy_charged: null,
    enemy_range: null,
    ...fields,
  });
  const nodes = base.view.nodes.map((node): NodeView => {
    if (node.id === 2) {
      // In fog: the last sighting, a range.
      return {
        ...node,
        detail: 'fog',
        seen: seen(210, 'range', ['attack'], { enemy_range: { low: 3, high: 5 } }),
      };
    }
    if (node.id === 3) {
      return {
        ...node,
        detail: 'range',
        seen: seen(0, 'range', ['attack'], { enemy_range: { low: 21, high: null } }),
      };
    }
    return {
      ...node,
      seen: seen(
        0,
        node.detail,
        [],
        node.detail === 'exact' ? { enemy_units: 0, enemy_charged: 0 } : {},
      ),
    };
  });
  const figure = (
    id: string,
    pos: number,
    toward_b: boolean,
    detail: EnemyGroup['detail'],
    fields: Partial<EnemyGroup> = {},
  ): EnemyGroup => ({
    id,
    pos,
    toward_b,
    detail,
    mode: 'attack',
    units: null,
    charged: null,
    units_range: null,
    ...fields,
  });
  const half = (detail: Detail, memory: Seen | null): HalfView => ({ detail, seen: memory });
  const edges = base.view.edges.map((edge): EdgeView => {
    switch (edge.id) {
      case 1:
        // 0-2: the half of the city 2 is in fog; its memory is exact numbers.
        return {
          ...edge,
          halves: [
            half('exact', seen(0, 'exact', [], { enemy_units: 0, enemy_charged: 0 })),
            half('fog', seen(450, 'exact', ['attack'], { enemy_units: 4, enemy_charged: 2 })),
          ],
          enemy_groups: [],
        };
      case 2:
        // 3-2: the half of 3 is seen as a range with a figure in it, the half of 2 is in fog.
        return {
          ...edge,
          halves: [
            half('range', seen(0, 'range', ['attack'], { enemy_range: { low: 6, high: 10 } })),
            half('fog', seen(120, 'presence', ['defense'])),
          ],
          enemy_groups: [figure('r1', 350, false, 'range', { units_range: { low: 6, high: 10 } })],
        };
      case 3:
        // 3-1: both halves seen, an exact figure going to 3 and a range one going to 1.
        return {
          ...edge,
          halves: [
            half('range', seen(0, 'range', ['attack'], { enemy_range: { low: 1, high: 2 } })),
            half('exact', seen(0, 'exact', ['attack'], { enemy_units: 4, enemy_charged: 3 })),
          ],
          enemy_groups: [
            figure('e1', 750, false, 'exact', { units: 4, charged: 3 }),
            figure('r2', 250, true, 'range', { units_range: { low: 1, high: 2 } }),
          ],
        };
      default:
        return { ...edge, enemy_groups: [] };
    }
  });
  return {
    ...base,
    tick,
    view: { ...base.view, nodes, edges, packets: [], fights: [] },
  };
}

/**
 * The `snapshot_fog` fixture with an own group marching along the road 2-1 into the hidden city 2
 * (#419, DEC-10): the group sees its own road, so the half of the road that lies in the hidden cell
 * is `presence` and an enemy figure on it is seen too (no numbers); the city 2 stays in fog. The
 * group and the figure have to be drawn over the veil, not dimmed by it. Made here, not a fixture of
 * the protocol.
 */
function fogRoadSnapshot(): SnapshotMsg {
  const base = fixture('snapshot_fog');
  const sighting = (level: Detail): Seen => ({
    tick: base.tick,
    level,
    enemy_modes: level === 'presence' ? ['attack'] : [],
    enemy_units: null,
    enemy_charged: null,
    enemy_range: null,
  });
  const edges = base.view.edges.map((edge): EdgeView => {
    if (edge.id !== 1) return edge;
    return {
      ...edge,
      detail: 'presence',
      halves: [
        { detail: 'presence', seen: sighting('presence') },
        { detail: 'presence', seen: sighting('presence') },
      ],
      // Near the city 2 (the end `a`), going to it.
      enemy_groups: [
        {
          id: 'e0f1a2b3c4d5e6f7',
          pos: 420,
          toward_b: false,
          detail: 'presence',
          mode: 'attack',
          units: null,
          charged: null,
          units_range: null,
        },
      ],
    };
  });
  return {
    ...base,
    view: {
      ...base.view,
      edges,
      groups: [
        ...base.view.groups,
        {
          id: '0f1e2d3c4b5a6978',
          units: 2,
          charged: 1,
          mode: 'attack',
          // A quarter of the road short of the hidden city, in the veil of its cell.
          location: { kind: 'edge', edge: 1, from_node: 1, progress: 750 },
          order: null,
          defense_bonus: null,
          defense_cap: null,
        },
      ],
    },
  };
}

/** A real map with a baked background, by name (the scenes `artery` and `provinces`). */
function bundledMap(name: string) {
  const map = BUNDLED_MAPS.find((m) => m.meta.name === name);
  if (map === undefined) throw new Error(`the map ${name} is not bundled`);
  return map;
}

export interface FixtureScene {
  id: string;
  /** `meta.name` of the map the snapshot was written for. */
  map: string;
  snapshot: SnapshotMsg;
  events: readonly EventMsg[];
  /** The part of the map (world units) the camera looks at; without it the whole map is shown. */
  view?: { x: number; y: number; width: number; height: number };
  /** The city development of DEC-26 is on (the barracks marks are drawn); off when absent. */
  cityUpgrades?: boolean;
}

export const FIXTURE_SCENES: readonly FixtureScene[] = [
  {
    // The real map with its baked background (#344): the scene to judge the map style by.
    id: 'artery',
    map: 'artery',
    snapshot: arterySnapshot(bundledMap('artery')),
    // The last round of the fight in the city 4 (its shots in the air), 12 ticks ago.
    events: [round(ARTERY_TICK - 12, { node: 4 }, 2, 0, 1)],
    view: ARTERY_VIEW,
    // As in `mvp-1`: the own capital and the enemy city 5 next door show the barracks (DEC-31).
    cityUpgrades: true,
  },
  {
    // A pool map (DEC-27) with its provinces: hollow rings, no warehouse, no VP (#348).
    id: 'provinces',
    map: 'crossroads',
    snapshot: provincesSnapshot(bundledMap('crossroads')),
    events: [],
    view: PROVINCES_VIEW,
    cityUpgrades: true,
  },
  {
    id: 'snapshot',
    map: 'diamond',
    snapshot: fixture('snapshot'),
    events: [fight(118, { edge: 3, point: 1200 }, 1, 2)],
    // The enemy capital 3 is next to the own city 0: its barracks are seen (DEC-31).
    cityUpgrades: true,
  },
  { id: 'overflow', map: 'diamond', snapshot: overflowSnapshot(), events: [] },
  { id: 'ranges', map: 'diamond', snapshot: rangesSnapshot(), events: [] },
  { id: 'snapshot_fog', map: 'line3', snapshot: fixture('snapshot_fog'), events: [] },
  // An own group and an enemy figure on a road into a hidden city: not dimmed by the veil (#419).
  { id: 'fog_road', map: 'line3', snapshot: fogRoadSnapshot(), events: [] },
  {
    id: 'fights',
    map: 'siege',
    snapshot: fightsSnapshot(),
    events: fightRoundEvents(fightsSnapshot()),
  },
  // The same four fights with their shots in the air (tracers, #352).
  {
    id: 'fights_kill',
    map: 'siege',
    snapshot: fightsSnapshot('kill'),
    events: fightRoundEvents(fightsSnapshot('kill')),
  },
  {
    id: 'fights_flight',
    map: 'siege',
    snapshot: fightsSnapshot('flight'),
    events: fightRoundEvents(fightsSnapshot('flight')),
  },
  {
    id: 'snapshot_clash',
    map: 'siege',
    snapshot: fixture('snapshot_clash'),
    events: [
      // A fight going on over the road 5 (the fixture lists it): a round just fired, its shots in
      // the air; a held city, a captured one and a pair of groups that both bounced, ended.
      round(398, { edge: 5, point: 1250 }, 2, 1, 1),
      fight(397, { node: 0 }, 1, 2, 0),
      fight(395, { node: 1 }, 2, 1, 1, true),
      fight(394, { edge: 1, point: 1000 }, 1, 1, null),
    ],
  },
];

/** The scene that is not a fixture: a live match against the dev server (`dev/devServer.ts`). */
export const DEMO_SCENE = 'demo';

/**
 * A frozen scene: the snapshot at its own tick, no animation, so screenshots are stable. `at` freezes the
 * rendering at another tick (`?at=397.5`; fractional too): the effects of the fights are functions of the
 * render tick, so a round can be looked at frame by frame (`mise run shots`, the shots of #352).
 */
export function frozenSource(scene: FixtureScene, at?: number): RenderSource {
  // `interpolateFrame` holds the tick inside the snapshot: a later render tick is the snapshot taken then.
  const snapshot = at === undefined ? scene.snapshot : { ...scene.snapshot, tick: at };
  const frame: RenderFrame = interpolateFrame(snapshot, null, snapshot.tick);
  return {
    frame: () => frame,
    events: () => scene.events,
    orderDelays: { planned: DEV_RULES.orders.planned_delay_ticks },
    roundTicks: DEV_RULES.combat.round_ticks,
    recruitTicks: DEV_RULES.recruit.unit_ticks,
    roadBuildTicks: DEV_RULES.build.ticks_per_level,
    cityUpgrades:
      scene.cityUpgrades === true
        ? {
            barracks: DEV_RULES.city_upgrades.barracks_ticks,
            warehouse: DEV_RULES.city_upgrades.warehouse_ticks,
            warehouseMaxLevel: DEV_RULES.city_upgrades.warehouse_max_level,
            warehouseGainPerLevel: DEV_RULES.city_upgrades.warehouse_gain_per_level,
          }
        : null,
    capacityTicks: {
      attritionTicks: DEV_RULES.capacity.attrition_ticks,
      graceTicks: DEV_RULES.capacity.grace_ticks,
    },
  };
}
