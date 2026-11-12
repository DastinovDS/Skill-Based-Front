import { describe, expect, it } from 'vitest';
import type { MapFile } from '../protocol.gen.ts';
import {
  BUILDING_KINDS,
  freeGap,
  iconHalf,
  iconSize,
  layoutBuildings,
  lozengeScale,
  owedRow,
  roadAngles,
  vpSeat,
  type BuildingKind,
} from './buildingLayout.ts';
import { cityRadius, fitReach, ringRadius } from './cityLayout.ts';
import { captionTop } from './nameLayout.ts';
import { lozengeRow, lozengeRowY } from './pieceLayout.ts';
import { BUILDING, RING_ENGRAVED, VP_LOZENGE } from './style.ts';

const deg = (d: number): number => (d * Math.PI) / 180;

// The six arrangements of roads for two to six roads of the round 2 mockup
// (docs/design/mockups/city-buildings-r2.html, `ROAD_SETS`): laid to hit the seats of the old towers
// (left, upper left), the VP lozenge (upper right), the top and the warehouse side. Degrees, 0 east,
// 90 south.
const ROAD_SETS: Readonly<Record<number, readonly (readonly number[])[]>> = {
  2: [
    [180, 20],
    [225, 90],
    [340, 160],
    [270, 135],
    [200, 330],
    [45, 250],
  ],
  3: [
    [180, 300, 60],
    [225, 0, 110],
    [150, 250, 20],
    [270, 170, 40],
    [200, 90, 330],
    [120, 240, 0],
  ],
  4: [
    [180, 270, 0, 90],
    [225, 315, 45, 140],
    [160, 230, 330, 70],
    [200, 280, 10, 100],
    [130, 210, 300, 30],
    [250, 170, 90, 340],
  ],
  5: [
    [180, 240, 310, 30, 110],
    [225, 280, 350, 60, 150],
    [160, 220, 290, 0, 80],
    [200, 260, 330, 40, 120],
    [140, 190, 260, 330, 50],
    [170, 230, 300, 20, 100],
  ],
  6: [
    [180, 240, 300, 0, 60, 120],
    [195, 255, 315, 15, 75, 135],
    [170, 215, 270, 330, 30, 100],
    [210, 260, 320, 10, 80, 140],
    [150, 200, 250, 320, 20, 90],
    [185, 235, 290, 350, 50, 115],
  ],
};

// The city sizes of the mockup: the body radius is the client's by capacity class; the warehouse is 3
// places, a capital's 6 (`warehouse.start_by_kind`).
const CITIES = [
  { name: 'small', radius: cityRadius(4), warehouse: 3 },
  { name: 'medium', radius: cityRadius(6), warehouse: 3 },
  { name: 'large', radius: cityRadius(8), warehouse: 3 },
  { name: 'capital', radius: cityRadius(10), warehouse: 6 },
] as const;

/** The zooms of the mockup: far, normal, near. */
const ZOOMS = [0.5, 1, 2.2] as const;
const NAME = 'Watchhouse';

const BOTH: readonly BuildingKind[] = ['barracks', 'factory'];
const KIND_SETS: readonly (readonly BuildingKind[])[] = [BOTH, ['barracks'], ['factory']];

interface Clash {
  readonly what: string;
  readonly kind: string;
}

/**
 * What an icon at `it` (half extent `r`) meets in a city: a road (the same test as the mockup's
 * `clashesOf`), the VP lozenge, the warehouse row, the name under it, the capacity cells. Empty:
 * nothing.
 */
function clashes(
  city: (typeof CITIES)[number],
  roads: readonly number[],
  zoom: number,
  kinds: readonly BuildingKind[],
): Clash[] {
  const size = iconSize(zoom);
  const layout = layoutBuildings({ radius: city.radius, roads, vp: true, kinds, size });
  const ring = ringRadius(city.radius);
  const r = iconHalf(size);
  const out: Clash[] = [];
  const vp = vpSeat(city.radius);
  const store = lozengeRow(city.warehouse);
  const storeY = lozengeRowY(city.radius);
  const nameTop = captionTop('city', city.radius);
  for (const kind of kinds) {
    const it = layout.items[kind];
    if (it === undefined) {
      out.push({ what: 'missing', kind });
      continue;
    }
    for (const a of roads) {
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const along = it.x * ux + it.y * uy;
      const perp = Math.abs(-it.x * uy + it.y * ux);
      if (along > ring && perp < r + 3.7) out.push({ what: 'road', kind });
    }
    if (Math.hypot(it.x - vp.x, it.y - vp.y) < r + VP_LOZENGE.side * 0.62) {
      out.push({ what: 'vp', kind });
    }
    if (store.some((x) => Math.hypot(it.x - x, it.y - storeY) < r + 3.4)) {
      out.push({ what: 'store', kind });
    }
    if (zoom >= 0.45) {
      const w = (NAME.length * 4.1) / zoom;
      const top = nameTop;
      const bottom = top + 14 / zoom;
      if (Math.abs(it.x) < w + r && it.y + r > top && it.y - r < bottom) {
        out.push({ what: 'name', kind });
      }
    }
    // The capacity cells: the ring's dark cut ends `cut / 2` past its radius.
    if (Math.hypot(it.x, it.y) - r < ring + RING_ENGRAVED.cut / 2) out.push({ what: 'ring', kind });
    // The C2 chevrons stand on the helmet's shoulder inside the ring: their box lies in the circle of
    // `fitReach + 2.2` round the helmet (`BADGE_BOUND_PAST_FIT` of `entityView.ts`), and so do the
    // B6 ticks; an icon past the ring never reaches it.
    if (Math.hypot(it.x, it.y) - r < fitReach(city.radius) + 2.2)
      out.push({ what: 'chevrons', kind });
  }
  return out;
}

describe('iconSize', () => {
  it('is 16 units across near zoom 1 and never under 13 css px on screen', () => {
    expect(iconSize(1)).toBe(BUILDING.world);
    expect(iconSize(2.2)).toBe(BUILDING.world);
    for (const z of [0.15, 0.3, 0.5, 0.75, 0.99, 1.3, 3]) {
      expect(iconSize(z) * z).toBeGreaterThanOrEqual(BUILDING.minPx - 1e-6);
    }
  });

  it('rounds up to a quarter octave, so a zoom lays the icons out now and then', () => {
    expect(iconSize(0.5)).toBe(iconSize(0.49));
    expect(iconSize(0.5)).toBeGreaterThan(iconSize(1));
    const octave = iconSize(0.25) / iconSize(0.5);
    expect(octave).toBeCloseTo(2, 5);
  });
});

describe('roadAngles: where the roads leave each city', () => {
  it('reads the angle of every edge at both its ends, from the nodes of the map', () => {
    const map = {
      nodes: [
        { id: 0, x: 0, y: 0 },
        { id: 1, x: 100, y: 0 },
        { id: 2, x: 0, y: 100 },
      ],
      edges: [
        { id: 0, a: 0, b: 1 },
        { id: 1, a: 0, b: 2 },
      ],
    } as unknown as MapFile;
    const angles = roadAngles(map);
    expect(angles[0]).toEqual([0, Math.PI / 2]);
    expect(angles[1]).toEqual([Math.PI]);
    expect(angles[2]).toEqual([-Math.PI / 2]);
  });
});

describe('freeGap: the widest free angle between the roads', () => {
  it('without roads and a VP lozenge, takes the widest gap of the warehouse side and the VP', () => {
    const gap = freeGap([], 32, false);
    // Only the warehouse side (straight down, 0.95 either side) is blocked: the middle is straight up.
    expect(gap.mid).toBeCloseTo(-Math.PI / 2 + 2 * Math.PI, 5);
    expect(gap.width).toBeCloseTo(2 * Math.PI - 2 * BUILDING.free.store, 5);
  });

  it('keeps clear of a road and of the VP lozenge', () => {
    const gap = freeGap([deg(180)], 32, true);
    expect(gap.width).toBeGreaterThan(0);
    const half = gap.width / 2;
    for (const blocked of [deg(180), -Math.PI / 4, Math.PI / 2]) {
      let d = Math.abs(
        ((((gap.mid - blocked) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI,
      );
      d = Math.abs(d);
      expect(d).toBeGreaterThanOrEqual(half - 1e-9);
    }
  });
});

describe('layoutBuildings: the free side (#954, P2)', () => {
  const base = { radius: cityRadius(6), roads: [deg(180), deg(300), deg(60)], vp: true };

  it('stands a lone building in the middle of the free angle, just outside the ring', () => {
    const size = iconSize(1);
    const layout = layoutBuildings({ ...base, kinds: ['factory'], size });
    const at = layout.items.factory;
    expect(at).toBeDefined();
    if (at === undefined) return;
    expect(Math.atan2(at.y, at.x)).toBeCloseTo(
      Math.atan2(Math.sin(layout.gap.mid), Math.cos(layout.gap.mid)),
      6,
    );
    const d =
      ringRadius(base.radius) + RING_ENGRAVED.cut / 2 + BUILDING.free.ringAir + iconHalf(size);
    expect(Math.hypot(at.x, at.y)).toBeCloseTo(d, 6);
    expect(layout.items.barracks).toBeUndefined();
  });

  it('stands two side by side when the angle is wide, the barracks first', () => {
    const size = iconSize(1);
    const layout = layoutBuildings({ ...base, roads: [], kinds: BOTH, size });
    const b = layout.items.barracks;
    const f = layout.items.factory;
    if (b === undefined || f === undefined) throw new Error('both seats');
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(Math.hypot(f.x, f.y), 6);
    expect(Math.hypot(b.x - f.x, b.y - f.y)).toBeGreaterThan(2 * iconHalf(size));
    expect(layout.angles.barracks).toBeLessThan(layout.angles.factory ?? Number.NaN);
  });

  it('stacks them outward when the angle is narrow, the barracks the outer one', () => {
    const size = iconSize(1);
    // A road every 60 degrees leaves 41 degrees between two roads: the two do not fit side by side.
    const roads = [0, 60, 120, 180, 240, 300].map(deg);
    const layout = layoutBuildings({ ...base, roads, vp: false, kinds: BOTH, size });
    const b = layout.items.barracks;
    const f = layout.items.factory;
    if (b === undefined || f === undefined) throw new Error('both seats');
    expect(layout.angles.barracks).toBeCloseTo(layout.angles.factory ?? Number.NaN, 9);
    expect(Math.hypot(b.x, b.y) - Math.hypot(f.x, f.y)).toBeCloseTo(
      2 * iconHalf(size) + BUILDING.free.sep,
      6,
    );
  });

  it('seats nothing that is not asked for', () => {
    const layout = layoutBuildings({ ...base, kinds: [], size: iconSize(1) });
    for (const kind of BUILDING_KINDS) expect(layout.items[kind]).toBeUndefined();
  });
});

describe('the placement against the mockup road sets (nothing collides, ui-style 73)', () => {
  it('never meets a road, the VP lozenge, the store, the name or the capacity cells', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const city of CITIES) {
      for (const [n, sets] of Object.entries(ROAD_SETS)) {
        sets.forEach((degrees, i) => {
          const roads = degrees.map(deg);
          for (const zoom of ZOOMS) {
            for (const kinds of KIND_SETS) {
              seen++;
              for (const c of clashes(city, roads, zoom, kinds)) {
                bad.push(
                  `${city.name} ${n} roads #${String(i)} zoom ${String(zoom)} ${kinds.join('+')}: ${c.kind} meets ${c.what}`,
                );
              }
            }
          }
        });
      }
    }
    expect(seen).toBe(CITIES.length * 30 * ZOOMS.length * KIND_SETS.length);
    expect(bad).toEqual([]);
  });
});

describe('owedRow: the owed charges beside an icon', () => {
  it('lays one lozenge per charge across the icon, centred, just outside it', () => {
    const size = iconSize(1);
    const item = { x: 0, y: -40 };
    const row = owedRow(item, -Math.PI / 2, size, 3);
    expect(row.slots).toHaveLength(3);
    expect(row.k).toBe(lozengeScale(size));
    // Along the radial the row stands beyond the icon; across it the slots are a pitch apart.
    for (const p of row.slots) expect(p.y).toBeLessThan(item.y - iconHalf(size));
    const [a, b, c] = row.slots;
    if (a === undefined || b === undefined || c === undefined) throw new Error('three slots');
    expect(b.x - a.x).toBeCloseTo(c.x - b.x, 9);
    expect((a.x + c.x) / 2).toBeCloseTo(item.x, 9);
  });

  it('is empty for no charges', () => {
    expect(owedRow({ x: 0, y: 0 }, 0, 16, 0).slots).toEqual([]);
  });
});
