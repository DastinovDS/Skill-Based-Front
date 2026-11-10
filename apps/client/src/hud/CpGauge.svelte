<script lang="ts">
  import { untrack } from 'svelte';
  import { reducedMotion } from '../render/motion.ts';
  import {
    burinEdge,
    priceBracket,
    quantumEnd,
    running,
    shownValue,
    slivers,
    type CpChange,
  } from './cpMotion.ts';

  interface Props {
    /** Own CP and the cap, hundredths (the snapshot's). */
    value: number;
    cap: number;
    /** The way to the next CP quantum, 0..1 (DEC-44 progress); `null`: not known, not drawn. */
    next: number | null;
    /** The size of one quantum, hundredths (`cp.per_period`): the ruled part is `next` of it. */
    quantum: number;
    /** The CP do not pay for the hovered move, or a move was just refused for them (#762). */
    short: boolean;
    /** The CP price of the hovered move, hundredths; `null`: nothing hovered. */
    price: number | null;
    /** The numeral as the page writes it. */
    text: string;
  }

  let { value, cap, next, quantum: step, short, price, text }: Props = $props();

  // The Double frame (ui-style 54a, 55a, 57a) in CSS px: a scale of `W` px from 0 to the cap, a
  // bar over it, the next quantum ruled in, a needle under the value. Nothing runs past the scale.
  const W = 150;
  const X = 6;
  const BASE = 22;
  const HEIGHT = 42;
  /** At most this many spent slivers sink at once (a pool of elements, moved per frame). */
  const SLIVER_SLOTS = [0, 1, 2, 3];

  const cp = $derived(value / 100);
  const n = $derived(Math.max(1, cap / 100));
  const unit = $derived(W / n);
  const full = $derived(value >= cap);
  // A tick at every half CP, the whole ones longer.
  const ticks = $derived.by(() => {
    const out: string[] = [];
    for (let j = 0; j <= n * 2; j++) {
      const x = Math.round(X + (j * unit) / 2) + 0.5;
      out.push(`M${String(x)} ${String(BASE)}V${String(BASE + (j % 2 === 0 ? 7 : 4))}`);
    }
    return out.join('');
  });
  const bracket = $derived(price === null ? null : priceBracket(cp, price / 100));
  // The frame runs from the left serif along both rules to the right one.
  const L = X - 3.5;
  const R = X + W + 3.5;
  const TOP = BASE - 11.5;
  const BOTTOM = BASE + 0.5;
  const MID = BASE - 5.5;
  const outerTop = `M${String(L)} ${String(MID)}V${String(TOP)}H${String(R)}V${String(MID)}`;
  const outerBottom = `M${String(L)} ${String(MID)}V${String(BOTTOM)}H${String(R)}V${String(MID)}`;
  const innerTop = `M${String(L + 2)} ${String(MID)}V${String(TOP + 2)}H${String(R - 2)}V${String(MID)}`;
  const innerBottom = `M${String(L + 2)} ${String(MID)}V${String(BOTTOM - 2)}H${String(R - 2)}V${String(MID)}`;

  // The painted parts, moved through attributes: the bar eases for up to a second after a change,
  // and a reactive value would re-render the bar every frame of it.
  let bar: SVGRectElement | undefined = $state();
  let quantum: SVGRectElement | undefined = $state();
  let notch: SVGPathElement | undefined = $state();
  let needle: SVGPathElement | undefined = $state();
  let edge: SVGRectElement | undefined = $state();
  let sliverEls: SVGGElement[] = $state([]);

  let changes: CpChange[] = [];
  let last: number | null = null;
  let frame = 0;

  // The numeral rolls down on a spend and up on an income (CSS), the old one gone by 60 % of it.
  let roll = $state<{ readonly key: number; readonly was: string; readonly dir: 'down' | 'up' }>({
    key: 0,
    was: '',
    dir: 'up',
  });
  let lastText = '';

  function paint(now: number): boolean {
    changes = running(changes, now);
    const shown = shownValue(cp, n, changes, now);
    const end = next === null || full ? null : quantumEnd(cp, n, next, step);
    bar?.setAttribute('width', String(Math.max(0, unit * shown)));
    if (quantum !== undefined) {
      const from = Math.max(shown, cp);
      const w = end === null ? 0 : Math.max(0, unit * (end - from));
      quantum.setAttribute('x', String(X + unit * from));
      quantum.setAttribute('width', String(w));
    }
    if (notch !== undefined) {
      notch.setAttribute('visibility', end === null ? 'hidden' : 'visible');
      if (end !== null) notch.setAttribute('transform', `translate(${String(X + unit * end)} 0)`);
    }
    needle?.setAttribute('transform', `translate(${String(X + unit * shown)} 0)`);
    if (edge !== undefined) {
      const alpha = burinEdge(changes, now);
      edge.setAttribute('opacity', String(alpha));
      edge.setAttribute('x', String(X + unit * shown - 1));
    }
    const list = slivers(changes, now);
    sliverEls.forEach((el, i) => {
      const s = list[i];
      if (s === undefined) {
        el.setAttribute('visibility', 'hidden');
        return;
      }
      el.setAttribute('visibility', 'visible');
      el.setAttribute('opacity', String(1 - s.drop));
      el.setAttribute('transform', `translate(0 ${String(6 * s.drop)})`);
      const rect = el.firstElementChild;
      const line = el.lastElementChild;
      for (const r of [rect, line]) {
        r?.setAttribute('x', String(X + unit * s.lo));
        r?.setAttribute('width', String(Math.max(0, unit * (s.hi - s.lo))));
      }
    });
    return changes.length > 0;
  }

  function loop(now: number): void {
    frame = paint(now) ? requestAnimationFrame(loop) : 0;
  }

  // Once per snapshot: a new value starts a change, and the frame loop runs only while one eases.
  $effect(() => {
    const now = performance.now();
    if (last !== null && value !== last && !reducedMotion()) {
      changes = [...running(changes, now), { at: now, delta: (value - last) / 100, after: cp }];
    } else if (reducedMotion()) {
      changes = [];
    }
    if (text !== lastText) {
      if (lastText !== '' && !reducedMotion() && last !== null && value !== last) {
        const key = untrack(() => roll.key) + 1;
        roll = { key, was: lastText, dir: value < last ? 'down' : 'up' };
      }
      lastText = text;
    }
    last = value;
    // `paint` reads `next` and the cap too: a new snapshot repaints the quantum and the scale.
    if (paint(now) && frame === 0) frame = requestAnimationFrame(loop);
  });

  $effect(() => {
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  });
</script>

<span class="gauge" class:short class:full>
  <span class="num">
    {#key roll.key}
      <span class="digits now {roll.key > 0 ? roll.dir : ''}">{text}</span>
      {#if roll.key > 0}
        <span class="digits was {roll.dir}" aria-hidden="true">{roll.was}</span>
      {/if}
    {/key}
  </span>
  <svg
    viewBox="0 0 {W + X * 2 + 14} {HEIGHT}"
    width={W + X * 2 + 14}
    height={HEIGHT}
    aria-hidden="true"
  >
    <defs>
      <!-- The next quantum, ruled in upright; the spent sliver, hatched at 45 degrees. -->
      <pattern id="cp-ruled" patternUnits="userSpaceOnUse" width="2.4" height="8">
        <rect width="1" height="8" class="own-fill" />
      </pattern>
      <pattern
        id="cp-spent"
        patternUnits="userSpaceOnUse"
        width="2.4"
        height="2.4"
        patternTransform="rotate(45)"
      >
        <rect width="1" height="2.4" class="own-fill" />
      </pattern>
    </defs>
    <!-- the scale -->
    <path class="casing-line" d="M{X - 1} {BASE}H{X + W + 1}" />
    <path class="ink-line" d="M{X} {BASE + 0.5}H{X + W}{ticks}" />
    <rect class="casing" x={X - 1} y={BASE - 9} width={W + 2} height="8" />
    {#each SLIVER_SLOTS as i (i)}
      <g class="sliver" visibility="hidden" bind:this={sliverEls[i]}>
        <rect y={BASE - 8} height="6" fill="url(#cp-spent)" />
        <rect class="sliver-rule" y={BASE - 7.6} height="5.2" />
      </g>
    {/each}
    <rect
      class="quantum"
      y={BASE - 8}
      height="6"
      width="0"
      fill="url(#cp-ruled)"
      bind:this={quantum}
    />
    <rect class="bar" x={X} y={BASE - 8} height="6" width="0" bind:this={bar} />
    <path
      class="notch"
      d="M0 {BASE - 10}L-4 {BASE - 16}H4Z"
      visibility="hidden"
      bind:this={notch}
    />
    <rect class="edge" y={BASE - 9} width="1.6" height="8" opacity="0" bind:this={edge} />
    <!-- At the cap: the engraved double frame, drawn in from its serifs (CSS). -->
    <g class="frame">
      <path class="frame-casing" pathLength="1" d={outerTop} />
      <path class="frame-casing" pathLength="1" d={outerBottom} />
      <path class="frame-outer" pathLength="1" d={outerTop} />
      <path class="frame-outer" pathLength="1" d={outerBottom} />
      <path class="frame-inner" pathLength="1" d={innerTop} />
      <path class="frame-inner" pathLength="1" d={innerBottom} />
      <rect
        class="serif left"
        x="-2.8"
        y="-2.8"
        width="5.6"
        height="5.6"
        transform="translate({L} {MID}) rotate(45)"
      />
      <rect
        class="serif right"
        x="-2.8"
        y="-2.8"
        width="5.6"
        height="5.6"
        transform="translate({R} {MID}) rotate(45)"
      />
    </g>
    <path class="needle" d="M0 {BASE - 1}L-4.5 {BASE + 7}H4.5Z" bind:this={needle} />
    {#if bracket !== null}
      {@const xa = X + unit * bracket.from}
      {@const xb = Math.max(X + unit * bracket.to, xa + 6)}
      {@const yb = BASE + 13}
      <path class="bracket-casing" d="M{xa} {yb - 3}V{yb}H{xb}V{yb - 3}" />
      <path class="bracket" class:short={bracket.short} d="M{xa} {yb - 3}V{yb}H{xb}V{yb - 3}" />
      {#if bracket.short}
        <!-- Short: a down chevron after the bracket (the shape tells it, not the red). -->
        <path class="chevron" d="M{xb + 4} {yb - 4}l4 4l4 -4" />
      {/if}
    {/if}
  </svg>
</span>

<style>
  .gauge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }

  .num {
    position: relative;
    display: inline-grid;
    min-width: 30px;
    height: 28px;
    overflow: hidden;
    color: var(--ink);
    font: 500 23px/28px var(--font-text);
    font-variant-numeric: lining-nums tabular-nums;
  }

  .short .num {
    color: var(--enemy);
  }

  .digits {
    grid-area: 1 / 1;
    white-space: nowrap;
  }

  /* A spend rolls the numeral down, an income up; the old one is gone by 60 %, the new inks in
     from 30 % (ui-style 57a). */
  .now.down {
    animation: roll-in-down var(--t-cp-roll) var(--ease-engrave) both;
  }

  .now.up {
    animation: roll-in-up var(--t-cp-roll) var(--ease-engrave) both;
  }

  .was.down {
    animation: roll-out-down var(--t-cp-roll) var(--ease-engrave) both;
  }

  .was.up {
    animation: roll-out-up var(--t-cp-roll) var(--ease-engrave) both;
  }

  @keyframes roll-in-down {
    0%,
    30% {
      transform: translateY(-13px);
      opacity: 0;
    }
    100% {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes roll-in-up {
    0%,
    30% {
      transform: translateY(13px);
      opacity: 0;
    }
    100% {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes roll-out-down {
    0% {
      transform: none;
      opacity: 1;
    }
    60%,
    100% {
      transform: translateY(13px);
      opacity: 0;
    }
  }

  @keyframes roll-out-up {
    0% {
      transform: none;
      opacity: 1;
    }
    60%,
    100% {
      transform: translateY(-13px);
      opacity: 0;
    }
  }

  svg {
    display: block;
    overflow: visible;
  }

  .own-fill {
    fill: var(--own);
  }

  .casing-line {
    stroke: var(--casing);
    stroke-width: 3;
    fill: none;
  }

  .ink-line {
    stroke: var(--ink);
    stroke-width: 1;
    fill: none;
  }

  .casing {
    fill: var(--casing);
  }

  .bar {
    fill: var(--own);
  }

  .short .bar {
    fill: var(--enemy);
  }

  .sliver-rule {
    fill: none;
    stroke: var(--ink);
    stroke-opacity: 0.8;
    stroke-width: 0.8;
  }

  .notch {
    fill: var(--plate);
    stroke: var(--ink);
    stroke-width: 1;
  }

  .edge {
    fill: var(--ink);
  }

  .needle {
    fill: var(--ink);
    stroke: var(--casing);
    stroke-width: 1;
  }

  .frame path {
    fill: none;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    stroke-linecap: butt;
    transition: stroke-dashoffset var(--t-cp-frame-out) var(--ease-engrave);
  }

  .frame-casing {
    stroke: var(--casing);
    stroke-width: 3;
  }

  .frame-outer {
    stroke: var(--ink);
    stroke-width: 1;
  }

  .frame-inner {
    stroke: var(--ink);
    stroke-width: 0.7;
  }

  .serif {
    fill: var(--ink);
    stroke: var(--casing);
    stroke-width: 1;
    opacity: 0;
    transition: opacity calc(var(--t-cp-frame-out) / 2) var(--ease-engrave);
  }

  /* At the cap the frame is drawn in a little after the income lands. */
  .full .frame path {
    stroke-dashoffset: 0;
    transition-duration: var(--t-cp-frame-in);
    transition-delay: 120ms;
  }

  .full .serif.left {
    opacity: 1;
    transition-duration: calc(var(--t-cp-frame-in) / 4);
    transition-delay: 120ms;
  }

  .full .serif.right {
    opacity: 1;
    transition-duration: calc(var(--t-cp-frame-in) * 0.15);
    transition-delay: calc(120ms + var(--t-cp-frame-in) * 0.85);
  }

  .bracket-casing {
    fill: none;
    stroke: var(--casing);
    stroke-width: 3.4;
  }

  .bracket {
    fill: none;
    stroke: var(--ink);
    stroke-width: 1.2;
  }

  .bracket.short,
  .chevron {
    stroke: var(--enemy);
  }

  .chevron {
    fill: none;
    stroke-width: 1.6;
    stroke-linejoin: miter;
  }

  /* The motion setting of the page (#871) decides, not the media query alone. */
  :global(:root[data-motion='reduced']) .digits {
    animation: none !important;
  }

  :global(:root[data-motion='reduced']) .was {
    display: none;
  }

  :global(:root[data-motion='reduced']) .frame path,
  :global(:root[data-motion='reduced']) .serif {
    transition: none !important;
  }
</style>
