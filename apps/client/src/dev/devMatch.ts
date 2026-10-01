import type { HudState } from '../hud/hudState.svelte.ts';
import { MatchSession } from '../match/session.ts';
import type { MapFile, RulesetPublic } from '../protocol.gen.ts';
import { createDevServer } from './devServer.ts';

export interface DevMatch {
  session: MatchSession;
  start: () => void;
  stop: () => void;
}

/** A match session against the dev server: what the lobby will later do against the real one. */
export function createDevMatch(map: MapFile, rules: RulesetPublic, hud: HudState): DevMatch {
  const server = createDevServer(map, rules);
  const session = new MatchSession({
    matchId: 'dev',
    token: 'dev',
    context: { hud, tickHz: rules.tick_hz },
    connection: { createSocket: server.createSocket },
  });
  return {
    session,
    start: () => {
      session.start();
    },
    stop: () => {
      session.stop();
      server.stop();
    },
  };
}
