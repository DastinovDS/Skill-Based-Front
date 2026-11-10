<script lang="ts">
  import { untrack } from 'svelte';
  import { reducedMotion } from '../render/motion.ts';

  interface Props {
    /** The figure as the page writes it; a change rolls the old one out and the new one in. */
    text: string;
    /** Up: the new one comes from below (a gain); down: from above. */
    dir?: 'up' | 'down';
    /** The roll waits this long after the change, ms (the VP totals wait for their gains). */
    delayMs?: number;
    /** How far the figures travel, px (about half the size of the type). */
    travel?: number;
  }

  let { text, dir = 'up', delayMs = 0, travel = 13 }: Props = $props();

  // The numeral roll of the CP gauge (ui-style 57a): the old one gone by 60 % of it, the new one
  // inked in from 30 %, easeInOutSine over `--t-cp-roll`. The first figure does not roll.
  let roll = $state<{ readonly key: number; readonly was: string }>({ key: 0, was: '' });
  let last: string | null = null;

  $effect(() => {
    const now = text;
    if (last !== null && now !== last && !reducedMotion()) {
      roll = { key: untrack(() => roll.key) + 1, was: last };
    }
    last = now;
  });
</script>

<span class="roll {dir}" style:--roll-travel="{travel}px" style:--roll-delay="{delayMs}ms">
  {#key roll.key}
    <span class="digits now" class:rolling={roll.key > 0}>{text}</span>
    {#if roll.key > 0}
      <span class="digits was rolling" aria-hidden="true">{roll.was}</span>
    {/if}
  {/key}
</span>

<style>
  .roll {
    position: relative;
    display: inline-grid;
    overflow: hidden;
    vertical-align: top;
  }

  .digits {
    grid-area: 1 / 1;
    white-space: nowrap;
  }

  .up .now.rolling {
    animation: in-up var(--t-cp-roll) var(--ease-engrave) var(--roll-delay) both;
  }

  .up .was.rolling {
    animation: out-up var(--t-cp-roll) var(--ease-engrave) var(--roll-delay) both;
  }

  .down .now.rolling {
    animation: in-down var(--t-cp-roll) var(--ease-engrave) var(--roll-delay) both;
  }

  .down .was.rolling {
    animation: out-down var(--t-cp-roll) var(--ease-engrave) var(--roll-delay) both;
  }

  @keyframes in-up {
    0%,
    30% {
      transform: translateY(var(--roll-travel));
      opacity: 0;
    }
    100% {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes out-up {
    0% {
      transform: none;
      opacity: 1;
    }
    60%,
    100% {
      transform: translateY(calc(-1 * var(--roll-travel)));
      opacity: 0;
    }
  }

  @keyframes in-down {
    0%,
    30% {
      transform: translateY(calc(-1 * var(--roll-travel)));
      opacity: 0;
    }
    100% {
      transform: none;
      opacity: 1;
    }
  }

  @keyframes out-down {
    0% {
      transform: none;
      opacity: 1;
    }
    60%,
    100% {
      transform: translateY(var(--roll-travel));
      opacity: 0;
    }
  }

  :global(:root[data-motion='reduced']) .digits {
    animation: none !important;
  }

  :global(:root[data-motion='reduced']) .was {
    display: none;
  }
</style>
