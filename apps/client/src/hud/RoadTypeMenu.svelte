<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { RoadGain } from '../protocol.gen.ts';
  import {
    labelPoint,
    RADIAL,
    ROAD_HALF,
    ROAD_SECTORS,
    roadSectorAt,
    sectorPath,
  } from './radial.ts';
  import { gainText } from './tipText.ts';

  interface Props {
    orders: OrderController;
  }

  let { orders }: Props = $props();

  /** The ring plus a caption under it; the origin is the middle of the ring. */
  const HALF = RADIAL.outer + 20;
  const HALF_W = 250;
  const CAPTION = 40;

  const menu = $derived(orders.roadType.current);
  const gainOf = (type: 'fast' | 'freight'): RoadGain | null =>
    type === 'fast' ? menu.fast : menu.freight;
  // The middle of the menu: where the pointer was when it opened, kept inside the window.
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
      orders.roadType.hover(roadSectorAt(event.clientX - centre.x, event.clientY - centre.y));
  }
</script>

<svelte:window onpointermove={onmove} />

{#if menu.open}
  <!-- A click outside the ring (or in its middle) closes the menu. -->
  <button
    type="button"
    class="backdrop"
    tabindex="-1"
    aria-label={t('roadType.close')}
    onclick={() => {
      orders.closeRoadType();
    }}
  ></button>
  <svg
    class="radial"
    role="menu"
    aria-label={tf('roadType.title', { edge: menu.edge })}
    viewBox="{-HALF_W} {-HALF} {HALF_W * 2} {HALF * 2 + CAPTION}"
    width={HALF_W * 2}
    height={HALF * 2 + CAPTION}
    style:left="{centre.x - HALF_W}px"
    style:top="{centre.y - HALF}px"
  >
    {#each ROAD_SECTORS as sector (sector.type)}
      {@const gain = gainOf(sector.type)}
      {@const at = labelPoint(sector.angle)}
      {#if gain !== null}
        <g
          class="sector {sector.type}"
          class:hover={menu.hover === sector.type}
          role="menuitem"
          tabindex="0"
          onclick={() => {
            orders.chooseRoadType(sector.type);
          }}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              orders.chooseRoadType(sector.type);
            }
          }}
        >
          <path d={sectorPath(sector.angle, ROAD_HALF)} />
          <!-- The type is told by its sign as well as by its name: >> fast, ≡ freight. -->
          <text x={at.x} y={at.y - 26} class="sign">{sector.type === 'fast' ? '»' : '≡'}</text>
          <text x={at.x} y={at.y - 6} class="name">{t(`road.${sector.type}`)}</text>
          <text x={at.x} y={at.y + 12} class="gain">{gainText(gain)}</text>
          <rect x={at.x - 10} y={at.y + 22} width="20" height="17" rx="4" class="keycap" />
          <text x={at.x} y={at.y + 35} class="key">{sector.key}</text>
        </g>
      {/if}
    {/each}
    <circle class="centre" r={RADIAL.inner - 4} />
    <text class="cancel" y="4">{t('radial.cancel')}</text>
    <text class="caption" y={RADIAL.outer + 22}>
      {tf('roadType.caption', { level: menu.level, charges: menu.charges ?? '?' })}
    </text>
    <text class="caption dim" y={RADIAL.outer + 38}>{t('roadType.hint')}</text>
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

  .sector.hover path,
  .sector:focus-visible path {
    fill: var(--surface-2);
    stroke: var(--paper);
    stroke-width: 2.5;
  }

  .sign {
    fill: var(--paper);
    font-size: 20px;
    font-weight: 700;
  }

  .name {
    fill: var(--paper);
    font-size: 15px;
    font-weight: 700;
  }

  .gain {
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
