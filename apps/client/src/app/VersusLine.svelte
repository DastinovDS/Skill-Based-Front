<script lang="ts">
  import { t } from '../i18n/index.ts';
  import HelmetIcon from '../units/HelmetIcon.svelte';

  interface Props {
    you: string;
    /** The other seat; null: the empty seat of an invite ("a friend", the dashed helmet). */
    opponent: string | null;
    /** Helmet width in px. */
    size?: number;
    /** "Ready" after a seat: a lozenge and the word, never colour alone. */
    youReady?: boolean;
    opponentReady?: boolean;
  }

  let { you, opponent, size = 32, youReady = false, opponentReady = false }: Props = $props();
</script>

<!-- The versus line of the plinth (#919): the own helmet and nick, "against", the opponent and
     their helmet; an empty seat is "a friend" with a dashed helmet. -->
<div class="vs">
  <HelmetIcon side="own" {size} engraved />
  <span class="nm">{you}</span>
  {#if youReady}<span class="ok">{t('invite.seatReady')}</span>{/if}
  <span class="x">{t('versus.against')}</span>
  {#if opponent === null}
    <span class="x">{t('invite.aFriend')}</span>
    <HelmetIcon side="enemy" {size} engraved dashed />
  {:else}
    <span class="nm">{opponent}</span>
    <HelmetIcon side="enemy" {size} engraved />
    {#if opponentReady}<span class="ok">{t('invite.seatReady')}</span>{/if}
  {/if}
</div>

<style>
  .vs {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    font: 500 17px / 1.2 var(--font-display);
    letter-spacing: 0.12em;
    white-space: nowrap;
  }

  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .x {
    font: italic 400 17px var(--font-text);
    letter-spacing: 0;
    color: var(--ink-dim);
  }

  .vs :global(svg) {
    flex: none;
  }

  /* Ready: a filled lozenge and the word in cut capitals. */
  .ok {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-left: -4px;
    font: 500 11px / 1 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink);
  }

  .ok::before {
    content: '';
    width: 7px;
    height: 7px;
    background: var(--ink);
    transform: rotate(45deg);
  }
</style>
