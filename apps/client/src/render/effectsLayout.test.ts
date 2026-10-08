import { describe, expect, it } from 'vitest';
import type { EventMsg, MapFile } from '../protocol.gen.ts';
import {
  bounceArrow,
  bounceInfo,
  captureInfo,
  effectProgress,
  flashLook,
  numbersLook,
  scaledPolygon,
  starPolygon,
  waveLook,
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
  it('fades the flash out while it grows', () => {
    expect(flashLook(0).alpha).toBe(1);
    expect(flashLook(1).alpha).toBe(0);
    expect(flashLook(1).scale).toBeGreaterThan(flashLook(0).scale);
  });

  it('lets the numbers rise by 12 and fade at the end, but not rise with reduced motion', () => {
    expect(numbersLook(0, false)).toEqual({ alpha: 1, rise: 0 });
    expect(numbersLook(1, false).rise).toBe(12);
    expect(numbersLook(0.5, false).alpha).toBe(1);
    expect(numbersLook(0.95, false).alpha).toBeCloseTo(1 / 6);
    expect(numbersLook(1, true).rise).toBe(0);
    expect(numbersLook(0.5, true).alpha).toBe(1);
  });

  it('grows the wave to the whole cell and fades it', () => {
    expect(waveLook(0)).toEqual({ scale: 0, alpha: 1 });
    expect(waveLook(1)).toEqual({ scale: 1, alpha: 0 });
  });
});

describe('geometry', () => {
  it('makes a star with alternating radii', () => {
    const star = starPolygon(10, 4, 4);
    expect(star).toHaveLength(16);
    expect(Math.hypot(star[0] ?? 0, star[1] ?? 0)).toBeCloseTo(10);
    expect(Math.hypot(star[2] ?? 0, star[3] ?? 0)).toBeCloseTo(4);
  });

  it('scales a cell about the city', () => {
    const cell = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];
    expect(scaledPolygon(cell, { x: 10, y: 0 }, 0.5)).toEqual([5, 0, 15, 0]);
  });

  it('points a bounce arrow towards the node the group came from', () => {
    const arrow = bounceArrow({ x: 100, y: 0 }, { x: 0, y: 0 }, 40, 10);
    expect(arrow?.to.x).toBeCloseTo(60);
    expect(arrow?.head[0].x).toBeCloseTo(60);
    expect(bounceArrow({ x: 5, y: 5 }, { x: 5, y: 5 }, 40, 10)).toBeNull();
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
