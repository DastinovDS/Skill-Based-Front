import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '../protocol.gen.ts';
import { MatchAudio, STALE_MS } from './matchAudio.ts';
import type { SoundId } from './recipes.ts';

const round = (tick: number): ServerMsg => ({
  type: 'event',
  tick,
  kind: 'fight_round',
  data: { losses_0: 0, losses_1: 0 },
});
const captured = (tick: number): ServerMsg => ({
  type: 'event',
  tick,
  kind: 'node_captured',
  data: { node: 1, player: 0 },
});

function setup(opts: { reduced?: boolean } = {}) {
  const played: SoundId[] = [];
  const clock = { now: 0, visible: true };
  const audio = new MatchAudio({
    me: 0,
    play: (id) => played.push(id),
    now: () => clock.now,
    visible: () => clock.visible,
    reduced: () => opts.reduced === true,
  });
  return { audio, played, clock };
}

describe('MatchAudio', () => {
  it('plays an event when the map reaches its tick, not before', () => {
    const { audio, played } = setup();
    audio.onMessage(captured(50));
    audio.onRender(49);
    expect(played).toEqual([]);
    audio.onRender(50);
    expect(played).toEqual(['capture']);
    audio.onRender(51);
    expect(played).toEqual(['capture']);
  });

  it('plays an accepted order and the match end at once', () => {
    const { audio, played } = setup();
    audio.onMessage({
      type: 'ack',
      seq: 1,
      applied_tick: 2,
      path: null,
      arrive_tick: null,
      reject_code: null,
    });
    expect(played).toEqual(['orderOk']);
  });

  it('drops sounds older than half a second when the frames come back', () => {
    const { audio, played, clock } = setup();
    clock.visible = false;
    audio.onMessage(captured(10));
    audio.onMessage(round(11));
    clock.now = 10_000;
    clock.visible = true;
    audio.onMessage(captured(900));
    audio.onRender(900);
    expect(played).toEqual(['capture']); // only the fresh one, no burst of the old ones
  });

  it('keeps a sound up to the stale limit', () => {
    const { audio, played, clock } = setup();
    audio.onMessage(captured(5));
    clock.now = STALE_MS;
    audio.onRender(5);
    expect(played).toEqual(['capture']);
  });

  it('plays nothing while the tab is hidden', () => {
    const { audio, played, clock } = setup();
    audio.onMessage(captured(5));
    clock.visible = false;
    audio.onRender(5);
    audio.onMessage({
      type: 'ack',
      seq: 1,
      applied_tick: 2,
      path: null,
      arrive_tick: null,
      reject_code: null,
    });
    expect(played).toEqual([]);
  });

  it('skips the fight hit under less motion but keeps the rest', () => {
    const { audio, played } = setup({ reduced: true });
    audio.onMessage(round(5));
    audio.onMessage(captured(5));
    audio.onRender(5);
    expect(played).toEqual(['capture']);
  });

  it('forgets what waits after a reset', () => {
    const { audio, played } = setup();
    audio.onMessage(captured(5));
    audio.reset();
    audio.onRender(9);
    expect(played).toEqual([]);
  });
});
