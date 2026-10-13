<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import {
    labelPoint,
    PRIORITY_SIGN,
    RADIAL,
    SUPPLY_HALF,
    SUPPLY_SECTORS,
    sectorPath,
    supplySectorAt,
    type SupplyChoice,
  } from './radial.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  /** The ring plus a caption under it; the origin is the middle of the ring. */
  const HALF = RADIAL.outer + 20;
  const HALF_W = 250;
  const CAPTION = 40;

  const menu = $derived(orders.supplyMenu.current);
  // The middle of the menu: where the pointer was when it opened (the clicked city), kept inside
  // the window.
  let centre = $state({ x: 0, y: 0 });
  let pointer = { x: 0, y: 0, seen: false };

  function inside(at: { x: number; y: number }): { x: number; y: number } {
    return {
      x: Math.min(Math.max(at.x, HALF_W), Math.max(HALF_W, window.innerWidth - HALF_W)),
      y: Math.min(Math.max(at.y, HALF), Math.max(HALF, window.innerHeight - HALF - CAPTION)),
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
    if (menu.open)
      orders.supplyMenu.hover(supplySectorAt(event.clientX - centre.x, event.clientY - centre.y));
  }

  function sign(choice: SupplyChoice): string {
    return choice === 'transfer' ? '⇢' : PRIORITY_SIGN[choice];
  }

  function name(choice: SupplyChoice): string {
    return choice === 'transfer' ? t('supplyMenu.transfer') : t(`priority.${choice}`);
  }
</script>

<svelte:window
  onpointermove={onmove}
  onpointerdown={(event) => {
    // The click on the city opens the menu: its middle is where that click was.
    pointer = { x: event.clientX, y: event.clientY, seen: true };
  }}
/>

{#if menu.open}
  <!-- A click outside the ring (or in its middle, or on the city again) closes the menu. -->
  <button
    type="button"
    class="backdrop"
    tabindex="-1"
    aria-label={t('supplyMenu.close')}
    onclick={() => {
      orders.closeSupplyMenu();
    }}
  ></button>
  <svg
    class="radial"
    role="menu"
    aria-label={tf('supplyMenu.title', { node: menu.node })}
    viewBox="{-HALF_W} {-HALF} {HALF_W * 2} {HALF * 2 + CAPTION}"
    width={HALF_W * 2}
    height={HALF * 2 + CAPTION}
    style:left="{centre.x - HALF_W}px"
    style:top="{centre.y - HALF}px"
  >
    {#each SUPPLY_SECTORS as sector (sector.choice)}
      {@const at = labelPoint(sector.angle)}
      {@const current = sector.choice === menu.priority}
      <g
        class="sector"
        class:hover={menu.hover === sector.choice}
        class:current
        role="menuitem"
        tabindex="0"
        onclick={() => {
          orders.chooseSupply(sector.choice);
        }}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            orders.chooseSupply(sector.choice);
          }
        }}
      >
        <path d={sectorPath(sector.angle, SUPPLY_HALF)} />
        <text x={at.x} y={at.y - 22} class="sign">{sign(sector.choice)}</text>
        <text x={at.x} y={at.y - 3} class="name">{name(sector.choice)}</text>
        {#if current}
          <text x={at.x} y={at.y + 13} class="note">{t('supplyMenu.current')}</text>
        {:else if sector.choice === 'transfer' && menu.warehouse !== null}
          <text x={at.x} y={at.y + 13} class="note"
            >{tf('supplyMenu.stock', { charges: menu.warehouse })}</text
          >
        {/if}
        <rect x={at.x - 10} y={at.y + 20} width="20" height="17" rx="4" class="keycap" />
        <text x={at.x} y={at.y + 33} class="key">{sector.key}</text>
      </g>
    {/each}
    <circle class="centre" r={RADIAL.inner - 4} />
    <text class="cancel" y="4">{t('radial.cancel')}</text>
    <text class="caption" y={RADIAL.outer + 22}>{t('supplyMenu.caption')}</text>
    <text class="caption dim" y={RADIAL.outer + 38}>{t('supplyMenu.hint')}</text>
  </svg>
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

  .radial {
    position: fixed;
    z-index: 21;
    pointer-events: auto;
    font-family: inherit;
    text-anchor: middle;
  }

  .sector path {
    fill: var(--surface);
    stroke: var(--border);
    stroke-width: 1.5;
  }

  .sector {
    cursor: pointer;
    outline: none;
  }

  .sector.current path {
    stroke: var(--text);
    stroke-dasharray: 5 4;
  }

  .sector.hover path,
  .sector:focus-visible path {
    fill: var(--surface-2);
    stroke: var(--paper);
    stroke-width: 2.5;
    stroke-dasharray: none;
  }

  .sign {
    fill: var(--paper);
    font-size: 18px;
    font-weight: 700;
  }

  .name {
    fill: var(--paper);
    font-size: 14px;
    font-weight: 700;
  }

  .note {
    fill: var(--text);
    font-size: 11px;
  }

  .keycap {
    fill: none;
    stroke: var(--text-dim);
  }

  .key {
    fill: var(--text-dim);
    font-size: 11px;
  }

  .centre {
    fill: var(--bg);
    stroke: var(--border);
  }

  .cancel {
    fill: var(--text-dim);
    font-size: 10px;
  }

  .caption {
    fill: var(--text);
    font-size: 12px;
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 3px;
  }

  .caption.dim {
    fill: var(--text-dim);
  }
</style>
