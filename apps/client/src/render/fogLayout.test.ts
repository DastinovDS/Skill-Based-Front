import { describe, expect, it } from 'vitest';
import type { MapFile } from '../protocol.gen.ts';
import { ageLabel, borderPermille, borderPoint, ghostAlpha } from './fogLayout.ts';

/** Two nodes 1000 apart on the x axis and one road between them (#366). */
function line(border: number | undefined): MapFile {
  const node = (id: number, x: number): MapFile['nodes'][number] => ({
    id,
    name: `n${String(id)}`,
    x,
    y: 0,
    terrain: 'plains',
    vp: 1,
    kind: 'capital',
    capital_of: id === 0 ? 0 : 1,
    start_owner: id === 0 ? 0 : 1,
    start_units: 0,
    start_charged: 0,
    start_stock: 0,
  });
  const edge = { id: 0, a: 0, b: 1, max_level: 1, travel_ticks: 300, border_permille: border };
  return {
    meta: { name: 'line', version: 1, symmetry: 'rot180', width: 1000, height: 10 },
    nodes: [node(0, 0), node(1, 1000)],
    edges: [edge as MapFile['edges'][number]],
    mirror: { nodes: { '0': 1, '1': 0 }, edges: { '0': 0 } },
  };
}

describe('border point (DEC-23, item 5; #366)', () => {
  it('comes from border_permille of the map edge, thousandths from the end a', () => {
    expect(borderPermille(line(300), 0)).toBe(300);
    expect(borderPoint(line(300), 0)?.x).toBeCloseTo(300);
  });

  it('is the middle for a map without the field (an old replay frames file)', () => {
    expect(borderPermille(line(undefined), 0)).toBe(500);
    expect(borderPoint(line(undefined), 0)?.x).toBeCloseTo(500);
  });
});

describe('ageLabel', () => {
  it('shows minutes and seconds since the sighting', () => {
    expect(ageLabel(210, 10)).toBe('-0:21');
    expect(ageLabel(0, 10)).toBe('-0:00');
    expect(ageLabel(1250, 10)).toBe('-2:05');
  });

  it('treats a sighting from the future as just now', () => {
    expect(ageLabel(-30, 10)).toBe('-0:00');
  });

  it('does not divide by a zero tick rate', () => {
    expect(ageLabel(100, 0)).toBe('-0:00');
  });
});

describe('ghostAlpha (9.8)', () => {
  it('stays at 0.6 for the first minute, fades linearly, and is gone after two minutes', () => {
    expect(ghostAlpha(0)).toBe(0.6);
    expect(ghostAlpha(60)).toBe(0.6);
    expect(ghostAlpha(90)).toBeCloseTo(0.3);
    expect(ghostAlpha(119)).toBeGreaterThan(0);
    expect(ghostAlpha(119)).toBeLessThan(0.02);
    expect(ghostAlpha(120)).toBe(0);
    expect(ghostAlpha(500)).toBe(0);
  });
});
