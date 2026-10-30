<script lang="ts">
  import { rasterOf, shapesOf, type AnyIconName } from './icons.ts';

  interface Props {
    name: AnyIconName;
    /** Side in px; the stroke scales with it. */
    size?: number;
  }

  let { name, size = 18 }: Props = $props();

  const raster = $derived(rasterOf(name));
</script>

<!-- Decorative: the button around it carries the name (aria-label or text). -->
<svg
  class="icon"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  focusable="false"
>
  {#if raster !== null}
    <!-- A raster icon (the city menu, #627): its own colours, not `currentColor`. -->
    <image href={raster} x="0" y="0" width="24" height="24" />
  {/if}
  {#each shapesOf(name) as shape, index (index)}
    {#if shape.tag === 'path'}
      <path d={shape.d} />
    {:else if shape.tag === 'circle'}
      <circle cx={shape.cx} cy={shape.cy} r={shape.r} />
    {:else if shape.tag === 'text'}
      <!-- A digit in a flag: filled, drawn with the font of the page. -->
      <text
        x={shape.x}
        y={shape.y}
        font-size={shape.size}
        font-weight="800"
        text-anchor="middle"
        dominant-baseline="central"
        fill="currentColor"
        stroke="none">{shape.content}</text
      >
    {:else}
      <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />
    {/if}
  {/each}
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
