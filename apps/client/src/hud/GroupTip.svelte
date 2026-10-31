<script lang="ts">
  import { getLocale, tf } from '../i18n/index.ts';
  import type { RulesetPublic } from '../protocol.gen.ts';
  import type { GroupInfo } from './hudData.ts';
  import ChargeTip from './ChargeTip.svelte';
  import { formatCentis } from './format.ts';
  import MapTip from './MapTip.svelte';

  interface Props {
    /** The group under the pointer; `null`: none. */
    group: GroupInfo | null;
    /** The ruleset: the rule of the Defense bonus in the tip is its numbers (DEC-30). */
    rules: RulesetPublic;
  }

  let { group, rules }: Props = $props();

  // Whole seconds for one point of the bonus: the rule says "+1 for every N s".
  const seconds = $derived(Math.round(rules.orders.defense_ticks_per_bonus / rules.tick_hz));
</script>

<!-- The charges of the group under the pointer. The same group while its id is: the numbers
change under it every snapshot. For an own group in "Defense" the bonus it has gathered and the
rule of the mode; for one with a planned order the bonus of the order, a forecast while it stands
in its city. The opponent's groups are not under this tip: they show their mode only. -->
<MapTip identity={group === null ? null : group.id}>
  {#if group !== null}
    <ChargeTip units={group.units} charged={group.charged} />
    {#if group.defense !== null}
      <p class="extra">
        <strong
          >{tf('defense.title', { bonus: group.defense.bonus, cap: group.defense.cap })}</strong
        >
        <span class="rule"
          >{tf('defense.rule', {
            seconds,
            cost: formatCentis(rules.cost.defense, getLocale()),
          })}</span
        >
      </p>
    {/if}
    {#if group.gathering !== null}
      <!-- Economy v2 (DEC-41, item 10): the plan gathers its bonus from the warehouse of its node. -->
      <p class="extra">
        <strong
          >{tf('plan.title', { bonus: group.gathering.bonus, plan: group.gathering.plan })}</strong
        >
        <span class="rule"
          >{tf('plan.rule', {
            seconds: Math.round(rules.orders.plan_ticks_per_bonus / rules.tick_hz),
          })}</span
        >
      </p>
    {:else if group.plannedBonus > 0}
      <p class="extra">
        {group.node !== null
          ? tf('order.bonusForecast', { n: group.plannedBonus })
          : tf('order.bonus', { n: group.plannedBonus })}
      </p>
    {/if}
  {/if}
</MapTip>

<style>
  .extra {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 240px;
    margin: 6px 0 0;
    padding-top: 6px;
    border-top: 1px solid var(--border);
    font-size: 12px;
    line-height: 1.35;
  }

  .rule {
    color: var(--text-dim);
  }
</style>
