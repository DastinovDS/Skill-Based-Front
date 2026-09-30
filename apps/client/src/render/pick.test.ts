import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { TOKEN_FULL } from './layout.ts';
import { NODE_HIT_SLACK, pickAt } from './pick.ts';
import { NODE_RADIUS } from './style.ts';

const map = DEFAULT_MAP;
const node = map.nodes[1] ?? map.nodes[0];
if (node === undefined) throw new Error('the default map has no nodes');
const at = { x: node.x, y: node.y };
const NONE = new Map<string, { x: number; y: number }>();

describe('pickAt', () => {
  it('hits a node inside its circle and within the slack', () => {
    expect(pickAt(map, at, NONE)).toEqual({ kind: 'node', id: node.id });
    const near = { x: at.x + NODE_RADIUS + NODE_HIT_SLACK - 1, y: at.y };
    expect(pickAt(map, near, NONE)).toEqual({ kind: 'node', id: node.id });
  });

  it('hits nothing on the empty map', () => {
    const far = { x: at.x + 1000, y: at.y + 1000 };
    expect(pickAt(map, far, NONE)).toBeNull();
  });

  it('prefers a group token over the node under it, and the last drawn of two', () => {
    const tokens = new Map([
      ['a', { x: at.x, y: at.y }],
      ['b', { x: at.x + 5, y: at.y }],
    ]);
    expect(pickAt(map, at, tokens)).toEqual({ kind: 'group', id: 'b' });
    const edge = { x: at.x - TOKEN_FULL.width / 2 - 1, y: at.y };
    expect(pickAt(map, edge, tokens)?.kind).not.toBe('group');
  });
});
