/**
 * What the client knows about its own side at the end of a match, for the result screen (#596).
 * Everything here was already on the player's screen during the match (nicks of the welcome, the
 * own cities and the own VP of the snapshots): nothing about the opponent that the fog hid, and no
 * game logic. A field is `null` when the client has no data (the connection never got a snapshot).
 */
export interface MatchSummary {
  readonly nicks: { readonly mine: string; readonly enemy: string };
  /** Own cities (not provinces) in the last snapshot. */
  readonly cities: number | null;
  /** The highest VP the player had in any snapshot of this session. */
  readonly vpPeak: number | null;
}
