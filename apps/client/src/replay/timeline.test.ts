import { describe, expect, it } from 'vitest';
import { SAMPLE } from './fixture.ts';
import { parseReplay } from './replayFile.ts';
import { buildTimeline } from './timeline.ts';

const timeline = buildTimeline(SAMPLE);

describe('buildTimeline', () => {
  it('makes one snapshot per frame, at the frame tick', () => {
    expect(timeline.snapshots.map((s) => s.tick)).toEqual(SAMPLE.frames.map((f) => f.t));
  });

  it('shows every city and road without fog, with the capacity from the file', () => {
    const view = timeline.snapshots[0]?.view;
    expect(view?.nodes).toHaveLength(SAMPLE.map.nodes.length);
    expect(view?.nodes.every((n) => n.detail === 'exact' && n.seen === null)).toBe(true);
    expect(view?.nodes.map((n) => n.capacity)).toEqual(SAMPLE.frames[0]?.n.map((n) => n[2]));
    expect(view?.edges.every((e) => e.detail !== 'fog')).toBe(true);
  });

  it('keeps the groups of both players, with owners by id', () => {
    const owners = new Set(timeline.groupOwners.values());
    expect(owners).toEqual(new Set([0, 1]));
    const frame = SAMPLE.frames.find((f) => f.g.some((g) => g.o === 1));
    const snapshot = timeline.snapshots.find((s) => s.tick === frame?.t);
    expect(snapshot?.view.groups.map((g) => timeline.groupOwners.get(g.id))).toEqual(
      frame?.g.map((g) => g.o),
    );
  });

  it('turns locations, orders and VP into the protocol shapes', () => {
    const frame = SAMPLE.frames.find((f) => f.g.some((g) => g.on !== undefined && g.to));
    const raw = frame?.g.find((g) => g.on !== undefined && g.to);
    const group = timeline.snapshots
      .find((s) => s.tick === frame?.t)
      ?.view.groups.find((g) => g.id === String(raw?.id));
    expect(group?.location).toEqual({
      kind: 'edge',
      edge: raw?.on?.[0],
      from_node: raw?.on?.[1],
      progress: raw?.on?.[2],
    });
    expect(group?.order?.path).toEqual(raw?.to);
    expect(group?.order?.dest).toBe(raw?.to?.at(-1));
    const last = timeline.snapshots.at(-1);
    expect(last?.view.vp).toEqual(SAMPLE.vp);
  });

  it('carries every event of the file', () => {
    expect(timeline.events).toHaveLength(SAMPLE.events.length);
    expect(timeline.events.at(-1)).toMatchObject({ kind: 'match_ended', tick: SAMPLE.ticks });
  });

  it('lists the fights going on from the frame key "f" (DEC-24): both sides, none without it', () => {
    const first = SAMPLE.frames[0];
    if (first === undefined) throw new Error('the sample has no frames');
    const withFight = buildTimeline({
      ...SAMPLE,
      frames: [{ ...first, f: [[7, null, 1, 1250, null, 40, 50, [3, 4]]] }],
    }).snapshots[0];
    expect(withFight?.view.fights).toEqual([
      {
        id: '7',
        node: null,
        edge: 1,
        point: 1250,
        attacker: null,
        start_tick: 40,
        next_round_tick: 50,
        groups: ['3', '4'],
        enemy_units: 0,
        enemy_charged: 0,
        shots: [0, 0],
        losses: [0, 0],
        last_round: null,
      },
    ]);
    expect(timeline.snapshots[0]?.view.fights).toEqual([]);
  });

  it('fills the road builds of the edges from the frame key "e" (DEC-28), none without it', () => {
    const first = SAMPLE.frames[0];
    if (first === undefined) throw new Error('the sample has no frames');
    const [built] = buildTimeline({
      ...SAMPLE,
      frames: [{ ...first, e: [[1, 0, 150]] }],
    }).snapshots;
    expect(built?.view.edges[1]?.build).toEqual({ done_tick: 150 });
    expect(built?.view.edges.filter((e) => e.build !== null)).toHaveLength(1);
    expect(timeline.snapshots[0]?.view.edges.every((e) => e.build === null)).toBe(true);
  });

  it('reads the road builds of cities of older files (key "b", DEC-16) as builds of the edge', () => {
    const first = SAMPLE.frames[0];
    if (first === undefined) throw new Error('the sample has no frames');
    const [built] = buildTimeline({
      ...SAMPLE,
      frames: [{ ...first, b: [[2, 1, 150]] }],
    }).snapshots;
    expect(built?.view.edges[1]?.build).toEqual({ done_tick: 150 });
  });

  it('reads a file from before DEC-16: a "build" group shows as attacking, its intent is dropped', () => {
    const first = SAMPLE.frames[0];
    const group = first?.g[0];
    if (first === undefined || group === undefined) throw new Error('the sample has no group');
    const legacy = parseReplay({
      ...SAMPLE,
      frames: [
        {
          ...first,
          g: [{ ...group, m: 'build', b: 0 }],
          i: [
            [7, 0, 'build', 0, null],
            [8, 1, 'defense', 3, null],
          ],
        },
      ],
    });
    const view = buildTimeline(legacy).snapshots[0]?.view;
    expect(view?.groups[0]?.mode).toBe('attack');
    expect(view?.intents.map((i) => i.kind)).toEqual(['defense']);
  });
});
