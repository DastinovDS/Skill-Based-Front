<script lang="ts">
  import Icon from '../hud/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import UnitMark from './UnitMark.svelte';

  interface Props {
    /** The nick (or the bot) in the seat, or null while the seat is empty. */
    opponent: string | null;
    /** The own nick; without it the seat says "You". */
    you?: string | null;
    /** `null`: no ready state is shown (the seat is empty, or a bot match is starting). */
    youReady?: boolean | null;
    opponentReady?: boolean | null;
  }

  let { opponent, you = null, youReady = null, opponentReady = null }: Props = $props();
</script>

<!-- The two seats (Lapis, #845): a helmet, the nick in cut capitals, the state in italics and who
     sits there. "Ready" is a check and the word, never colour alone; an empty seat is a dashed
     helmet and "Waiting". -->
<div class="vs">
  <div class="sd">
    <UnitMark side="own" size={36} />
    <span class="sn">{you ?? t('invite.you')}</span>
    {#if youReady !== null}
      <small class:y={youReady}
        >{#if youReady}<Icon name="check" size={15} />{/if}{youReady
          ? t('invite.seatReady')
          : t('invite.seatNotReady')}</small
      >
    {:else}
      <small></small>
    {/if}
    <p class="sw">{t('invite.you')}</p>
  </div>
  <span class="seatx">{t('versus.against')}</span>
  <div class="sd">
    {#if opponent === null}
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true" focusable="false">
        <path class="seat-empty" d="M5 30 C5 14 14 7 24 7 C34 7 40 15 40 30 L40 33 L5 33 Z" />
      </svg>
    {:else}
      <UnitMark side="enemy" size={36} />
    {/if}
    <span class="sn">{opponent ?? t('invite.seatWaiting')}</span>
    {#if opponent !== null && opponentReady !== null}
      <small class:y={opponentReady}
        >{#if opponentReady}<Icon name="check" size={15} />{/if}{opponentReady
          ? t('invite.seatReady')
          : t('invite.seatNotReady')}</small
      >
    {:else if opponent === null}
      <small><span class="busy" aria-hidden="true"><i></i><i></i><i></i></span></small>
    {:else}
      <small></small>
    {/if}
    <p class="sw">{t('invite.opponent')}</p>
  </div>
</div>
