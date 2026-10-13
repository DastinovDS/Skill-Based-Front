<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import { PRIORITY_SIGN } from './radial.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  const ui = $derived(orders.ui.current);
  const levels = ['high', 'normal', 'low'] as const;
</script>

{#if ui.supplyMode}
  <section class="banner" aria-live="polite">
    <strong>{t('supply.banner')}</strong>
    {#if ui.transferFrom !== null}
      <span>{tf('supply.pick', { node: ui.transferFrom })}</span>
    {:else}
      <span>{t('supply.hint')}</span>
    {/if}
    <ul class="legend">
      {#each levels as level (level)}
        <li>
          <span class="sign" aria-hidden="true">{PRIORITY_SIGN[level]}</span>{t(
            `priority.${level}`,
          )}
        </li>
      {/each}
      <li><span class="line solid" aria-hidden="true"></span>{t('supply.legendAuto')}</li>
      <li><span class="line dashed" aria-hidden="true"></span>{t('supply.legendTransfer')}</li>
    </ul>
  </section>
{/if}

<style>
  .banner {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    max-width: calc(100% - 24px);
    padding: 8px 14px;
    box-sizing: border-box;
    border: 1px solid var(--paper);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    text-align: center;
    pointer-events: none;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px 12px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-dim);
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .sign {
    color: var(--paper);
  }

  .line {
    display: inline-block;
    width: 18px;
    border-top: 3px solid var(--you);
  }

  .line.dashed {
    border-top-style: dashed;
  }
</style>
