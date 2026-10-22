<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  const ui = $derived(orders.ui.current);

  // The rear minimum slider (DEC-28, item 3). The value of the server comes with every snapshot;
  // while the player drags, the slider shows the dragged value, and the command goes out once the
  // thumb is released (a change), not on every step. A refused command drops the dragged value.
  const server = $derived(orders.rearMin);
  // The dragged value counts only while the server's value is the one it was dragged from.
  let draft = $state<{ readonly value: number; readonly from: number | null } | null>(null);
  const shown = $derived(draft !== null && draft.from === server ? draft.value : (server ?? 0));

  $effect(() =>
    orders.ui.onFeedback((feedback) => {
      if (feedback.kind !== 'accepted' && feedback.cmd.type === 'set_rear_min') draft = null;
    }),
  );
</script>

{#if ui.supplyMode}
  <section class="banner" aria-live="polite">
    <strong>{t('supply.banner')}</strong>
    {#if ui.transferFrom !== null}
      <span>{tf('supply.pick', { node: ui.transferFrom })}</span>
    {:else}
      <span>{t('supply.hint')}</span>
    {/if}
    {#if server !== null}
      <label class="rear" title={t('supply.rearMinHint')}>
        <span>{t('supply.rearMin')}</span>
        <input
          type="range"
          min="0"
          max={orders.rearMinMax}
          step="1"
          value={shown}
          aria-label={t('supply.rearMin')}
          oninput={(event) => {
            draft = { value: Number(event.currentTarget.value), from: server };
          }}
          onchange={(event) => {
            orders.setRearMin(Number(event.currentTarget.value));
            // The map takes the keys again (a focused slider would keep them).
            event.currentTarget.blur();
          }}
        />
        <output>{shown}</output>
        <!-- The keys do the same as the slider: one step a press. -->
        <span class="keys" aria-hidden="true"><kbd>[</kbd><kbd>]</kbd></span>
      </label>
    {/if}
    <ul class="legend">
      <li><span class="line solid" aria-hidden="true"></span>{t('supply.legendAuto')}</li>
      <li><span class="line dashed" aria-hidden="true"></span>{t('supply.legendTransfer')}</li>
      <li><span class="glyph" aria-hidden="true">⚑</span>{t('supply.legendMarker')}</li>
      <li><span class="glyph" aria-hidden="true">●○</span>{t('supply.legendStock')}</li>
      <li><span class="glyph enemy" aria-hidden="true">▽</span>{t('supply.legendEnemy')}</li>
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

  /* The slider is the one part that takes the pointer. */
  .rear {
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: auto;
  }

  .rear input {
    width: 140px;
    accent-color: var(--you);
  }

  .rear .keys {
    display: flex;
    gap: 3px;
  }

  .rear kbd {
    min-width: 1.4em;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
    text-align: center;
  }

  .rear output {
    min-width: 1.5ch;
    font-weight: 700;
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

  .line {
    display: inline-block;
    width: 18px;
    border-top: 3px solid var(--you);
  }

  .line.dashed {
    border-top-style: dashed;
  }

  .glyph {
    color: var(--you);
    font-weight: 700;
  }

  .glyph.enemy {
    color: var(--enemy);
  }
</style>
