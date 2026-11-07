<script lang="ts">
  import HelmetIcon from '../units/HelmetIcon.svelte';
  import { unitLook } from '../units/unitStyleState.svelte.ts';

  interface Props {
    /** Whose unit: the player's (blue) or the opponent's (red: the inner outline, or the other helmet facing left). */
    side: 'own' | 'enemy';
    /** Width in px. */
    size?: number;
    /** The share filled: charged units (ui-style 9.5; a helmet fills from the bottom, #784). */
    share?: number;
  }

  let { side, size = 40, share = 1 }: Props = $props();

  // An inverted triangle, filled from the tip by the share (the area, so the root).
  const pad = 4;
  const h = $derived(size * 0.866);
  const tip = $derived({ x: pad + size / 2, y: pad + h });
  function points(fraction: number): string {
    const top = tip.y - fraction * h;
    const half = (fraction * size) / 2;
    return `${(tip.x - half).toFixed(1)},${top.toFixed(1)} ${(tip.x + half).toFixed(1)},${top.toFixed(1)} ${tip.x.toFixed(1)},${tip.y.toFixed(1)}`;
  }
</script>

{#if unitLook.helmets}
  <!-- The unit look of the map (#784): a helmet, filled from the bottom by the share. -->
  <HelmetIcon {side} size={size + 8} {share} />
{:else}
  <svg
    class="unit-mark"
    width={size + pad * 2}
    height={h + pad * 2}
    viewBox={`0 0 ${String(size + pad * 2)} ${String(h + pad * 2)}`}
    aria-hidden="true"
    focusable="false"
  >
    <polygon points={points(1)} class="back" />
    <polygon points={points(Math.sqrt(share))} class={side} />
    <polygon points={points(1)} class="rim" />
    {#if side === 'enemy'}
      <polygon points={points(0.62)} class="inner" />
    {/if}
  </svg>
{/if}

<style>
  .unit-mark {
    flex: none;
    overflow: visible;
  }
  .back {
    fill: #161b22;
  }
  .own {
    fill: var(--you);
  }
  .enemy {
    fill: var(--enemy);
  }
  .rim {
    fill: none;
    stroke: var(--paper);
    stroke-width: 2.4;
    stroke-linejoin: round;
  }
  .inner {
    fill: none;
    stroke: var(--bg);
    stroke-width: 2;
    stroke-linejoin: round;
  }
</style>
