import { describe, expect, it } from 'vitest';
import { NEW_MAP, RANDOM_POOL, type Invite, type MapSummary } from '../api/http.ts';
import {
  DRAW_NODES,
  DRAW_TRAIL,
  drawTimes,
  inviteView,
  pickedTile,
  pickerTiles,
  stepWay,
  WAY_PAUSE,
  WAY_VERB,
} from './play.ts';

const map = (id: string, over: Partial<MapSummary> = {}): MapSummary => ({
  id,
  version: 1,
  width: 100,
  height: 100,
  background_url: null,
  generated: false,
  per_match: false,
  ...over,
});

describe('the ways of the plinth (#919)', () => {
  it('says per way what the main button does (r2 "Per way")', () => {
    expect(WAY_VERB).toEqual({ match: 'play.go.search', bot: 'bot.start', friend: 'play.go.link' });
  });

  it('has no pauses in a queue match, one each with a bot or a friend (DEC-05)', () => {
    expect(WAY_PAUSE).toEqual({ match: 'none', bot: 'each', friend: 'each' });
  });

  it('steps with the arrows and stops at the ends', () => {
    expect(stepWay('match', 1)).toBe('bot');
    expect(stepWay('friend', 1)).toBe('friend');
    expect(stepWay('match', -1)).toBe('match');
  });
});

describe("the bot's map picker (#919, item 2)", () => {
  it('is New map, Random map and the pool, without stored generated or per-match maps', () => {
    const tiles = pickerTiles([
      map('crossroads'),
      map('gen1-17', { generated: true }),
      map('ridge'),
      map('live-1', { per_match: true }),
    ]);
    expect(tiles.map((tile) => tile.id)).toEqual([NEW_MAP, RANDOM_POOL, 'crossroads', 'ridge']);
  });

  it('still offers the new and the random map while the list is unknown', () => {
    expect(pickerTiles(null).map((tile) => tile.kind)).toEqual(['new', 'random']);
  });

  it('falls back to the new map when the chosen one left the list', () => {
    const tiles = pickerTiles([map('ridge')]);
    expect(pickedTile('ridge', tiles)).toBe('ridge');
    expect(pickedTile('gen1-17', tiles)).toBe(NEW_MAP);
  });
});

describe('the stages of an invite on the plinth', () => {
  const invite = (over: Partial<Invite> = {}): Invite => ({
    code: 'abc',
    state: 'open',
    public: false,
    map_id: 'live-1',
    map_ready: false,
    host_nick: 'Me',
    guest_nick: null,
    you_ready: false,
    opponent_ready: false,
    expires_in_s: 1800,
    match_id: null,
    ...over,
  });

  it('loads first', () => {
    expect(inviteView(null, 'Me').stage).toBe('loading');
  });

  it('shows the link to the host as soon as the invite exists, the map still drawing', () => {
    expect(inviteView(invite(), 'Me')).toMatchObject({
      stage: 'link',
      drawing: true,
      opponent: null,
    });
  });

  it('a public entry has no link to send: it only waits', () => {
    expect(inviteView(invite({ public: true }), 'Me').stage).toBe('waiting');
  });

  it('the other seat is the guest for the host and the host for the guest', () => {
    const joined = invite({ state: 'joined', guest_nick: 'Vega' });
    expect(inviteView(joined, 'Me')).toMatchObject({ stage: 'joined', opponent: 'Vega' });
    expect(inviteView(joined, 'Vega')).toMatchObject({ stage: 'joined', opponent: 'Me' });
  });

  it('starts once both are ready', () => {
    const both = invite({ guest_nick: 'Vega', you_ready: true, opponent_ready: true });
    expect(inviteView(both, 'Me').stage).toBe('starting');
  });
});

describe('the drawing sketch', () => {
  it('sets every place within the drawing part of the loop, the first at the start', () => {
    const times = drawTimes(0.78);
    expect(times).toHaveLength(DRAW_NODES.length);
    expect(times[0]).toBe(0);
    for (const at of times) {
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThanOrEqual(0.78);
    }
  });

  it('visits every node on its trail', () => {
    for (let n = 0; n < DRAW_NODES.length; n++) expect(DRAW_TRAIL).toContain(n);
  });
});
