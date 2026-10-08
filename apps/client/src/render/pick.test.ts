import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { TokenSpot } from './layout.ts';
import { NODE_HIT_SLACK, pickAt, segmentDistance } from './pick.ts';
import { NODE_RADIUS } from './style.ts';

const map = DEFAULT_MAP;
const node = map.nodes[1] ?? map.nodes[0];
if (node === undefined) throw new Error('the default map has no nodes');
const at = { x: node.x, y: node.y };
const NONE = new Map<string, TokenSpot>();
const spot = (x: number, y: number, side = 24, scale = 1): TokenSpot => ({ x, y, side, scale });

describe('pickAt, size of the click area of a group', () => {
  // Away from the city circle, so only the token can be hit.
  const off = (dx: number): { x: number; y: number } => ({ x: at.x + dx, y: at.y - 200 });
  const lonely = new Map([['g', spot(at.x, at.y - 200, 24)]]);

  it('is at least 28 px on screen when zoomed out', () => {
    // Scale 0.5: the triangle is drawn 40 world units wide (20 px), the click area 56 (28 px).
    expect(pickAt(map, off(27), lonely, 0.5)).toEqual({ kind: 'group', id: 'g' });
    expect(pickAt(map, off(29), lonely, 0.5)?.kind).not.toBe('group');
  });

  it('is the drawn size when zoomed in', () => {
    expect(pickAt(map, off(11), lonely, 4)).toEqual({ kind: 'group', id: 'g' });
    expect(pickAt(map, off(13), lonely, 4)?.kind).not.toBe('group');
  });
});

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
      ['a', spot(at.x, at.y)],
      ['b', spot(at.x + 5, at.y)],
    ]);
    expect(pickAt(map, at, tokens)).toEqual({ kind: 'group', id: 'b' });
    const edge = { x: at.x - 14 - 1, y: at.y };
    expect(pickAt(map, edge, tokens)?.kind).not.toBe('group');
  });

  it('hits a road away from any city, and prefers the city near its end', () => {
    const edge = map.edges[0];
    const a = edge === undefined ? undefined : map.nodes[edge.a];
    const b = edge === undefined ? undefined : map.nodes[edge.b];
    if (edge === undefined || a === undefined || b === undefined) throw new Error('no roads');
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(pickAt(map, middle, NONE)).toEqual({ kind: 'edge', id: edge.id });
    expect(pickAt(map, { x: a.x, y: a.y }, NONE)).toEqual({ kind: 'node', id: a.id });
    expect(segmentDistance(middle, a, b)).toBeCloseTo(0);
  });
});
