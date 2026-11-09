<script lang="ts">
  import { CUT_ICONS, CUT_SOLIDS, type CutIconName } from './cutIcons.ts';

  interface Props {
    name: CutIconName;
    /** Side in px. */
    size?: number;
  }

  let { name, size = 24 }: Props = $props();

  const d = $derived(CUT_ICONS[name]);
  const solid = $derived(CUT_SOLIDS[name] ?? null);
  // The ruled fill needs a pattern id of its own per icon on the page.
  const uid = $props.id();
  const id = `cut-icon-rule-${uid}`;
</script>

<!-- A "Cut" icon (src/theme/cutIcons.ts): decorative, the control around it carries the name. -->
<svg
  class="cut-icon"
  viewBox="-13 -13 26 26"
  width={size}
  height={size}
  aria-hidden="true"
  focusable="false"
>
  {#if solid !== null}
    <defs>
      <pattern {id} patternUnits="userSpaceOnUse" width="2.6" height="2.6">
        <rect width="2.6" height="1.15" fill="currentColor" />
      </pattern>
    </defs>
    <path d={solid} fill="url(#{id})" />
  {/if}
  <path
    {d}
    fill="none"
    stroke="#060504"
    stroke-width="4.2"
    stroke-linecap="square"
    stroke-linejoin="miter"
    opacity="0.9"
  />
  <path
    {d}
    fill="none"
    stroke="currentColor"
    stroke-width="2.1"
    stroke-linecap="square"
    stroke-linejoin="miter"
  />
</svg>

<style>
  .cut-icon {
    flex: none;
    display: block;
    overflow: visible;
  }
</style>
