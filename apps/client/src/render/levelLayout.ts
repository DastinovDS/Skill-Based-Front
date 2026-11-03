/**
 * The geometry of the leaf-level fill (T1 "Bright fill", DEC-43, ui-style 42): the polygons of the
 * level cells and the thin rim along their border toward the own rear. Pure functions, no PixiJS.
 */
import type { Point } from './camera.ts';
import { territoryBorders, type CellEdge } from './regionLayout.ts';

/** One stretch of the rim: from `a` to `b`, drawn a little inside the level cell. */
export interface RimSegment {
  readonly a: Point;
  readonly b: Point;
}

/**
 * The rim of a set of level cells: their edges that face an own cell outside the set (toward the
 * rear). The border with the enemy or with nobody is the owner's line already and is left alone.
 * `owners[i]` is the owner of node `i`; `me` the viewing player; `inset` how far inside the rim lies.
 */
export function levelRim(
  cells: readonly (readonly Point[])[],
  edges: readonly CellEdge[],
  owners: readonly (number | null)[],
  me: number,
  level: ReadonlySet<number>,
  inset: number,
): RimSegment[] {
  const facing = edges.filter((edge) => {
    if (!level.has(edge.cell) || edge.neighbour === null) return false;
    return owners[edge.neighbour] === me && !level.has(edge.neighbour);
  });
  if (facing.length === 0) return [];
  // `territoryBorders` draws a line where the owner of a cell differs from the one across it: the
  // level cells stand for owner 1 and the rest for owner 0, over the edges that face the rear.
  const marked = owners.map((_, i) => (level.has(i) ? 1 : 0));
  return territoryBorders(cells, marked, inset, facing).map(({ a, b }) => ({ a, b }));
}

/**
 * How much of the fill a cell has while the level changes: a cell in both the old and the new set
 * stays at 1, one that enters grows with `share` (0..1), one that leaves shrinks with it.
 */
export function levelShare(
  cell: number,
  from: ReadonlySet<number>,
  to: ReadonlySet<number>,
  share: number,
): number {
  const was = from.has(cell);
  const now = to.has(cell);
  if (was && now) return 1;
  if (now) return share;
  if (was) return 1 - share;
  return 0;
}
