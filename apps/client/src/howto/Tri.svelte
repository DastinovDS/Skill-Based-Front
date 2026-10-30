<script lang="ts">
  interface Props {
    /** Whose unit: the attacker (blue, one outline) or the defender (red, a double outline). */
    side: 'own' | 'enemy';
    /** Charged: filled. Empty: outline only. Gone: dashed, the unit fell. */
    cell: 'charged' | 'empty' | 'gone';
  }

  let { side, cell }: Props = $props();

  const TRI = 'M2 2h18l-9 15.5z';
  const INNER = 'M6.5 4.8h9l-4.5 7.8z';
</script>

<svg class="tri" viewBox="0 0 22 20" width="22" height="20" aria-hidden="true" focusable="false">
  {#if cell === 'gone'}
    <path d={TRI} class="gone" />
  {:else}
    <path d={TRI} class="back" />
    {#if cell === 'charged'}
      <path d={TRI} class={side} />
    {/if}
    <path d={TRI} class="rim" />
    {#if side === 'enemy'}<path d={INNER} class="inner" />{/if}
  {/if}
</svg>

<style>
  .tri {
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
    stroke-width: 1.6;
    stroke-linejoin: round;
  }

  .inner {
    fill: none;
    stroke: var(--bg);
    stroke-width: 1.3;
    stroke-linejoin: round;
  }

  .gone {
    fill: none;
    stroke: var(--text-dim);
    stroke-width: 1.4;
    stroke-dasharray: 3 2.5;
    stroke-linejoin: round;
  }
</style>
