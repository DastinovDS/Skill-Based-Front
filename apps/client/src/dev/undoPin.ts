import type { MapInteraction, UndoMark } from '../render/interaction.ts';

/** How old a pinned cue always is, ms: the order mostly wound back, the ring winding (Rewind, #851). */
const PIN_AGE_MS = 380;

/**
 * `?undo=<what>` on the dev screen: the cue of `X` (#764) pinned to a frozen scene (a fixture scene
 * has no server to accept an undo), so the screenshots can look at it. `empty`: nothing to undo;
 * `node,<id>`: a recruit undone in that city; `group,<id>,<node>...`: the order of a group undone,
 * with the nodes it still had ahead. `null`: no or a broken value.
 */
export function parseUndo(value: string | null): Omit<UndoMark, 'at'> | null {
  if (value === null) return null;
  const [kind, id, ...path] = value.split(',');
  if (kind === 'empty') return { group: null, node: null, path: [] };
  if (id === undefined || id === '') return null;
  if (kind === 'node' && Number.isInteger(Number(id))) {
    return { group: null, node: Number(id), path: [] };
  }
  const nodes = path.map(Number);
  return kind === 'group' && nodes.every((n) => Number.isInteger(n) && n >= 0)
    ? { group: id, node: null, path: nodes }
    : null;
}

/** The interaction of the map with the cue added to its overlay, forever the same age. */
export function pinUndo(base: MapInteraction, mark: Omit<UndoMark, 'at'>): MapInteraction {
  return {
    overlay: () => ({
      ...base.overlay(),
      undo: [{ ...mark, at: performance.now() - PIN_AGE_MS }],
    }),
    click: (hit, shift) => {
      base.click(hit, shift);
    },
    hover: (hit) => {
      base.hover(hit);
    },
  };
}
