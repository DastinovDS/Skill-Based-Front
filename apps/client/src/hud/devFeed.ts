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
const DEV_CAPACITY: Record<NodeKind, number> = {
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
      priority: null,
      starve_in: null,
      recruit_queue: null,
      recruit_progress: null,
      recruit_waiting: null,
    };
    if (mine.has(n.id)) {
      const city = n.kind !== 'province';
      return {
        ...base,
        priority: city ? 'normal' : null,
        recruit_queue: city ? 0 : null,
        recruit_progress: city ? 0 : null,
        recruit_waiting: city ? false : null,
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
    }));

  const regen = Math.floor((tick * rules.cp.per_period) / rules.cp.period_ticks);
  return {
    type: 'snapshot',
    tick,
    view: {
      me: { cp: Math.min(rules.cp.cap, regen), stance: 'balance' },
      vp: [Math.floor(tick / 100), Math.floor(tick / 150)],
      nodes,
      edges: map.edges.map((e) => ({
        id: e.id,
        width: e.base_width,
        kind: 'none',
        // A road is seen when one of its ends is (as in the real fog), hidden only between two hidden cities.
        detail: nodes[e.a]?.detail === 'fog' && nodes[e.b]?.detail === 'fog' ? 'fog' : 'exact',
        upgrade_gain: null,
        seen: null,
      })),
      groups,
      packets: [],
      intents: [],
      fights: devFights(map, tick),
    },
  };
}

// --- A scripted fight for the demo (DEC-24) ----------------------------------------------------------
// Every `FIGHT_CYCLE` ticks a fight runs from phase 120 to 180 (a round every 10 ticks): in a city on
// even cycles, on a road on odd ones. It ends captured, held or both bounced in turn.

const FIGHT_CYCLE = 200;
const FIGHT_START = 120;
const FIGHT_END = 180;
const FIGHT_ROUND = 10;

function devFightPlace(map: MapFile, cycle: number) {
  const city = map.nodes[1]?.id ?? 0;
  return cycle % 2 === 0
    ? { node: city, edge: null, point: null, attacker: 1 as const }
    : { node: null, edge: map.edges[0]?.id ?? 0, point: 900, attacker: null };
}

/** The fight of the demo going on at `tick`, as the view of a player lists it. */
export function devFights(map: MapFile, tick: number): SnapshotMsg['view']['fights'] {
  const phase = tick % FIGHT_CYCLE;
  if (phase < FIGHT_START || phase >= FIGHT_END) return [];
  const cycle = Math.floor(tick / FIGHT_CYCLE);
  const start = cycle * FIGHT_CYCLE + FIGHT_START;
  return [
    {
      id: 'dev-fight',
      ...devFightPlace(map, cycle),
      start_tick: start,
      next_round_tick: start + (Math.floor((tick - start) / FIGHT_ROUND) + 1) * FIGHT_ROUND,
      groups: [],
      enemy_units: 3,
      enemy_charged: 2,
    },
  ];
}

/** `fight_round` every round of the scripted fight and `fight_ended` at its end; else `null`. */
export function devFightEvent(map: MapFile, tick: number): EventMsg | null {
  const phase = tick % FIGHT_CYCLE;
  const cycle = Math.floor(tick / FIGHT_CYCLE);
  const place = devFightPlace(map, cycle);
  const round = Math.floor((phase - FIGHT_START) / FIGHT_ROUND);
  if (phase === FIGHT_END) {
    const result = cycle % 3;
    return {
      type: 'event',
      tick,
      kind: 'fight_ended',
      data: {
        fight: 'dev-fight',
        ...place,
        start: tick - (FIGHT_END - FIGHT_START),
        winner: result === 2 ? null : result === 0 ? 1 : 0,
        captured: result === 0 && place.node !== null,
        shots_0: 3,
        losses_0: result === 0 ? 2 : 1,
        losses_1: result === 0 ? 1 : 3,
      },
    };
  }
  if (phase <= FIGHT_START || phase > FIGHT_END || (phase - FIGHT_START) % FIGHT_ROUND !== 0) {
    return null;
  }
  return {
    type: 'event',
    tick,
    kind: 'fight_round',
    data: {
      fight: 'dev-fight',
      ...place,
      shots_0: 1,
      virtual_0: 0,
      losses_0: round % 2 === 0 ? 1 : 0,
      losses_1: round % 2 === 0 ? 0 : 1,
      spent_0: 1,
    },
  };
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
    const fight = devFightEvent(map, tick);
    if (fight !== null) handlers.onEvent(fight);
    handlers.onSnapshot(devSnapshot(map, rules, tick));
    tick += 1;
  };
  step();
  const timer = setInterval(step, 1000 / rules.tick_hz);
  return () => {
    clearInterval(timer);
  };
}
