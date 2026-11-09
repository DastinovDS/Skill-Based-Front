<script lang="ts">
  import { getLocale, tf } from '../i18n/index.ts';
  import type { RulesetPublic } from '../protocol.gen.ts';
  import type { GroupInfo } from './hudData.ts';
  import BonusChevron from './BonusChevron.svelte';
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
  const seconds = $derived(Math.round(rules.tick_hz / rules.tick_hz)); // no «Defense»: removed (#894): stage 2 deletes this
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
            cost: formatCentis(0, getLocale()),
          })}</span
        >
      </p>
    {/if}
    <!-- A plan that still gathers its bonus shows nothing extra: the charges say it (#811). -->
    {#if group.gathering === null && group.plannedBonus > 0}
      <p class="extra">
        <span class="bonus"
          ><BonusChevron />{group.node !== null
            ? tf('order.bonusForecast', { n: group.plannedBonus })
            : tf('order.bonus', { n: group.plannedBonus })}</span
        >
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
    border-top: 1px solid rgb(236 228 209 / 25%);
    font-size: 14px;
    line-height: 1.35;
  }

  .rule {
    color: var(--text-dim);
  }

  /* The chevron of a bonus (#797) in front of its line. */
  .bonus {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
  }
</style>
