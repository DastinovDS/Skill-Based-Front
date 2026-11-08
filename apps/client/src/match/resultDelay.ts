import type { MatchEndMsg } from '../protocol.gen.ts';
import { CAPITAL_RESULT_DELAY_MS } from '../render/style.ts';

/**
 * How long the result screen waits after `match_end` (#819). A match that ends by the capture of a
 * capital shows that capture first: the last snapshot reaches the screen (the render runs 0.2 s
 * behind), its flood runs (1.0 s) and the settled frame stays 0.5 s. Every other end opens the result
 * at once, as before. Presentation only: the match is over on the server either way.
 */
export function resultDelayMs(end: Pick<MatchEndMsg, 'reason'>): number {
  return end.reason === 'capital_captured' ? CAPITAL_RESULT_DELAY_MS : 0;
}
