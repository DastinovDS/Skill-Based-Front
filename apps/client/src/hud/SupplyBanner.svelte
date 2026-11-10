<script lang="ts">
  import { t } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import LeafShift from './LeafShift.svelte';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  const ui = $derived(orders.ui.current);

  // The supply flow (DEC-43): the leaf shift stepper (`LeafShift`) and its HUD pill.
  const shift = $derived(orders.leafShift);

  /** Key labels are the keys themselves, not translations. */
  const TAB = 'Tab';
</script>

{#if ui.supplyMode}
  <section class="supply" aria-label={t('supply.banner')}>
    <div class="pill">
      <!-- The supply flow needs no word (the round 5 Combined view): the key, then the level. -->
      <kbd class="k" aria-hidden="true">{TAB}</kbd>
      <span class="sep" aria-hidden="true"></span>
      <LeafShift {orders} />
    </div>
  </section>
{:else if shift !== null && shift > 0}
  <!-- Out of the Supply mode the shift stays in sight while it is not "front". -->
  <section class="supply" aria-label={t('supply.banner')}>
    <div class="pill">
      <LeafShift {orders} />
    </div>
  </section>
{/if}

<style>
  /*
   * In the bottom left corner: the alert row is at the top of the map, a banner there covered it
   * (#597). One pill (S3, #627): the key of the mode and the leaf shift stepper. Only the stepper
   * takes the pointer.
   */
  .supply {
    position: absolute;
    /* The HUD is a flex column: without an explicit `top` the banner would stretch from its static position. */
    top: auto;
    bottom: 12px;
    left: 12px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    max-width: calc(100% - 24px);
    color: var(--ink);
    font: 500 15px/1.3 var(--font-text);
    pointer-events: none;
  }

  /* An Engraved plate in a double rule (one rule, a dark gap, a faint inner rule), square cut. */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    margin: 0;
    min-height: 40px;
    padding: 5px 12px;
    box-sizing: border-box;
    border: 1px solid rgb(236 228 209 / 60%);
    background: rgb(14 12 9 / 94%);
    box-shadow:
      inset 0 0 0 3px rgb(14 12 9 / 94%),
      inset 0 0 0 4px rgb(236 228 209 / 25%);
    white-space: nowrap;
  }

  .sep {
    width: 1px;
    height: 18px;
    background: var(--border);
  }

  .k {
    display: inline-block;
    box-sizing: border-box;
    padding: 0 4px;
    border: 1px solid rgb(236 228 209 / 40%);
    color: var(--ink-dim);
    font: 500 11px/16px var(--font-display);
    letter-spacing: 0.06em;
    text-align: center;
  }
</style>
