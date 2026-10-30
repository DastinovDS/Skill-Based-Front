<script lang="ts">
  import { tick } from 'svelte';
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';
  import type { NodeNamer } from './nodeName.ts';
  import Slider from './Slider.svelte';
  import { cycleFocus } from './focusCycle.ts';

  interface Props {
    orders: OrderController;
    /** The name of a place by its id. */
    names: NodeNamer;
  }

  let { orders, names }: Props = $props();

  const dialog = $derived(orders.transfer.current);
  let cancel: HTMLButtonElement | undefined = $state();

  // The slider has the focus: arrows change the amount, Enter sends, Esc closes. Without a slider
  // (nothing to send) the focus goes to Cancel.
  $effect(() => {
    if (dialog.open && dialog.max < 1) void tick().then(() => cancel?.focus());
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
      cycleFocus(event);
    }
  }

  /** Key labels are the keys themselves, not translations. */
  const ESC = 'Esc';
</script>

{#if dialog.open}
  <Dialog
    id="transfer"
    eyebrow={t('transfer.eyebrow')}
    title={tf('transfer.title', { from: names(dialog.from), to: names(dialog.to) })}
    onkeydown={onKey}
  >
    {#if dialog.max > 0}
      <p class="amount">
        <span class="n">{dialog.n}</span>
        <span class="of">{tf('transfer.of', { max: dialog.max })}</span>
      </p>
      <Slider
        value={dialog.n}
        min={1}
        max={dialog.max}
        label={t('transfer.slider')}
        focusOnMount
        oninput={(n: number) => {
          orders.setTransferAmount(n);
        }}
      />
    {:else}
      <ul class="dlg-lines">
        <li class="dlg-line warn">
          <Icon name="alert" size={18} />
          <span>{t(dialog.full ? 'transfer.full' : 'transfer.empty')}</span>
        </li>
      </ul>
    {/if}
    <p class="dlg-lead">{t('transfer.free')}</p>
    {#snippet actions()}
      <button
        type="button"
        class="dlg-btn pri"
        disabled={dialog.max < 1}
        onclick={() => {
          orders.confirmTransfer();
        }}
      >
        <Icon name="transfer" size={18} />{t('transfer.send')}<kbd class="dlg-k" aria-hidden="true"
          >↵</kbd
        >
      </button>
      <button
        type="button"
        class="dlg-btn"
        bind:this={cancel}
        onclick={() => {
          orders.closeTransfer();
        }}
      >
        {t('transfer.cancel')}<kbd class="dlg-k" aria-hidden="true">{ESC}</kbd>
      </button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .amount {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 14px 0 2px;
  }

  .n {
    font-size: 40px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }

  .of {
    font-size: 14px;
    color: var(--text-dim);
  }
</style>
