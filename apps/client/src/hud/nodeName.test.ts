import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { nodeNamer } from './nodeName.ts';

describe('nodeNamer', () => {
  it('gives the name the map file has for the node', () => {
    const names = nodeNamer(DEFAULT_MAP);
    for (const node of DEFAULT_MAP.nodes) expect(names(node.id)).toBe(node.name);
  });

  it('never shows a hole: an unknown node or an empty name reads #<id>', () => {
    const map = { nodes: [{ name: '' }] } as unknown as Parameters<typeof nodeNamer>[0];
    expect(nodeNamer(map)(0)).toBe('#0');
    expect(nodeNamer(map)(9)).toBe('#9');
  });
});
