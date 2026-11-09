<script lang="ts">
  interface Props {
    /** Side in px. */
    size?: number;
  }

  let { size = 15 }: Props = $props();
</script>

<!-- The alert sign (ui-style 54q): an amber lozenge with an ink stroke and point. Decorative. -->
<svg class="warn-sign" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
  <path class="lozenge" d="M8 1 15 8 8 15 1 8z" />
  <path class="bang" d="M8 4.8v4.2M8 10.9v.6" />
</svg>

<style>
  .warn-sign {
    flex: none;
    display: block;
  }

  .lozenge {
    fill: var(--warn);
    stroke: var(--casing);
    stroke-width: 1;
  }

  .bang {
    fill: none;
    stroke: #16130f;
    stroke-width: 1.8;
    stroke-linecap: round;
  }
</style>
