<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.ts';
  import { reducedMotion } from '../render/motion.ts';
  import CpMark from '../theme/CpMark.svelte';
  import Icon from './Icon.svelte';
  import { markPaths } from './marks.ts';
  import { pointerAt } from './pointer.ts';
  import {
    BIG_RING,
    halfFor,
    labelPoint,
    sectorHit,
    sectorPath,
    type RadialItem,
    type RadialRing,
  } from './radial.ts';

  /** A point of the page in CSS px. */
  interface Point {
    readonly x: number;
    readonly y: number;
  }

  interface Props {
    /** The sectors. None: a plain disc with `centre` in it (the split menu). */
    items: readonly RadialItem[];
    /** Accessible name of the menu. */
    label: string;
    /**
     * Where the middle is: `'centre'` of the window (the stance menu), `'pointer'` where the
     * pointer is when the menu opens, a fixed point, or a function read every frame for a menu that
     * follows a city or a group (`null`: the thing is gone, the menu closes).
     */
    at: 'centre' | 'pointer' | Point | (() => Point | null);
    ring?: RadialRing;
    /** The sector under the pointer; the owner keeps it (a held key chooses it on release). */
    hover: string | null;
    onhover: (id: string | null) => void;
    onchoose: (id: string) => void;
    onclose: () => void;
    /** Accessible name of the click-outside area. */
    closeLabel: string;
    /**
     * A click outside the ring closes the menu (and a click in a gap picks the sector by angle).
     * Without it the map under and around the ring stays clickable.
     */
    modal?: boolean;
    /** The ring takes clicks. `false`: a menu held open by a key, the pointer stays the map's. */
    interactive?: boolean;
    /** Keep the whole ring inside the window (menus at the pointer or the middle). */
    clamp?: boolean;
    /** Content of the hole (a slider), HTML. */
    centre?: Snippet;
    /** Radius of the plain disc when there are no sectors. */
    disc?: number;
    /** Half the angle of a sector, degrees; by default as wide as the number of sectors allows. */
    half?: number;
  }

  let {
    items,
    label,
    at,
    ring = BIG_RING,
    hover,
    onhover,
    onchoose,
    onclose,
    closeLabel,
    modal = false,
    interactive = true,
    clamp = true,
    centre,
    disc = 0,
    half: halfAngle,
  }: Props = $props();

  const outer = $derived(items.length === 0 ? disc : ring.outer);
  const half = $derived(halfAngle ?? halfFor(items.length));
  const small = $derived(ring.outer - ring.inner < 100);
  // The picture: the ring; the middle of the ring is the origin.
  const pad = 6;
  const halfW = $derived(outer + pad);
  const height = $derived(outer * 2 + pad * 2 + 4);

  let root: HTMLElement | undefined = $state();
  // The middle of the menu now; plain data, the frame loop moves the box through the CSSOM.
  let middle: Point = { x: 0, y: 0 };

  function resolve(): Point | null {
    if (typeof at === 'function') return at();
    if (at === 'centre') return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (at === 'pointer') return opened;
    return at;
  }

  // 'pointer' means where it was when the menu appeared, not where it is later.
  const opened = pointerAt();

  function place(): boolean {
    if (root === undefined) return true;
    const found = resolve();
    if (found === null) return false;
    let { x, y } = found;
    if (clamp) {
      x = Math.min(Math.max(x, halfW), Math.max(halfW, window.innerWidth - halfW));
      y = Math.min(
        Math.max(y, outer + pad),
        Math.max(outer + pad, window.innerHeight - outer - pad),
      );
    }
    middle = { x, y };
    root.style.left = `${String(x - halfW)}px`;
    root.style.top = `${String(y - outer - pad)}px`;
    root.style.visibility = 'visible';
    return true;
  }

  $effect(() => {
    // `place` reads the anchor and the size: a change of either places the menu again.
    if (!place()) {
      onclose();
      return undefined;
    }
    if (typeof at !== 'function') return undefined;
    let frame = requestAnimationFrame(function follow(): void {
      if (!place()) {
        onclose();
        return;
      }
      frame = requestAnimationFrame(follow);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  });

  const sectors = $derived(items.map((item) => ({ angle: item.angle, item })));

  function sectorAtPoint(x: number, y: number): RadialItem | null {
    return sectorHit(sectors, x - middle.x, y - middle.y, ring, half);
  }

  function onmove(event: PointerEvent): void {
    if (items.length === 0) return;
    const found = sectorAtPoint(event.clientX, event.clientY);
    const id = found === null || found.disabled === true ? null : found.id;
    if (id !== hover) onhover(id);
  }

  // A click outside a sector: the one lit by the pointer is chosen (it may be in a gap), else the
  // menu closes.
  function onbackdrop(event: MouseEvent): void {
    const found = sectorAtPoint(event.clientX, event.clientY);
    if (found === null) onclose();
    else if (found.disabled !== true) onchoose(found.id);
  }

  /** Side of the icon of a sector, px: 24 in the small rings, 30 in the big one (ui-style 54g). */
  const iconSize = $derived(small ? 24 : 30);

  /** The price row of a sector: a line of figures for CP and rates, a row of lozenges for charges. */
  const PRICE_LINE = 19;
  const MARK_ROW = 17;
  const MARK_SCALE = 1.15;

  function priceHeight(item: RadialItem): number {
    const p = item.price;
    if (p === undefined) return 0;
    return (
      (p.cp !== undefined ? PRICE_LINE : 0) +
      (p.charges !== undefined && p.charges > 0 ? MARK_ROW : 0) +
      (p.chargeRate !== undefined ? PRICE_LINE : 0)
    );
  }

  interface Row {
    readonly kind: 'icon' | 'name' | 'price' | 'line' | 'key';
    readonly text: string;
    /** The baseline of a text row from the label point (5 below the row's middle). */
    readonly dy: number;
    readonly h: number;
  }

  /** Rows of a sector: the icon, the name, the price, the small lines, the key; centred on the label point. */
  function rows(item: RadialItem): Row[] {
    const list: { kind: Row['kind']; text: string; h: number }[] = [];
    if (item.icon !== undefined) list.push({ kind: 'icon', text: item.icon, h: iconSize + 4 });
    if (item.compact !== true) {
      list.push({
        kind: 'name',
        text: item.current === true ? `✓ ${item.label}` : item.label,
        h: small ? 18 : 20,
      });
    }
    const priceH = priceHeight(item);
    if (priceH > 0) list.push({ kind: 'price', text: '', h: priceH });
    const extra = item.lines ?? [];
    list.push(...extra.map((text) => ({ kind: 'line' as const, text, h: 16 })));
    if (item.key !== undefined) list.push({ kind: 'key', text: item.key, h: 20 });
    const total = list.reduce((sum, row) => sum + row.h, 0);
    let y = -total / 2;
    return list.map((row) => {
      const dy = y + row.h / 2 + 5;
      y += row.h;
      return { ...row, dy };
    });
  }

  /** The figures of a price row and where its sign stands, centred on `x` (EB Garamond digits). */
  function figureRow(text: string, x: number, per: string): { tx: number; mx: number; px: number } {
    const digits = text.length * 7.6;
    const width = digits + 3 + 13 + (per === '' ? 0 : 3 + per.length * 6.4);
    const left = x - width / 2;
    return { tx: left + digits, mx: left + digits + 3, px: left + digits + 3 + 13 + 3 };
  }

  /** The row "1 [CP] | -> +0.5 [CP]" of a recruit that will walk (#930, W8), centred on `x`. */
  function walkRow(
    cp: string,
    walk: string,
    x: number,
  ): { tx: number; mx: number; rule: number; ax: number; wx: number; wm: number } {
    const digits = cp.length * 7.6;
    const walkDigits = (walk.length + 1) * 6.8;
    const width = digits + 3 + 13 + 5 + 1 + 4 + 8 + 2 + walkDigits + 2 + 12;
    const left = x - width / 2;
    const rule = left + digits + 3 + 13 + 5;
    const ax = rule + 5;
    const wx = ax + 10;
    return { tx: left + digits, mx: left + digits + 3, rule, ax, wx, wm: wx + walkDigits + 2 };
  }

  // The hovered sector's name in the hub over the ring (Cut and ring, ui-style 54g).
  const hubName = $derived(items.find((item) => item.id === hover)?.label ?? null);
  const perMinute = $derived(t('radial.perMinute'));
</script>

<svelte:window onpointermove={onmove} />

{#if modal}
  <!-- A click outside the ring, in its hole, or on the thing it belongs to closes the menu. -->
  <button type="button" class="backdrop" tabindex="-1" aria-label={closeLabel} onclick={onbackdrop}
  ></button>
{/if}
<!-- The box grows out of the middle of the ring. -->
<div
  class="radial"
  class:small
  class:interactive
  class:grow={!reducedMotion()}
  style:transform-origin="{halfW}px {outer + pad}px"
  bind:this={root}
>
  <svg
    role={items.length === 0 ? 'dialog' : 'menu'}
    aria-label={label}
    viewBox="{-halfW} {-(outer + pad)} {halfW * 2} {height}"
    width={halfW * 2}
    {height}
  >
    <defs>
      <!-- The hovered sector: ruled in the own colour on the dark plate (Cut and ring). -->
      <pattern id="radial-lit" patternUnits="userSpaceOnUse" width="4" height="4">
        <rect width="4" height="4" class="lit-plate" />
        <rect width="4" height="1" class="lit-rule" />
      </pattern>
    </defs>
    {#if items.length === 0}
      <circle class="disc" r={outer} />
      <circle class="frame" r={outer + 4} />
    {/if}
    {#each items as item (item.id)}
      {@const spot = labelPoint(item.angle, ring)}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <g
        class="sector"
        class:hover={hover === item.id}
        class:current={item.current === true}
        class:disabled={item.disabled === true}
        role={item.current === undefined ? 'menuitem' : 'menuitemradio'}
        aria-label={item.aria ?? (item.compact === true ? item.label : undefined)}
        aria-disabled={item.disabled === true}
        aria-checked={item.current === undefined ? undefined : item.current}
        tabindex={item.disabled === true ? -1 : 0}
        onclick={() => {
          if (item.disabled !== true) onchoose(item.id);
        }}
        onkeydown={(event) => {
          if (item.disabled !== true && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            onchoose(item.id);
          }
        }}
      >
        <path class="plate" d={sectorPath(item.angle, half, ring)} />
        <path class="edge" d={sectorPath(item.angle, half, ring)} />
        {#each rows(item) as row, i (i)}
          {#if row.kind === 'icon' && item.icon !== undefined}
            <!-- The icon is centred on the row (dy is the baseline of a text row: 5 below its middle). -->
            <g
              class="glyph"
              data-icon={item.icon}
              transform="translate({spot.x - iconSize / 2} {spot.y + row.dy - 5 - iconSize / 2})"
            >
              <Icon name={item.icon} size={iconSize} cut />
            </g>
            {#if item.current === true && item.compact === true}
              <!-- The current choice: a lozenge over its icon (a shape, not a colour). -->
              <path
                class="current-mark"
                d="M{spot.x} {spot.y + row.dy - iconSize / 2 - 13}l3.5 3.5l-3.5 3.5l-3.5 -3.5z"
              />
            {/if}
          {:else if row.kind === 'price' && item.price !== undefined}
            {@const p = item.price}
            {@const per = p.perMinute === true ? perMinute : ''}
            {@const top = spot.y + row.dy - 5 - row.h / 2}
            {#if p.cp !== undefined && p.walk !== undefined}
              <!-- #930, W8: the price now, then what each recruit pays as it walks to the point. -->
              {@const w = walkRow(p.cp, p.walk, spot.x)}
              <text x={w.tx} y={top + 14} class="figure end">{p.cp}</text>
              <g transform="translate({w.mx} {top + 3})"><CpMark size={13} /></g>
              <path class="walk-rule" d="M{w.rule} {top + 2}V{top + 17}" />
              <path
                class="walk-arrow"
                d="M{w.ax} {top + 9.5}h6M{w.ax + 3.4} {top + 6.9}l2.6 2.6l-2.6 2.6"
              />
              <text x={w.wx} y={top + 14} class="walk-figure">+{p.walk}</text>
              <g transform="translate({w.wm} {top + 4})"><CpMark size={12} /></g>
            {:else if p.cp !== undefined}
              {@const f = figureRow(p.cp, spot.x, per)}
              <text x={f.tx} y={top + 14} class="figure end">{p.cp}</text>
              <g transform="translate({f.mx} {top + 3})"><CpMark size={13} /></g>
              {#if per !== ''}<text x={f.px} y={top + 14} class="per">{per}</text>{/if}
            {/if}
            {#if p.charges !== undefined && p.charges > 0}
              {@const cy = top + (p.cp !== undefined ? PRICE_LINE : 0) + MARK_ROW / 2}
              {#each markPaths(p.charges, p.have ?? 0, spot.x, cy, MARK_SCALE) as m, k (k)}
                <path class="mark {m.kind}" d={m.d} />
              {/each}
            {/if}
            {#if p.chargeRate !== undefined}
              {@const at = top + (p.cp !== undefined ? PRICE_LINE : 0)}
              {@const f = figureRow(p.chargeRate, spot.x, per)}
              <text x={f.tx} y={at + 14} class="figure end">{p.chargeRate}</text>
              {#each markPaths(1, 1, f.mx + 6.5, at + 9.5, 1) as m, k (k)}
                <path class="mark {m.kind}" d={m.d} />
              {/each}
              {#if per !== ''}<text x={f.px} y={at + 14} class="per">{per}</text>{/if}
            {/if}
          {:else if row.kind === 'key'}
            <rect x={spot.x - 8} y={spot.y + row.dy - 12} width="16" height="15" class="keycap" />
            <text x={spot.x} y={spot.y + row.dy - 1} class="key">{row.text}</text>
          {:else}
            <text x={spot.x} y={spot.y + row.dy} class={row.kind}>{row.text}</text>
          {/if}
        {/each}
      </g>
    {/each}
    {#if items.length > 0}
      <!-- The double frame of the ring: a rule outside the sectors and one inside the hole. -->
      <circle class="frame" r={ring.outer + 4} />
      <circle class="frame hole" r={ring.inner - 3} />
    {/if}
  </svg>
  {#if hubName !== null && items.length > 0}
    <!-- The name of the sector under the pointer, in cut capitals over the ring. -->
    <div class="hub" style:left="{halfW}px" aria-hidden="true">{hubName}</div>
  {/if}
  {#if centre !== undefined}
    <div
      class="centre"
      style:top="{outer + pad}px"
      style:width="{Math.max(0, (items.length === 0 ? outer : ring.inner) * 1.5)}px"
    >
      {@render centre()}
    </div>
  {/if}
</div>

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
    /* Placed by the script (CSSOM) before it shows. */
    visibility: hidden;
    /* The box never takes the pointer: only the sectors do, the rest is the map's (or the backdrop's). */
    pointer-events: none;
    color: var(--ink);
    font-family: var(--font-text);
    font-variant-numeric: lining-nums tabular-nums;
  }

  svg {
    display: block;
    text-anchor: middle;
    overflow: visible;
  }

  /* Every radial menu opens growing from its centre: a short ease-out, none with less motion. */
  .radial.grow {
    animation: radial-open 160ms var(--ease-settle);
  }

  @keyframes radial-open {
    from {
      transform: scale(0.6);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  /* The motion setting of the page (#871) decides, not the media query alone. */
  :global(:root[data-motion='reduced']) .radial.grow {
    animation: none;
  }

  .centre {
    position: absolute;
    left: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    transform: translate(-50%, -50%);
    pointer-events: auto;
  }

  .sector {
    pointer-events: none;
    outline: none;
  }

  .interactive .sector:not(.disabled) {
    pointer-events: auto;
    cursor: pointer;
  }

  /* Cut and ring (ui-style 54g): sectors of dark ink, a hairline round each. */
  .plate {
    fill: rgb(14 12 9 / 97%);
  }

  .lit-plate {
    fill: rgb(14 12 9 / 97%);
  }

  .lit-rule {
    fill: rgb(134 166 234 / 42%);
  }

  .edge {
    fill: none;
    stroke: rgb(236 228 209 / 45%);
    stroke-width: 0.8;
  }

  /* The sector under the pointer: ruled in the own colour, its edge in full ink. */
  .sector.hover .plate,
  .sector:focus-visible .plate {
    fill: url(#radial-lit);
  }

  .sector.hover .edge,
  .sector:focus-visible .edge {
    stroke: rgb(236 228 209 / 95%);
    stroke-width: 1.3;
  }

  .sector.current .edge {
    stroke: var(--ink);
    stroke-width: 1.6;
  }

  .current-mark {
    fill: var(--ink);
    stroke: var(--casing);
    stroke-width: 1;
  }

  /* Off is told by more than the dimming: a dashed edge and a fainter glyph. */
  /* The plate stays solid (the map never shows through a menu); its content dims. */
  .sector.disabled .glyph,
  .sector.disabled text,
  .sector.disabled .keycap,
  .sector.disabled .mark,
  .sector.disabled g {
    opacity: 0.45;
  }

  .sector.disabled .edge {
    stroke-dasharray: 4 3;
  }

  .sector.disabled .glyph {
    opacity: 0.35;
  }

  .disc {
    fill: rgb(14 12 9 / 97%);
    stroke: rgb(236 228 209 / 45%);
    stroke-width: 0.8;
  }

  .frame {
    fill: none;
    stroke: rgb(236 228 209 / 55%);
    stroke-width: 0.8;
    pointer-events: none;
  }

  /* The icons draw with `currentColor`: ivory on the plate, brighter on the lit sector. */
  .glyph {
    color: #d9cfb8;
  }

  .sector.hover .glyph {
    color: var(--ink);
  }

  .name {
    fill: var(--ink);
    font: 600 15px var(--font-text);
  }

  .small .name {
    font-size: 14px;
  }

  .figure {
    fill: var(--ink);
    font: 500 16px var(--font-text);
  }

  .figure.end {
    text-anchor: end;
  }

  .walk-rule {
    stroke: var(--ink);
    stroke-opacity: 0.4;
    stroke-width: 1;
  }

  .walk-arrow {
    fill: none;
    stroke: var(--own);
    stroke-width: 1.5;
  }

  .walk-figure {
    fill: var(--neutral);
    font: 500 15px var(--font-text);
    text-anchor: start;
  }

  .per {
    fill: var(--ink-dim);
    font: 500 13px var(--font-text);
    text-anchor: start;
  }

  .mark.casing {
    fill: var(--casing);
  }

  .mark.fill {
    fill: var(--own);
  }

  .mark.hollow {
    fill: var(--plate);
    stroke: var(--ink);
    stroke-opacity: 0.92;
    stroke-width: 0.9;
  }

  .line {
    fill: var(--ink-soft);
    font: 500 13px var(--font-text);
  }

  /* The key in a small square in cut capitals. */
  .keycap {
    fill: none;
    stroke: rgb(236 228 209 / 40%);
    stroke-width: 1;
  }

  .key {
    fill: var(--ink-dim);
    font: 600 10px var(--font-display);
    letter-spacing: 0.06em;
  }

  .hub {
    position: absolute;
    top: -16px;
    transform: translateX(-50%);
    padding: 4px 9px 3px;
    border-top: 1px solid rgb(236 228 209 / 45%);
    border-bottom: 1px solid rgb(236 228 209 / 45%);
    background: rgb(14 12 9 / 92%);
    color: var(--ink);
    font: 600 11px/1.2 var(--font-display);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    white-space: nowrap;
  }
</style>
