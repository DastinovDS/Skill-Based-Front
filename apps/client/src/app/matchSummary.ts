/**
 * What the client knows about its own side at the end of a match, for the result screen (#596):
 * the nicks of the welcome. The numbers of the screen are the server's totals in `match_end.stats`
 * (#824); the client counts nothing itself.
 */
export interface MatchSummary {
  readonly nicks: { readonly mine: string; readonly enemy: string };
}
