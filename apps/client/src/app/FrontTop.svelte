<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.ts';
  import HelmetIcon from '../units/HelmetIcon.svelte';
  import { unitLook } from '../units/unitStyleState.svelte.ts';

  interface Props {
    /** The tabs of the menu (#629, M5), between the mark and the corner. */
    tabs?: Snippet;
    /** The top right corner: the player chip. */
    corner?: Snippet;
  }

  let { tabs, corner }: Props = $props();
</script>

<!-- The top line of the screens before a match: the game's mark (an own unit, a dashed road, an
     enemy unit, in the unit look of the map), the tabs of the menu and the player in the corner. -->
<header class="top">
  <h1 class="mark">
    {#if unitLook.helmets}
      <!-- The unit look of the map (#784): an own helmet, a dashed road, an enemy helmet. -->
      <span class="mark-helmets" aria-hidden="true">
        <HelmetIcon side="own" size={24} />
        <svg width="14" height="26" viewBox="24 0 14 26" focusable="false">
          <path d="M25 13h12" class="mark-road" />
        </svg>
        <HelmetIcon side="enemy" size={24} />
      </span>
    {:else}
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
    {/if}
    {t('app.title')}
  </h1>
  {#if tabs !== undefined}{@render tabs()}{/if}
  {#if corner !== undefined}
    <div class="corner">{@render corner()}</div>
  {/if}
</header>
