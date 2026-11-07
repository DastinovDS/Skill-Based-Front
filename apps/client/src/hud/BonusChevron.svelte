<script lang="ts">
  /**
   * The sign of a bonus in the HTML interface (#797): the green chevron up of the advantage badge
   * (#791, ui-style 45) on its dark outline, the same shape as on the map and in the arena. A
   * hollow one (`hollow`) is a point still asked for: a light contour with a dark inside, so filled
   * and hollow differ by shape, not by colour alone (AGENTS.md 7.4). Decorative: the text beside it
   * says the number.
   */
  interface Props {
    /** Width in px; the height follows the badge's proportions. */
    size?: number;
    hollow?: boolean;
  }

  let { size = 14, hollow = false }: Props = $props();
</script>

<svg
  class="chevron"
  class:hollow
  viewBox="0 0 14 10"
  width={size}
  height={Math.round((size * 10) / 14)}
  aria-hidden="true"
  focusable="false"
>
  <path d="M2.5 7.5 7 3l4.5 4.5" class="out" />
  <path d="M2.5 7.5 7 3l4.5 4.5" class="in" />
</svg>

<style>
  .chevron {
    flex: none;
    vertical-align: -1px;
  }

  path {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .out {
    stroke: var(--bg);
    stroke-width: 4.6;
  }

  .in {
    stroke: var(--badge-up);
    stroke-width: 2.2;
  }

  /* Still asked for: a light contour, dark inside. */
  .hollow .out {
    stroke: var(--paper);
    stroke-width: 3.8;
  }

  .hollow .in {
    stroke: var(--bg);
    stroke-width: 1.8;
  }
</style>
