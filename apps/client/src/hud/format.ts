/** Number formatting for the HUD. Pure, so it is tested without a DOM. */

/** CP and charges come in hundredths: `350` is "3.5" (separator by locale). */
export function formatCentis(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 100);
}

/** `m:ss` for a time in whole seconds. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const rest = seconds % 60;
  return `${String(Math.floor(seconds / 60))}:${String(rest).padStart(2, '0')}`;
}

const DOT_LIMIT = 12;

/**
 * Charge dots of a group: filled for a charged unit, empty for a discharged one (state is never
 * only a colour, AGENTS.md 7.4). Above `DOT_LIMIT` units the row would be too long: no dots then.
 */
export function chargeDots(units: number, charged: number): string {
  if (units > DOT_LIMIT) {
    return '';
  }
  const filled = Math.min(Math.max(charged, 0), units);
  return '●'.repeat(filled) + '○'.repeat(units - filled);
}

/** Ticks as seconds with one decimal ("2,4"), for countdowns. */
export function formatSeconds(ticks: number, tickHz: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.max(0, ticks) / tickHz);
}
