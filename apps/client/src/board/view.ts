/**
 * What the leaderboard and the profile show, derived from the server's answers (#78). Display
 * rules only: the rating, the rank, the result and whether a replay opens all come from the
 * server (AGENTS.md, section 7.1); nothing here computes them.
 */
import type {
  BotLevel,
  Leaderboard,
  LeaderboardEntry,
  MatchEntry,
  PlayerProfile,
  RecordTally,
} from '../api/http.ts';
import type { MessageKey } from '../i18n/index.ts';

export type PlayerStatus =
  /** A password account with a rating (`rank` is null only if the server did not rank it). */
  | { readonly kind: 'ranked'; readonly rating: number; readonly rank: number | null }
  /** The first ranked matches: the rating is hidden (DEC-34). */
  | { readonly kind: 'calibrating'; readonly played: number; readonly total: number }
  /** No password: no rating at all. */
  | { readonly kind: 'guest' };

export function statusOf(profile: PlayerProfile): PlayerStatus {
  if (!profile.has_password) return { kind: 'guest' };
  if (profile.rating !== null) {
    return { kind: 'ranked', rating: profile.rating, rank: profile.rank };
  }
  const calibration = profile.calibration;
  // An account without a rating is in calibration; the server always says how far it is.
  return calibration === null
    ? { kind: 'guest' }
    : { kind: 'calibrating', played: calibration.played, total: calibration.total };
}

/** The kinds that change a rating (the ranked matches of the defaults in #78). */
const RANKED_KINDS: ReadonlySet<MatchEntry['kind']> = new Set(['rated', 'calibration']);

/**
 * The history lines of a profile. Your own profile lists every kind. Another player's lists the
 * ranked matches only (default 4 of #78): their casual and unrated replays are private anyway.
 */
export function visibleMatches(profile: PlayerProfile, own: boolean): readonly MatchEntry[] {
  return own ? profile.matches : profile.matches.filter((m) => RANKED_KINDS.has(m.kind));
}

/** The bot names the server stores per difficulty level (`LEVEL_BOTS` of botmatch.py). */
const BOT_LEVELS: Readonly<Record<string, BotLevel>> = {
  turtle: 'easy',
  reactive: 'normal',
  expander: 'hard',
  rusher: 'expert',
};

const BOT_LEVEL_KEYS: Readonly<Record<BotLevel, MessageKey>> = {
  easy: 'bot.level.easy',
  normal: 'bot.level.normal',
  hard: 'bot.level.hard',
  expert: 'bot.level.expert',
};

/** The label of a bot opponent: its difficulty level, or the server's name if it is a new one. */
export function botLabel(nick: string, translate: (key: MessageKey) => string): string {
  const level = BOT_LEVELS[nick];
  return level === undefined ? nick : translate(BOT_LEVEL_KEYS[level]);
}

export type RatingText =
  | { readonly kind: 'none' }
  /** A calibration match: the rating stays hidden until calibration is over. */
  | { readonly kind: 'hidden' }
  | {
      readonly kind: 'change';
      /** "+14", "-9" with a true minus sign, "±0". */
      readonly delta: string;
      readonly before: number;
      readonly after: number;
    };

export function ratingOf(match: MatchEntry): RatingText {
  const change = match.rating_change;
  if (change === null) return { kind: match.kind === 'calibration' ? 'hidden' : 'none' };
  const diff = change.after - change.before;
  const delta = diff > 0 ? `+${String(diff)}` : diff < 0 ? `−${String(-diff)}` : '±0';
  return { kind: 'change', delta, before: change.before, after: change.after };
}

/** The row of the leaderboard that is the player's own, if it is in the top. */
export function ownEntry(board: Leaderboard, ownId: number | null): LeaderboardEntry | null {
  return ownId === null ? null : (board.entries.find((e) => e.player_id === ownId) ?? null);
}

/**
 * The share of wins in percent, rounded to the nearest whole one, for the leaderboard column
 * (#629, L10): a display figure of the record the server sends; `null` without matches.
 */
export function winShare(record: RecordTally, matches: number): number | null {
  return matches <= 0 ? null : Math.round((record.wins * 100) / matches);
}

/** "17–13–1": wins, losses, draws, as the leaderboard writes them. */
export function recordText(record: RecordTally): string {
  return `${String(record.wins)}–${String(record.losses)}–${String(record.draws)}`;
}

/** A number of the profile, or why there is none. */
export type FactValue =
  | { readonly kind: 'number'; readonly value: number }
  /** In calibration the rating exists but is not shown (DEC-34). */
  | { readonly kind: 'hidden' }
  /** A guest has no rating at all. */
  | { readonly kind: 'none' };

/** The facts row of the own profile (#871): all of it from `GET /api/players/{id}`. */
export interface ProfileFacts {
  readonly rating: FactValue;
  readonly rank: FactValue;
  /**
   * An account counts its ranked matches and their record; a guest plays no ranked match, so it
   * shows all its matches and their record instead.
   */
  readonly matchesLabel: 'profile.fact.ranked' | 'profile.fact.matches';
  readonly matches: number;
  readonly record: RecordTally;
  readonly status: PlayerStatus;
}

const NONE = { kind: 'none' } as const;
const HIDDEN = { kind: 'hidden' } as const;

export function profileFacts(profile: PlayerProfile): ProfileFacts {
  const status = statusOf(profile);
  if (status.kind === 'guest') {
    const all = profile.record;
    return {
      rating: NONE,
      rank: NONE,
      matchesLabel: 'profile.fact.matches',
      matches: all.wins + all.losses + all.draws,
      record: all,
      status,
    };
  }
  const ranked = status.kind === 'ranked';
  return {
    rating: ranked ? { kind: 'number', value: status.rating } : HIDDEN,
    rank: ranked ? (status.rank === null ? NONE : { kind: 'number', value: status.rank }) : HIDDEN,
    matchesLabel: 'profile.fact.ranked',
    matches: profile.rated_matches,
    record: profile.rated_record,
    status,
  };
}
