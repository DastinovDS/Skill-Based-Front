<script lang="ts">
  import { t } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import { shiftLabel } from '../render/flowLayout.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  // The supply flow (DEC-43): `−` moves the supply level one road back from the front ("−1", "−2"),
  // `+` forward again. The value and its largest are the server's (`View.me.leaf_shift`, `_max`).
  const shift = $derived(orders.leafShift);
  const max = $derived(orders.leafShiftMax);
</script>

{#if shift !== null && max !== null}
  <div class="step" role="group" aria-label={t('supply.shift')} title={t('supply.shiftTip')}>
    <button
      type="button"
      class="sbtn"
      aria-label={t('supply.shiftBack')}
      disabled={shift >= max}
      onclick={(event) => {
        orders.stepLeafShift(1);
        event.currentTarget.blur();
      }}>−</button
    >
    <output aria-live="polite" class:moved={shift > 0}
      >{shiftLabel(shift, t('supply.shiftFront'))}</output
    >
    <button
      type="button"
      class="sbtn"
      aria-label={t('supply.shiftForward')}
      disabled={shift <= 0}
      onclick={(event) => {
        orders.stepLeafShift(-1);
        event.currentTarget.blur();
      }}>+</button
    >
  </div>
{/if}

<style>
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

  output {
    min-width: 5ch;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  /* A moved level is told by a frame as well as by the number. */
  output.moved {
    border: 1px solid var(--you);
    border-radius: 5px;
    padding: 1px 6px;
  }
</style>
