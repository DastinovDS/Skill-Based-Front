<script lang="ts">
  import { t } from '../i18n/index.ts';
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
  }

  let { player, onhelp, helpHere = false, locked = false }: Props = $props();
</script>

<!-- The top bar of the screens before a match (#919, III Plinth): the brand in cut capitals, then
     on the right the "?" of How to play and the player, over an incised double rule. No tabs. -->
<header class="top">
  <h1 class="mark">{t('app.title')}</h1>
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
