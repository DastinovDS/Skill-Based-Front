<script lang="ts">
  import type { CharterSeat } from '../../tutorial/progress.ts';
  import { EMBLEM, star } from './charterArt.ts';

  interface Props {
    seat: CharterSeat;
    /** Its middle on the seal (the seal's centre is the origin). */
    y: number;
    size: number;
    tone: 'ink' | 'dim' | 'dark' | 'minium';
    stroke: number;
  }

  let { seat, y, size, tone, stroke }: Props = $props();
  const kk = $derived(size / 24);
</script>

<!-- The emblem of a seal: the chapter's menu icon, or the enemy star of the first match. -->
{#if seat === 'match'}
  <path d={star(0, y, size * 0.44, size * 0.19)} class="fill {tone}" />
{:else}
  <g
    transform="translate({-12 * kk} {y - 12 * kk}) scale({kk})"
    class="line {tone}"
    stroke-width={stroke}
  >
    {#each EMBLEM[seat] as d, i (i)}
      <path {d} />
    {/each}
  </g>
{/if}

<style>
  .line {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .line.ink {
    stroke: var(--ink);
  }

  .line.dim {
    stroke: #736a5a;
  }

  .line.dark {
    stroke: #16130f;
  }

  .line.minium {
    stroke: var(--enemy);
  }

  .fill.ink {
    fill: var(--ink);
  }

  .fill.minium {
    fill: var(--enemy);
  }

  .fill.dark {
    fill: #16130f;
  }

  .fill.dim {
    fill: #736a5a;
  }
</style>
