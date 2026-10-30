/**
 * Whose eyes the replay is watched through (#599). The viewing side is drawn blue (ui-style 6,
 * "Replay"); "both" is the old look: player 1 blue, player 2 red.
 *
 * The seam for the fog of one side (#600): the chosen `ReplayView` is what the viewer would hand
 * to the snapshot builder to cut a side's vision. Nothing here decides what is visible.
 */
import type { PlayerId } from '../protocol.gen.ts';

export type ReplayView = 'both' | PlayerId;

/** The side drawn blue. */
export function blueSide(view: ReplayView): PlayerId {
  return view === 'both' ? 0 : view;
}

/** The other side, drawn red. */
export const otherSide = (side: PlayerId): PlayerId => (side === 0 ? 1 : 0);

/**
 * The side a replay opens as: the side the viewer played when the app knows it (the result screen
 * passes it), otherwise the side whose nick is the viewer's own (a file with `nicks`), otherwise
 * both. A viewer who is on neither side, or on both (a game against oneself), gets "both".
 */
export function defaultView(
  me: PlayerId | null,
  nicks: readonly [string, string] | null,
  ownNick: string | null,
): ReplayView {
  if (me !== null) return me;
  if (nicks === null || ownNick === null) return 'both';
  const mine = ownNick.toLowerCase();
  const sides = ([0, 1] as const).filter((side) => nicks[side].toLowerCase() === mine);
  return sides.length === 1 ? (sides[0] ?? 'both') : 'both';
}
