import { describe, expect, it } from 'vitest';
import { easeEngrave } from '../theme/tokens.ts';
import { earmarks } from './cpMotion.ts';
import { railTicks, vpCountdown } from './topBar.ts';
import { ARCH_PX, flightPoint, gatePoint } from './walkFlight.ts';

describe('earmarks (#930, W1/W2)', () => {
  const paid = { short: false };
  const lack = { short: true };

  it('earmarks the top of the bar per walk the CP pay, the nearest on top', () => {
    expect(earmarks(1.5, 5, [paid, paid], 0.5)).toEqual([
      { lo: 1, hi: 1.5, short: false },
      { lo: 0.5, hi: 1, short: false },
    ]);
  });

  it('lays the walks the CP do not pay past the value, one after the other', () => {
    expect(earmarks(1.25, 5, [paid, paid, lack, lack], 0.5)).toEqual([
      { lo: 0.75, hi: 1.25, short: false },
      { lo: 0.25, hi: 0.75, short: false },
      { lo: 1.25, hi: 1.75, short: true },
      { lo: 1.75, hi: 2.25, short: true },
    ]);
  });

  it('keeps to the scale: nothing runs past the cap or under zero', () => {
    expect(earmarks(4.75, 5, [lack, lack], 0.5)).toEqual([{ lo: 4.75, hi: 5, short: true }]);
    expect(earmarks(0.25, 5, [paid], 0.5)).toEqual([{ lo: 0, hi: 0.25, short: false }]);
  });

  it('follows the shown value while a spend eases', () => {
    const [mark] = earmarks(2.2, 5, [paid], 0.5);
    expect(mark?.hi).toBe(2.2);
    expect(mark?.lo).toBeCloseTo(1.7);
  });
});

describe('vpCountdown (#930, P1; the rule of #934)', () => {
  // `victory.vp_period_ticks` 300: credits on every tick t > 0 with t % 300 == 0, and a snapshot of
  // tick t already includes the credit of t, so the next is 300 - t % 300 ticks away.
  it('counts down to the next credit, never to 0', () => {
    expect(vpCountdown(0, 300)).toEqual({ ticks: 300, share: 0, round: 0 });
    expect(vpCountdown(180, 300)).toEqual({ ticks: 120, share: 0.6, round: 0 });
    expect(vpCountdown(299, 300)).toEqual({ ticks: 1, share: 299 / 300, round: 0 });
  });

  it('starts a new period at the tick of a credit (the snapshot includes it)', () => {
    expect(vpCountdown(300, 300)).toEqual({ ticks: 300, share: 0, round: 1 });
    expect(vpCountdown(2580, 300)).toEqual({ ticks: 120, share: 0.6, round: 8 });
  });

  it('has none without a period', () => {
    expect(vpCountdown(10, 0)).toBeNull();
  });
});

describe('railTicks', () => {
  it('ticks every 5 s of a 30 s period, both ends included', () => {
    expect(railTicks(300, 10)).toEqual([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]);
  });

  it('keeps the two ends for a short period', () => {
    expect(railTicks(20, 10)).toEqual([0, 1]);
  });
});

describe('the flight of a paid walk (#930, W10)', () => {
  it('leaves from the gate: 10 px out of the city towards its rally point', () => {
    expect(gatePoint({ x: 100, y: 100, r: 20 }, { x: 200, y: 100, r: 20 })).toEqual({
      x: 130,
      y: 100,
    });
    // The point off screen: straight up.
    expect(gatePoint({ x: 100, y: 100, r: 20 }, null)).toEqual({ x: 100, y: 70 });
  });

  it('flies an arch from the gate into the gauge and fades at the end', () => {
    const path = { from: { x: 0, y: 400 }, to: { x: 200, y: 10 } };
    const start = flightPoint(path, 0, 700, easeEngrave);
    expect([start.x, start.y, start.alpha]).toEqual([0, 400, 1]);
    const middle = flightPoint(path, 350, 700, easeEngrave);
    expect(middle.x).toBeCloseTo(100);
    expect(middle.y).toBeCloseTo(205 - ARCH_PX);
    const end = flightPoint(path, 700, 700, easeEngrave);
    expect(end.x).toBeCloseTo(200);
    expect(end.y).toBeCloseTo(10);
    expect(end.alpha).toBe(0);
    expect(end.trail.startsWith('M200.0 10.0')).toBe(true);
  });
});
