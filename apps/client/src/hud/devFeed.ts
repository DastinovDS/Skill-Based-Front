/**
 * Stand-in for the match server on the dev screen (CLI-08, #64): until the lobby and the match
 * connection (CLI-01) replace it, a snapshot and sometimes an event are made up for the bundled
 * map 10 times a second, so the HUD has live numbers to show. The ruleset is the PRO-01 `welcome`
 * fixture; the map decides who stands where. Nothing here is game logic: the numbers only move.
 */
import type {
  EventMsg,
  GroupView,
  MapFile,
  NodeKind,
  NodeView,
  RulesetPublic,
  SnapshotMsg,
  WelcomeMsg,
} from '../protocol.gen.ts';

const welcomeFiles = import.meta.glob<WelcomeMsg>(
  '../../../../packages/protocol/fixtures/server/welcome.json',
  { eager: true, import: 'default' },
);

/** The player on the dev screen. */
export const DEV_PLAYER = 0;

/** The ruleset of the PRO-01 fixture. */
export const DEV_RULES: RulesetPublic = (() => {
  const welcome = Object.values(welcomeFiles)[0];
  if (welcome === undefined) {
    throw new Error('packages/protocol/fixtures/server/welcome.json is not bundled');
  }
  return welcome.ruleset_public;
})();

/** How many enemy nodes are shown in full, then how many only as presence (the rest is fog). */
const SEEN_EXACT = 1;
const SEEN_PRESENCE = 2;

/** The snapshot of dev tick `tick` for `map` (player 0 sees its own nodes; the first enemy nodes are shown in full or as presence). */
/**
 * Capacities of the dev feed by node kind: the `mvp-0` numbers of DEC-22, only for this offline
 * fake (a real snapshot carries the server's capacity of every node).
 */
export const DEV_CAPACITY: Record<NodeKind, number> = {
  capital: 10,
  city_large: 8,
  city_medium: 6,
  city_small: 4,
  province: 3,
};

export function devSnapshot(map: MapFile, rules: RulesetPublic, tick: number): SnapshotMsg {
  const mine = new Set(map.nodes.filter((n) => n.start_owner === DEV_PLAYER).map((n) => n.id));
  const next = map.nodes.filter((n) => n.start_owner === 1).map((n) => n.id);
  const exact = new Set(next.slice(0, SEEN_EXACT));
  const presence = new Set(next.slice(SEEN_EXACT, SEEN_EXACT + SEEN_PRESENCE));

  const nodes: NodeView[] = map.nodes.map((n) => {
    const base = {
      id: n.id,
      owner: n.start_owner,
      capacity: DEV_CAPACITY[n.kind],
      build: null,
      attrition_in: null,
      grace_left: null,
      starve_in: null,
      recruit_queue: null,
      recruit_progress: null,
      recruit_waiting: null,
      has_barracks: null,
      warehouse_level: null,
      warehouse_cap: null,
      building: null,
    };
    if (mine.has(n.id)) {
      const city = n.kind !== 'province';
      return {
        ...base,
        recruit_queue: city ? 0 : null,
        recruit_progress: city ? 0 : null,
        recruit_waiting: city ? false : null,
        has_barracks: city ? true : null,
        warehouse_level: city ? 0 : null,
        warehouse_cap: city ? DEV_CAPACITY[n.kind] : null,
        detail: 'exact',
        warehouse: n.start_stock,
        seen: { tick, level: 'exact', enemy_modes: [], enemy_units: 0, enemy_charged: 0 },
      };
    }
    if (exact.has(n.id)) {
      return {
        ...base,
        detail: 'exact',
        warehouse: n.start_stock,
        seen: {
          tick,
          level: 'exact',
          enemy_modes: ['attack'],
          enemy_units: n.start_units,
          enemy_charged: n.start_charged,
        },
      };
    }
    if (presence.has(n.id)) {
      return {
        ...base,
        detail: 'presence',
        warehouse: null,
        seen: {
          tick,
          level: 'presence',
          enemy_modes: ['defense'],
          enemy_units: null,
          enemy_charged: null,
        },
      };
    }
    return { ...base, detail: 'fog', warehouse: null, seen: null };
  });

  const groups: GroupView[] = map.nodes
    .filter((n) => mine.has(n.id) && n.start_units > 0)
    .map((n) => ({
      id: `dev-${String(n.id)}`,
      units: n.start_units,
      charged: n.start_charged,
      mode: 'attack',
      location: { kind: 'node', node: n.id },
      order: null,
      defense_bonus: null,
      defense_cap: null,
    }));

  const regen = Math.floor((tick * rules.cp.per_period) / rules.cp.period_ticks);
  return {
    type: 'snapshot',
    tick,
    view: {
      me: {
        cp: Math.min(rules.cp.cap, regen),
        stance: 'balance',
        fronts: [null, null],
        rear_min: 1,
      },
      vp: [Math.floor(tick / 100), Math.floor(tick / 150)],
      nodes,
      edges: map.edges.map((e) => ({
        id: e.id,
        width: e.base_width,
        // A road is seen when one of its ends is (as in the real fog), hidden only between two hidden cities.
        detail: nodes[e.a]?.detail === 'fog' && nodes[e.b]?.detail === 'fog' ? 'fog' : 'exact',
        upgrade_gain: null,
        seen: null,
        build: null,
      })),
      groups,
      packets: [],
      intents: [],
      fights: devFights(map, tick),
    },
  };
}

// --- A scripted fight for the demo (DEC-24, DEC-29) ----------------------------------------------
// Every `FIGHT_CYCLE` ticks a fight starts at phase 120 and plays six rounds (a round every 10
// ticks, the last one at phase 180 together with the end): in a city on even cycles, on a road on
// odd ones. The first two rounds the player fires a bonus (virtual) shot. It ends held, or, every
// third cycle, with both sides retreating.

const FIGHT_CYCLE = 200;
const FIGHT_START = 120;
const FIGHT_ROUND = 10;

/** The rounds of the scripted fight, by player (0 is the player of the demo). */
const DEV_ROUNDS = [
  { shots: [1, 1], virtual: [1, 0], spent: [0, 1], losses: [0, 0] },
  { shots: [1, 1], virtual: [1, 0], spent: [0, 1], losses: [0, 0] },
  { shots: [1, 1], virtual: [0, 0], spent: [1, 1], losses: [0, 0] },
  { shots: [1, 1], virtual: [0, 0], spent: [1, 1], losses: [0, 0] },
  { shots: [1, 0], virtual: [0, 0], spent: [1, 0], losses: [0, 1] },
  { shots: [1, 0], virtual: [0, 0], spent: [1, 0], losses: [0, 1] },
] as const;
const FIGHT_END = FIGHT_START + DEV_ROUNDS.length * FIGHT_ROUND;

function devFightPlace(map: MapFile, cycle: number) {
  const city = map.nodes[1]?.id ?? 0;
  return cycle % 2 === 0
    ? { node: city, edge: null, point: null, attacker: 1 as const }
    : { node: null, edge: map.edges[0]?.id ?? 0, point: 900, attacker: null };
}

const pairSum = (key: 'shots' | 'losses' | 'virtual', rounds: number): [number, number] => [
  DEV_ROUNDS.slice(0, rounds).reduce((n, r) => n + r[key][0], 0),
  DEV_ROUNDS.slice(0, rounds).reduce((n, r) => n + r[key][1], 0),
];

/** The bonus shots of the demo fight still left after `rounds` rounds (DEC-32). */
const virtualLeft = (rounds: number): [number, number] => {
  const all = pairSum('virtual', DEV_ROUNDS.length);
  const used = pairSum('virtual', rounds);
  return [all[0] - used[0], all[1] - used[1]];
};

/** The fight of the demo going on at `tick`, as the view of a player lists it. */
export function devFights(map: MapFile, tick: number): SnapshotMsg['view']['fights'] {
  const phase = tick % FIGHT_CYCLE;
  if (phase < FIGHT_START || phase >= FIGHT_END) return [];
  const cycle = Math.floor(tick / FIGHT_CYCLE);
  const start = cycle * FIGHT_CYCLE + FIGHT_START;
  const done = Math.floor((tick - start) / FIGHT_ROUND);
  const last = done === 0 ? undefined : DEV_ROUNDS[done - 1];
  return [
    {
      id: 'dev-fight',
      ...devFightPlace(map, cycle),
      start_tick: start,
      next_round_tick: start + (done + 1) * FIGHT_ROUND,
      groups: [],
      enemy_units: 3,
      enemy_charged: 2,
      shots: pairSum('shots', done),
      losses: pairSum('losses', done),
      virtual_left: virtualLeft(done),
      mute: [0, 0],
      last_round:
        last === undefined
          ? null
          : {
              tick: start + done * FIGHT_ROUND,
              shots: [...last.shots],
              virtual: [...last.virtual],
              spent: [...last.spent],
              losses: [...last.losses],
            },
    },
  ];
}

/**
 * The fight events of `tick`: `fight_started` at the start, `fight_round` every round, and
 * `fight_ended` after the last one; none on the other ticks.
 */
export function devFightEvents(map: MapFile, tick: number): EventMsg[] {
  const phase = tick % FIGHT_CYCLE;
  const cycle = Math.floor(tick / FIGHT_CYCLE);
  const place = devFightPlace(map, cycle);
  const events: EventMsg[] = [];
  if (phase === FIGHT_START) {
    events.push({
      type: 'event',
      tick,
      kind: 'fight_started',
      data: { fight: 'dev-fight', ...place },
    });
  }
  const round = (phase - FIGHT_START) / FIGHT_ROUND;
  if (Number.isInteger(round) && round >= 1 && round <= DEV_ROUNDS.length) {
    const r = DEV_ROUNDS[round - 1];
    if (r !== undefined) {
      events.push({
        type: 'event',
        tick,
        kind: 'fight_round',
        data: {
          fight: 'dev-fight',
          node: place.node,
          edge: place.edge,
          point: place.point,
          shots_0: r.shots[0],
          shots_1: r.shots[1],
          virtual_0: r.virtual[0],
          virtual_1: r.virtual[1],
          spent_0: r.spent[0],
          spent_1: r.spent[1],
          losses_0: r.losses[0],
          losses_1: r.losses[1],
        },
      });
    }
  }
  if (phase === FIGHT_END) {
    const shots = pairSum('shots', DEV_ROUNDS.length);
    const losses = pairSum('losses', DEV_ROUNDS.length);
    const bounced = cycle % 3 === 2;
    events.push({
      type: 'event',
      tick,
      kind: 'fight_ended',
      data: {
        fight: 'dev-fight',
        ...place,
        start: tick - (FIGHT_END - FIGHT_START),
        winner: bounced ? null : DEV_PLAYER,
        captured: false,
        shots_0: shots[0],
        shots_1: shots[1],
        losses_0: losses[0],
        losses_1: losses[1],
      },
    });
  }
  return events;
}

/** A made-up event every few seconds, cycling through a few kinds the feed knows. */
export function devEvent(map: MapFile, tick: number): EventMsg | null {
  const period = 30;
  if (tick === 0 || tick % period !== 0) return null;
  const node = map.nodes[(tick / period) % map.nodes.length]?.id ?? 0;
  switch ((tick / period) % 3) {
    case 0:
      return { type: 'event', tick, kind: 'node_captured', data: { node, player: 0 } };
    case 1:
      return {
        type: 'event',
        tick,
        kind: 'fight_ended',
        data: {
          node,
          edge: null,
          point: null,
          attacker: 1,
          winner: 0,
          captured: false,
          losses_0: 1,
          losses_1: 2,
        },
      };
    default:
      return { type: 'event', tick, kind: 'vp_awarded', data: { player: 1, vp: 1 } };
  }
}

export interface DevFeedHandlers {
  onSnapshot: (snapshot: SnapshotMsg) => void;
  onEvent: (event: EventMsg) => void;
}

/** Starts the feed at tick 0; returns the function that stops it. */
export function startDevFeed(
  map: MapFile,
  rules: RulesetPublic,
  handlers: DevFeedHandlers,
): () => void {
  let tick = 0;
  const step = (): void => {
    const event = devEvent(map, tick);
    if (event !== null) handlers.onEvent(event);
    for (const fight of devFightEvents(map, tick)) handlers.onEvent(fight);
    handlers.onSnapshot(devSnapshot(map, rules, tick));
    tick += 1;
  };
  step();
  const timer = setInterval(step, 1000 / rules.tick_hz);
  return () => {
    clearInterval(timer);
  };
}
