<script lang="ts">
  import { t } from '../i18n/index.ts';
  import UnitMark from './UnitMark.svelte';

  interface Props {
    /** The nick (or the bot) in the seat, or null while the seat is empty. */
    opponent: string | null;
    /** `null`: no ready state is shown (the seat is empty, or a bot match is starting). */
    youReady?: boolean | null;
    opponentReady?: boolean | null;
  }

  let { opponent, youReady = null, opponentReady = null }: Props = $props();

  const both = $derived(youReady === true && opponentReady === true);
</script>

<!-- You, a road, the seat: a dashed marching road while the seat is empty, a dotted one once
     somebody sits there, a solid one when both are ready. "Ready" is a filled or a hollow dot
     with the word, never colour alone. -->
<div class="vs">
  <div class="sd">
    <UnitMark side="own" size={40} />
    <b>{t('invite.you')}</b>
    {#if youReady !== null}
      <small class:y={youReady}
        ><i></i>{youReady ? t('invite.seatReady') : t('invite.seatNotReady')}</small
      >
    {:else}
      <small></small>
    {/if}
  </div>
  <div class="rdw">
    <svg height="28" width="100%" aria-hidden="true" focusable="false">
      <line
        x1="0"
        y1="14"
        x2="100%"
        y2="14"
        class={opponent === null ? 'vs-road wait' : both ? 'vs-road both' : 'vs-road near'}
      />
    </svg>
  </div>
  <div class="sd">
    {#if opponent === null}
      <svg
        class="seat"
        width="48"
        height="44"
        viewBox="0 0 48 44"
        aria-hidden="true"
        focusable="false"
      >
        <polygon points="4,4 44,4 24,39" class="ghost" />
        <text x="24" y="19.5" text-anchor="middle" class="ghost-q">?</text>
      </svg>
    {:else}
      <UnitMark side="enemy" size={40} />
    {/if}
    <b>{opponent ?? t('invite.seatWaiting')}</b>
    {#if opponent !== null && opponentReady !== null}
      <small class:y={opponentReady}
        ><i></i>{opponentReady ? t('invite.seatReady') : t('invite.seatNotReady')}</small
      >
    {:else}
      <small></small>
    {/if}
  </div>
</div>
