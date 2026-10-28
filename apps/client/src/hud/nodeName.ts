/** The names of the places for the interface texts (#449): they come from the map file only. */
import type { MapFile } from '../protocol.gen.ts';

/** The display name of the node `id`. */
export type NodeNamer = (id: number) => string;

/**
 * A namer for `map`: the name of the node as the map file has it (DEC-23, item 4: not translated).
 * A node the map does not know, or one with an empty name, reads `#<id>`, so a text never shows a
 * hole.
 */
export function nodeNamer(map: Pick<MapFile, 'nodes'>): NodeNamer {
  return (id) => {
    const name = map.nodes[id]?.name;
    return name === undefined || name === '' ? `#${String(id)}` : name;
  };
}
