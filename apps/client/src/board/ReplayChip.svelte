<script lang="ts">
  import type { ReplayLinkState } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
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

<!-- One chip per state of the replay; the state is a shape and a word, never colour alone. Only
     `ready` opens the viewer: the server decides what can be watched (AGENTS.md, section 7.1). -->
{#if state === 'ready'}
  <button
    type="button"
    class="watch"
    aria-label={tf('history.replay.watchAria', { opponent })}
    onclick={onwatch}
  >
    <Icon name="eye" size={15} />{t('history.replay.watch')}
  </button>
{:else if state === 'preparing'}
  <span class="chip" title={t('history.replay.preparingTitle')}>
    <i class="dot" aria-hidden="true"></i>{t('history.replay.preparing')}
  </span>
{:else if state === 'expired'}
  <span class="chip dashed" title={t('history.replay.expiredTitle')}>
    <Icon name="clock" size={13} />{t('history.replay.expired')}
  </span>
{:else if state === 'unavailable'}
  <span class="chip dashed" title={t('history.replay.unavailableTitle')}>
    <Icon name="ban" size={13} />{t('history.replay.unavailable')}
  </span>
{:else}
  <span class="chip" title={t('history.replay.privateTitle')}>
    <Icon name="lock" size={13} />{t('history.replay.private')}
  </span>
{/if}

<style>
  .watch,
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }

  .watch {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }

  .watch:hover {
    border-color: var(--text-dim);
  }

  .watch:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }

  .chip {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: rgb(13 17 23 / 55%);
    color: var(--text-dim);
    font-size: 13px;
  }

  .chip.dashed {
    border-style: dashed;
  }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-dim);
    animation: pulse 1.25s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.35;
    }
    50% {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }
</style>
