<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import { chargedOfSplit } from '../match/splitState.svelte.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import { pointerAt } from './pointer.ts';
  import Radial from './Radial.svelte';

  interface Props {
    orders: OrderController;
    /** Where the group is on screen: the menu opens on it. Without it, under the pointer. */
    anchors?: MapAnchors;
  }

  let { orders, anchors }: Props = $props();

  /** Radius of the round menu; the slider and the buttons sit inside it. */
  const RADIUS = 120;

  const menu = $derived(orders.splitMenu.current);
  const charged = $derived(chargedOfSplit(menu.n, menu.charged));
</script>

<!-- The split menu (S): a disc with a slider on the group, same style and closing as the radials. -->
{#if menu.open}
  <Radial
    items={[]}
    disc={RADIUS}
    label={t('split.title')}
    at={() => anchors?.group(menu.group) ?? pointerAt()}
    hover={null}
    onhover={() => undefined}
    onchoose={() => undefined}
    onclose={() => {
      orders.closeSplit();
    }}
    closeLabel={t('split.close')}
    modal
  >
    {#snippet centre()}
      <div class="split">
        <p class="title">{t('split.title')}</p>
        <p class="amount">
          <span class="n">{menu.n}</span>
          <span class="of">{tf('split.of', { units: menu.units })}</span>
        </p>
        <input
          type="range"
          min="1"
          max={menu.units - 1}
          step="1"
          value={menu.n}
          aria-label={t('orders.splitUnits')}
          oninput={(event) => {
            orders.splitMenu.set(Number(event.currentTarget.value));
          }}
        />
        <p class="charged">{tf('split.charged', { charged })}</p>
        <button
          type="button"
          class="confirm"
          class:hover={menu.hover}
          onpointerenter={() => {
            orders.splitMenu.hover(true);
          }}
          onpointerleave={() => {
            orders.splitMenu.hover(false);
          }}
          onclick={() => {
            orders.confirmSplit();
          }}
        >
          {t('split.confirm')}
        </button>
        <p class="hint">{t('split.hint')}</p>
      </div>
    {/snippet}
  </Radial>
{/if}

<style>
  .split {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    text-align: center;
  }

  p {
    margin: 0;
  }

  .title {
    color: var(--paper);
    font-size: 13px;
    font-weight: 700;
  }

  .amount {
    color: var(--paper);
  }

  .n {
    font-size: 26px;
    font-weight: 700;
  }

  .of,
  .charged,
  .hint {
    color: var(--text-dim);
    font-size: 11px;
  }

  input {
    width: 90%;
  }

  .confirm {
    padding: 4px 14px;
    border: 1.5px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--paper);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .confirm.hover,
  .confirm:focus-visible {
    border-color: var(--paper);
    background: color-mix(in srgb, var(--you) 38%, var(--bg));
  }
</style>
