import { describe, expect, it } from 'vitest';
import { DEV_RULES, DEV_RULES_GROUP } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { createDevMatch } from '../dev/devMatch.ts';
import { NO_RENDER_RULES, renderRules } from './renderRules.ts';

describe('renderRules: the numbers the map draws with, from one ruleset (ARC-C02)', () => {
  it('takes every number from ruleset_public', () => {
    const rules = DEV_RULES_GROUP;
    expect(renderRules(rules)).toEqual({
      tickHz: rules.tick_hz,
      roundTicks: rules.combat.round_ticks,
      orderDelays: { planned: 0 },
      recruitTicks: rules.recruit.unit_ticks,
      recruitQueueMax: rules.recruit.queue_max,
      rallyCost: rules.recruit.rally_cost,
      provinceWarehouse: rules.city_upgrades.warehouse_province,
      buildings: {
        barracks: {
          ticks: rules.city_upgrades.barracks_ticks,
          charges: rules.city_upgrades.barracks_charges,
        },
        factory: { ticks: rules.factory.build_ticks, charges: rules.factory.cost },
      },
      fortBuildTicks: rules.fort.build_ticks,
    });
  });

  it('draws no walk marks without the rally point in the rules', () => {
    const off = { ...DEV_RULES_GROUP.recruit, rally_point: false };
    expect(renderRules({ ...DEV_RULES_GROUP, recruit: off }).rallyCost).toBe(0);
  });

  it('feeds the dev match the same numbers as a live match', () => {
    const hud = new HudState({
      me: 0,
      nicks: ['Ember', 'Bot'],
      rules: DEV_RULES,
      map: DEFAULT_MAP,
    });
    const match = createDevMatch(DEFAULT_MAP, DEV_RULES, hud);
    expect(match.session.rules).toEqual(renderRules(DEV_RULES));
    match.stop();
  });

  it('times nothing before the rules are known', () => {
    expect(NO_RENDER_RULES).toMatchObject({
      orderDelays: null,
      recruitTicks: null,
      rallyCost: 0,
      buildings: null,
      fortBuildTicks: 0,
    });
  });
});
