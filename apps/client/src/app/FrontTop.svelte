<script lang="ts">
  import { getContext } from 'svelte';
  import { t } from '../i18n/index.ts';
  import { HOME_KEY, type HomeGetter } from './home.ts';
  import type { TopPlayer } from './play.ts';

  interface Props {
    /** The player on the right; absent: the brand alone (the result, the replay's loading). */
    player?: TopPlayer;
    /** The "?" that opens How to play; absent: no "?". */
    onhelp?: () => void;
    /** The How to play page is open: the "?" is marked and opens nothing. */
    helpHere?: boolean;
    /** A waiting room or a search: leaving would drop it, the bar shows the player but opens nothing. */
    locked?: boolean;
    /** The name of the page in the middle of the bar (the tutorial's chapter select, #806). */
    title?: string;
  }

  let { player, onhelp, helpHere = false, locked = false, title }: Props = $props();

  // The brand is always the same control (#945, owner 2026-11-11): it goes to the main screen where
  // the app allows leaving for it, and does nothing on the main screen, in a locked bar and in the
  // boot (no reload: that would drop a running search or an invite being drawn).
  const homeOf = getContext<HomeGetter | undefined>(HOME_KEY);
  const goesHome = $derived(locked ? null : (homeOf?.() ?? null));
  // No way home: this is the main screen (or the boot, or a locked search): marked as the current page.
  const here = $derived(goesHome === null);
  function goHome(): void {
    goesHome?.();
  }
</script>

<!-- The top bar of the screens before a match (#919, III Plinth): the brand in cut capitals, then
     on the right the "?" of How to play and the player, over an incised double rule. No tabs. -->
<header class="top">
  <h1 class="mark">
    <button
      type="button"
      class="home"
      aria-label={t('top.home')}
      aria-current={here ? 'page' : undefined}
      onclick={goHome}>{t('app.title')}</button
    >
  </h1>
  {#if title !== undefined}
    <p class="page-title">{title}</p>
  {/if}
  {#if player !== undefined || onhelp !== undefined}
    <div class="corner">
      {#if onhelp !== undefined}
        <button
          type="button"
          class="qm"
          class:on={helpHere}
          aria-label={t('help.howTo')}
          aria-current={helpHere ? 'page' : undefined}
          disabled={locked}
          onclick={helpHere ? undefined : onhelp}>?</button
        >
      {/if}
      {#if player !== undefined}
        <button
          type="button"
          class="who"
          class:on={player.here === true}
          aria-current={player.here === true ? 'page' : undefined}
          disabled={locked}
          onclick={player.here === true ? undefined : player.onprofile}
        >
          <b class="nick">{player.nick}</b>
          {#if player.guest}<span class="st">{t('menu.guest')}</span>{/if}
        </button>
      {/if}
    </div>
  {/if}
</header>
