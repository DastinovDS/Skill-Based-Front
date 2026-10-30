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
    /** The opponent of a found pair: written on the map. */
    opponent?: string | null;
    /** Seconds in the queue: the scout of the search walks by it (#474). */
    waited?: number;
    /** The name of the rail for assistive technology. */
    label: string;
    /** The tabs of the menu at the top (#629, M5). */
    tabs?: Snippet;
    /** The top right corner: the player chip. */
    corner?: Snippet;
    /**
     * The entry screen (#629, N5 "Title"): no top line, the content stands in the middle over the
     * blurred map.
     */
    entry?: boolean;
    children: Snippet;
    /** The "Dock" panel beside the rail (#473): the rail keeps the menu, the mode opens here. */
    panel?: Snippet;
    /** The name of the panel for assistive technology. */
    panelLabel?: string;
  }

  let {
    map,
    phase = 'idle',
    opponent = null,
    waited = 0,
    label,
    tabs,
    corner,
    entry = false,
    children,
    panel,
    panelLabel = '',
  }: Props = $props();
</script>

<!-- One frame for the screens before a match (#471, variant A "Front"): the map is the postcard, a
     text rail stands on the left, the tabs of the menu and the player are on the top line. -->
<main class="front" class:docked={panel !== undefined} class:entry>
  <MenuBackdrop {map} {phase} {opponent} {waited} docked={panel !== undefined} />
  <div class="shade"></div>
  {#if !entry}<FrontTop {tabs} {corner} />{/if}
  <section class="rail" aria-label={label}>
    {@render children()}
  </section>
  {#if panel !== undefined}
    <section class="panel" aria-label={panelLabel}>
      {@render panel()}
    </section>
  {/if}
</main>
