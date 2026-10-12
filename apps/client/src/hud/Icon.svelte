<script lang="ts">
  import { ICONS, type IconName } from './icons.ts';

  interface Props {
    name: IconName;
    /** Side in px; the stroke scales with it. */
    size?: number;
  }

  let { name, size = 18 }: Props = $props();
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
  {#each ICONS[name] as shape, index (index)}
    {#if shape.tag === 'path'}
      <path d={shape.d} />
    {:else if shape.tag === 'circle'}
      <circle cx={shape.cx} cy={shape.cy} r={shape.r} />
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
