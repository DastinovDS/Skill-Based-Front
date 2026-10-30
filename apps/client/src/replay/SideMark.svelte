<script lang="ts">
  interface Props {
    /** The viewing side (blue, a single outline) or the other one (red, a double outline). */
    side: 'own' | 'enemy';
    /** Width in px; the triangle is 8:7. */
    size?: number;
  }

  let { side, size = 16 }: Props = $props();
</script>

<!-- The triangle of the match top bar: the side is the colour plus the outline, never colour alone. -->
<svg
  class="side-mark"
  viewBox="0 0 16 14"
  width={size}
  height={(size * 14) / 16}
  aria-hidden="true"
  focusable="false"
>
  {#if side === 'own'}
    <path d="M1.5 1.5h13L8 12.5z" class="one" />
  {:else}
    <path d="M1.5 1.5h13L8 12.5z" class="two-outer" />
    <path d="M4.6 3.6h6.8L8 9.6z" class="two-inner" />
  {/if}
</svg>

<style>
  .side-mark {
    flex: none;
  }

  .one {
    fill: var(--you);
    stroke: var(--paper);
    stroke-width: 1.4;
    stroke-linejoin: round;
  }

  .two-outer {
    fill: var(--enemy);
    stroke: var(--paper);
    stroke-width: 1.4;
    stroke-linejoin: round;
  }

  .two-inner {
    fill: none;
    stroke: var(--bg);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }
</style>
