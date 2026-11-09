<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { AlertState } from '../match/alerts.svelte.ts';
  import type { OverflowAlert } from '../match/overflow.ts';
  import BarGlyph from '../theme/BarGlyph.svelte';
  import HelmetIcon from '../units/HelmetIcon.svelte';
  import { alertRows, alertRowText } from './alertRows.ts';
  import { formatSeconds } from './format.ts';
  import type { NodeNamer } from './nodeName.ts';
  import WarnSign from './WarnSign.svelte';

  interface Props {
    alerts: AlertState;
    /** The name of a place by its id. */
    names: NodeNamer;
  }

  let { alerts, names }: Props = $props();

  const rows = $derived(alertRows(alerts.overflow, alerts.current));
  const seconds = (ticks: number): string =>
    tf('alert.seconds', { seconds: formatSeconds(ticks, alerts.tickHz, getLocale()) });
  /** Ticks until the overcrowded city loses a unit: the attrition count, else the grace left. */
  const lossTicks = (alert: OverflowAlert): number => alert.attritionIn ?? alert.graceLeft ?? 0;
  /** The key itself is not translated. */
  const SPACE = 'Space';
</script>

<!-- The alerts hang as strips under the top bar (Leader, ui-style 54q): a sign, the place and the
     numbers, no sentence; the sentence is the strip's accessible name. `Space` takes the camera there. -->
{#if rows.length > 0}
  <ul class="alerts" aria-label={t('alert.title')}>
    {#each rows as row (row.kind)}
      <li class="strip {row.kind}" aria-label={alertRowText(row, alerts.tickHz, names)}>
        <WarnSign />
        <span class="place" aria-hidden="true">{names(row.first.node)}</span>
        {#if row.kind === 'incoming'}
          <span class="inc" aria-hidden="true">
            <HelmetIcon side="enemy" size={18} engraved />{row.orders}
            {#if row.first.ticksLeft !== null}
              <BarGlyph name="clock" size={13} />{seconds(row.first.ticksLeft)}
            {/if}
          </span>
        {:else}
          <span class="inc" aria-hidden="true">
            <HelmetIcon side="own" size={18} engraved />{row.first.units}/{row.first.capacity}
            <BarGlyph name="clock" size={13} />{seconds(lossTicks(row.first))}
          </span>
        {/if}
        {#if row.cities > 1}
          <span class="more" aria-hidden="true">+{row.cities - 1}</span>
        {/if}
      </li>
    {/each}
    <li class="key" title={t('alert.focusHint')} aria-label={t('alert.focusHint')}>
      <kbd aria-hidden="true">{SPACE}</kbd>
    </li>
  </ul>
{/if}

<style>
  .alerts {
    position: absolute;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: center;
    max-width: calc(100% - 32px);
    margin: 0;
    padding: 0;
    list-style: none;
    pointer-events: none;
  }

  /* A strip hung from the bar's double rule: no top edge, ivory rules down the sides and under it. */
  .strip {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    padding: 4px 14px 5px;
    border: 1px solid rgb(236 228 209 / 55%);
    border-top: 0;
    background: rgb(14 12 9 / 95%);
    color: var(--ink);
    font: 500 12px/1.3 var(--font-display);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .inc {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font: 500 17px/1 var(--font-text);
    letter-spacing: 0;
    text-transform: none;
  }

  .inc :global(.bar-glyph) {
    margin-left: 6px;
    color: var(--ink-dim);
  }

  .more {
    font: 500 15px/1 var(--font-text);
    letter-spacing: 0;
    color: var(--ink-dim);
  }

  .key {
    margin-top: 3px;
  }

  kbd {
    padding: 0 4px;
    border: 1px solid rgb(236 228 209 / 40%);
    background: rgb(14 12 9 / 90%);
    color: var(--ink-dim);
    font: 500 10px/14px var(--font-display);
    letter-spacing: 0.06em;
  }
</style>
