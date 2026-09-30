/**
 * Scenes of the dev screen (CLI-04, #60), until the match screen (CLI-06) draws real snapshots.
 *
 * - Three fixtures from `packages/protocol/fixtures/server/` (`snapshot`, `snapshot_fog`,
 *   `snapshot_clash`), each on its map, frozen at the tick of the snapshot. The Playwright test
 *   (`visual/`) takes its reference screenshots from them.
 * - `demo`: a scripted sequence for any map, pushed through `SnapshotBuffer` so that the
 *   interpolation and the moving packets can be watched.
 */
import { SnapshotBuffer } from '../net/snapshotBuffer.ts';
import { interpolateFrame, type RenderFrame } from '../net/interpolate.ts';
import type { EventMsg, MapFile, SnapshotMsg } from '../protocol.gen.ts';
import type { RenderSource } from '../render/source.ts';

const files = import.meta.glob<SnapshotMsg>(
  '../../../../packages/protocol/fixtures/server/snapshot*.json',
  { eager: true, import: 'default' },
);

function fixture(name: string): SnapshotMsg {
  const found = Object.entries(files).find(([path]) => path.endsWith(`/${name}.json`));
  if (found === undefined) throw new Error(`fixture ${name}.json is missing`);
  return found[1];
}

function fight(tick: number, where: { node: number } | { edge: number }, l0: number, l1: number) {
  const event: EventMsg = {
    type: 'event',
    tick,
    kind: 'fight',
    data: {
      node: 'node' in where ? where.node : null,
      edge: 'edge' in where ? where.edge : null,
      attacker: 0,
      pool_0: 4,
      pool_1: 3,
      unspent_0: 1,
      unspent_1: 0,
      losses_0: l0,
      losses_1: l1,
    },
  };
  return event;
}

export interface FixtureScene {
  id: string;
  /** `meta.name` of the map the snapshot was written for. */
  map: string;
  snapshot: SnapshotMsg;
  events: readonly EventMsg[];
}

export const FIXTURE_SCENES: readonly FixtureScene[] = [
  {
    id: 'snapshot',
    map: 'diamond',
    snapshot: fixture('snapshot'),
    events: [fight(118, { edge: 3 }, 1, 2)],
  },
  { id: 'snapshot_fog', map: 'line3', snapshot: fixture('snapshot_fog'), events: [] },
  {
    id: 'snapshot_clash',
    map: 'siege',
    snapshot: fixture('snapshot_clash'),
    events: [fight(395, { edge: 1 }, 2, 3), fight(398, { node: 1 }, 0, 1)],
  },
];

export const DEMO_SCENE = 'demo';

/** A frozen scene: the snapshot at its own tick, no animation, so screenshots are stable. */
export function frozenSource(scene: FixtureScene): RenderSource {
  const frame: RenderFrame = interpolateFrame(scene.snapshot, null, scene.snapshot.tick);
  return { frame: () => frame, events: () => scene.events };
}

const DEMO_TICK_MS = 100;

/** The demo snapshot at `tick` for any map: owners from the map start, groups walking a road. */
export function demoSnapshot(map: MapFile, tick: number): SnapshotMsg {
  const mine = (owner: number | null): boolean => owner === 0;
  const first = map.edges.find((edge) => mine(map.nodes[edge.a]?.start_owner ?? null));
  const cycle = tick % 60;
  const exact = (id: number) => map.nodes[id]?.start_owner === 0;
  return {
    type: 'snapshot',
    tick,
    view: {
      me: { cp: 500, stance: 'balance' },
      vp: [0, 0],
      nodes: map.nodes.map((node) => ({
        id: node.id,
        owner: node.start_owner,
        capacity: node.base_capacity,
        detail: exact(node.id) ? 'exact' : node.start_owner === 1 ? 'presence' : 'fog',
        warehouse: exact(node.id) ? node.start_stock : null,
        seen:
          node.start_owner === 1
            ? {
                tick,
                level: 'presence',
                enemy_modes: node.capital_of === null ? ['defense'] : ['attack', 'build'],
                enemy_units: null,
                enemy_charged: null,
              }
            : null,
      })),
      edges: map.edges.map((edge) => ({
        id: edge.id,
        width: edge.base_width,
        detail: 'presence',
        upgrade_gain: null,
        seen: null,
      })),
      groups: [
        ...(first === undefined
          ? []
          : [
              {
                // A new id every lap: the group appears at the start again instead of
                // travelling back through interpolation.
                id: `demo-runner-${String(Math.floor(tick / 60)).padStart(4, '0')}`,
                units: 3,
                charged: 2,
                mode: 'attack' as const,
                location: {
                  kind: 'edge' as const,
                  edge: first.id,
                  from_node: first.a,
                  progress: Math.min(999, cycle * 17),
                },
                order: { dest: first.b, path: [first.b] as [number], planned: false },
              },
            ]),
        ...map.nodes.flatMap((node) =>
          node.start_owner === 0 && node.start_units > 0
            ? [
                {
                  id: `demo-${String(node.id).padStart(11, '0')}`,
                  units: node.start_units,
                  charged: node.start_charged,
                  mode: 'attack' as const,
                  location: { kind: 'node' as const, node: node.id },
                  order: null,
                },
              ]
            : [],
        ),
      ],
      packets:
        first === undefined
          ? []
          : [
              {
                id: 'demo-packet',
                edge: first.id,
                from_node: first.a,
                charges: 2,
                depart_tick: tick - cycle,
                arrive_tick: tick - cycle + 60,
              },
            ],
      intents: [],
    },
  };
}

/** The demo as a live source: one snapshot per tick, `DEMO_TICK_MS` of wall clock time each. */
export function demoSource(map: MapFile): RenderSource {
  const buffer = new SnapshotBuffer({ tickMs: DEMO_TICK_MS });
  const started = performance.now();
  let pushed = -1;
  const events: EventMsg[] = [];
  return {
    frame() {
      const tick = Math.floor((performance.now() - started) / DEMO_TICK_MS);
      for (let t = Math.max(pushed + 1, tick - 3); t <= tick; t++) {
        buffer.push(demoSnapshot(map, t));
        pushed = t;
        if (t % 120 === 119) {
          const node = map.nodes.find((n) => n.start_owner === 0 && n.capital_of === null);
          if (node !== undefined) events.push(fight(t, { node: node.id }, 1, 2));
        }
      }
      return buffer.sample();
    },
    events: () => events,
  };
}
