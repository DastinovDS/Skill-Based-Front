/**
 * The text of the map tooltips (ui-style U5): a title and "key: value" rows with the numbers the
 * player needs to decide (the width a road gets next, when an intent leaves). Pure: the numbers come from the snapshot (`HudData.tip`) and `ruleset_public`; nothing is
 * decided here (AGENTS.md 7.1).
 */
import { getLocale, t, tf } from '../i18n/index.ts';
import type { RoadGain, RulesetPublic } from '../protocol.gen.ts';
import { formatSeconds } from './format.ts';
import type { IntentInfo, RoadInfo, TipInfo } from './hudData.ts';

export interface TipRow {
  readonly label: string;
  readonly value: string;
  /** A dimmer line under the row that explains the term (the nested hint of ui-style U5). */
  readonly hint?: string;
}

export interface TipText {
  readonly title: string;
  readonly rows: readonly TipRow[];
  /** A last line: what a click does. */
  readonly note?: string;
}

export interface TipEnv {
  readonly rules: Pick<RulesetPublic, 'tick_hz' | 'combat'>;
  /** A click on this road upgrades it now (the road pick of the selected city). */
  readonly pickable: boolean;
}

function seconds(ticks: number, env: TipEnv): string {
  return `${formatSeconds(ticks, env.rules.tick_hz, getLocale())} ${t('unit.s')}`;
}

/** What one more level of a road type adds, as the server says (DEC-22, item 7). */
export function gainText(gain: RoadGain): string {
  const parts: string[] = [];
  if (gain.speed_pct > 0) parts.push(tf('roadType.speed', { value: gain.speed_pct }));
  if (gain.amount > 0) parts.push(tf('roadType.amount', { value: gain.amount }));
  return parts.join(', ');
}

function roadTip(road: RoadInfo, env: TipEnv): TipText {
  const rows: TipRow[] = [
    { label: t('tip.width'), value: String(road.width) },
    { label: t('tip.roadKind'), value: t(`road.${road.kind}`) },
  ];
  let note: string | undefined;
  if (road.gain !== null) {
    // Both types on level 1 (the first upgrade chooses one), the road's own type later.
    for (const type of ['fast', 'freight'] as const) {
      const gain = road.gain[type];
      if (gain === null) continue;
      rows.push({
        label: tf('tip.nextWidth', { type: t(`road.${type}`), width: road.width + 1 }),
        value: tf('tip.gain', { gain: gainText(gain), charges: road.charges ?? '?' }),
      });
    }
    note = t(env.pickable ? 'orders.roadHintPick' : 'orders.roadHintHow');
  }
  return {
    title: tf('tip.road', { edge: road.id, a: road.a, b: road.b }),
    rows,
    ...(note === undefined ? {} : { note }),
  };
}

function intentTip(intent: IntentInfo, env: TipEnv): TipText {
  const when = intent.ticksLeft === null ? t('alert.incomingGone') : seconds(intent.ticksLeft, env);
  const rows: TipRow[] = [
    { label: t('tip.from'), value: tf('tip.cityNo', { node: intent.origin }) },
  ];
  if (intent.target !== null) {
    rows.push({ label: t('tip.to'), value: tf('tip.cityNo', { node: intent.target }) });
  }
  rows.push({ label: t('tip.leaves'), value: when });
  const title =
    intent.kind === 'defense'
      ? t(intent.owner === 'mine' ? 'tip.intentDefense.mine' : 'tip.intentDefense.enemy')
      : t(intent.owner === 'mine' ? 'tip.intentMove.mine' : 'tip.intentMove.enemy');
  return { title, rows };
}

/**
 * The tooltip text of what the pointer rests on. A city has no tooltip, and a group shows only its
 * charges (`ChargeTip.svelte`), so both give `null`.
 */
export function tipText(tip: TipInfo, env: TipEnv): TipText | null {
  switch (tip.kind) {
    case 'node':
    case 'group':
      return null;
    case 'edge':
      return roadTip(tip.road, env);
    case 'intent':
      return intentTip(tip.intent, env);
  }
}
