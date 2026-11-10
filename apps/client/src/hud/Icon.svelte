<script lang="ts">
  import CutIcon from '../theme/CutIcon.svelte';
  import { cutIconOf } from '../theme/cutIcons.ts';
  import FortIcon from '../theme/FortIcon.svelte';
  import { rasterOf, shapesOf, type AnyIconName } from './icons.ts';

  interface Props {
    name: AnyIconName;
    /** Side in px; the stroke scales with it. */
    size?: number;
    /** The Engraved "Cut" drawing of the in-match interface where the icon has one (ui-style 54g). */
    cut?: boolean;
  }

  let { name, size = 18, cut = false }: Props = $props();

  const raster = $derived(rasterOf(name));
  const cutName = $derived(cut ? cutIconOf(name) : null);
</script>

<!-- Decorative: the button around it carries the name (aria-label or text). -->
{#if name === 'fortify'}
  <!-- The wall on the road, drawn per size (#858, src/theme/fortIcon.ts). -->
  <FortIcon {size} />
{:else if cutName !== null}
  <CutIcon name={cutName} {size} />
{:else}
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
      {:else}
        <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} rx={shape.rx} />
      {/if}
    {/each}
  </svg>
{/if}

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
