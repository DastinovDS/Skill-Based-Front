<script lang="ts">
  import { tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import Icon from './Icon.svelte';
  import MapTip from './MapTip.svelte';
  import type { NodeNamer } from './nodeName.ts';

  interface Props {
    orders: OrderController;
    names: NodeNamer;
    /** `ruleset_public.capture.charge_cost` (DEC-38): the number the rule names. */
    cost: number;
  }

  let { orders, names, cost }: Props = $props();

  // A target the player does not own while a capture costs charges (`captureHover`, DEC-38).
  const node = $derived(orders.ui.current.captureHover);
</script>

<!-- The rule of DEC-38 on the hovered target before the order is sent: the price of a capture only,
never whether this group can pay it (AGENTS.md 7.1). The flag icon and the words carry it. -->
<MapTip identity={node}>
  {#if node !== null}
    <div class="capture" data-node={node}>
      <Icon name="flag" size={18} />
      <span>{tf('capture.tip', { place: names(node), n: cost })}</span>
    </div>
  {/if}
</MapTip>

<style>
  .capture {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 260px;
  }

  .capture :global(.icon) {
    flex: none;
    color: var(--warn);
  }
</style>
