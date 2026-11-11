<script lang="ts">
  import type { Way } from './play.ts';
  import { SIGN_LINE, WAY_SIGNS } from './waySigns.ts';

  interface Props {
    way: Way;
    /** Height in px. */
    height?: number;
  }

  let { way, height = 30 }: Props = $props();

  const sign = $derived(WAY_SIGNS[way]);
  const width = $derived((height * sign.box[2]) / sign.box[3]);
  // The ruled fill needs a pattern id of its own per sign on the page.
  const uid = $props.id();
  const rule = `way-sign-rule-${uid}`;
</script>

<!-- A plain sign of a way (#968, ui-style 74): decorative, the button around it carries the name. -->
<svg
  class="way-sign"
  data-way={way}
  viewBox={sign.box.join(' ')}
  {width}
  {height}
  aria-hidden="true"
  focusable="false"
>
  <defs>
    <pattern id={rule} patternUnits="userSpaceOnUse" width="2.6" height="2.6">
      <rect width="2.6" height="1.15" fill="currentColor" />
    </pattern>
  </defs>
  {#each sign.parts as p, i (i)}
    {#if p.ruled}
      <path d={p.d} fill="#0e0c09" fill-opacity="0.82" fill-rule="evenodd" />
      <path d={p.d} fill="url(#{rule})" fill-rule="evenodd" />
    {/if}
    <path
      d={p.d}
      fill="none"
      stroke="#060504"
      stroke-width={4.2 * SIGN_LINE * p.lw}
      stroke-opacity="0.9"
      stroke-linecap="square"
      stroke-linejoin="miter"
    />
    <path
      d={p.d}
      fill="none"
      stroke="currentColor"
      stroke-width={2.1 * SIGN_LINE * p.lw}
      stroke-linecap="square"
      stroke-linejoin="miter"
    />
  {/each}
</svg>

<style>
  .way-sign {
    flex: none;
    display: block;
    overflow: visible;
  }
</style>
