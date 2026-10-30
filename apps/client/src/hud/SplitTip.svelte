<script lang="ts">
  import { tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import Icon from './Icon.svelte';
  import MapTip from './MapTip.svelte';
  import type { NodeNamer } from './nodeName.ts';

  interface Props {
    orders: OrderController;
    names: NodeNamer;
  }

  let { orders, names }: Props = $props();

  // The node comes from the server's `reach` answer (`split`): the group is too big for the way there.
  const node = $derived(orders.ui.current.splitHover);

  /** The key that opens the split menu (a key label, not a translation). */
  const KEY = 'S';
</script>

<!-- The stack limit before the order is sent (#468): the shape (the split icon, the key) and the words carry it. -->
<MapTip identity={node}>
  {#if node !== null}
    <div class="split" data-node={node}>
      <Icon name="split" size={18} />
      <span>{tf('split.tip', { place: names(node) })}</span>
      <kbd class="k">{KEY}</kbd>
    </div>
  {/if}
</MapTip>

<style>
  .split {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 260px;
  }

  .split :global(.icon) {
    flex: none;
    color: var(--warn);
  }

  /* The key chip of the menus (app.css `.front .k`), small. */
  .k {
    flex: none;
    min-width: 20px;
    height: 20px;
    box-sizing: border-box;
    padding: 0 5px;
    border: 1px solid #3d444d;
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--surface-2);
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 17px;
    text-align: center;
  }
</style>
