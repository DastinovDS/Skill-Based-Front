<script lang="ts">
  import type { Snippet } from 'svelte';
  import { reducedMotion } from '../render/motion.ts';
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
    /** Lines under the ring (a number of the ruleset, a hint). */
    captions?: readonly { readonly text: string; readonly dim?: boolean }[];
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
    captions = [],
    centre,
    disc = 0,
    half: halfAngle,
  }: Props = $props();

  const outer = $derived(items.length === 0 ? disc : ring.outer);
  const half = $derived(halfAngle ?? halfFor(items.length));
  const small = $derived(ring.outer - ring.inner < 100);
  const WIDE = 250;
  const CAPTION_LINE = 18;
  // The picture: the ring plus the lines under it; the middle of the ring is the origin.
  const pad = 6;
  const halfW = $derived(captions.length > 0 ? Math.max(WIDE, outer + pad) : outer + pad);
  const height = $derived(outer * 2 + pad * 2 + captions.length * CAPTION_LINE + 4);

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
        Math.max(outer + pad, window.innerHeight - outer - pad - captions.length * CAPTION_LINE),
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

  /** Lines of a sector: the glyph, the name, the small lines, the key; centred on the label point. */
  function rows(item: RadialItem): { kind: string; text: string; dy: number }[] {
    const list: { kind: string; text: string; h: number }[] = [];
    if (item.sign !== undefined) list.push({ kind: 'sign', text: item.sign, h: small ? 22 : 26 });
    if (item.compact !== true) {
      list.push({
        kind: 'name',
        text: item.current === true ? `✓ ${item.label}` : item.label,
        h: small ? 18 : 20,
      });
    }
    const extra = item.lines ?? [];
    list.push(...extra.map((text) => ({ kind: 'line', text, h: 16 })));
    if (item.key !== undefined) list.push({ kind: 'key', text: item.key, h: 24 });
    const total = list.reduce((sum, row) => sum + row.h, 0);
    let y = -total / 2;
    return list.map((row) => {
      const dy = y + row.h / 2 + 5;
      y += row.h;
      return { kind: row.kind, text: row.text, dy };
    });
  }
</script>

<svelte:window onpointermove={onmove} />

{#if modal}
  <!-- A click outside the ring, in its hole, or on the thing it belongs to closes the menu. -->
  <button type="button" class="backdrop" tabindex="-1" aria-label={closeLabel} onclick={onbackdrop}
  ></button>
{/if}
<!-- The box grows out of the middle of the ring (it also holds the captions under it). -->
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
    {#if items.length === 0}
      <circle class="disc" r={outer} />
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
        aria-label={item.compact === true ? item.label : undefined}
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
        <path d={sectorPath(item.angle, half, ring)} />
        {#each rows(item) as row, i (i)}
          {#if row.kind === 'key'}
            <rect
              x={spot.x - 10}
              y={spot.y + row.dy - 13}
              width="20"
              height="17"
              rx="4"
              class="keycap"
            />
            <text x={spot.x} y={spot.y + row.dy} class="key">{row.text}</text>
          {:else}
            <text x={spot.x} y={spot.y + row.dy} class={row.kind}>{row.text}</text>
          {/if}
        {/each}
      </g>
    {/each}
    {#if items.length > 0}
      <circle class="hole" r={ring.inner - 4} />
    {/if}
    {#each captions as caption, i (i)}
      <text class="caption" class:dim={caption.dim === true} y={outer + 22 + i * CAPTION_LINE}>
        {caption.text}
      </text>
    {/each}
  </svg>
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
    font-family: inherit;
  }

  svg {
    display: block;
    text-anchor: middle;
    overflow: visible;
  }

  /* Every radial menu opens growing from its centre: a short ease-out, none with less motion. */
  .radial.grow {
    animation: radial-open 140ms ease-out;
  }

  @keyframes radial-open {
    from {
      transform: scale(0.4);
      opacity: 0;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .radial.grow {
      animation: none;
    }
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

  .sector path {
    fill: var(--surface);
    stroke: var(--border);
    stroke-width: 1.5;
    transition: fill 80ms;
  }

  /* The sector under the pointer: filled with the colour of the owner and outlined in white. */
  .sector.hover path,
  .sector:focus-visible path {
    fill: color-mix(in srgb, var(--you) 38%, var(--bg));
    stroke: var(--paper);
    stroke-width: 2.5;
  }

  .sector.current path {
    stroke: var(--paper);
    stroke-width: 3;
  }

  /* Off is told by more than the dimming: a dashed outline and a fainter glyph. */
  .sector.disabled {
    opacity: 0.45;
  }

  .sector.disabled path {
    stroke-dasharray: 5 4;
  }

  .sector.disabled .sign {
    opacity: 0.6;
  }

  .disc {
    fill: var(--surface);
    stroke: var(--border);
    stroke-width: 1.5;
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

  .small .name {
    font-size: 13px;
  }

  .line {
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

  .hole {
    fill: none;
    stroke: var(--border);
    pointer-events: none;
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
