<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import { keyBindings } from '../app/keyBindingsState.svelte.ts';
  import type { AlertState } from '../match/alerts.svelte.ts';
  import type { OverflowAlert } from '../match/overflow.ts';
  import BarGlyph from '../theme/BarGlyph.svelte';
  import CpMark from '../theme/CpMark.svelte';
  import HelmetIcon from '../units/HelmetIcon.svelte';
  import { alertRows, alertRowText } from './alertRows.ts';
  import { formatSeconds } from './format.ts';
  import type { NodeNamer } from './nodeName.ts';
  import WarnSign from './WarnSign.svelte';

  interface Props {
    alerts: AlertState;
    /** The name of a place by its id. */
    names: NodeNamer;
    /**
     * Takes the camera to the city of a strip (#1004, item 14), as the alert key does for the next
     * one; without it the strips are not buttons.
     */
    onshow?: (node: number) => void;
  }

  let { alerts, names, onshow }: Props = $props();

  const rows = $derived(alertRows(alerts.overflow, alerts.current));
  const seconds = (ticks: number): string =>
    tf('alert.seconds', { seconds: formatSeconds(ticks, alerts.tickHz, getLocale()) });
  /** Ticks until the overcrowded city loses a unit: the attrition count, else the grace left. */
  const lossTicks = (alert: OverflowAlert): number => alert.attritionIn ?? alert.graceLeft ?? 0;
  /** The key (its name is not translated) and the hint that names it, both following the binding (#966). */
  const key = $derived(keyBindings.label('alert'));
  const hint = $derived(tf('alert.focusHint', { alertKey: key }));
</script>

<!-- The alerts hang as strips under the top bar (Leader, ui-style 54q): a sign, the place and the
     numbers, no sentence; the sentence is the strip's accessible name. `Space` takes the camera there,
     and a click on a strip takes it to that strip's city (#1004): a button laid over the strip. -->
{#if rows.length > 0 || alerts.stays.length > 0}
  <ul class="alerts" aria-label={t('alert.title')}>
    <!-- #930 (W10): a recruit stays home, its walk not paid: the city, the crossed CP mark and the
         recruit, discharged (a hollow helmet). -->
    {#each alerts.stays as stay (stay.seq)}
      <li
        class="strip stay"
        class:go={onshow !== undefined}
        role="alert"
        aria-label={tf('alert.stay', {
          node: names(stay.node),
          target: names(stay.target ?? stay.node),
        })}
      >
        <WarnSign />
        <span class="place" aria-hidden="true">{names(stay.node)}</span>
        <span class="inc" aria-hidden="true">
          <span class="crossed"><CpMark size={15} /></span>
          <HelmetIcon side="own" size={18} share={0} engraved />
        </span>
        {#if onshow !== undefined}
          {@const show = tf('toast.show', { node: names(stay.node) })}
          <button
            type="button"
            class="cover"
            aria-label={show}
            title={show}
            onclick={() => {
              onshow(stay.node);
            }}
          ></button>
        {/if}
      </li>
    {/each}
    {#each rows as row (row.kind)}
      <li
        class="strip {row.kind}"
        class:go={onshow !== undefined}
        aria-label={alertRowText(row, alerts.tickHz, names)}
      >
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
        {#if onshow !== undefined}
          {@const show = tf('toast.show', { node: names(row.first.node) })}
          <button
            type="button"
            class="cover"
            aria-label={show}
            title={show}
            onclick={() => {
              onshow(row.first.node);
            }}
          ></button>
        {/if}
      </li>
    {/each}
    <li class="key" title={hint} aria-label={hint}>
      <kbd aria-hidden="true">{key}</kbd>
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

  /* A strip that takes the camera to its city (#1004): a clear button over the whole strip; on
     hover or focus the strip's rules light up and the place is underlined (shape as well as tone). */
  .strip.go {
    position: relative;
    pointer-events: auto;
  }

  .cover {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 0;
    background: none;
    border: none;
    cursor: pointer;
  }

  .strip.go:has(.cover:hover),
  .strip.go:has(.cover:focus-visible) {
    border-color: rgb(236 228 209 / 85%);
    background: rgb(28 24 18 / 97%);
  }

  .strip.go:has(.cover:hover) .place,
  .strip.go:has(.cover:focus-visible) .place {
    text-decoration: underline;
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }

  .cover:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
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

  /* The CP mark of the walk not paid, cut by a red stroke on a casing (shape, not only colour). */
  .crossed {
    position: relative;
    display: inline-flex;
  }

  .crossed::after {
    content: '';
    position: absolute;
    left: -2px;
    right: -2px;
    top: 50%;
    height: 1.6px;
    background: var(--badge-down);
    box-shadow: 0 0 0 1px var(--casing);
    transform: rotate(-40deg);
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
