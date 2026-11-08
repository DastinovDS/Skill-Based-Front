<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n/index.ts';

  interface Props {
    /** The tabs of the menu (#629, M5), between the brand and the corner. */
    tabs?: Snippet;
    /** The top right corner: the player. */
    corner?: Snippet;
  }

  let { tabs, corner }: Props = $props();
</script>

<!-- The top bar of the screens before a match (Lapis, #845): the brand in cut capitals, the tabs of
     the menu and the player in the corner, over an incised double rule. -->
<header class="top">
  <h1 class="mark">{t('app.title')}</h1>
  {#if tabs !== undefined}{@render tabs()}{/if}
  {#if corner !== undefined}
    <div class="corner">{@render corner()}</div>
  {/if}
</header>
