import { describe, expect, it } from 'vitest';
import type { EdgeView, EnemyGroup, SnapshotMsg } from '../protocol.gen.ts';
import { interpolateFrame } from './interpolate.ts';

const fixtures = import.meta.glob<string>('../../../../packages/protocol/fixtures/server/*.json', {
  eager: true,
  import: 'default',
  query: '?raw',
});
const base = JSON.parse(
  fixtures['../../../../packages/protocol/fixtures/server/snapshot.json'] ?? 'null',
) as SnapshotMsg;
const road = base.view.edges[0] as EdgeView;

const figure = (id: string, pos: number, toward_b = true): EnemyGroup => ({
  id,
  pos,
  toward_b,
  detail: 'presence',
  mode: 'attack',
  units: null,
  charged: null,
  units_range: null,
});

/** A snapshot whose roads carry exactly these figures (`edge`: the road of each). */
function snap(tick: number, figures: readonly (readonly [number, EnemyGroup])[]): SnapshotMsg {
  const edges = base.view.edges.map((edge) => ({
    ...edge,
    enemy_groups: figures.filter(([id]) => id === edge.id).map(([, f]) => f),
  }));
  return { ...base, tick, view: { ...base.view, edges, groups: [], packets: [] } };
}

const posOf = (frame: ReturnType<typeof interpolateFrame>, id: string): number | undefined =>
  frame.enemies.find((e) => e.figure.id === id)?.pos;

describe('interpolateFrame, enemy figures (DEC-33)', () => {
  it('moves a figure between its positions in two snapshots', () => {
    const a = snap(100, [[road.id, figure('x', 200)]]);
    const b = snap(110, [[road.id, figure('x', 400)]]);
    expect(posOf(interpolateFrame(a, b, 100), 'x')).toBe(200);
    expect(posOf(interpolateFrame(a, b, 102.5), 'x')).toBe(250);
    expect(posOf(interpolateFrame(a, b, 110), 'x')).toBe(400);
  });

  it('moves a figure backwards when it goes to the end a', () => {
    const a = snap(100, [[road.id, figure('x', 800, false)]]);
    const b = snap(110, [[road.id, figure('x', 600, false)]]);
    expect(posOf(interpolateFrame(a, b, 105), 'x')).toBe(700);
  });

  it('does not extrapolate: with nothing newer the figure stays where it is', () => {
    const a = snap(100, [[road.id, figure('x', 200)]]);
    expect(posOf(interpolateFrame(a, null, 107), 'x')).toBe(200);
    const b = snap(110, [[road.id, figure('x', 400)]]);
    // The render time is clamped to the two snapshots.
    expect(posOf(interpolateFrame(a, b, 130), 'x')).toBe(400);
  });

  it('draws no line through a gap: a new id is another figure, a vanished one holds', () => {
    // It left into the fog and came out again: another id, so no motion between the two.
    const a = snap(100, [[road.id, figure('old', 480)]]);
    const b = snap(110, [[road.id, figure('new', 520)]]);
    const frame = interpolateFrame(a, b, 105);
    expect(frame.enemies.map((e) => [e.figure.id, e.pos])).toEqual([['old', 480]]);
    // It arrived in a city (gone from the list): it stays at its last place until `b` is the base.
    const arrived = snap(110, []);
    expect(posOf(interpolateFrame(a, arrived, 105), 'old')).toBe(480);
  });

  it('does not tie a figure to another road or to the other way', () => {
    const a = snap(100, [[road.id, figure('x', 200)]]);
    const turned = snap(110, [[road.id, figure('x', 100, false)]]);
    expect(posOf(interpolateFrame(a, turned, 105), 'x')).toBe(200);
    const other = base.view.edges.find((edge) => edge.id !== road.id);
    if (other === undefined) throw new Error('one road only');
    const moved = snap(110, [[other.id, figure('x', 400)]]);
    expect(posOf(interpolateFrame(a, moved, 105), 'x')).toBe(200);
  });

  it('lists only the figures of the base snapshot: nothing appears before its snapshot', () => {
    const a = snap(100, []);
    const b = snap(110, [[road.id, figure('late', 300)]]);
    expect(interpolateFrame(a, b, 109).enemies).toEqual([]);
  });
});
