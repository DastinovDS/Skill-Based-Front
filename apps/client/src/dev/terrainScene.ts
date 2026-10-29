/**
 * The `terrain` scene of the dev screen (#429): the `artery` moment for the terrain map mode (T).
 * The artery scene sees the places beside its garrisons only as presence, so here every second one
 * of them is seen as a range, to show all three sight signs (exact on the own garrisons' places,
 * range, presence). Made here from the artery scene, not a fixture of the protocol: a picture for
 * the eyes; which place is seen how is just plausible, the server decides it (DEC-21).
 */
import type { MapFile, NodeView, SnapshotMsg } from '../protocol.gen.ts';
import { ARTERY_TICK, arterySnapshot } from './arteryScene.ts';

export const TERRAIN_TICK = ARTERY_TICK;

export function terrainSnapshot(map: MapFile): SnapshotMsg {
  const base = arterySnapshot(map);
  let seenPresence = 0;
  const nodes: NodeView[] = base.view.nodes.map((node) => {
    if (node.detail !== 'presence') return node;
    seenPresence += 1;
    if (seenPresence % 2 === 1) return node;
    return {
      ...node,
      detail: 'range',
      seen: node.seen === null ? null : { ...node.seen, level: 'range' },
    };
  });
  return { ...base, view: { ...base.view, nodes } };
}
