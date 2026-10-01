import { describe, expect, it } from 'vitest';
import { SAMPLE } from './fixture.ts';
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
});
