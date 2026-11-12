import { describe, expect, it } from 'vitest';
import rawBuildings from './siege-buildings.frames.json';
import { parseReplay } from './replayFile.ts';
import { ReplayPlayer } from './replayPlayer.ts';
import { buildTimeline } from './timeline.ts';

// Format 3 (#980): no road-level slots, and the header `rules` also carries the numbers of the map.
// Written out from `docs/design/replay-frames.md` ("Format change"). The sample is a format 2 file,
// so a format 3 file is made from it the way the server now writes one.

type Raw = Record<string, unknown> & {
  frames: { w?: number[]; v?: { e: unknown[][] }[] }[];
  rules?: Record<string, number>;
};

const MAP_RULES = {
  round_ticks: 30,
  rally_cost: 50,
  province_warehouse: 1,
  attrition_ticks: 80,
  grace_ticks: 20,
};

function formatThree(rules: Record<string, number> = MAP_RULES): Raw {
  const raw = structuredClone(rawBuildings) as unknown as Raw;
  raw.format = 3;
  for (const frame of raw.frames) {
    delete frame.w;
    for (const side of frame.v ?? []) side.e = side.e.map((e) => e.slice(1));
  }
  raw.rules = { ...raw.rules, ...rules };
  return raw;
}

describe('road levels are gone from format 3 (#980)', () => {
  it('a format 2 file carries them and reads the same as the format 3 file without them', () => {
    const old = rawBuildings as unknown as Raw;
    expect(old.format).toBe(2);
    expect(old.frames[0]?.w).toBeDefined();
    // The first element of a vision edge is the road level (a number) in the old file.
    expect(typeof old.frames[0]?.v?.[0]?.e[0]?.[0]).toBe('number');

    const fromOld = parseReplay(structuredClone(old));
    const fromNew = parseReplay(formatThree());
    const edge = fromNew.frames[0]?.v?.[0]?.e[0];
    // After parsing both read one shape: the road visibility comes first.
    expect(typeof edge?.[0]).toBe('string');
    expect(fromOld.frames.map((f) => f.v)).toEqual(fromNew.frames.map((f) => f.v));
    expect(buildTimeline(fromNew, 0).snapshots).toEqual(buildTimeline(fromOld, 0).snapshots);
    // The edges of a snapshot come from the map, not from the old `w` slot.
    expect(buildTimeline(fromNew).snapshots[0]?.view.edges).toHaveLength(fromNew.map.edges.length);
  });

  it('parsing an already parsed old file does not strip a second element', () => {
    const once = parseReplay(structuredClone(rawBuildings));
    const twice = parseReplay(structuredClone(once));
    expect(twice.frames.map((f) => f.v)).toEqual(once.frames.map((f) => f.v));
  });
});

describe('the map rules of the header (#980)', () => {
  it('a format 3 replay plays with the numbers of its match', () => {
    const player = new ReplayPlayer(parseReplay(formatThree()));
    expect(player.roundTicks).toBe(30);
    expect(player.rallyCost).toBe(50);
    expect(player.provinceWarehouse).toBe(1);
    expect(player.capacityTicks).toEqual({ attritionTicks: 80, graceTicks: 20 });
  });

  it('a format 2 replay gives none of them: the viewer falls back as before', () => {
    const player = new ReplayPlayer(parseReplay(structuredClone(rawBuildings)));
    expect(player.roundTicks).toBeUndefined();
    expect(player.rallyCost).toBeUndefined();
    expect(player.provinceWarehouse).toBeUndefined();
    expect(player.capacityTicks).toBeUndefined();
    // The numbers of the buildings still come from the old header.
    expect(player.recruitTicks).toBeDefined();
  });

  it.each(['round_ticks', 'rally_cost', 'province_warehouse', 'attrition_ticks', 'grace_ticks'])(
    'a format 3 header without %s is dropped as damaged, never an error',
    (key) => {
      const raw = formatThree();
      raw.rules = Object.fromEntries(
        Object.entries(raw.rules ?? {}).filter(([name]) => name !== key),
      );
      const file = parseReplay(raw);
      expect(file.rules).toBeUndefined();
      expect(new ReplayPlayer(file).roundTicks).toBeUndefined();
    },
  );

  it('drops a header with a round of no ticks', () => {
    expect(parseReplay(formatThree({ ...MAP_RULES, round_ticks: 0 })).rules).toBeUndefined();
  });
});
