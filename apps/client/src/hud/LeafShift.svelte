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

<!-- The leaf shift (the round 5 Combined view): minus, the level sign and its value, plus; the
     words are the group's name and the buttons' names. -->
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
    <!-- The level: two own rules under two faint ones (the supply level and the front above it). -->
    <svg class="level" viewBox="-8 -8 16 16" width="16" height="16" aria-hidden="true">
      <path class="own" d="M-7 5 H7 M-7 1 H7" />
      <path class="faint" d="M-7 -3 H7 M-7 -6 H7" />
    </svg>
    <output aria-live="polite" class:moved={shift > 0}>{shiftLabel(shift, '0')}</output>
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
    gap: 8px;
    pointer-events: auto;
  }

  /* A framed square, 28 px hit area (ui-style 22): one rule, a dark gap, a faint inner rule. */
  .sbtn {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid rgb(236 228 209 / 60%);
    border-radius: 0;
    background: none;
    box-shadow:
      inset 0 0 0 2px var(--plate),
      inset 0 0 0 3px rgb(236 228 209 / 22%);
    color: var(--ink);
    font: 500 19px/1 var(--font-text);
    cursor: pointer;
  }

  .sbtn:hover:not(:disabled) {
    border-color: var(--ink);
  }

  .sbtn:focus-visible {
    outline: 2px solid var(--ink);
    outline-offset: 2px;
  }

  /* Off is told by more than the colour: the button loses its frame too. */
  .sbtn:disabled {
    border-style: dashed;
    color: var(--ink-dim);
    cursor: default;
    opacity: 0.6;
  }

  .level {
    flex: none;
  }

  .level .own {
    stroke: var(--own);
    stroke-width: 1.4;
  }

  .level .faint {
    stroke: var(--ink);
    stroke-width: 0.8;
    opacity: 0.6;
  }

  output {
    min-width: 2.2ch;
    font: 500 20px/1 var(--font-text);
    font-variant-numeric: lining-nums tabular-nums;
    text-align: center;
  }

  /* A moved level is told by a rule under the number as well as by the number. */
  output.moved {
    padding-bottom: 1px;
    border-bottom: 1px solid var(--own);
  }
</style>
