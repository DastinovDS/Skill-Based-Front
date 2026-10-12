<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import { eventText } from './eventText.ts';
  import type { HudData } from './hudData.ts';
  import Icon from './Icon.svelte';

  interface Props {
    data: HudData | null;
    open: boolean;
    onclose: () => void;
  }

  let { data, open, onclose }: Props = $props();
</script>

<!-- The journal slides in from the right (ui-style 10.4): everything the toasts leave out. -->
{#if open}
  <aside class="log" aria-label={t('events.title')}>
    <header>
      <h2>{t('events.title')}</h2>
      <button type="button" class="close" aria-label={t('menu.close')} onclick={onclose}>
        <Icon name="x" />
      </button>
    </header>
    {#if data === null || data.events.length === 0}
      <p class="hint">{t('events.empty')}</p>
    {:else}
      <ul>
        {#each data.events as event (event.seq)}
          <li>
            <span class="tick">{tf('event.tick', { tick: event.tick })}</span>
            {eventText(event, data.me)}
          </li>
        {/each}
      </ul>
    {/if}
  </aside>
{/if}

<style>
  .log {
    position: absolute;
    top: 48px;
    right: 0;
    bottom: 0;
    z-index: 12;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(340px, 100%);
    overflow-y: auto;
    padding: 12px;
    border-left: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    pointer-events: auto;
    animation: log-in 160ms ease-out;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: 16px;
  }

  .close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    color: inherit;
    cursor: pointer;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .close:focus-visible {
    outline: 2px solid var(--paper);
  }

  ul {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tick {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-dim);
  }

  @keyframes log-in {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .log {
      animation: none;
    }
  }
</style>
