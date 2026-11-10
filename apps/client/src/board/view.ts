/**
 * What the profile shows, derived from the server's answers (#871, #919). Display rules only: the
 * result and whether a replay opens come from the server (AGENTS.md, section 7.1); nothing here
 * computes them. No rating is shown outside a match at the MVP (#919).
 */
import { BOT_LEVELS, type BotLevel, type PlayerProfile, type RecordTally } from '../api/http.ts';

/** The bot names the server stores per difficulty level (`LEVEL_BOTS` of botmatch.py). */
const BOT_NAMES: Readonly<Record<string, BotLevel>> = {
  turtle: 'easy',
  reactive: 'normal',
  expander: 'hard',
  rusher: 'expert',
};

/** The level of a bot opponent by the server's name, or null for a name it does not know. */
export function botLevel(nick: string): BotLevel | null {
  return BOT_NAMES[nick] ?? null;
}

/** How many of the four lozenges a level fills (Easy 1 to Expert 4). */
export function levelCells(level: BotLevel): number {
  return BOT_LEVELS.indexOf(level) + 1;
}

/** "17–13–1": wins, losses, draws. */
export function recordText(record: RecordTally): string {
  return `${String(record.wins)}–${String(record.losses)}–${String(record.draws)}`;
}

/** The facts of the own profile (#919): every match played and their record, nothing rated. */
export interface ProfileFacts {
  readonly matches: number;
  readonly record: RecordTally;
}

export function profileFacts(profile: PlayerProfile): ProfileFacts {
  const all = profile.record;
  return { matches: all.wins + all.losses + all.draws, record: all };
}
