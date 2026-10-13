<script lang="ts">
  import { tick } from 'svelte';
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  const dialog = $derived(orders.transfer.current);
  let slider: HTMLInputElement | undefined = $state();
  let send: HTMLButtonElement | undefined = $state();
  let cancel: HTMLButtonElement | undefined = $state();

  // The slider has the focus: arrows change the amount, Enter sends, Esc closes.
  $effect(() => {
    if (dialog.open) void tick().then(() => (slider ?? cancel)?.focus());
  });

  function onKey(event: KeyboardEvent): void {
    // The dialog's keys never reach the map (Tab would switch the map mode).
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      orders.closeTransfer();
    } else if (event.key === 'Enter' && dialog.max > 0) {
      event.preventDefault();
      event.stopPropagation();
      orders.confirmTransfer();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      const order = [slider, send, cancel].filter((e) => e !== undefined);
      const at = order.findIndex((e) => e === document.activeElement);
      const next = (at + (event.shiftKey ? order.length - 1 : 1)) % order.length;
      order[next]?.focus();
    }
  }
</script>

{#if dialog.open}
  <div class="backdrop">
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-title"
      tabindex="-1"
      onkeydown={onKey}
    >
      <h2 id="transfer-title">{tf('transfer.title', { from: dialog.from, to: dialog.to })}</h2>
      {#if dialog.max > 0}
        <label class="amount">
          <span>{tf('transfer.amount', { n: dialog.n, max: dialog.max })}</span>
          <input
            type="range"
            min="1"
            max={dialog.max}
            step="1"
            value={dialog.n}
            aria-label={t('transfer.slider')}
            bind:this={slider}
            oninput={(event) => {
              orders.setTransferAmount(Number(event.currentTarget.value));
            }}
          />
        </label>
      {:else}
        <p>{t('transfer.empty')}</p>
      {/if}
      <p class="dim">{t('transfer.free')}</p>
      <div class="actions">
        <button
          type="button"
          bind:this={cancel}
          onclick={() => {
            orders.closeTransfer();
          }}>{t('transfer.cancel')}</button
        >
        {#if dialog.max > 0}
          <button
            type="button"
            class="primary"
            bind:this={send}
            onclick={() => {
              orders.confirmTransfer();
            }}>{t('transfer.send')}</button
          >
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 16px;
    background: var(--scrim);
    pointer-events: auto;
  }

  .dialog {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(380px, 100%);
    padding: 18px 20px;
    box-sizing: border-box;
    border: 1px solid var(--paper);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-size: 17px;
  }

  .dim {
    color: var(--text-dim);
    font-size: 13px;
  }

  .amount {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  input[type='range'] {
    width: 100%;
    accent-color: var(--you);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }

  button {
    min-width: 0;
    padding: 6px 12px;
    font: inherit;
    color: inherit;
    cursor: pointer;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }

  .primary {
    background: var(--you);
    border-color: var(--paper);
    color: var(--bg);
    font-weight: 600;
  }
</style>
