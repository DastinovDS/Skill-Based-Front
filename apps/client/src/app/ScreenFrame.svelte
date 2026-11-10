<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { MapFile } from '../protocol.gen.ts';
  import FrontTop from './FrontTop.svelte';
  import MenuBackdrop from './MenuBackdrop.svelte';
  import type { BackdropPhase } from './menuScene.ts';

  interface Props {
    /** The pool map drawn behind the rail; `null` keeps the plain dark page. */
    map: MapFile | null;
    phase?: BackdropPhase;
    /** The name of the rail for assistive technology. */
    label: string;
    /**
     * The entry screen (#629, N5 "Title"): no top line, the content stands in the middle over the
     * blurred map.
     */
    entry?: boolean;
    /** The content takes the width of the page under the bar (the result). */
    wide?: boolean;
    children: Snippet;
  }

  let { map, phase = 'idle', label, entry = false, wide = false, children }: Props = $props();
</script>

<!-- The frame of the entry, the boot, the result and the replay's loading (#471; Lapis, #845): the
     map behind, the bar with the brand on top, the rail of text on the left. The main screen has its
     own frame (`PlayScreen`, #919), the pages theirs (`board/SheetFrame`). -->
<main class="front" class:entry class:wide>
  <MenuBackdrop {map} {phase} {entry} />
  <div class="shade"></div>
  {#if !entry}<FrontTop />{/if}
  <section class="rail" aria-label={label}>
    {@render children()}
  </section>
</main>
