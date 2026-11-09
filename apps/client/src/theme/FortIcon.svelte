<script lang="ts">
  import { fortIconFor } from './fortIcon.ts';

  interface Props {
    /** Side in px: drawn on its own grid at 16, 24 and 32 (the nearest larger one between). */
    size?: number;
  }

  let { size = 24 }: Props = $props();

  const spec = $derived(fortIconFor(size));
  const wall = $derived(`${spec.left} ${spec.right}`);
  // The ruled fill needs a pattern id of its own per icon on the page.
  const uid = $props.id();
  const id = `fort-icon-rule-${uid}`;
</script>

<!-- The fortify icon (#858, src/theme/fortIcon.ts): the wall on the road. Decorative: the button around it carries the name. -->
<svg
  class="fort-icon"
  viewBox="0 0 {spec.grid} {spec.grid}"
  width={size}
  height={size}
  shape-rendering="crispEdges"
  aria-hidden="true"
  focusable="false"
>
  <defs>
    <pattern {id} patternUnits="userSpaceOnUse" width={spec.pitch} height={spec.pitch}>
      <rect width={spec.pitch} height="1" fill="currentColor" />
    </pattern>
  </defs>
  <path d={wall} fill="url(#{id})" />
  <path d={spec.road} stroke="#060504" stroke-width={spec.roadWidth + 2} fill="none" />
  <path d={wall} fill="none" stroke="#060504" stroke-width={spec.casing} stroke-linejoin="miter" />
  <path d={spec.road} stroke="currentColor" stroke-width={spec.roadWidth} fill="none" />
  <path
    d={wall}
    fill="none"
    stroke="currentColor"
    stroke-width={spec.ink}
    stroke-linejoin="miter"
  />
</svg>

<style>
  .fort-icon {
    flex: none;
    display: block;
    overflow: visible;
  }
</style>
