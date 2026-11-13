import { describe, expect, it } from 'vitest';
import { leaderLine, placeCard, type Rect } from './leader.ts';

// The hint card stands near its target and off every place, mark and HUD piece (the walkthrough's
// placement, docs/design/tutorial.md section 8).
describe('the Leader card', () => {
  const area: Rect = [0, 60, 1280, 800];
  const size = { w: 330, h: 120 };

  it('stands close to its target without covering it or an obstacle', () => {
    const target = { kind: 'circle' as const, x: 640, y: 400, r: 30 };
    const blocked: Rect = [700, 300, 1000, 500];
    const at = placeCard(target, size, area, [[584, 344, 696, 456], blocked]);
    const box: Rect = [at.x, at.y, at.x + size.w, at.y + size.h];
    const hits = (r: Rect): boolean =>
      !(box[2] <= r[0] || box[0] >= r[2] || box[3] <= r[1] || box[1] >= r[3]);
    expect(hits([584, 344, 696, 456])).toBe(false);
    expect(hits(blocked)).toBe(false);
    expect(at.y).toBeGreaterThanOrEqual(60);
    const near = Math.hypot(
      Math.max(box[0] - 640, 0, 640 - box[2]),
      Math.max(box[1] - 400, 0, 400 - box[3]),
    );
    expect(near).toBeLessThan(160);
  });

  it('ties the plate to the edge of a circle and to the side of a box', () => {
    const line = leaderLine({ kind: 'circle', x: 100, y: 300, r: 20 }, { x: 300, y: 250 }, size);
    expect(line.from).toEqual({ x: 300, y: 300 });
    expect(line.to.x).toBeCloseTo(136);
    expect(line.to.y).toBeCloseTo(300);
    const box = leaderLine({ kind: 'box', x: 10, y: 8, w: 200, h: 36 }, { x: 100, y: 200 }, size);
    expect(box.to.y).toBe(51);
  });
});
