<script lang="ts">
  import type { Snippet } from 'svelte';
  import FrontTop from '../app/FrontTop.svelte';
  import MenuBackdrop from '../app/MenuBackdrop.svelte';
  import type { TopPlayer } from '../app/play.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import './sheet.css';

  interface Props {
    /** The pool map drawn behind the sheet, dimmed; `null` keeps the plain dark page. */
    map: MapFile | null;
    /** The name of the sheet for assistive technology. */
    label: string;
    /** The player in the bar (the nick opens the profile) and the "?" of How to play (#919). */
    player: TopPlayer;
    onhelp: () => void;
    /** This sheet is How to play: the "?" is marked. */
    helpHere?: boolean;
    /** A dialog of the sheet (the nick change, the log-out warning): over the bar too. */
    overlay?: Snippet;
    children: Snippet;
  }

  let { map, label, player, onhelp, helpHere = false, overlay, children }: Props = $props();
</script>

<!-- The frame of the pages (#919): the profile, the settings, How to play and the password. The bar
     on top, one wide sheet under it on the blurred stone over the map (ui-style 51). -->
<main class="front sheet">
  <MenuBackdrop {map} phase="idle" />
  <div class="shade"></div>
  <FrontTop {player} {onhelp} {helpHere} />
  <section class="body" aria-label={label}>
    {@render children()}
  </section>
  {#if overlay !== undefined}{@render overlay()}{/if}
</main>
