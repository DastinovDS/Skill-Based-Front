<script lang="ts">
  import type { ReplayLinkState } from '../api/http.ts';
  import { t, tf } from '../i18n/index.ts';

  interface Props {
    /** What the server says about the replay of this match (`replay.state`). */
    state: ReplayLinkState;
    /** The opponent, for the name of the button. */
    opponent: string;
    onwatch: () => void;
  }

  let { state, opponent, onwatch }: Props = $props();
</script>

<!-- One mark per state (Lapis, #845): Watch is a quiet button; the other states are words in
     italics (Preparing with its waiting dots), never colour alone. Only `ready` opens the viewer: the
     server decides what can be watched (AGENTS.md, section 7.1). -->
{#if state === 'ready'}
  <button
    type="button"
    class="watch lapis-btn secondary sm"
    aria-label={tf('history.replay.watchAria', { opponent })}
    onclick={onwatch}
  >
    {t('history.replay.watch')}
  </button>
{:else if state === 'preparing'}
  <span class="st" title={t('history.replay.preparingTitle')}>
    <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>{t(
      'history.replay.preparing',
    )}
  </span>
{:else if state === 'expired'}
  <span class="st" title={t('history.replay.expiredTitle')}>{t('history.replay.expired')}</span>
{:else if state === 'unavailable'}
  <span class="st" title={t('history.replay.unavailableTitle')}
    >{t('history.replay.unavailable')}</span
  >
{:else}
  <span class="st" title={t('history.replay.privateTitle')}>{t('history.replay.private')}</span>
{/if}

<style>
  .watch {
    letter-spacing: 0.2em;
  }

  .st {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--ink-dim);
    font-size: 18px;
    font-style: italic;
    white-space: nowrap;
  }

  .dots {
    display: inline-flex;
    gap: 3px;
  }

  .dots i {
    display: block;
    width: 5px;
    height: 5px;
    background: currentColor;
    animation: dots 1.2s ease-in-out infinite;
  }

  .dots i:nth-child(2) {
    animation-delay: 0.15s;
  }

  .dots i:nth-child(3) {
    animation-delay: 0.3s;
  }

  @keyframes dots {
    0%,
    60%,
    100% {
      opacity: 0.25;
    }

    30% {
      opacity: 1;
    }
  }

  /* The motion setting of the page (#871) decides, not the media query alone. */
  :global(:root[data-motion='reduced']) .dots i {
    animation: none;
    opacity: 0.7;
  }
</style>
