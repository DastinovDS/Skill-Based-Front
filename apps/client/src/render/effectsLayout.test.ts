import { BOUNCE_HOME } from './style.ts';
import { describe, expect, it } from 'vitest';
import { expectDeclared, filledData, tracked } from '../net/eventFields.fixture.ts';
import type { EventMsg, MapFile } from '../protocol.gen.ts';
import {
  homeChevronShape,
  homeChevrons,
  bounceInfo,
  captureInfo,
  effectProgress,
  numbersLook,
  starPolygon,
} from './effectsLayout.ts';

const event = (kind: string, data: EventMsg['data'], tick = 10): EventMsg => ({
  type: 'event',
  tick,
  kind,
  data,
});
const map = { nodes: [{ id: 0, x: 10, y: 20 }] } as unknown as MapFile;

describe('effectProgress', () => {
  it('runs 0..1 over the duration in ticks and is null before and after', () => {
    expect(effectProgress(-1, 400, 10)).toBeNull();
    expect(effectProgress(0, 400, 10)).toBe(0);
    expect(effectProgress(2, 400, 10)).toBeCloseTo(0.5);
    expect(effectProgress(4, 400, 10)).toBeNull();
    // 3 s of loss numbers at 10 ticks per second.
    expect(effectProgress(29, 3000, 10)).toBeLessThan(1);
    expect(effectProgress(30, 3000, 10)).toBeNull();
  });
});

describe('effect looks', () => {
  it('lets the numbers rise by 12 and fade at the end, but not rise with reduced motion', () => {
    expect(numbersLook(0, false)).toEqual({ alpha: 1, rise: 0 });
    expect(numbersLook(1, false).rise).toBe(12);
    expect(numbersLook(0.5, false).alpha).toBe(1);
    expect(numbersLook(0.95, false).alpha).toBeCloseTo(1 / 6);
    expect(numbersLook(1, true).rise).toBe(0);
    expect(numbersLook(0.5, true).alpha).toBe(1);
  });
});

describe('geometry', () => {
  it('makes a star with alternating radii', () => {
    const star = starPolygon(10, 4, 4);
    expect(star).toHaveLength(16);
    expect(Math.hypot(star[0] ?? 0, star[1] ?? 0)).toBeCloseTo(10);
    expect(Math.hypot(star[2] ?? 0, star[3] ?? 0)).toBeCloseTo(4);
  });

  it('runs three chevrons from a bounced group towards home, fainter one by one (Chevrons home)', () => {
    const run = homeChevrons({ x: 100, y: 0 }, { x: 0, y: 0 }, 20, 0, 1000);
    expect(run).toHaveLength(BOUNCE_HOME.count);
    // Ahead of the helmet, towards home, the gap apart.
    expect(run[0]?.at.x).toBeCloseTo(100 - 20 * 0.6 - BOUNCE_HOME.lead);
    expect(run[1]?.at.x).toBeCloseTo((run[0]?.at.x ?? 0) - BOUNCE_HOME.gap);
    expect(run.every((c) => c.dir.x === -1)).toBe(true);
    expect(run[0]?.alpha).toBe(1);
    expect(run[2]?.alpha).toBeCloseTo(1 - 2 * BOUNCE_HOME.dim);
    // They run: a quarter of a gap later they stand a quarter gap on.
    const later = homeChevrons(
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      20,
      BOUNCE_HOME.gap / 4 / BOUNCE_HOME.speed,
      1000,
    );
    expect(later[0]?.at.x).toBeCloseTo((run[0]?.at.x ?? 0) - BOUNCE_HOME.gap / 4);
    // They fade in after the bounce, and none runs past home.
    expect(homeChevrons({ x: 100, y: 0 }, { x: 0, y: 0 }, 20, 0, -200)[0]?.alpha).toBe(0);
    expect(homeChevrons({ x: 30, y: 0 }, { x: 0, y: 0 }, 20, 0, 1000)).toHaveLength(1);
    expect(homeChevrons({ x: 5, y: 5 }, { x: 5, y: 5 }, 20, 0, 1000)).toEqual([]);
  });

  it('points a home chevron along the way home', () => {
    const [c] = homeChevrons({ x: 100, y: 0 }, { x: 0, y: 0 }, 20, 0, 1000);
    if (c === undefined) throw new Error('no chevron');
    const shape = homeChevronShape(c);
    expect(shape[0]).toBeCloseTo(c.at.x - BOUNCE_HOME.tip);
    expect(shape).toHaveLength(8);
  });
});

describe('event readers', () => {
  it('reads a capture of a known city', () => {
    expect(captureInfo(event('node_captured', { node: 0, player: 1 }), map)).toEqual({
      node: 0,
      player: 1,
      tick: 10,
      at: { x: 10, y: 20 },
    });
    expect(captureInfo(event('node_captured', { node: 7, player: 1 }), map)).toBeNull();
    expect(captureInfo(event('fight', { node: 0, player: 1 }), map)).toBeNull();
  });

  it('reads a bounce only from a fight_group of a bounced group', () => {
    expect(bounceInfo(event('fight_group', { group: '5', bounce: true }))).toEqual({
      group: '5',
      tick: 10,
    });
    expect(bounceInfo(event('fight_group', { group: '5', bounce: false }))).toBeNull();
    expect(bounceInfo(event('fight', { group: '5', bounce: true }))).toBeNull();
  });
});

describe('the fields the effects read (ARC-02)', () => {
  it('captureInfo reads only fields of node_captured the server sends', () => {
    const { data, reads } = tracked(
      'node_captured',
      filledData('node_captured', { node: 0, player: 1 }),
    );
    expect(captureInfo(event('node_captured', data), map)).not.toBeNull();
    expectDeclared('node_captured', reads);
  });

  it('bounceInfo reads only fields of fight_group the server sends', () => {
    const { data, reads } = tracked('fight_group', filledData('fight_group', { bounce: true }));
    expect(bounceInfo(event('fight_group', data))).not.toBeNull();
    expectDeclared('fight_group', reads);
  });
});
