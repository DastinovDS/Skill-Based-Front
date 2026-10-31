import type { HudState } from '../hud/hudState.svelte.ts';
import { MatchSession } from '../match/session.ts';
import type { LineRouteMsg, MapFile, ReachMsg, RulesetPublic } from '../protocol.gen.ts';
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
  /** Scripted motion for looking at animation (`/?motion`). */
  motion = false,
  /** The answers to `line_route_query` (#665). */
  onLineRoute?: (msg: LineRouteMsg) => void,
): DevMatch {
  const server = createDevServer(map, rules, { motion });
  const session = new MatchSession({
    matchId: 'dev',
    token: 'dev',
    context: {
      hud,
      tickHz: rules.tick_hz,
      orders: rules.orders,
      capacity: rules.capacity,
      roadBuildTicks: rules.build.ticks_per_level,
    },
    onServerMessage: (msg) => {
      if (msg.type === 'reach') onReach?.(msg);
      else if (msg.type === 'line_route') onLineRoute?.(msg);
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
