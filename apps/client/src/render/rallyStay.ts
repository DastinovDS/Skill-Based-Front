/**
 * A recruit that stays home for want of the CP of its walk (#930, W10; DEC-48, item I3): the own
 * event `rally_walk_no_cp` crosses the CP mark at the gate of its city, towards the rally point it
 * did not reach, for 1.6 s by the render tick (the last 0.6 s fading; with "less motion" it stands,
 * then goes). Pure: `CityView` places the sprite.
 */
import type { EventMsg, PlayerId } from '../protocol.gen.ts';

/** The whole time the mark shows and the part of it that fades, ms (the mockup's 1.6 and 0.6 s). */
export const STAY_SHOW_MS = 1600;
export const STAY_FADE_MS = 600;

export interface StayMark {
  readonly node: number;
  readonly target: number | null;
  /** 0..1. */
  readonly alpha: number;
}

/** The crossed marks to show at render `tick` (one per city: the newest). */
export function stayMarks(
  events: readonly EventMsg[],
  me: PlayerId,
  tick: number,
  tickHz: number,
  reduced: boolean,
): StayMark[] {
  const out: StayMark[] = [];
  if (tickHz <= 0) return out;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event === undefined) continue;
    const ms = ((tick - event.tick) * 1000) / tickHz;
    if (ms >= STAY_SHOW_MS) break; // older events do not show any more
    if (event.kind !== 'rally_walk_no_cp' || ms < 0) continue;
    const { player, node, target } = event.data;
    if (player !== me || typeof node !== 'number') continue;
    if (out.some((m) => m.node === node)) continue;
    const fade = reduced ? 1 : Math.min(1, (STAY_SHOW_MS - ms) / STAY_FADE_MS);
    out.push({ node, target: typeof target === 'number' ? target : null, alpha: fade });
  }
  return out;
}
