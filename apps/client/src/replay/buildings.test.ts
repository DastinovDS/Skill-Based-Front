import { describe, expect, it } from 'vitest';
import type { PlayerId } from '../protocol.gen.ts';
import { SAMPLE, SAMPLE_BUILDINGS, SAMPLE_FOG } from './fixture.ts';
import { ReplayPlayer } from './replayPlayer.ts';
import { hasBuildings, parseReplay, type ReplayFile } from './replayFile.ts';
import { buildTimeline } from './timeline.ts';

// The buildings of the replay frames (#905): format 1 and 2, the full view, and a side's view with
// the fog. The expected numbers are written out from `docs/design/replay-frames.md` ("Buildings"),
// not read back from the code under test.

/** Player 0 owns 0 and 1, player 1 owns 4 and 5 (the capitals are 0 and 5 on `siege`). */
function built(): { file: ReplayFile; road0: number; road5: number } {
  const file = structuredClone(SAMPLE_BUILDINGS);
  const frame = file.frames[0];
  if (frame === undefined) throw new Error('no frame');
  frame.n[1] = [0, 0, 3];
  frame.n[4] = [1, 0, 3];
  const road0 = file.map.edges.findIndex((e) => e.a === 0 || e.b === 0);
  const road5 = file.map.edges.findIndex((e) => e.a === 5 || e.b === 5);
  frame.c = [
    [0, 0, null, 1, null, [2, 10, 0], 1],
    [1, null, [null, 4], 0, [150, 0]],
    [4, null, [170, 0], 0, [null, 1]],
    [5, 1, null, 1, null, [1, 5, 1], 4],
  ];
  frame.d = [
    [road0, 0, 1, 40],
    [road5, 5, 0, 90],
  ];
  const [first, second] = frame.v ?? [];
  if (first === undefined || second === undefined) throw new Error('no vision');
  // Player 0 saw the enemy capital's factory and barracks and its fortification (not built yet);
  // player 1 saw nothing of the buildings but the fortification of node 0.
  first.c = [[5, 1, 1]];
  first.d = [[road5, 5, 0]];
  delete second.c;
  second.d = [[road0, 0, 1]];
  return { file, road0, road5 };
}

const nodeOf = (file: ReplayFile, side: PlayerId | null, id: number) =>
  buildTimeline(file, side).snapshots[0]?.view.nodes[id];

describe('the formats (#905)', () => {
  it('reads format 1 and 2 and refuses any other', () => {
    expect(SAMPLE.format).toBe(1);
    expect(SAMPLE_BUILDINGS.format).toBe(2);
    const raw = (format: number): unknown => ({ ...structuredClone(SAMPLE_BUILDINGS), format });
    expect(parseReplay(raw(1)).format).toBe(1);
    expect(parseReplay(raw(2)).format).toBe(2);
    for (const format of [0, 3, 'x']) {
      expect(() => parseReplay(raw(format as number))).toThrow(
        expect.objectContaining({ code: 'format' }),
      );
    }
  });

  it('draws the buildings of a format 1 file written between the two parts (it has the keys)', () => {
    const file = parseReplay({ ...structuredClone(SAMPLE_BUILDINGS), format: 1 });
    expect(hasBuildings(file)).toBe(true);
    expect(nodeOf(file, null, 0)?.factory).toBe(true);
  });

  it('shows no buildings for a format 1 file without the keys', () => {
    expect(hasBuildings(SAMPLE)).toBe(false);
    const nodes = buildTimeline(SAMPLE).snapshots.flatMap((s) => s.view.nodes);
    expect(nodes.every((n) => n.factory === null && n.has_barracks === null)).toBe(true);
    expect(nodes.every((n) => n.building === null && n.rally_point === null)).toBe(true);
    const edges = buildTimeline(SAMPLE).snapshots.flatMap((s) => s.view.edges);
    expect(edges.every((e) => e.forts.length === 0)).toBe(true);
    // Nothing for the renderer to draw buildings with either.
    const player = new ReplayPlayer(SAMPLE);
    expect(player.cityUpgrades).toBeUndefined();
    expect(player.recruitTicks).toBeUndefined();
    expect(player.fortBuildTicks).toBeUndefined();
  });

  it('drops damaged building keys instead of drawing a half', () => {
    const raw = structuredClone(SAMPLE_BUILDINGS) as unknown as {
      frames: { c?: unknown; d?: unknown }[];
    };
    if (raw.frames[3] === undefined) throw new Error('no frame');
    raw.frames[3].c = [[999, 0]];
    const file = parseReplay(raw);
    expect(hasBuildings(file)).toBe(false);
    expect(file.frames.every((f) => f.d === undefined)).toBe(true);
  });

  it('keeps the rule numbers of the header, and the renderer gets them from the player', () => {
    expect(SAMPLE_BUILDINGS.rules).toEqual({
      unit_ticks: 30,
      queue_max: 3,
      barracks_ticks: 100,
      barracks_charges: 3,
      factory_ticks: 100,
      factory_charges: 4,
      fort_ticks: 100,
    });
    const player = new ReplayPlayer(SAMPLE_BUILDINGS);
    expect(player.recruitTicks).toBe(30);
    expect(player.recruitQueueMax).toBe(3);
    expect(player.fortBuildTicks).toBe(100);
    expect(player.cityUpgrades).toEqual({
      barracks: 100,
      factory: 100,
      barracksCharges: 3,
      factoryCharges: 4,
    });
  });

  it('draws a file with buildings but no header without time bars', () => {
    const raw = { ...structuredClone(SAMPLE_BUILDINGS), format: 1 } as Record<string, unknown>;
    delete raw.rules;
    const player = new ReplayPlayer(parseReplay(raw));
    expect(player.cityUpgrades).toEqual({ barracks: 0 });
    expect(player.recruitTicks).toBeUndefined();
  });
});

describe('the full view shows the buildings of both players (#905)', () => {
  const { file, road0, road5 } = built();

  it('has factories, barracks, builds, queues and rally points of both sides', () => {
    expect(nodeOf(file, null, 0)).toMatchObject({
      factory: true,
      has_barracks: true,
      factory_build: null,
      building: null,
      recruit_queue: 2,
      recruit_progress: 10,
      recruit_waiting: false,
      rally_point: 1,
    });
    expect(nodeOf(file, null, 5)).toMatchObject({
      factory: true,
      has_barracks: true,
      recruit_queue: 1,
      recruit_progress: 5,
      recruit_waiting: true,
      rally_point: 4,
    });
  });

  it('has the builds of both sides, done_tick null while charges are owed', () => {
    expect(nodeOf(file, null, 1)).toMatchObject({
      factory: false,
      has_barracks: false,
      factory_build: { done_tick: null, owed: 4 },
      building: { kind: 'barracks', done_tick: 150, owed: 0 },
    });
    expect(nodeOf(file, null, 4)).toMatchObject({
      factory_build: { done_tick: 170, owed: 0 },
      building: { kind: 'barracks', done_tick: null, owed: 1 },
    });
  });

  it('has a city without a record as a plain city, a province as none', () => {
    const plain = file.map.nodes.findIndex(
      (n, id) => n.kind !== 'province' && ![0, 1, 4, 5].includes(id),
    );
    expect(nodeOf(file, null, plain)).toMatchObject({ factory: false, has_barracks: false });
    const province = file.map.nodes.findIndex((n) => n.kind === 'province');
    if (province >= 0) expect(nodeOf(file, null, province)).toMatchObject({ factory: null });
  });

  it('has the fortifications of both sides, the ready tick only while building', () => {
    const edges = buildTimeline(file).snapshots[0]?.view.edges;
    expect(edges?.[road0]?.forts).toContainEqual({
      node: 0,
      owner: 0,
      built: true,
      done_tick: null,
    });
    expect(edges?.[road5]?.forts).toContainEqual({
      node: 5,
      owner: 1,
      built: false,
      done_tick: 90,
    });
  });
});

describe('"View as" a side shows what its live view showed (#905)', () => {
  const { file, road0, road5 } = built();

  it('keeps every own building, with builds, queue and rally point', () => {
    expect(nodeOf(file, 0, 0)).toMatchObject({
      factory: true,
      recruit_queue: 2,
      rally_point: 1,
    });
    expect(nodeOf(file, 0, 1)).toMatchObject({
      factory_build: { done_tick: null, owed: 4 },
      building: { kind: 'barracks', done_tick: 150, owed: 0 },
    });
    expect(nodeOf(file, 1, 4)).toMatchObject({
      factory_build: { done_tick: 170, owed: 0 },
      building: { kind: 'barracks', done_tick: null, owed: 1 },
    });
    expect(nodeOf(file, 1, 5)).toMatchObject({ rally_point: 4, recruit_queue: 1 });
  });

  it('shows an enemy city only as a built factory and barracks, from v', () => {
    // Player 0 saw the capital 5: factory and barracks, and nothing of its queue or rally point.
    expect(nodeOf(file, 0, 5)).toMatchObject({
      factory: true,
      has_barracks: true,
      factory_build: null,
      building: null,
      recruit_queue: null,
      recruit_progress: null,
      recruit_waiting: null,
      rally_point: null,
    });
  });

  it('knows nothing of an enemy city that is not in v (not "without")', () => {
    // Player 1 has no `c` in v: the capital 0 is a factory in the full view, unknown to it.
    expect(nodeOf(file, 1, 0)).toMatchObject({
      factory: null,
      has_barracks: null,
      building: null,
      recruit_queue: null,
      rally_point: null,
    });
    // Player 0 saw only the capital 5, not the city 4 (a build under way in the full view).
    expect(nodeOf(file, 0, 4)).toMatchObject({
      factory: null,
      has_barracks: null,
      factory_build: null,
      building: null,
    });
  });

  it('shows an enemy fortification only when v has it, without a tick', () => {
    const first = buildTimeline(file, 0).snapshots[0]?.view.edges;
    // Own one (node 0, built) with its tick rule; the enemy's from v: being built, no tick.
    expect(first?.[road0]?.forts).toEqual([{ node: 0, owner: 0, built: true, done_tick: null }]);
    expect(first?.[road5]?.forts).toEqual([{ node: 5, owner: 1, built: false, done_tick: null }]);
    const second = buildTimeline(file, 1).snapshots[0]?.view.edges;
    // Player 1: its own with the ready tick, the enemy one it saw (built, no tick).
    expect(second?.[road5]?.forts).toEqual([{ node: 5, owner: 1, built: false, done_tick: 90 }]);
    expect(second?.[road0]?.forts).toEqual([{ node: 0, owner: 0, built: true, done_tick: null }]);
  });

  it('hides an enemy fortification v does not list', () => {
    const { file: hidden, road0: r0 } = built();
    const vision = hidden.frames[0]?.v?.[1];
    if (vision === undefined) throw new Error('no vision');
    delete vision.d;
    expect(buildTimeline(hidden, 1).snapshots[0]?.view.edges[r0]?.forts).toEqual([]);
  });

  it('never carries an enemy build, queue or rally point, in any frame of a recorded match', () => {
    for (const side of [0, 1] as const) {
      const owners = (i: number): readonly (PlayerId | null)[] =>
        (SAMPLE_BUILDINGS.frames[i]?.n ?? []).map((n) => n[0]);
      const snapshots = buildTimeline(SAMPLE_BUILDINGS, side).snapshots;
      snapshots.forEach((snapshot, i) => {
        snapshot.view.nodes.forEach((node, id) => {
          if (owners(i)[id] === side) return;
          expect(node.factory_build).toBeNull();
          expect(node.building).toBeNull();
          expect(node.recruit_queue).toBeNull();
          expect(node.recruit_waiting).toBeNull();
          expect(node.rally_point).toBeNull();
        });
        for (const edge of snapshot.view.edges) {
          for (const fort of edge.forts) {
            if (fort.owner !== side) expect(fort.done_tick).toBeNull();
          }
        }
      });
    }
  });

  it('shows in the recorded match what the full view has, for the own side', () => {
    const full = buildTimeline(SAMPLE_BUILDINGS).snapshots;
    const mine = buildTimeline(SAMPLE_BUILDINGS, 0).snapshots;
    let own = 0;
    full.forEach((snapshot, i) => {
      snapshot.view.nodes.forEach((node, id) => {
        if (node.owner !== 0) return;
        const side = mine[i]?.view.nodes[id];
        expect(side).toMatchObject({
          factory: node.factory,
          has_barracks: node.has_barracks,
          factory_build: node.factory_build,
          building: node.building,
          recruit_queue: node.recruit_queue,
          rally_point: node.rally_point,
        });
        own += node.factory_build === null ? 0 : 1;
      });
    });
    expect(own).toBeGreaterThan(0);
  });

  it('shows no building of a side of a file without the keys (before #905)', () => {
    const nodes = buildTimeline(SAMPLE_FOG, 0).snapshots.flatMap((s) => s.view.nodes);
    expect(nodes.every((n) => n.factory === null && n.has_barracks === null)).toBe(true);
    expect(nodes.every((n) => n.factory_build === null && n.rally_point === null)).toBe(true);
  });
});
