<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { AlertState } from '../match/alerts.svelte.ts';

  interface Props {
    alerts: AlertState;
  }

  let { alerts }: Props = $props();

  const list = $derived(alerts.current);
  const seconds = (ticks: number): string =>
    new Intl.NumberFormat(getLocale(), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(ticks / alerts.tickHz);
</script>

<!-- The list of alerts under the top bar: the line of package D replaces this one. -->
{#if list.length > 0}
  <ul class="alerts" aria-label={t('alert.title')}>
    {#each list as alert (alert.node)}
      <li class="incoming">
        <span class="mark" aria-hidden="true">!</span>
        <span>
          {tf('alert.incoming', { node: alert.node, count: alert.count })}:
          {alert.ticksLeft === null
            ? t('alert.incomingGone')
            : tf('alert.incomingIn', { seconds: seconds(alert.ticksLeft) })}
        </span>
      </li>
    {/each}
    <li class="hint">{t('alert.focusHint')}</li>
  </ul>
{/if}

<style>
  .alerts {
    position: absolute;
    top: 48px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
    pointer-events: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-left: 4px solid var(--warn);
    border-radius: 6px;
    background: var(--surface);
    color: var(--text);
    font-size: 14px;
  }

  .mark {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--warn);
    color: var(--bg);
    font-weight: 700;
    font-size: 13px;
  }

  .hint {
    border-left-color: var(--border);
    color: var(--text-dim);
    font-size: 12px;
    align-self: center;
  }
</style>
