import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupView, Location, PacketView, SnapshotMsg } from '../protocol.gen.ts';
import { interpolateFrame, interpolateLocation, packetProgress } from './interpolate.ts';
import { SnapshotBuffer } from './snapshotBuffer.ts';

const fixtures = import.meta.glob<string>('../../../../packages/protocol/fixtures/server/*.json', {
  eager: true,
  import: 'default',
  query: '?raw',
});
const base = JSON.parse(
  fixtures['../../../../packages/protocol/fixtures/server/snapshot.json'] ?? 'null',
) as SnapshotMsg;

const onEdge = (edge: number, from_node: number, progress: number): Location => ({
  kind: 'edge',
  edge,
  from_node,
  progress,
});
const atNode = (node: number): Location => ({ kind: 'node', node });
const group = (id: string, location: Location): GroupView => ({
  id,
  units: 2,
  charged: 1,
  mode: 'attack',
  location,
  order: null,
  defense_bonus: null,
  defense_cap: null,
});
const packet = (id: string, depart_tick: number, arrive_tick: number): PacketView => ({
  id,
  edge: 0,
  from_node: 0,
  charges: 1,
  depart_tick,
  arrive_tick,
  path: [1],
  dest_tick: arrive_tick,
  transfer: false,
});
/** The PRO-01 snapshot fixture with another tick, groups and packets. */
function snap(tick: number, groups: GroupView[] = [], packets: PacketView[] = []): SnapshotMsg {
  return {
    type: 'snapshot',
    tick,
    view: { ...base.view, nodes: [], edges: [], intents: [], groups, packets },
  };
}
const locOf = (snapshot: SnapshotMsg, id: string): Location | undefined =>
  snapshot.view.groups.find((g) => g.id === id)?.location;

describe('interpolateLocation', () => {
  it('moves along one edge, forward and back (bounce)', () => {
    expect(interpolateLocation(onEdge(1, 0, 200), onEdge(1, 0, 600), 0.5)).toEqual(
      onEdge(1, 0, 400),
    );
    expect(interpolateLocation(onEdge(1, 0, 600), onEdge(1, 0, 200), 0.25)).toEqual(
      onEdge(1, 0, 500),
    );
  });

  it('runs to the far end when the group is at a node in the later snapshot', () => {
    expect(interpolateLocation(onEdge(1, 0, 800), atNode(2), 0.5)).toEqual(onEdge(1, 0, 900));
  });

  it('runs back to from_node after a bounce into it', () => {
    expect(interpolateLocation(onEdge(1, 0, 400), atNode(0), 0.5)).toEqual(onEdge(1, 0, 200));
  });

  it('leaves a node along the edge it departs on, from progress 0', () => {
    expect(interpolateLocation(atNode(0), onEdge(1, 0, 300), 0.5)).toEqual(onEdge(1, 0, 150));
  });

  it('holds the earlier place when the change cannot be interpolated', () => {
    expect(interpolateLocation(atNode(0), atNode(2), 0.9)).toEqual(atNode(0));
    expect(interpolateLocation(atNode(0), onEdge(1, 3, 300), 0.9)).toEqual(atNode(0));
    expect(interpolateLocation(onEdge(1, 0, 400), onEdge(2, 0, 100), 0.9)).toEqual(
      onEdge(1, 0, 400),
    );
    expect(interpolateLocation(onEdge(1, 0, 400), null, 0.9)).toEqual(onEdge(1, 0, 400));
  });
});

describe('interpolateFrame', () => {
  it('interpolates progress of groups between two snapshots', () => {
    const a = snap(10, [group('g', onEdge(1, 0, 200))]);
    const b = snap(11, [group('g', onEdge(1, 0, 300))]);
    const frame = interpolateFrame(a, b, 10.5);
    expect(frame.tick).toBe(10.5);
    expect(frame.base).toBe(a);
    expect(frame.groups.map((g) => g.location)).toEqual([onEdge(1, 0, 250)]);
  });

  it('draws only groups of the earlier snapshot: a new one appears with its snapshot', () => {
    const a = snap(10, [group('old', atNode(0))]);
    const b = snap(11, [group('new', atNode(1))]);
    expect(interpolateFrame(a, b, 10.9).groups.map((g) => g.group.id)).toEqual(['old']);
  });

  it('never extrapolates: the time is clamped to the two snapshots, without a newer one it holds', () => {
    const a = snap(10, [group('g', onEdge(1, 0, 200))]);
    const b = snap(11, [group('g', onEdge(1, 0, 300))]);
    expect(interpolateFrame(a, b, 14).groups[0]?.location).toEqual(onEdge(1, 0, 300));
    expect(interpolateFrame(a, b, 5).groups[0]?.location).toEqual(onEdge(1, 0, 200));
    expect(interpolateFrame(a, null, 12).groups[0]?.location).toEqual(onEdge(1, 0, 200));
    expect(interpolateFrame(a, null, 12).tick).toBe(10);
  });

  it('interpolates across a gap of several ticks', () => {
    const a = snap(10, [group('g', onEdge(1, 0, 100))]);
    const b = snap(14, [group('g', onEdge(1, 0, 500))]);
    expect(interpolateFrame(a, b, 12).groups[0]?.location).toEqual(onEdge(1, 0, 300));
  });

  it('moves packets by their own ticks, without a second snapshot', () => {
    const a = snap(10, [], [packet('p', 8, 18)]);
    expect(packetProgress(packet('p', 8, 18), 13)).toBe(500);
    expect(interpolateFrame(a, snap(11), 10.5).packets[0]?.progress).toBe(250);
    expect(packetProgress(packet('p', 8, 18), 5)).toBe(0);
    expect(packetProgress(packet('p', 8, 18), 99)).toBe(1000);
    expect(packetProgress(packet('p', 8, 8), 8)).toBe(1000);
  });
});

describe('SnapshotBuffer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const moving = (tick: number): SnapshotMsg => snap(tick, [group('g', onEdge(1, 0, tick * 10))]);
  const progressOf = (buffer: SnapshotBuffer): number | undefined => {
    const loc = buffer.sample()?.groups[0]?.location;
    return loc?.kind === 'edge' ? loc.progress : undefined;
  };

  it('has no frame before the first snapshot', () => {
    expect(new SnapshotBuffer().sample()).toBeNull();
  });

  it('renders two ticks behind the newest snapshot and interpolates in real time', () => {
    const buffer = new SnapshotBuffer({ delayTicks: 2 });
    for (const tick of [100, 101, 102]) buffer.push(moving(tick));
    // Render time starts at 100 (newest 102 minus 2).
    expect(progressOf(buffer)).toBe(1000);
    vi.advanceTimersByTime(50);
    expect(progressOf(buffer)).toBe(1005);
    vi.advanceTimersByTime(50);
    expect(progressOf(buffer)).toBe(1010);
    expect(buffer.sample()?.base.tick).toBe(101);
  });

  it('shows the first snapshot until the delay has built up, then runs smoothly at 10 Hz', () => {
    const buffer = new SnapshotBuffer({ delayTicks: 2 });
    const seen: (number | undefined)[] = [];
    for (let tick = 100; tick < 106; tick++) {
      buffer.push(moving(tick));
      seen.push(progressOf(buffer));
      vi.advanceTimersByTime(100);
    }
    // 100, 101 and 102 hold snapshot 100 (render time is still before it); then +10 per tick.
    expect(seen).toEqual([1000, 1000, 1000, 1010, 1020, 1030]);
  });

  it('waits on a late snapshot instead of extrapolating', () => {
    const buffer = new SnapshotBuffer({ delayTicks: 2 });
    for (const tick of [100, 101, 102]) buffer.push(moving(tick));
    vi.advanceTimersByTime(10_000);
    // Render time stops at newest - delay + 1, so the cushion of one snapshot is kept.
    const frame = buffer.sample();
    expect(frame?.tick).toBe(101);
    expect(progressOf(buffer)).toBe(1010);
  });

  it('jumps into the window after a long pause of rendering', () => {
    const buffer = new SnapshotBuffer({ delayTicks: 2 });
    buffer.push(moving(100));
    vi.advanceTimersByTime(300);
    for (const tick of [103, 104]) buffer.push(moving(tick));
    // Newest 104: the window is [102, 104]; the clock (98 + 3 = 101) is behind it and jumps in.
    expect(buffer.sample()?.tick).toBe(102);
    vi.advanceTimersByTime(5_000);
    buffer.push(moving(150));
    expect(buffer.sample()?.tick).toBe(149);
  });

  it('keeps the delay after a stall: the next snapshots do not catch the clock up', () => {
    const buffer = new SnapshotBuffer({ delayTicks: 2 });
    for (const tick of [100, 101, 102]) buffer.push(moving(tick));
    vi.advanceTimersByTime(10_000);
    buffer.sample();
    for (let tick = 103; tick < 106; tick++) {
      buffer.push(moving(tick));
      vi.advanceTimersByTime(100);
    }
    // Newest 105, the clock is capped at 104, not 105: still a snapshot of cushion ahead.
    expect(buffer.sample()?.tick).toBe(104);
  });

  it('interpolates across a skipped snapshot', () => {
    const buffer = new SnapshotBuffer({ delayTicks: 2 });
    for (const tick of [100, 101, 103, 104]) buffer.push(moving(tick));
    expect(buffer.size).toBe(4);
    // Render time 102 (newest 104 minus 2) lies between the snapshots 101 and 103.
    const frame = buffer.sample();
    expect(frame?.tick).toBe(102);
    expect(frame?.base.tick).toBe(101);
    expect(progressOf(buffer)).toBe(1020);
  });

  it('ignores a duplicate and a stale snapshot', () => {
    const buffer = new SnapshotBuffer();
    expect(buffer.push(moving(100))).toBe('added');
    expect(buffer.push(moving(101))).toBe('added');
    expect(buffer.push(moving(101))).toBe('duplicate');
    expect(buffer.push(moving(100))).toBe('stale');
    expect(buffer.push(moving(99))).toBe('stale');
    expect(buffer.size).toBe(2);
    expect(buffer.newestTick).toBe(101);
  });

  it('keeps at most `capacity` snapshots, dropping the oldest', () => {
    const buffer = new SnapshotBuffer({ capacity: 3 });
    for (let tick = 1; tick <= 6; tick++) buffer.push(moving(tick));
    expect(buffer.size).toBe(3);
    expect(buffer.sample()?.base.tick).toBe(4);
  });

  it('forgets everything on clear and starts a new timeline at any tick', () => {
    const buffer = new SnapshotBuffer({ delayTicks: 2 });
    for (const tick of [100, 101, 102]) buffer.push(moving(tick));
    buffer.clear();
    expect(buffer.size).toBe(0);
    expect(buffer.sample()).toBeNull();
    expect(buffer.newestTick).toBeNull();
    // After a resync the tick may even be lower than before.
    expect(buffer.push(moving(40))).toBe('added');
    expect(buffer.sample()?.base.tick).toBe(40);
  });

  it('delay is configurable', () => {
    const buffer = new SnapshotBuffer({ delayTicks: 3 });
    for (const tick of [100, 101, 102, 103]) buffer.push(moving(tick));
    expect(buffer.sample()?.tick).toBe(100);
    buffer.delayTicks = 2;
    expect(buffer.delayTicks).toBe(2);
    expect(buffer.sample()?.tick).toBe(101);
  });

  it('uses the tick length it is given', () => {
    const buffer = new SnapshotBuffer({ delayTicks: 2, tickMs: 50 });
    for (const tick of [100, 101, 102]) buffer.push(moving(tick));
    vi.advanceTimersByTime(125); // the clock starts at 98: 98 + 125 / 50
    expect(buffer.sample()?.tick).toBe(100.5);
  });

  it('does not keep the group locations of a snapshot it interpolates (no mutation)', () => {
    const buffer = new SnapshotBuffer({ delayTicks: 1 });
    const a = moving(100);
    const b = moving(101);
    buffer.push(a);
    buffer.push(b);
    vi.advanceTimersByTime(50);
    buffer.sample();
    expect(locOf(a, 'g')).toEqual(onEdge(1, 0, 1000));
    expect(locOf(b, 'g')).toEqual(onEdge(1, 0, 1010));
  });
});
