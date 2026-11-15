<script lang="ts">
  import { tf } from '../i18n/index.ts';
  import type { GroupInfo } from './hudData.ts';
  import BonusChevron from './BonusChevron.svelte';
  import ChargeTip from './ChargeTip.svelte';
  import MapTip from './MapTip.svelte';
  import { NO_ANCHORS, type Anchor, type MapAnchors } from '../render/anchors.ts';

  interface Props {
    /** The group under the pointer; `null`: none. */
    group: GroupInfo | null;
    /** Where the helmets are on the page: the tag keeps clear of the one it describes. */
    anchors?: MapAnchors;
  }

  let { group, anchors = NO_ANCHORS }: Props = $props();

  // In a city the city with its ring and its VP lozenge, else the token of the group on its road.
  function subject(): Anchor | null {
    if (group === null) return null;
    const city = group.node === null ? null : anchors.node(group.node);
    if (city !== null) return { ...city, r: city.reach ?? city.r };
    return anchors.group(group.id);
  }
</script>

<!-- The charges of the group under the pointer. The same group while its id is: the numbers
change under it every snapshot. For one with a planned order the bonus of the order, a forecast
while it stands in its city. The opponent's groups are not under this tip: they show their mode only. -->
<MapTip identity={group === null ? null : group.id} clear={subject}>
  {#if group !== null}
    <ChargeTip units={group.units} charged={group.charged} />
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

  /* The chevron of a bonus (#797) in front of its line. */
  .bonus {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
  }
</style>
