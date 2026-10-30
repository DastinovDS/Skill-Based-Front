<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { NodeNamer } from './nodeName.ts';
  import Slider from './Slider.svelte';

  interface Props {
    orders: OrderController;
    /** The name of a place by its id. */
    names: NodeNamer;
  }

  let { orders, names }: Props = $props();

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

  /** Key labels are the keys themselves, not translations. */
  const TAB = 'Tab';
</script>

{#if ui.supplyMode}
  <section class="supply" aria-live="polite">
    <p class="head">
      <strong>{t('supply.banner')}</strong><kbd class="k" aria-hidden="true">{TAB}</kbd>
    </p>
    {#if ui.transferFrom !== null}
      <p class="line">{tf('supply.pick', { node: names(ui.transferFrom) })}</p>
    {:else}
      <p class="line">{t('supply.hint')}</p>
    {/if}
    {#if server !== null}
      <div class="rear">
        <span class="label">{t('supply.rearMin')}</span>
        <Slider
          value={shown}
          min={0}
          max={orders.rearMinMax}
          label={t('supply.rearMin')}
          oninput={(n: number) => {
            draft = { value: n, from: server };
          }}
          onchange={(n: number, input: HTMLInputElement) => {
            orders.setRearMin(n);
            // The map takes the keys again (a focused slider would keep them).
            input.blur();
          }}
        />
        <output>{shown}</output>
        <!-- The keys do the same as the slider: one step a press. -->
        <span class="keys" aria-hidden="true"><kbd class="k">[</kbd><kbd class="k">]</kbd></span>
      </div>
      <p class="line dim">{t('supply.rearMinHint')}</p>
    {/if}
    <ul class="legend">
      <li><span class="line-key solid" aria-hidden="true"></span>{t('supply.legendAuto')}</li>
      <li><span class="line-key dashed" aria-hidden="true"></span>{t('supply.legendTransfer')}</li>
      <li><span class="glyph" aria-hidden="true">⚑</span>{t('supply.legendMarker')}</li>
      <li><span class="glyph" aria-hidden="true">●○</span>{t('supply.legendStock')}</li>
      <li><span class="glyph enemy" aria-hidden="true">▽</span>{t('supply.legendEnemy')}</li>
    </ul>
  </section>
{/if}

<style>
  /*
   * In the bottom left corner: the alert row is at the top of the map, a banner there covered it
   * (#597). The road and terrain banners are bottom too, but one at the middle and this one at the
   * left, and it takes clicks only on the slider.
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
    align-items: stretch;
    gap: 6px;
    width: 340px;
    max-width: calc(100% - 24px);
    padding: 12px 14px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
    pointer-events: none;
  }

  p {
    margin: 0;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .head strong {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .line {
    font-size: 14px;
    line-height: 1.35;
  }

  .line.dim {
    font-size: 12px;
    color: var(--text-dim);
  }

  /* The slider is the one part that takes the pointer. */
  .rear {
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: auto;
  }

  .rear .label {
    flex: none;
  }

  .rear :global(.slider) {
    flex: 1;
    min-width: 60px;
  }

  .keys {
    display: flex;
    gap: 3px;
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

  .rear output {
    min-width: 1.5ch;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 12px;
    color: var(--text-dim);
  }

  .legend li {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .line-key {
    display: inline-block;
    width: 18px;
    border-top: 3px solid var(--you);
  }

  .line-key.dashed {
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
