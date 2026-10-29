<script lang="ts">
  import type { Snippet } from 'svelte';
  import MenuBackdrop from '../app/MenuBackdrop.svelte';
  import { t } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import './split.css';

  interface Props {
    /** The pool map drawn behind the panes; `null` keeps the plain dark page. */
    map: MapFile | null;
    /** The name of the rail for assistive technology. */
    label: string;
    /** The top right corner: the player chip. */
    corner?: Snippet;
    /** The small text rail: the way back and the rows of the menu. */
    rail: Snippet;
    /** The two panes: the list and the profile. */
    panes: Snippet;
  }

  let { map, label, corner, rail, panes }: Props = $props();
</script>

<!-- The frame of the start screens (`.front`, #471) with two panes instead of the one of the Dock
     (variant S "Split", #78): the list of players and the profile of the chosen one. -->
<main class="front split">
  <MenuBackdrop {map} phase="idle" />
  <div class="shade"></div>
  <header class="top">
    <h1 class="mark">
      <svg width="64" height="26" viewBox="0 0 64 26" aria-hidden="true" focusable="false">
        <polygon
          points="3,3 21,3 12,19.6"
          class="mark-you"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
        <path d="M26 11h12" class="mark-road" />
        <polygon
          points="43,3 61,3 52,19.6"
          class="mark-enemy"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
        <polygon points="47.5,5.6 56.5,5.6 52,13.4" class="mark-hole" stroke-linejoin="round" />
      </svg>
      {t('app.title')}
    </h1>
    {#if corner !== undefined}
      <div class="corner">{@render corner()}</div>
    {/if}
  </header>
  <nav class="rail" aria-label={label}>
    {@render rail()}
  </nav>
  <div class="panes">
    {@render panes()}
  </div>
</main>
