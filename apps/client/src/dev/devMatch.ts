import type { HudState } from '../hud/hudState.svelte.ts';
import { MatchSession } from '../match/session.ts';
import type { MapFile, ReachMsg, RulesetPublic } from '../protocol.gen.ts';
import { renderRules } from '../render/renderRules.ts';

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
): DevMatch {
  const server = createDevServer(map, rules, { motion });
  const session = new MatchSession({
    matchId: 'dev',
    token: 'dev',
    // Every number of the ruleset, as a live match has them (ARC-C02).
    context: { hud, rules: renderRules(rules) },
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
