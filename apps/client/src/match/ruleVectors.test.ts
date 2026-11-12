/**
 * The display numbers the client works out from `ruleset_public` (ARC-C03, #482) against the
 * shared vector `packages/protocol/vectors/display_rules.json`, written from the rules (DEC-48,
 * DEC-25, DEC-44, mechanics.md section 11). `packages/sim/tests/test_display_vectors.py` checks
 * the simulation against the same rows, so a rule change fails on both sides, never here alone.
 */
import { describe, expect, it } from 'vitest';
import vector from '../../../../packages/protocol/vectors/display_rules.json';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { cpPerSecond } from '../hud/hudData.ts';
import { rallyDues } from '../hud/rallyDue.ts';
import { vpCountdown } from '../hud/topBar.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { NodeView, RulesetPublic, Stance } from '../protocol.gen.ts';
import { rallyPrice } from './orderController.ts';

describe('the rally price (DEC-48, item A2)', () => {
  it.each(vector.rally_price.rows)('$id: $n groups', (row) => {
    expect(rallyPrice(row.n, row.move, row.rally_pct)).toBe(row.price);
  });
});

describe('the walks to a rally point (DEC-25, DEC-48 item H3)', () => {
  const { params } = vector.recruit_walks;
  const own = devSnapshot(DEFAULT_MAP, DEV_RULES, 100).view.nodes.find((n) => n.owner === 0);
  if (own === undefined) throw new Error('the dev snapshot has no own node');

  it.each(vector.recruit_walks.rows)('$id: $note', (row) => {
    const node: NodeView = {
      ...own,
      rally_point: own.id + 1,
      recruit_queue: row.view.queue,
      recruit_progress: row.view.progress,
      recruit_waiting: row.view.waiting,
    };
    const pending = Array.from({ length: row.view.pending }, () => ({ node: own.id }));
    const dues = rallyDues([node], 0, row.view.cp, params.unit_ticks, params.rally_cost, pending);
    expect(dues.map((d) => ({ after: d.ticks, paid: !d.short }))).toEqual(row.walks);
  });
});

describe('the CP income a second (DEC-44)', () => {
  it.each(vector.cp_rate.rows)('$stance', (row) => {
    const stance = row.stance as Stance;
    const rules: RulesetPublic = {
      ...DEV_RULES,
      tick_hz: row.tick_hz,
      cp: { ...DEV_RULES.cp, per_period: row.per_period },
      stances: {
        ...DEV_RULES.stances,
        cp_period_ticks: { ...DEV_RULES.stances.cp_period_ticks, [stance]: row.period_ticks },
      },
    };
    expect(cpPerSecond(rules, stance) * row.seconds).toBe(row.gain);
  });
});

describe('the countdown to the next VP credit (mechanics.md, section 11)', () => {
  it.each(vector.vp_countdown.rows)('tick $tick', (row) => {
    expect(vpCountdown(row.tick, row.period)?.ticks).toBe(row.next_in);
  });
});
