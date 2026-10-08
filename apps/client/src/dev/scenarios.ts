/**
 * Scenes of the dev screen (CLI-04, #60): three fixtures from
 * `packages/protocol/fixtures/server/` (`snapshot`, `snapshot_fog`, `snapshot_clash`), each on
 * its map, frozen at the tick of the snapshot. The Playwright test (`visual/`) takes its reference
 * screenshots from them. The live `demo` scene is the dev server's match (CLI-06, #62).
 */
import { DEV_RULES } from '../hud/devFeed.ts';
import { interpolateFrame, type RenderFrame } from '../net/interpolate.ts';
import type { EventMsg, SnapshotMsg } from '../protocol.gen.ts';
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

/** The scene that is not a fixture: a live match against the dev server (`dev/devServer.ts`). */
export const DEMO_SCENE = 'demo';

/** A frozen scene: the snapshot at its own tick, no animation, so screenshots are stable. */
export function frozenSource(scene: FixtureScene): RenderSource {
  const frame: RenderFrame = interpolateFrame(scene.snapshot, null, scene.snapshot.tick);
  return {
    frame: () => frame,
    events: () => scene.events,
    orderDelays: {
      planned: DEV_RULES.orders.planned_delay_ticks,
      defense: DEV_RULES.orders.defense_delay_ticks,
    },
  };
}
