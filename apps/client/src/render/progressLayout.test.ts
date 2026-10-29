import { describe, expect, it } from 'vitest';
import { ringRadius } from './cityLayout.ts';
import {
  alertAlpha,
  alertSpot,
  buildMark,
  fillPixels,
  hatchPolygons,
  innerWidth,
  markTops,
  queueMark,
  type QueueInput,
} from './progressLayout.ts';
import { PROGRESS } from './style.ts';

const input = (over: Partial<QueueInput> = {}): QueueInput => ({
  count: 3,
  progress: 0,
  unitTicks: 30,
  waiting: false,
  paused: false,
  slots: 0,
  ...over,
});

const states = (over: Partial<QueueInput>): string[] =>
  (queueMark(input(over))?.cells ?? []).map((cell) => cell.state);

describe('fillPixels', () => {
  const inner = innerWidth(PROGRESS.cell.width);

  it('is whole pixels of the inner width, never more', () => {
    expect(inner).toBe(12);
    expect(fillPixels(0.5, inner)).toBe(6);
    expect(fillPixels(1, inner)).toBe(inner);
    expect(fillPixels(7, inner)).toBe(inner);
  });

  it('is 0 for nothing, below a pixel and for numbers that make no sense', () => {
    expect(fillPixels(0, inner)).toBe(0);
    expect(fillPixels(0.05, inner)).toBe(0);
    expect(fillPixels(-1, inner)).toBe(0);
    expect(fillPixels(Number.NaN, inner)).toBe(0);
    expect(fillPixels(0.5, 0)).toBe(0);
  });
});

describe('queueMark: the state of each cell', () => {
  it('a queued unit that has not started is a frame with a dot', () => {
    expect(states({ count: 2, progress: 0 })).toEqual(['queued', 'queued']);
  });

  it('the first unit in production is an active cell, the rest queued', () => {
    expect(states({ count: 3, progress: 15 })).toEqual(['active', 'queued', 'queued']);
    expect(queueMark(input({ progress: 15 }))?.cells[0]?.fill).toBe(6);
  });

  it('a ready unit with no room is a solid cell and gets the alert ring', () => {
    const mark = queueMark(input({ count: 2, progress: 30, waiting: true }));
    expect(mark?.cells.map((cell) => cell.state)).toEqual(['ready', 'queued']);
    expect(mark?.alert).toBe(0);
  });

  it('a fight in the city stops the production: the cell keeps its progress and gets the ring', () => {
    const mark = queueMark(input({ count: 1, progress: 10, paused: true }));
    expect(mark?.cells[0]?.state).toBe('active');
    expect(mark?.cells[0]?.fill).toBe(4);
    expect(mark?.alert).toBe(0);
  });

  it('no ring while the production runs', () => {
    expect(queueMark(input({ progress: 10 }))?.alert).toBeNull();
  });

  it('the selected city adds free slots, dashed, after the queued units', () => {
    expect(states({ count: 1, progress: 0, slots: 3 })).toEqual(['queued', 'slot', 'slot']);
    expect(states({ count: 0, slots: 3 })).toEqual(['slot', 'slot', 'slot']);
  });

  it('never fewer cells than queued units, whatever the slots say', () => {
    expect(states({ count: 3, slots: 1 })).toHaveLength(3);
  });

  it('nothing to show: no queue and no free slots', () => {
    expect(queueMark(input({ count: 0, slots: 0 }))).toBeNull();
  });

  it('the production never reads from a unit time of 0', () => {
    expect(states({ count: 1, progress: 5, unitTicks: 0 })).toEqual(['queued']);
  });

  it('a ring needs a unit: free slots alone have none, even in a fight', () => {
    expect(queueMark(input({ count: 0, slots: 3, paused: true }))?.alert).toBeNull();
  });
});

describe('queueMark: geometry', () => {
  it('the cells are laid in a row on a plate, centred on the city', () => {
    const mark = queueMark(input());
    if (mark === null) throw new Error('no mark');
    const { width: cw, gap } = PROGRESS.cell;
    expect(mark.width).toBe(3 * cw + 2 * gap + 2 * PROGRESS.pad);
    const xs = mark.cells.map((cell) => cell.x);
    expect(xs[0]).toBeCloseTo(-mark.width / 2 + PROGRESS.pad);
    expect(xs[1]).toBeCloseTo((xs[0] ?? 0) + cw + gap);
    const last = xs[2] ?? 0;
    expect(last + cw + PROGRESS.pad).toBeCloseTo(mark.width / 2);
  });

  it('the ring is the first cell grown on every side, from the city centre', () => {
    const mark = queueMark(input({ count: 2, waiting: true, progress: 30 }));
    if (mark === null) throw new Error('no mark');
    const spot = alertSpot(mark, -50);
    const first = mark.cells[0];
    if (spot === null || first === undefined) throw new Error('no ring');
    expect(spot.x).toBeCloseTo(first.x + PROGRESS.cell.width / 2);
    expect(spot.y).toBeCloseTo(-50 + PROGRESS.pad + PROGRESS.cell.height / 2);
    expect(spot.width).toBe(PROGRESS.cell.width + 2 * PROGRESS.alert.grow);
    expect(spot.height).toBe(PROGRESS.cell.height + 2 * PROGRESS.alert.grow);
  });

  it('has no ring spot without an alert', () => {
    const mark = queueMark(input());
    if (mark === null) throw new Error('no mark');
    expect(alertSpot(mark, 0)).toBeNull();
  });
});

describe('buildMark: barracks and warehouse share one indicator', () => {
  it('has the same plate for both kinds; only the kind differs', () => {
    const barracks = buildMark('barracks', 0.5);
    const warehouse = buildMark('warehouse', 0.5);
    expect(barracks.kind).toBe('barracks');
    expect(warehouse.kind).toBe('warehouse');
    expect({ ...barracks, kind: '' }).toEqual({ ...warehouse, kind: '' });
  });

  it('fills the wide cell by the share done, whole pixels', () => {
    const inner = innerWidth(PROGRESS.buildCell.width);
    expect(buildMark('barracks', 0).fill).toBe(0);
    expect(buildMark('barracks', 0.5).fill).toBe(inner / 2);
    expect(buildMark('warehouse', 1).fill).toBe(inner);
  });

  it('has the wide cell and the badge inside the plate', () => {
    const mark = buildMark('barracks', 0.3);
    expect(mark.cellX).toBeGreaterThan(PROGRESS.badge.cx + PROGRESS.badge.radius);
    expect(mark.cellX + PROGRESS.buildCell.width + PROGRESS.pad).toBeCloseTo(mark.width);
  });
});

describe('markTops', () => {
  const radius = 17;
  const queue = queueMark(input());
  const build = buildMark('barracks', 0.4);

  it('puts the queue plate just above the capacity ring', () => {
    const tops = markTops(radius, queue, null);
    if (queue === null || tops.queue === null) throw new Error('no queue');
    expect(tops.queue + queue.height).toBeLessThan(-ringRadius(radius));
    expect(tops.build).toBeNull();
  });

  it('stacks the build plate above the queue plate, a gap apart', () => {
    const tops = markTops(radius, queue, build);
    if (queue === null || tops.queue === null || tops.build === null) throw new Error('no tops');
    expect(tops.build + build.height + PROGRESS.gap).toBeCloseTo(tops.queue);
  });

  it('puts a lone build plate where the queue plate would be', () => {
    const alone = markTops(radius, null, build);
    const queued = markTops(radius, queue, null);
    if (queue === null || alone.build === null || queued.queue === null) throw new Error('no tops');
    expect(alone.build + build.height).toBeCloseTo(queued.queue + queue.height);
    expect(alone.queue).toBeNull();
  });

  it('rises with the size of the city', () => {
    const small = markTops(11, queue, null).queue ?? 0;
    const large = markTops(20, queue, null).queue ?? 0;
    expect(large).toBeLessThan(small);
  });
});

describe('alertAlpha', () => {
  it('pulses between the low and the full value', () => {
    expect(alertAlpha(0, false)).toBeCloseTo(PROGRESS.alert.low);
    expect(alertAlpha(1, false)).toBeCloseTo(1);
  });

  it('holds still and fully visible with "less motion"', () => {
    expect(alertAlpha(0, true)).toBe(1);
    expect(alertAlpha(0.7, true)).toBe(1);
  });
});

describe('hatchPolygons', () => {
  /** Area of a flat polygon (shoelace). */
  function area(flat: readonly number[]): number {
    let sum = 0;
    for (let i = 0; i < flat.length; i += 2) {
      const j = (i + 2) % flat.length;
      sum += (flat[i] ?? 0) * (flat[j + 1] ?? 0) - (flat[j] ?? 0) * (flat[i + 1] ?? 0);
    }
    return Math.abs(sum) / 2;
  }

  it('is nothing for an empty part', () => {
    expect(hatchPolygons(0, 6)).toEqual([]);
    expect(hatchPolygons(6, 0)).toEqual([]);
  });

  it('keeps every stripe inside the rectangle', () => {
    for (const poly of hatchPolygons(12, 6)) {
      for (let i = 0; i < poly.length; i += 2) {
        expect(poly[i]).toBeGreaterThanOrEqual(-1e-9);
        expect(poly[i]).toBeLessThanOrEqual(12 + 1e-9);
        expect(poly[i + 1]).toBeGreaterThanOrEqual(-1e-9);
        expect(poly[i + 1]).toBeLessThanOrEqual(6 + 1e-9);
      }
    }
  });

  it('covers the share of the rectangle that thickness over period says', () => {
    // Over a big rectangle the stripes cover thickness / period of it (the edges are the noise).
    const covered = hatchPolygons(200, 100, 10, 4).reduce((sum, poly) => sum + area(poly), 0);
    expect(covered / (200 * 100)).toBeCloseTo(0.4, 1);
  });

  it('keeps the stripes in place while the part grows (anchored to the corner)', () => {
    const short = hatchPolygons(6, 6);
    const long = hatchPolygons(12, 6);
    // The first stripe (x + y from 0 to the thickness) is the same triangle in both.
    expect(short[0]).toEqual(long[0]);
  });
});
