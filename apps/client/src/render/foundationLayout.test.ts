import { describe, expect, it } from 'vitest';
import { iconSize, layoutBuildings, owedRow } from './buildingLayout.ts';
import { cityRadius } from './cityLayout.ts';
import {
  activeShare,
  alertAlpha,
  boxDiscs,
  cityObstacles,
  foundationAlert,
  foundationBox,
  foundationOn,
  foundationSize,
  iconBox,
  markSeats,
  meets,
  pieceBoxes,
  placePiece,
  socketAt,
  socketCount,
  socketKinds,
  swingSeat,
  type Box,
  type CitySigns,
  type PieceInput,
} from './foundationLayout.ts';
import { captionTop } from './nameLayout.ts';
import { BUILDING, FOUNDATION, LOZENGE } from './style.ts';

const deg = (d: number): number => (d * Math.PI) / 180;

describe('socketKinds: what each socket shows (from the snapshot)', () => {
  const queue = { progress: 10, unitTicks: 30, waiting: false, sockets: 3, selected: false };

  it('is the unit under way, then the units ordered, then dark recesses', () => {
    expect(socketKinds({ ...queue, count: 2 })).toEqual(['active', 'queued', 'empty']);
    expect(socketKinds({ ...queue, count: 3 })).toEqual(['active', 'queued', 'queued']);
    expect(socketKinds({ ...queue, count: 1 })).toEqual(['active', 'empty', 'empty']);
  });

  it('dashes the free sockets of the selected city, all of them with no queue', () => {
    expect(socketKinds({ ...queue, count: 1, selected: true })).toEqual(['active', 'free', 'free']);
    expect(socketKinds({ ...queue, count: 0, selected: true })).toEqual(['free', 'free', 'free']);
  });

  it('shows the unit made that waits for room full', () => {
    expect(socketKinds({ ...queue, count: 2, waiting: true })).toEqual(['full', 'queued', 'empty']);
    expect(activeShare({ progress: 30, unitTicks: 30, waiting: true })).toBe(1);
  });

  it('keeps queue_max sockets, more only when the queue is longer', () => {
    expect(socketCount({ count: 0, sockets: 3 })).toBe(3);
    expect(socketCount({ count: 5, sockets: 3 })).toBe(5);
    expect(socketKinds({ ...queue, count: 4 })).toHaveLength(4);
  });

  it('makes the share of the unit under way from its ticks, clamped', () => {
    expect(activeShare({ progress: 15, unitTicks: 30, waiting: false })).toBeCloseTo(0.5, 9);
    expect(activeShare({ progress: 45, unitTicks: 30, waiting: false })).toBe(1);
    expect(activeShare({ progress: 5, unitTicks: 0, waiting: false })).toBe(0);
  });
});

describe('foundationOn, foundationAlert, alertAlpha', () => {
  it('stands the barracks on its foundation while it recruits, or selected where it may', () => {
    expect(foundationOn(1, false, 3)).toBe(true);
    expect(foundationOn(0, false, 3)).toBe(false);
    expect(foundationOn(0, true, 3)).toBe(true);
    expect(foundationOn(0, true, 0)).toBe(false);
  });

  it('rims it in amber with no room or a fight in the city, never with no queue', () => {
    expect(foundationAlert(1, true, false)).toBe(true);
    expect(foundationAlert(1, false, true)).toBe(true);
    expect(foundationAlert(1, false, false)).toBe(false);
    expect(foundationAlert(0, true, true)).toBe(false);
  });

  it('pulses between the low and full, still with "less motion"', () => {
    expect(alertAlpha(0, false)).toBe(FOUNDATION.alert.low);
    expect(alertAlpha(1, false)).toBe(1);
    expect(alertAlpha(0, true)).toBe(1);
  });
});

describe('the foundation under the barracks', () => {
  const size = BUILDING.world;

  it('stands the barracks on it: its top rule is the ground line, it is centred under the icon', () => {
    const seat = { x: 30, y: -12 };
    const f = foundationBox(seat, size, 3);
    const icon = iconBox('barracks', seat, size);
    // The ground line (9 in the 26-unit box) is the foundation's top; the icon's casing reaches past it.
    expect(f.y0).toBeCloseTo(seat.y + (9 * size) / BUILDING.box, 9);
    expect(icon.y1).toBeGreaterThan(f.y0);
    expect((f.x0 + f.x1) / 2).toBeCloseTo(seat.x, 9);
    // Wider than the barracks, as the mockup: a building on its base.
    expect(f.x1 - f.x0).toBeGreaterThan(icon.x1 - icon.x0 - 2 * FOUNDATION.casing);
  });

  it('scales with the icon and grows a socket at a time', () => {
    const a = foundationBox({ x: 0, y: 0 }, size, 3);
    const b = foundationBox({ x: 0, y: 0 }, size * 2, 3);
    expect(b.x1 - b.x0).toBeCloseTo(2 * (a.x1 - a.x0), 9);
    expect(foundationSize(4).width - foundationSize(3).width).toBeCloseTo(
      FOUNDATION.cell + FOUNDATION.gap,
      9,
    );
  });

  it('lays the sockets left to right inside its padding', () => {
    const { width } = foundationSize(3);
    expect(socketAt(0).x).toBe(FOUNDATION.padX);
    expect(socketAt(2).x + FOUNDATION.cell + FOUNDATION.padX).toBeCloseTo(width, 9);
    // A slide is a fraction of a socket's pitch.
    expect(socketAt(0.5).x - socketAt(0).x).toBeCloseTo((FOUNDATION.cell + FOUNDATION.gap) / 2, 9);
  });

  it('puts the CP marks of the walks in a row under it, centred', () => {
    const marks = markSeats(3, 2);
    expect(marks).toHaveLength(2);
    expect((marks[0]?.x ?? 0) + (marks[1]?.x ?? 0)).toBeCloseTo(0, 9);
    expect(marks[0]?.y).toBeGreaterThan(foundationBox({ x: 0, y: 0 }, size, 3).y1);
    expect(pieceBoxes({ x: 0, y: 0 }, size, 3, 2)).toHaveLength(3);
    expect(pieceBoxes({ x: 0, y: 0 }, size, 3, 0)).toHaveLength(2);
  });

  it('covers a box with discs that hold every point of it', () => {
    const box: Box = { x0: -10, y0: -2, x1: 10, y1: 3 };
    const discs = boxDiscs(box);
    for (let x = box.x0; x <= box.x1; x += 0.5) {
      for (let y = box.y0; y <= box.y1; y += 0.5) {
        expect(discs.some((d) => Math.hypot(x - d.x, y - d.y) <= d.r + 1e-9)).toBe(true);
      }
    }
  });
});

describe('swingSeat: the barracks swings round the city', () => {
  it('starts at rest, ends on the foundation and keeps its distance between them', () => {
    const rest = { x: -30, y: -10 };
    const anchor = { x: -10, y: -40 };
    expect(swingSeat(rest, anchor, 0).x).toBeCloseTo(rest.x, 9);
    expect(swingSeat(rest, anchor, 1).y).toBeCloseTo(anchor.y, 9);
    const mid = swingSeat(rest, anchor, 0.5);
    const d = (Math.hypot(rest.x, rest.y) + Math.hypot(anchor.x, anchor.y)) / 2;
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(d, 9);
  });

  it('turns the short way round', () => {
    const mid = swingSeat({ x: -10, y: 1 }, { x: -10, y: -1 }, 0.5);
    expect(mid.x).toBeLessThan(0);
  });
});

// The cities and roads of the building placement (#954): the mockup's road sets, every size, three
// zooms, with and without a factory, a factory being built (its owed lozenges), the CP marks of walks.
const CITIES = [
  { name: 'small', radius: cityRadius(4), warehouse: 3 },
  { name: 'medium', radius: cityRadius(6), warehouse: 3 },
  { name: 'capital', radius: cityRadius(10), warehouse: 6 },
] as const;
const ROADS: readonly (readonly number[])[] = [
  [180, 20],
  [225, 0, 110],
  [150, 250, 20],
  [180, 270, 0, 90],
  [160, 230, 330, 70],
  [180, 240, 310, 30, 110],
  [195, 255, 315, 15, 75, 135],
  [150, 200, 250, 320, 20, 90],
];
const ZOOMS = [0.5, 1, 2.2] as const;
type Factory = 'none' | 'built' | 'building';
const FACTORIES: readonly Factory[] = ['none', 'built', 'building'];

function caseOf(
  city: (typeof CITIES)[number],
  degrees: readonly number[],
  zoom: number,
  factory: Factory,
  marks: number,
): PieceInput {
  const roads = degrees.map(deg);
  const size = iconSize(zoom);
  const kinds = factory === 'none' ? (['barracks'] as const) : (['barracks', 'factory'] as const);
  const layout = layoutBuildings({ radius: city.radius, roads, vp: true, kinds: [...kinds], size });
  const rest = layout.items.barracks ?? { x: 0, y: 0 };
  const at = layout.items.factory;
  const grown = factory === 'building' ? 1.25 : 1;
  const angle = layout.angles.factory ?? 0;
  const seat =
    at === undefined
      ? null
      : {
          x: at.x + Math.cos(angle) * BUILDING.half * size * (grown - 1),
          y: at.y + Math.sin(angle) * BUILDING.half * size * (grown - 1),
        };
  const row =
    seat === null || factory !== 'building' ? null : owedRow(seat, angle, size * grown, 4, 1.1);
  const signs: CitySigns = {
    radius: city.radius,
    roads,
    vp: true,
    warehouse: city.warehouse,
    caption:
      zoom >= 0.45
        ? { top: captionTop('city', city.radius), width: 75 / zoom, height: 18 / zoom }
        : null,
    factory: seat === null ? null : iconBox('factory', seat, size * grown),
    owed:
      row === null
        ? []
        : row.slots.map((p) => ({ x: p.x, y: p.y, r: (LOZENGE.casing * row.k * Math.SQRT2) / 2 })),
  };
  return { signs, rest, size, sockets: 3, marks };
}

describe('placePiece: the nearest free seat (no collision, ui-style 76)', () => {
  it('meets nothing round any city, road set, zoom and factory, and stays near its seat at rest', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const city of CITIES) {
      ROADS.forEach((degrees, i) => {
        for (const zoom of ZOOMS) {
          for (const factory of FACTORIES) {
            for (const marks of [0, 2]) {
              const input = caseOf(city, degrees, zoom, factory, marks);
              const seat = placePiece(input);
              const what = `${city.name} roads #${String(i)} zoom ${String(zoom)} ${factory} marks ${String(marks)}`;
              seen++;
              if (!seat.clear) {
                bad.push(`${what}: no clear seat`);
                continue;
              }
              const obstacles = cityObstacles(input.signs, input.size);
              const discs = pieceBoxes(seat, input.size, 3, marks).flatMap(boxDiscs);
              if (discs.some((d) => obstacles.some((o) => meets(o, d.x, d.y, d.r)))) {
                bad.push(`${what}: meets a sign`);
              }
              const k = input.size / BUILDING.world;
              if (Math.hypot(seat.x - input.rest.x, seat.y - input.rest.y) > 45 * k) {
                bad.push(`${what}: too far from its seat at rest`);
              }
            }
          }
        }
      });
    }
    expect(seen).toBe(CITIES.length * ROADS.length * ZOOMS.length * FACTORIES.length * 2);
    expect(bad).toEqual([]);
  });

  it('keeps the barracks where it stands when that seat is already free', () => {
    const input = caseOf(CITIES[1], [180, 20], 1, 'none', 0);
    const far = { x: input.rest.x * 3, y: input.rest.y * 3 };
    const seat = placePiece({ ...input, rest: far });
    expect(seat).toEqual({ x: far.x, y: far.y, clear: true });
  });

  it('never touches the factory, which never moves', () => {
    const input = caseOf(CITIES[0], [195, 255, 315, 15, 75, 135], 1, 'built', 0);
    const factory = input.signs.factory;
    if (factory === null) throw new Error('a factory');
    const seat = placePiece(input);
    const piece = pieceBoxes(seat, input.size, 3, 0);
    const air = FOUNDATION.clear * (input.size / BUILDING.world);
    for (const b of piece) {
      const apart =
        b.x1 < factory.x0 - air + 1e-9 ||
        b.x0 > factory.x1 + air - 1e-9 ||
        b.y1 < factory.y0 - air + 1e-9 ||
        b.y0 > factory.y1 + air - 1e-9;
      // The discs that stand for a box are rounder than it: a box may come nearer than the air at a corner.
      expect(
        apart || boxDiscs(b).every((d) => !meets({ kind: 'box', box: factory }, d.x, d.y, d.r)),
      ).toBe(true);
    }
  });

  it('is the same seat for the same city, every time (deterministic)', () => {
    const input = caseOf(CITIES[2], [150, 200, 250, 320, 20, 90], 1, 'building', 2);
    expect(placePiece(input)).toEqual(placePiece(input));
  });

  it('takes the least crowded seat when no seat is free', () => {
    const input = caseOf(CITIES[0], [180, 20], 1, 'none', 0);
    // Roads every 10 degrees: no seat round the city is free.
    const roads = Array.from({ length: 36 }, (_, j) => deg(j * 10));
    const seat = placePiece({ ...input, signs: { ...input.signs, roads } });
    expect(seat.clear).toBe(false);
    expect(Number.isFinite(seat.x) && Number.isFinite(seat.y)).toBe(true);
  });
});
