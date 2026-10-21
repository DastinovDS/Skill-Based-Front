<script lang="ts">
  import { getLocale, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import { formatCentis } from './format.ts';
  import type { RoadInfo } from './hudData.ts';
  import MapTip from './MapTip.svelte';

  interface Props {
    orders: OrderController;
    /** The own road under the pointer that a click would raise (DEC-28, item 7); `null`: none. */
    road: RoadInfo | null;
  }

  let { orders, road }: Props = $props();

  // The numbers are the server's: the gain of the level from the snapshot, the price and the time
  // from `ruleset_public`. The client only formats them.
  const seconds = $derived(Math.ceil(orders.roadBuildTicks / orders.tickHz));
</script>

<!-- What a click on the road gives: the next level, the gain, the price and the time to build. -->
<MapTip identity={road === null ? null : road.id}>
  {#if road !== null && road.gain !== null}
    <div class="road">
      <strong>{tf('road.tip.level', { from: road.width, to: road.width + 1 })}</strong>
      <span>
        {tf('road.tip.gain', { units: road.gain.unit_speed_pct, amount: road.gain.amount })}
      </span>
      <span class="price">
        {tf('road.tip.price', {
          cost: formatCentis(orders.roadCost, getLocale()),
          seconds,
        })}
      </span>
    </div>
  {/if}
</MapTip>

<style>
  .road {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .price {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
</style>
