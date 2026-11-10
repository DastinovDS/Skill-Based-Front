import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from '../api/http.ts';
import { botLevel, levelCells, profileFacts, recordText } from './view.ts';

function profile(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    player_id: 1,
    nick: 'Vega',
    has_password: true,
    rating: 1590,
    rank: 3,
    calibration: null,
    rated_matches: 3,
    rated_record: { wins: 2, losses: 1, draws: 0 },
    record: { wins: 12, losses: 8, draws: 1 },
    matches: [],
    ...over,
  };
}

describe('the bot opponent of a match row', () => {
  it('names the level of the bots the server stores', () => {
    expect(botLevel('turtle')).toBe('easy');
    expect(botLevel('reactive')).toBe('normal');
    expect(botLevel('expander')).toBe('hard');
    expect(botLevel('rusher')).toBe('expert');
    expect(botLevel('newcomer')).toBeNull();
  });

  it('fills one lozenge per level', () => {
    expect([
      levelCells('easy'),
      levelCells('normal'),
      levelCells('hard'),
      levelCells('expert'),
    ]).toEqual([1, 2, 3, 4]);
  });
});

describe('the facts of the own profile (#919: no rating)', () => {
  it('counts every match and their record, ranked or not', () => {
    expect(profileFacts(profile())).toEqual({
      matches: 21,
      record: { wins: 12, losses: 8, draws: 1 },
    });
  });

  it('is the same for a guest', () => {
    const facts = profileFacts(
      profile({
        has_password: false,
        rating: null,
        rank: null,
        record: { wins: 1, losses: 0, draws: 0 },
      }),
    );
    expect(facts.matches).toBe(1);
  });

  it('writes the record with en dashes', () => {
    expect(recordText({ wins: 17, losses: 13, draws: 1 })).toBe('17–13–1');
  });
});
