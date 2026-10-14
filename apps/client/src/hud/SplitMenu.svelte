<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import { chargedOfSplit } from '../match/splitState.svelte.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  /** Half the size of the round menu; its middle is where the pointer was when S went down. */
  const HALF = 120;

  const menu = $derived(orders.splitMenu.current);
  const charged = $derived(chargedOfSplit(menu.n, menu.charged));
  let centre = $state({ x: 0, y: 0 });
  let pointer = { x: 0, y: 0, seen: false };

  function inside(at: { x: number; y: number }): { x: number; y: number } {
    return {
      x: Math.min(Math.max(at.x, HALF), Math.max(HALF, window.innerWidth - HALF)),
      y: Math.min(Math.max(at.y, HALF), Math.max(HALF, window.innerHeight - HALF)),
    };
  }

  $effect(() => {
    if (menu.open) {
      centre = inside(
        pointer.seen ? pointer : { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      );
    }
  });

  function onmove(event: PointerEvent): void {
    pointer = { x: event.clientX, y: event.clientY, seen: true };
  }
</script>

<svelte:window onpointermove={onmove} />

{#if menu.open}
  <!-- A click outside the menu closes it, as S and Esc do (the radial menus of the HUD). -->
  <button
    type="button"
    class="backdrop"
    tabindex="-1"
    aria-label={t('split.close')}
    onclick={() => {
      orders.closeSplit();
    }}
  ></button>
  <div
    class="split"
    role="dialog"
    aria-label={t('split.title')}
    style:left="{centre.x - HALF}px"
    style:top="{centre.y - HALF}px"
    style:width="{HALF * 2}px"
    style:height="{HALF * 2}px"
  >
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
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    border: none;
    background: transparent;
    pointer-events: auto;
    cursor: default;
  }

  .split {
    position: fixed;
    z-index: 21;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 24px;
    border-radius: 50%;
    border: 1.5px solid var(--border);
    background: var(--surface);
    pointer-events: auto;
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
    width: 70%;
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
    background: var(--surface-2);
  }
</style>
