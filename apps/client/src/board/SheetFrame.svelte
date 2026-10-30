<script lang="ts">
  import type { Snippet } from 'svelte';
  import FrontTop from '../app/FrontTop.svelte';
  import MenuBackdrop from '../app/MenuBackdrop.svelte';
  import type { MapFile } from '../protocol.gen.ts';
  import '../app/dock.css';
  import './sheet.css';

  interface Props {
    /** The pool map drawn behind the sheet, dimmed; `null` keeps the plain dark page. */
    map: MapFile | null;
    /** The name of the sheet for assistive technology. */
    label: string;
    tabs: Snippet;
    /** The top right corner: the player chip. */
    corner?: Snippet;
    children: Snippet;
  }

  let { map, label, tabs, corner, children }: Props = $props();
</script>

<!-- The frame of the Replays and Leaderboard tabs (#629, R2 and L10): the tabs on top, one wide
     sheet under them on the dimmed map, no rail. -->
<main class="front sheet">
  <MenuBackdrop {map} phase="idle" />
  <div class="shade"></div>
  <FrontTop {tabs} {corner} />
  <section class="body" aria-label={label}>
    {@render children()}
  </section>
</main>
