<script lang="ts">
  import { BAR_GLYPHS, type BarGlyphName } from './cutIcons.ts';

  interface Props {
    name: BarGlyphName;
    /** Side in px. */
    size?: number;
  }

  let { name, size = 15 }: Props = $props();
</script>

<!-- A glyph of the top bar (src/theme/cutIcons.ts): decorative, the button carries the name. -->
<svg
  class="bar-glyph"
  viewBox="0 0 16 16"
  width={size}
  height={size}
  aria-hidden="true"
  focusable="false"
>
  <path
    d={BAR_GLYPHS[name]}
    fill="none"
    stroke="currentColor"
    stroke-width="1.25"
    stroke-linecap="round"
  />
</svg>

<style>
  .bar-glyph {
    flex: none;
    display: block;
  }
</style>
