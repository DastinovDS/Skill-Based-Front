<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
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
    /** The top right corner: the player chip. */
    corner?: Snippet;
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
    corner,
    children,
    panel,
    panelLabel = '',
  }: Props = $props();
</script>

<!-- One frame for the screens before a match (#471, variant A "Front"): the map is the postcard, a
     text rail stands on the left, the player sits in the top right corner. The shapes are the
     game's own: an own triangle, a dashed road, an enemy triangle. -->
<main class="front" class:docked={panel !== undefined}>
  <MenuBackdrop {map} {phase} {opponent} {waited} docked={panel !== undefined} />
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
  <section class="rail" aria-label={label}>
    {@render children()}
  </section>
  {#if panel !== undefined}
    <section class="panel" aria-label={panelLabel}>
      {@render panel()}
    </section>
  {/if}
  <p class="tag">{t('menu.tagline')}</p>
</main>
