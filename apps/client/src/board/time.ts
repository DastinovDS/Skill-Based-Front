/** How long ago a match ended and how long it lasted, for the history lines (#78). Pure. */
import { formatClock } from '../hud/format.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A match older than this shows its date instead of "N days ago". */
const RELATIVE_DAYS = 30;

/**
 * "12 min. ago", "yesterday", "3 days ago" in the language of the UI (`Intl`, no word lists of
 * our own); a match from the future (a skewed clock) counts as "now"; a missing or damaged date
 * is `null`. Older than 30 days: the date.
 */
export function agoText(endedAt: string | null, nowMs: number, locale: string): string | null {
  if (endedAt === null) return null;
  const then = Date.parse(endedAt);
  if (Number.isNaN(then)) return null;
  const age = Math.max(0, nowMs - then);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (age < MINUTE) return relative.format(0, 'second');
  if (age < HOUR) return relative.format(-Math.floor(age / MINUTE), 'minute');
  if (age < DAY) return relative.format(-Math.floor(age / HOUR), 'hour');
  const days = Math.floor(age / DAY);
  if (days <= RELATIVE_DAYS) return relative.format(-days, 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(then);
}

/** The simulation runs 10 ticks per second (AGENTS.md, section 4.1); `m:ss`, or null if unknown. */
export function lengthText(ticks: number | null): string | null {
  return ticks === null ? null : formatClock(ticks / 10);
}
