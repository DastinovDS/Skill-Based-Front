import { beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE } from './fixture.ts';
import { ReplayPlayer } from './replayPlayer.ts';

let clock = 0;
const advance = (ms: number): void => {
  clock += ms;
};
let player: ReplayPlayer;

beforeEach(() => {
  clock = 1000;
  player = new ReplayPlayer(SAMPLE, () => clock);
});

describe('ReplayPlayer', () => {
  it('starts paused at tick 0 and does not move until played', () => {
    advance(5000);
    expect(player.frame().tick).toBe(0);
    expect(player.playing).toBe(false);
  });

  it('plays in real time at x1: one second is tick_hz ticks', () => {
    player.play();
    advance(2000);
    expect(player.frame().tick).toBe(2 * SAMPLE.tick_hz);
  });

  it.each([4, 16] as const)('plays x%i faster', (speed) => {
    player.setSpeed(speed);
    player.play();
    advance(1000);
    expect(player.frame().tick).toBe(SAMPLE.tick_hz * speed);
  });

  it('changing the speed keeps the time already played', () => {
    player.play();
    advance(1000);
    player.setSpeed(4);
    advance(1000);
    expect(player.position).toBeCloseTo(SAMPLE.tick_hz + SAMPLE.tick_hz * 4);
  });

  it('holds the position on pause', () => {
    player.play();
    advance(1000);
    player.pause();
    advance(9000);
    expect(player.position).toBe(SAMPLE.tick_hz);
  });

  it('stops at the end, and play after the end starts over', () => {
    player.setSpeed(16);
    player.play();
    advance(60_000);
    player.frame();
    expect(player.position).toBe(SAMPLE.ticks);
    expect(player.playing).toBe(false);
    expect(player.ended).toBe(true);
    player.play();
    expect(player.position).toBe(0);
    expect(player.playing).toBe(true);
  });

  it('seeks inside the match and clamps outside it', () => {
    player.seek(123);
    expect(player.frame().tick).toBe(123);
    player.seek(-5);
    expect(player.position).toBe(0);
    player.seek(10 ** 6);
    expect(player.position).toBe(SAMPLE.ticks);
  });

  it('interpolates between two frames', () => {
    const [a, b] = SAMPLE.frames;
    const middle = ((a?.t ?? 0) + (b?.t ?? 0)) / 2;
    player.seek(middle);
    expect(player.frame().tick).toBe(middle);
    expect(player.frame().base.tick).toBe(a?.t);
  });

  it('draws the groups and packets of both sides with their owners', () => {
    const owners = new Set<number | undefined>();
    for (const frame of SAMPLE.frames) {
      player.seek(frame.t);
      for (const g of player.frame().groups) owners.add(g.owner);
    }
    expect(owners).toEqual(new Set([0, 1]));
    const withPackets = SAMPLE.frames.find((f) => f.k.length > 0);
    if (withPackets !== undefined) {
      player.seek(withPackets.t);
      expect(player.frame().packets.map((p) => p.owner)).toEqual(withPackets.k.map((k) => k[1]));
    }
  });

  it('serves the events up to the position, the same array while unchanged', () => {
    expect(player.events()).toEqual([]);
    player.seek(200);
    const events = player.events();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.tick <= 200)).toBe(true);
    expect(player.events()).toBe(events);
    player.seek(0);
    expect(player.events()).toEqual([]);
  });

  it('shows the final VP at the end', () => {
    player.seek(SAMPLE.ticks);
    expect(player.current.view.vp).toEqual(SAMPLE.vp);
  });
});
