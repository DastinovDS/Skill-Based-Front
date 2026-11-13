/**
 * The rules reference (`docs/design/tutorial.md`, section 6): one or two lines per section, in the
 * words of the chapters. It quotes only the numbers a player looks up, all from the main ruleset
 * (`GET /api/ruleset`, no map tempo): the CP and charge rates in Balance and the CP cap, the round,
 * the pace of a plan's bonus, the VP period and the match length, the fort's toll, the price of a
 * rally walk. What the screen shows (prices, capacities, warehouse sizes, build times, the factory
 * limit, the countdowns) is left to the screen. Plain TypeScript; no rule is worked out here.
 */
import { formatCentis } from '../hud/format.ts';
import { tf, t, type MessageKey } from '../i18n/index.ts';
import type { RulesetPublic } from '../protocol.gen.ts';

export interface RulesSection {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

/** The sections of the reference, in order; a section of a mechanic the ruleset lacks is left out. */
export function rulesSections(rules: RulesetPublic, locale: string): RulesSection[] {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const plural = new Intl.PluralRules(locale);
  const seconds = (ticks: number): string =>
    tf('rules.seconds', { n: number.format(ticks / rules.tick_hz) });
  const counted = (n: number, one: MessageKey, other: MessageKey): string =>
    tf(plural.select(n) === 'one' ? one : other, { n: number.format(n) });
  const join = (...parts: (string | null)[]): string =>
    parts.filter((part) => part !== null).join(' ');

  const out: RulesSection[] = [];
  const add = (id: string, title: MessageKey, text: string): void => {
    out.push({ id, title: t(title), text });
  };
  add('units', 'rules.units.title', t('rules.units.text'));
  add('capture', 'rules.capture.title', t('rules.capture.text'));
  add('vision', 'rules.vision.title', t('rules.vision.text'));
  add(
    'supply',
    'rules.supply.title',
    tf('rules.supply.text', {
      cp: formatCentis(rules.cp.per_period, locale),
      cpEvery: seconds(rules.stances.cp_period_ticks.balance),
      cap: formatCentis(rules.cp.cap, locale),
      chargeEvery: seconds(rules.stances.capital_period_ticks.balance),
    }),
  );
  add('flow', 'rules.flow.title', t('rules.flow.text'));
  add('build', 'rules.build.title', t('rules.build.text'));
  add(
    'fights',
    'rules.fights.title',
    join(
      tf('rules.fights.text', { round: seconds(rules.combat.round_ticks) }),
      rules.combat.retreat === 'none' ? t('rules.fights.noRetreat') : null,
      tf('rules.fights.plan', { bonus: seconds(rules.orders.plan_ticks_per_bonus) }),
    ),
  );
  add(
    'win',
    'rules.win.title',
    tf('rules.win.text', {
      vp: seconds(rules.victory.vp_period_ticks),
      length: tf('rules.minutes', { n: number.format(rules.match_ticks / rules.tick_hz / 60) }),
    }),
  );
  add(
    'terrain',
    'rules.terrain.title',
    tf('rules.terrain.text', {
      charges: counted(rules.fort.toll_charges, 'rules.charges.one', 'rules.charges.other'),
      units: counted(rules.fort.toll_units, 'rules.units.one', 'rules.units.other'),
    }),
  );
  const group = rules.group_order === null ? null : t('rules.group.text');
  const rally = rules.recruit.rally_point
    ? tf('rules.group.rally', { cost: formatCentis(rules.recruit.rally_cost, locale) })
    : null;
  if (group !== null || rally !== null) add('group', 'rules.group.title', join(group, rally));
  add('capacity', 'rules.capacity.title', t('rules.capacity.text'));
  add('tempo', 'rules.tempo.title', t('rules.tempo.text'));
  add('also', 'rules.also.title', t('rules.also.text'));
  return out;
}
