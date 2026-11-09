import { describe, expect, it } from 'vitest';
import {
  CANAL,
  canalHachures,
  canalHead,
  canalPhase,
  canalRails,
  canalSpan,
  turnedSquare,
} from './canalLayout.ts';
import { ringRadius } from './cityLayout.ts';

const from = { x: 0, y: 0 };
const to = { x: 100, y: 0 };

describe('canalSpan: from ring to ring', () => {
  it('starts and ends just outside the capacity rings, with its unit vectors', () => {
    const span = canalSpan(from, to, 11, 14);
    if (span === null) throw new Error('no canal');
    expect(span.a.x).toBeCloseTo(ringRadius(11) + CANAL.inset);
    expect(span.b.x).toBeCloseTo(100 - ringRadius(14) - CANAL.inset);
    expect(span.length).toBeCloseTo(span.b.x - span.a.x);
    expect(span.u).toEqual({ x: 1, y: 0 });
    expect(span.n).toEqual({ x: -0, y: 1 });
  });

  it('is nothing when the rings touch', () => {
    expect(canalSpan(from, { x: 20, y: 0 }, 11, 11)).toBeNull();
  });
});

describe('canalHachures and canalPhase: the hachures run downhill', () => {
  const span = canalSpan(from, to, 11, 11);
  if (span === null) throw new Error('no canal');

  it('lays one hachure a pitch across the channel, all inside it', () => {
    const marks = canalHachures(span, 0);
    expect(marks.length).toBe(Math.floor((span.length - 2) / CANAL.pitch) + 1);
    for (const [p, q] of marks) {
      expect(p.x).toBeCloseTo(q.x);
      expect(Math.abs(p.y - q.y)).toBeCloseTo(2 * CANAL.half);
      expect(p.x).toBeGreaterThan(span.a.x - CANAL.lag);
      expect(p.x).toBeLessThan(span.b.x);
    }
  });

  it('moves them downhill with the phase, a pitch later it is the same picture', () => {
    const at = (phase: number): number => canalHachures(span, phase)[0]?.[0].x ?? 0;
    expect(at(1)).toBeCloseTo(at(0) + 1);
    expect(at(CANAL.pitch)).toBeCloseTo(at(0));
  });

  it('steps the phase a few times a second and holds it still with less motion', () => {
    expect(canalPhase(1, false)).toBe(CANAL.speed);
    expect((canalPhase(0.37, false) / CANAL.step) % 1).toBe(0);
    expect(canalPhase(0.37, false)).toBe(canalPhase(0.38, false));
    expect(canalPhase(5, true)).toBe(0);
  });
});

describe('the rails, the head and a packet', () => {
  const span = canalSpan(from, to, 11, 11);
  if (span === null) throw new Error('no canal');

  it('has two rails along the edges of the channel', () => {
    const rails = canalRails(span);
    expect(rails.map(([p]) => p.y)).toEqual([CANAL.half, -CANAL.half]);
  });

  it('points its V downhill at the receiving ring', () => {
    const [left, tip, right] = canalHead(span);
    expect(tip?.x).toBeCloseTo(span.b.x - 1);
    expect(left?.x).toBeLessThan(tip?.x ?? 0);
    expect(right?.x).toBeLessThan(tip?.x ?? 0);
  });

  it('turns a packet square along its road', () => {
    const flat = turnedSquare({ x: 0, y: 0 }, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 2);
    expect(flat).toHaveLength(8);
    // Turned 45 degrees: a corner on each axis.
    expect(Math.abs(flat[0] ?? 1)).toBeLessThan(1e-9);
  });
});
