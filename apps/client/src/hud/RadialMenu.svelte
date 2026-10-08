<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { Stance } from '../protocol.gen.ts';
  import { formatCentis } from './format.ts';
  import { labelPoint, RADIAL, sectorAt, sectorPath, SECTORS } from './radial.ts';

  interface Props {
    orders: OrderController;
    /** The current stance (`null` before the first snapshot). */
    stance: Stance | null;
    /** Charges a minute of the capital, for the caption (`passivePerMinute` of the ruleset). */
    passive: number;
  }

  let { orders, stance, passive }: Props = $props();

  /** The menu is the ring plus a caption under it; the origin is the middle of the ring. */
  const HALF = RADIAL.outer + 20;
  /** The caption is wider than the ring. */
  const HALF_W = 250;
  const CAPTION = 56;

  const menu = $derived(orders.radial.current);
  const rates = $derived(orders.stanceRates);
  const rateOf = (s: Stance) => rates.find((r) => r.stance === s);
  // The middle of the menu: where the pointer was when it opened, kept inside the window.
  let centre = $state({ x: 0, y: 0 });
  // The pointer is tracked all the time, so the menu opens right under it.
  let pointer = { x: 0, y: 0, seen: false };

  function inside(at: { x: number; y: number }): { x: number; y: number } {
    const margin = HALF;
    return {
      x: Math.min(Math.max(at.x, HALF_W), Math.max(HALF_W, window.innerWidth - HALF_W)),
      y: Math.min(Math.max(at.y, margin), Math.max(margin, window.innerHeight - margin - CAPTION)),
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
      orders.radial.hover(sectorAt(event.clientX - centre.x, event.clientY - centre.y));
  }

  const cp = (centis: number): string => formatCentis(centis, getLocale());
  const hovered = $derived(menu.hover);
</script>

<svelte:window onpointermove={onmove} />

{#if menu.open}
  {#if menu.sticky}
    <!-- A click outside the ring (or in its middle) closes the menu. -->
    <button
      type="button"
      class="backdrop"
      tabindex="-1"
      aria-label={t('radial.close')}
      onclick={() => {
        orders.closeRadial();
      }}
    ></button>
  {/if}
  <svg
    class="radial"
    class:sticky={menu.sticky}
    role="menu"
    aria-label={t('radial.title')}
    viewBox="{-HALF_W} {-HALF} {HALF_W * 2} {HALF * 2 + CAPTION}"
    width={HALF_W * 2}
    height={HALF * 2 + CAPTION}
    style:left="{centre.x - HALF_W}px"
    style:top="{centre.y - HALF}px"
  >
    {#each SECTORS as sector (sector.stance)}
      {@const rate = rateOf(sector.stance)}
      {@const at = labelPoint(sector.angle)}
      {@const current = stance === sector.stance}
      <g
        class="sector"
        class:hover={hovered === sector.stance}
        class:current
        role="menuitemradio"
        aria-checked={current}
        tabindex="0"
        onclick={() => {
          orders.chooseStance(sector.stance);
        }}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            orders.chooseStance(sector.stance);
          }
        }}
      >
        <path d={sectorPath(sector.angle)} />
        <text x={at.x} y={at.y - 8} class="name">
          {current ? '✓ ' : ''}{t(`stance.${sector.stance}`)}
        </text>
        {#if rate !== undefined}
          <text x={at.x} y={at.y + 10} class="cp">
            {tf('radial.cpPerMin', { value: cp(rate.cpPerMinCenti) })}
          </text>
          <text x={at.x} y={at.y + 26} class="charges">
            {tf('radial.chargesPerMin', { value: rate.chargesPerMin })}
          </text>
        {/if}
        <rect x={at.x - 10} y={at.y + 34} width="20" height="17" rx="4" class="keycap" />
        <text x={at.x} y={at.y + 47} class="key">{sector.key}</text>
      </g>
    {/each}
    <circle class="centre" r={RADIAL.inner - 4} />
    <text class="cancel" y="4">{t('radial.cancel')}</text>
    <text class="caption" y={RADIAL.outer + 22}>
      {tf('radial.capital', { value: passive })}
    </text>
    <text class="caption dim" y={RADIAL.outer + 40}>
      {menu.sticky ? t('radial.hintTap') : t('radial.hintHold')}
    </text>
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
    /* In hold mode the pointer belongs to the map; only a tapped menu takes clicks. */
    pointer-events: none;
    font-family: inherit;
    text-anchor: middle;
  }

  .radial.sticky {
    pointer-events: auto;
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

  .sector.hover path,
  .sector:focus-visible path {
    fill: var(--surface-2);
    stroke: var(--paper);
    stroke-width: 2.5;
  }

  .sector.current path {
    stroke: var(--paper);
    stroke-width: 3;
  }

  .name {
    fill: var(--paper);
    font-size: 15px;
    font-weight: 700;
  }

  .cp {
    fill: var(--you);
    font-size: 12px;
  }

  .charges {
    fill: var(--text);
    font-size: 12px;
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
