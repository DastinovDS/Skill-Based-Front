/**
 * The `progress` scene of the dev screen (#439): the `artery` moment with the progress marks of
 * the own cities in every state (ui-style 9.4a, variant A "Cells"): a recruit queue whose first
 * unit is waiting its turn, in production at several shares, ready with no room, or stopped by a
 * fight in the city (the attacked city 4), and a barracks or warehouse being built. Made here from
 * the artery scene, not a fixture of the protocol: it is a picture for the eyes, the numbers only
 * have to be plausible (the rule numbers are those of the welcome fixture).
 */
import { DEV_RULES } from '../hud/devFeed.ts';
import type { MapFile, NodeBuilding, NodeView, SnapshotMsg } from '../protocol.gen.ts';
import { ARTERY_TICK, arterySnapshot } from './arteryScene.ts';

export const PROGRESS_TICK = ARTERY_TICK;

/** What the scene gives an own city: a queue (and how far the first unit is) and/or a build. */
interface Marks {
  readonly queue?: number;
  /** Ticks of production of the first unit, 0..`unit_ticks`. */
  readonly progress?: number;
  /** The first unit is ready and waits for a place (DEC-25, item 7). */
  readonly waiting?: boolean;
  readonly build?: { readonly kind: NodeBuilding['kind']; readonly left: number };
  /** The city has the barracks (so it recruits). */
  readonly barracks?: boolean;
}

const UNIT = DEV_RULES.recruit.unit_ticks;

const MARKS: Readonly<Record<number, Marks>> = {
  // The capital: two queued, the first at half (a third slot is free: select the city); the warehouse is
  // being raised.
  0: { queue: 2, progress: UNIT / 2, build: { kind: 'warehouse', left: 40 }, barracks: true },
  // Ready with no room, and a warehouse just started.
  3: {
    queue: 2,
    waiting: true,
    progress: UNIT,
    build: { kind: 'warehouse', left: 90 },
    barracks: true,
  },
  // Under attack: the production stands (DEC-25, item 9), the warehouse is nearly done.
  4: { queue: 2, progress: 10, build: { kind: 'warehouse', left: 12 }, barracks: true },
  // One unit queued, not started.
  6: { queue: 1, progress: 0, barracks: true },
  // Three queued, the first about to come out.
  9: { queue: 3, progress: UNIT - 4, barracks: true },
  // Just a barracks, half way.
  1: { build: { kind: 'barracks', left: 50 } },
  // A warehouse just started.
  2: { build: { kind: 'warehouse', left: 100 } },
};

export function progressSnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  const nodes: NodeView[] = base.view.nodes.map((node) => {
    const marks = MARKS[node.id];
    if (marks === undefined || node.owner !== 0) return node;
    return {
      ...node,
      recruit_queue: marks.queue ?? 0,
      recruit_progress: marks.progress ?? 0,
      recruit_waiting: marks.waiting ?? false,
      has_barracks: marks.barracks ?? node.has_barracks,
      building:
        marks.build === undefined
          ? null
          : { kind: marks.build.kind, done_tick: PROGRESS_TICK + marks.build.left },
    };
  });
  return { ...base, view: { ...base.view, nodes } };
}
