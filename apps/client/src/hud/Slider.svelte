<script lang="ts">
  import { tick } from 'svelte';

  interface Props {
    value: number;
    min: number;
    max: number;
    step?: number;
    /** Accessible name (the visible caption is the caller's). */
    label: string;
    /** The thumb moves (every step). */
    oninput?: (value: number) => void;
    /** The thumb is released (a change). */
    onchange?: (value: number, input: HTMLInputElement) => void;
    /** Take the focus when the slider appears (a dialog whose first control it is). */
    focusOnMount?: boolean;
  }

  let {
    value,
    min,
    max,
    step = 1,
    label,
    oninput,
    onchange,
    focusOnMount = false,
  }: Props = $props();

  let input: HTMLInputElement | undefined = $state();

  $effect(() => {
    if (focusOnMount) void tick().then(() => input?.focus());
  });

  // The filled part of the track: the share of the range from the left, as a number for the CSS.
  const fraction = $derived(max > min ? (value - min) / (max - min) : 0);
</script>

<!-- The slider of the match (#597): a native range (keyboard, pointer, screen readers), drawn in the language of the menus. -->
<input
  class="slider"
  type="range"
  {min}
  {max}
  {step}
  {value}
  aria-label={label}
  style:--p={fraction}
  bind:this={input}
  oninput={(event) => {
    oninput?.(Number(event.currentTarget.value));
  }}
  onchange={(event) => {
    onchange?.(Number(event.currentTarget.value), event.currentTarget);
  }}
/>

<style>
  .slider {
    --thumb: 22px;
    --pos: calc(var(--thumb) / 2 + (100% - var(--thumb)) * var(--p));
    appearance: none;
    box-sizing: border-box;
    width: 100%;
    height: 28px;
    margin: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }

  /* The track: filled from the left up to the thumb, a lighter bed after it. */
  .slider::-webkit-slider-runnable-track {
    height: 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: linear-gradient(90deg, var(--you) var(--pos), var(--bg) var(--pos));
  }

  .slider::-moz-range-track {
    height: 8px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: linear-gradient(90deg, var(--you) var(--pos), var(--bg) var(--pos));
  }

  .slider::-webkit-slider-thumb {
    appearance: none;
    box-sizing: border-box;
    width: var(--thumb);
    height: var(--thumb);
    margin-top: calc((8px - var(--thumb)) / 2 - 1px);
    border: 2px solid var(--paper);
    border-radius: 50%;
    background: var(--you);
  }

  .slider::-moz-range-thumb {
    box-sizing: border-box;
    width: var(--thumb);
    height: var(--thumb);
    border: 2px solid var(--paper);
    border-radius: 50%;
    background: var(--you);
  }

  .slider:focus-visible {
    outline: none;
  }

  /* The focus is a ring around the thumb (the track is too thin to carry an outline). */
  .slider:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 3px var(--bg);
    outline: 2px solid var(--paper);
    outline-offset: 3px;
  }

  .slider:focus-visible::-moz-range-thumb {
    outline: 2px solid var(--paper);
    outline-offset: 3px;
  }

  .slider:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
</style>
