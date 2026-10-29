<script lang="ts">
  interface Props {
    /** Whose triangle: the player's (blue) or the opponent's (red, with the inner outline). */
    side: 'own' | 'enemy';
    /** Width in px. */
    size?: number;
    /** The share of the triangle filled from the tip: charged units (ui-style 9.5). */
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
