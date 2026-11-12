/**
 * The "mark problem" key of a match (`F8` by default, #810): the diagnostics of the last minute
 * go to the server log at once, and a toast says whether they got there, with the tick the mark
 * names (a playtester can say "I pressed F8 at tick 1234").
 */
import { diagnostics, type MarkResult } from '../diagnostics.ts';
import { t, tf } from '../i18n/index.ts';
import type { ToastBody } from './toasts.ts';

/** What sends the mark: the diagnostics of the page, or a stand-in on the dev screen. */
export interface Marker {
  mark(): Promise<MarkResult>;
}

/** The toast of a mark that was sent, not sent, or held back (`wait`: the one before is too recent). */
export function markToast(sent: boolean, tick: number | null, wait = false): ToastBody {
  if (wait) return { tone: 'neutral', icon: 'info', text: t('diag.markWait') };
  if (!sent) return { tone: 'warn', icon: 'alert', text: t('diag.markFailed') };
  return {
    tone: 'neutral',
    icon: 'info',
    text: tick === null ? t('diag.markedNoTick') : tf('diag.marked', { tick }),
  };
}

/** Sends the mark; the toast goes to `toasts` (`null`: the HUD is not there yet, no toast). */
export async function markProblem(
  toasts: { push: (body: ToastBody) => void } | null,
  marker: Marker = diagnostics,
): Promise<void> {
  const { sent, tick, wait } = await marker.mark();
  toasts?.push(markToast(sent, tick, wait));
}
