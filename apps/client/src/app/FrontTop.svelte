<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.ts';
  import HelmetIcon from '../units/HelmetIcon.svelte';

  interface Props {
    /** The tabs of the menu (#629, M5), between the mark and the corner. */
    tabs?: Snippet;
    /** The top right corner: the player chip. */
    corner?: Snippet;
  }

  let { tabs, corner }: Props = $props();
</script>

<!-- The top line of the screens before a match: the game's mark (an own unit, a dashed road, an
     enemy unit, as helmets like on the map), the tabs of the menu and the player in the corner. -->
<header class="top">
  <h1 class="mark">
    <!-- The units of the map (#784): an own helmet, a dashed road, an enemy helmet. -->
    <span class="mark-helmets" aria-hidden="true">
      <HelmetIcon side="own" size={24} />
      <svg width="14" height="26" viewBox="24 0 14 26" focusable="false">
        <path d="M25 13h12" class="mark-road" />
      </svg>
      <HelmetIcon side="enemy" size={24} />
    </span>
    {t('app.title')}
  </h1>
  {#if tabs !== undefined}{@render tabs()}{/if}
  {#if corner !== undefined}
    <div class="corner">{@render corner()}</div>
  {/if}
</header>
