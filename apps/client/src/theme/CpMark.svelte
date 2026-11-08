<script lang="ts">
  import { CP_MARK, cssColor, svgPoints } from './cpMark.ts';

  interface Props {
    /** Height and width in px; readable from 12 to 16 (the HUD, a price), larger for a title. */
    size?: number;
    /**
     * The name for assistive technology when the mark stands alone; without it the mark is
     * decorative and the element around it carries the words.
     */
    label?: string;
  }

  let { size = 14, label }: Props = $props();

  const box = CP_MARK.box;
  const points = CP_MARK.shapes.map(svgPoints);
</script>

<!-- The CP mark (#841, src/theme/cpMark.ts): a Roman standard, never the charge lozenge. -->
<svg
  class="cp-mark"
  viewBox="{box.x} {box.y} {box.width} {box.height}"
  width={size}
  height={size}
  role={label === undefined ? undefined : 'img'}
  aria-label={label}
  aria-hidden={label === undefined ? 'true' : undefined}
  focusable="false"
>
  <g
    fill="none"
    stroke={cssColor(CP_MARK.casing.color)}
    stroke-width={CP_MARK.casing.width}
    stroke-linejoin="miter"
  >
    {#each points as p, i (i)}
      <polygon points={p} />
    {/each}
  </g>
  <g fill={cssColor(CP_MARK.ink)}>
    {#each points as p, i (i)}
      <polygon points={p} />
    {/each}
  </g>
</svg>

<style>
  .cp-mark {
    flex: none;
    display: inline-block;
    overflow: visible;
    vertical-align: -0.15em;
  }
</style>
