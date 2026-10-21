<script lang="ts">
  import { t } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  const ui = $derived(orders.ui.current);
  // Read from the snapshot HUD data so the line follows the roads the server offers.
  const none = $derived(ui.roadMode && orders.upgradableRoads().length === 0);
</script>

<!-- The road mode on `U` (#315): a line at the bottom of the map says it is on and how to leave. -->
{#if ui.roadMode}
  <section class="banner" aria-live="polite">
    <strong>{t('road.banner')}</strong>
    <span>{t(none ? 'road.none' : 'road.hint')}</span>
  </section>
{/if}

<style>
  .banner {
    position: absolute;
    /* The HUD is a flex column: without an explicit `top` the banner would stretch from its static position. */
    top: auto;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    max-width: min(560px, calc(100% - 24px));
    padding: 6px 12px;
    box-sizing: border-box;
    border: 1px solid var(--paper);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    text-align: center;
    pointer-events: none;
  }
</style>
