import type { HudState } from '../hud/hudState.svelte.ts';
import { MatchSession } from '../match/session.ts';
import type { MapFile, ReachMsg, RulesetPublic } from '../protocol.gen.ts';
import { createDevServer } from './devServer.ts';

export interface DevMatch {
  session: MatchSession;
  start: () => void;
  stop: () => void;
}

/** A match session against the dev server: what the lobby will later do against the real one. */
export function createDevMatch(
  map: MapFile,
  rules: RulesetPublic,
  hud: HudState,
  /** The answers to `reach_query`: the order controller of the screen shows them. */
  onReach?: (msg: ReachMsg) => void,
): DevMatch {
  const server = createDevServer(map, rules);
  const session = new MatchSession({
    matchId: 'dev',
    token: 'dev',
    context: { hud, tickHz: rules.tick_hz, orders: rules.orders, capacity: rules.capacity },
    onServerMessage: (msg) => {
      if (msg.type === 'reach') onReach?.(msg);
    },
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
