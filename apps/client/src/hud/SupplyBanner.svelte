<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { NodeNamer } from './nodeName.ts';

  interface Props {
    orders: OrderController;
    /** The name of a place by its id. */
    names: NodeNamer;
  }

  let { orders, names }: Props = $props();

  const ui = $derived(orders.ui.current);

  // The rear minimum stepper (S3 "Stepper", #627; DEC-28, item 3). The value is the server's, from
  // every snapshot; a press sends one step (`stepRearMin`, the same as the `[` and `]` keys), and the
  // snapshot that applies it shows the new number a tick later.
  const rearMin = $derived(orders.rearMin);

  /** Key labels are the keys themselves, not translations. */
  const TAB = 'Tab';
  const ESC = 'Esc';
</script>

{#if ui.supplyMode}
  <section class="supply" aria-label={t('supply.banner')}>
    {#if ui.transferFrom !== null}
      <!-- Only while a transfer is being picked: where it goes from, and the way out. -->
      <p class="pill pick" aria-live="polite">
        <span>{tf('supply.pick', { node: names(ui.transferFrom) })}</span><kbd
          class="k"
          aria-hidden="true">{ESC}</kbd
        >
      </p>
    {/if}
    <div class="pill">
      <strong>{t('supply.banner')}</strong><kbd class="k" aria-hidden="true">{TAB}</kbd>
      {#if rearMin !== null}
        <span class="sep" aria-hidden="true"></span>
        <div
          class="step"
          role="group"
          aria-label={t('supply.rearMin')}
          title={t('supply.rearMinTip')}
        >
          <button
            type="button"
            class="sbtn"
            aria-label={t('supply.rearLess')}
            disabled={rearMin <= 0}
            onclick={(event) => {
              orders.stepRearMin(-1);
              // The map takes the keys again (a focused button would keep them).
              event.currentTarget.blur();
            }}>−</button
          >
          <!-- A charge kept on the floor of the warehouse: the glyph of the rear minimum. -->
          <svg class="keep" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="7" y="4" width="10" height="10" rx="1" />
            <path d="M4 19h16" />
          </svg>
          <output aria-live="polite">{rearMin}</output>
          <button
            type="button"
            class="sbtn"
            aria-label={t('supply.rearMore')}
            disabled={rearMin >= orders.rearMinMax}
            onclick={(event) => {
              orders.stepRearMin(1);
              event.currentTarget.blur();
            }}>+</button
          >
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  /*
   * In the bottom left corner: the alert row is at the top of the map, a banner there covered it
   * (#597). One pill (S3, #627): the name of the mode, its key and the rear minimum stepper; a second
   * pill above it only while a transfer is picked. Only the stepper takes the pointer.
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
    color: var(--text);
    font-size: 14px;
    pointer-events: none;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    min-height: 40px;
    padding: 5px 8px 5px 14px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    white-space: nowrap;
  }

  .pill.pick {
    padding-right: 10px;
    border-color: var(--you);
    white-space: normal;
  }

  strong {
    font-weight: 700;
  }

  .sep {
    width: 1px;
    height: 18px;
    background: var(--border);
  }

  .step {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto;
  }

  /* A 28 px hit area (ui-style 22). */
  .sbtn {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 17px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
  }

  .sbtn:hover:not(:disabled) {
    border-color: var(--text-dim);
  }

  .sbtn:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 1px;
  }

  /* Off is told by more than the colour: the button loses its frame too. */
  .sbtn:disabled {
    border-style: dashed;
    color: var(--text-dim);
    cursor: default;
    opacity: 0.6;
  }

  .keep {
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .keep rect {
    fill: currentColor;
  }

  output {
    min-width: 1.5ch;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .k {
    display: inline-block;
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
