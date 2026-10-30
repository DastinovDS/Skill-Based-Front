<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import UnitMark from '../app/UnitMark.svelte';
  import type { OrderController } from '../match/orderController.ts';
  import { chargedOfSplit } from '../match/splitState.svelte.ts';
  import type { MapAnchors } from '../render/anchors.ts';
  import Icon from './Icon.svelte';
  import { pointerAt } from './pointer.ts';
  import Radial from './Radial.svelte';
  import Slider from './Slider.svelte';
  import { cycleFocus } from './focusCycle.ts';

  interface Props {
    orders: OrderController;
    /** Where the group is on screen: the menu opens on it. Without it, under the pointer. */
    anchors?: MapAnchors;
  }

  let { orders, anchors }: Props = $props();

  /** Radius of the round menu; the preview, the slider and the buttons sit inside it. */
  const RADIUS = 150;

  const menu = $derived(orders.splitMenu.current);
  // The two groups the slider describes, as plain arithmetic of the numbers the menu holds: the new
  // group takes the charged first (`chargedOfSplit`), the rest stays. No rule is decided here.
  const goes = $derived({ units: menu.n, charged: chargedOfSplit(menu.n, menu.charged) });
  const stays = $derived({
    units: menu.units - menu.n,
    charged: menu.charged - goes.charged,
  });

  // Tab stays in the menu: slider, Split, Close.
  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    cycleFocus(event);
  }

  const share = (group: { units: number; charged: number }): number =>
    group.units > 0 ? group.charged / group.units : 0;

  /** Key labels are the keys themselves, not translations. */
  const SPLIT_KEY = 'S';
  const ESC = 'Esc';
</script>

<!-- The split menu (S): a disc with the two groups, a slider and the buttons, same style and closing as the radials. -->
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
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="split" onkeydown={onKey}>
        <p class="title"><Icon name="split" size={16} />{t('split.title')}</p>
        <div class="groups">
          <div class="group stays">
            <UnitMark side="own" size={32} share={share(stays)} />
            <span class="count">{stays.units}</span>
            <span class="line">{t('split.stays')}</span>
            <span class="line">{tf('split.chargedN', { n: stays.charged })}</span>
          </div>
          <div class="group goes">
            <UnitMark side="own" size={32} share={share(goes)} />
            <span class="count n">{goes.units}</span>
            <span class="line">{t('split.goes')}</span>
            <span class="line charged">{tf('split.chargedN', { n: goes.charged })}</span>
          </div>
        </div>
        <Slider
          value={menu.n}
          min={1}
          max={menu.units - 1}
          label={t('orders.splitUnits')}
          focusOnMount
          oninput={(n: number) => {
            orders.splitMenu.set(n);
          }}
        />
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
          {t('split.confirm')}<kbd class="k" aria-hidden="true">↵</kbd>
        </button>
        <button
          type="button"
          class="cancel"
          onclick={() => {
            orders.closeSplit();
          }}
        >
          {t('split.cancel')}<kbd class="k" aria-hidden="true">{SPLIT_KEY}</kbd><kbd
            class="k"
            aria-hidden="true">{ESC}</kbd
          >
        </button>
      </div>
    {/snippet}
  </Radial>
{/if}

<style>
  .split {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: center;
  }

  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--paper);
    font-size: 14px;
    font-weight: 700;
  }

  .groups {
    display: flex;
    justify-content: center;
    gap: 18px;
    width: 100%;
  }

  .group {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  /* The new group is told by a dashed outline and its caption, not by colour. */
  .group.goes {
    border-style: dashed;
    border-color: var(--paper);
  }

  .count {
    color: var(--paper);
    font-size: 26px;
    font-weight: 800;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  .line {
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.3;
  }

  .confirm,
  .cancel {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    box-sizing: border-box;
    font: inherit;
    cursor: pointer;
  }

  .confirm {
    width: 100%;
    height: 36px;
    border: 1px solid var(--paper);
    border-radius: 8px;
    background: var(--you);
    color: var(--bg);
    font-weight: 700;
  }

  .confirm.hover {
    background: color-mix(in srgb, var(--you) 80%, var(--paper));
  }

  .cancel {
    height: 28px;
    padding: 0 6px;
    border: 0;
    background: none;
    color: var(--text-dim);
    font-size: 13px;
  }

  .cancel:hover {
    color: var(--text);
  }

  .confirm:focus-visible,
  .cancel:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
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
    font-size: 12px;
    font-weight: 600;
    line-height: 17px;
  }

  .confirm .k {
    border-color: rgb(13 17 23 / 35%);
    background: rgb(13 17 23 / 18%);
    color: var(--bg);
  }
</style>
