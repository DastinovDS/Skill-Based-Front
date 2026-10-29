import { describe, expect, it } from 'vitest';
import type { MatchEntry, PlayerProfile } from '../api/http.ts';
import { botLabel, ownEntry, ratingOf, statusOf, visibleMatches } from './view.ts';

const record = { wins: 0, losses: 0, draws: 0 };

function profile(over: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    player_id: 1,
    nick: 'Vega',
    has_password: true,
    rating: 1590,
    rank: 3,
    calibration: null,
    rated_matches: 37,
    rated_record: record,
    record,
    matches: [],
    ...over,
  };
}

function match(kind: MatchEntry['kind'], over: Partial<MatchEntry> = {}): MatchEntry {
  return {
    match_id: 1,
    map_id: 'crossroads',
    ended_at: '2026-10-29T10:00:00Z',
    ticks: 7000,
    result: 'win',
    end_reason: 'timer',
    kind,
    unrated_reason: null,
    opponent: { player_id: 2, nick: 'Kolya', bot: false },
    rating_change: null,
    replay: { state: 'ready', url: '/api/replays/1' },
    ...over,
  };
}

describe('statusOf', () => {
  it('tells a ranked account, a calibrating one and a guest apart', () => {
    expect(statusOf(profile())).toEqual({ kind: 'ranked', rating: 1590, rank: 3 });
    expect(
      statusOf(profile({ rating: null, rank: null, calibration: { played: 2, total: 5 } })),
    ).toEqual({ kind: 'calibrating', played: 2, total: 5 });
    expect(statusOf(profile({ has_password: false, rating: null, rank: null }))).toEqual({
      kind: 'guest',
    });
  });

  it('keeps a rating without a rank', () => {
    expect(statusOf(profile({ rank: null }))).toEqual({ kind: 'ranked', rating: 1590, rank: null });
  });
});

describe('visibleMatches', () => {
  const matches = [
    match('rated'),
    match('calibration'),
    match('casual'),
    match('unrated'),
    match('bot'),
  ];

  it('shows every kind on the own profile', () => {
    expect(visibleMatches(profile({ matches }), true)).toHaveLength(5);
  });

  it("shows another player's ranked matches only", () => {
    const shown = visibleMatches(profile({ matches }), false).map((m) => m.kind);
    expect(shown).toEqual(['rated', 'calibration']);
  });
});

describe('ratingOf', () => {
  it('writes the change with a real minus sign', () => {
    const up = ratingOf(match('rated', { rating_change: { before: 1466, after: 1480 } }));
    expect(up).toEqual({ kind: 'change', delta: '+14', before: 1466, after: 1480 });
    const down = ratingOf(match('rated', { rating_change: { before: 1475, after: 1466 } }));
    expect(down).toMatchObject({ delta: '−9' });
    const same = ratingOf(match('rated', { rating_change: { before: 1400, after: 1400 } }));
    expect(same).toMatchObject({ delta: '±0' });
  });

  it('hides the rating of a calibration match and has nothing for the rest', () => {
    expect(ratingOf(match('calibration'))).toEqual({ kind: 'hidden' });
    expect(ratingOf(match('casual'))).toEqual({ kind: 'none' });
  });
});

describe('botLabel', () => {
  const echo = (key: string): string => `<${key}>`;

  it('names a bot by its level and keeps a name it does not know', () => {
    expect(botLabel('rusher', echo)).toBe('<bot.level.expert>');
    expect(botLabel('turtle', echo)).toBe('<bot.level.easy>');
    expect(botLabel('newbot', echo)).toBe('newbot');
  });
});

describe('ownEntry', () => {
  const board = {
    entries: [
      { rank: 1, player_id: 5, nick: 'A', rating: 1700, rated_matches: 9, record },
      { rank: 2, player_id: 6, nick: 'B', rating: 1600, rated_matches: 9, record },
    ],
    total: 2,
    min_rated_matches: 5,
  };

  it('finds the own row, or nothing', () => {
    expect(ownEntry(board, 6)?.rank).toBe(2);
    expect(ownEntry(board, 9)).toBeNull();
    expect(ownEntry(board, null)).toBeNull();
  });
});
