import type { HudState } from '../hud/hudState.svelte.ts';
import { MatchSession } from '../match/session.ts';
import type { MapFile, ReachMsg, RulesetPublic } from '../protocol.gen.ts';

/** The answer to the removed `line_route_query`: removed (#894): stage 2 deletes this. */
type LineRouteMsg = {
  readonly points: readonly number[];
  readonly tick: number;
  readonly path: readonly number[];
};
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- a stub of a removed rule (#894)
  _onLineRoute?: (msg: LineRouteMsg) => void, // the line route answer was removed (#894)
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
      roadBuildTicks: 0, // no road levels (#894)
      fortBuildTicks: rules.fort.build_ticks,
    },
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
