<script lang="ts">
  import { t } from '../i18n/index.ts';
  import type { AlertState } from '../match/alerts.svelte.ts';
  import { alertRows, alertRowText } from './alertRows.ts';
  import type { NodeNamer } from './nodeName.ts';

  interface Props {
    alerts: AlertState;
    /** The name of a place by its id. */
    names: NodeNamer;
  }

  let { alerts, names }: Props = $props();

  const rows = $derived(alertRows(alerts.overflow, alerts.current));
</script>

<!-- The alerts under the top bar (ui-style 10.4): one row per kind, `Space` takes the camera there. -->
{#if rows.length > 0}
  <ul class="alerts" aria-label={t('alert.title')}>
    {#each rows as row (row.kind)}
      <li class="row {row.kind}">
        <span class="mark" aria-hidden="true">!</span>
        <span>{alertRowText(row, alerts.tickHz, names)}</span>
      </li>
    {/each}
    <li class="hint">{t('alert.focusHint')}</li>
  </ul>
{/if}

<style>
  .alerts {
    position: absolute;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    max-width: calc(100% - 32px);
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
    flex: none;
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
  }
</style>
