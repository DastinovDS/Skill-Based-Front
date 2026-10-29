import { describe, expect, it } from 'vitest';
import { ringRadius } from './cityLayout.ts';
import { showsSight, sightLevel, signAt } from './sightLayout.ts';

describe('the sight sign (#429)', () => {
  it('counts bars by the detail of the snapshot: exact 3, range 2, presence 1, fog none', () => {
    expect(sightLevel('exact')).toBe(3);
    expect(sightLevel('range')).toBe(2);
    expect(sightLevel('presence')).toBe(1);
    expect(sightLevel('fog')).toBe(0);
  });

  it('is for a place that is not yours and that you see now', () => {
    expect(showsSight(1, 0, 'range')).toBe(true);
    expect(showsSight(null, 0, 'presence')).toBe(true);
    expect(showsSight(0, 0, 'exact')).toBe(false); // your own place needs no sign
    expect(showsSight(1, 0, 'fog')).toBe(false);
  });

  it('stands at the lower right of the ring, clear of the ring', () => {
    const at = signAt({ x: 100, y: 200 }, 14);
    expect(at.x).toBeGreaterThan(100);
    expect(at.y).toBeGreaterThan(200);
    expect(Math.hypot(at.x - 100, at.y - 200)).toBeGreaterThan(ringRadius(14));
  });
});
