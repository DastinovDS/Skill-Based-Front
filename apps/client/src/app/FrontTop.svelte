<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.ts';

  interface Props {
    /** The tabs of the menu (#629, M5), between the mark and the corner. */
    tabs?: Snippet;
    /** The top right corner: the player chip. */
    corner?: Snippet;
  }

  let { tabs, corner }: Props = $props();
</script>

<!-- The top line of the screens before a match: the game's mark (an own triangle, a dashed road,
     an enemy triangle), the tabs of the menu and the player in the corner. -->
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
  {#if tabs !== undefined}{@render tabs()}{/if}
  {#if corner !== undefined}
    <div class="corner">{@render corner()}</div>
  {/if}
</header>
