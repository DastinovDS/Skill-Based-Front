<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import { formatCentis, formatSeconds } from './format.ts';
  import type { HudData } from './hudData.ts';

  interface Props {
    data: HudData | null;
    /** The price of orders and the state of the pick come from here (the ruleset of `welcome`). */
    orders: OrderController;
  }

  let { data, orders }: Props = $props();

  const ui = $derived(orders.ui.current);
  const cp = (centis: number): string => formatCentis(centis, getLocale());
  const group = $derived(data?.group ?? null);
  const pick = $derived(ui.roadPick);
  const city = $derived(data?.node?.owner === 'mine' ? data.node : null);
  const unknown = (value: number | null): string | number => value ?? '?';
  const crowded = $derived(
    group !== null &&
      group.node !== null &&
      group.capacity !== null &&
      group.units > group.capacity,
  );
  const estimate = $derived(data?.estimate ?? null);
  // Nothing to say: the line is not drawn at all.
  const any = $derived(
    ui.preview !== null || pick !== null || crowded || estimate !== null || group !== null,
  );
</script>

<!-- One quiet line at the bottom of the map: what a click would do and what it would cost. There
     is no selection card since UI round 2; the facts of a thing are its tooltip. -->
{#if any}
  <section class="hint" aria-label={t('orders.title')} aria-live="polite">
    {#if pick !== null}
      <p>
        {tf('orders.roadPickMap', {
          node: pick,
          warehouse: unknown(city?.id === pick ? city.warehouse : null),
        })}
      </p>
    {:else if ui.preview !== null}
      <p class="main">
        {tf(ui.preview.planned ? 'orders.previewPlanned' : 'orders.previewMove', {
          node: ui.preview.node,
          cost: cp(ui.preview.cost),
        })}
      </p>
      {#if ui.preview.split}
        <p class="warn">{t('orders.previewSplit')}</p>
      {:else if ui.preview.ticks !== null}
        <p class="dim">
          {tf('orders.previewTime', {
            seconds: `${formatSeconds(ui.preview.ticks, orders.tickHz, getLocale())} ${t('unit.s')}`,
          })}
        </p>
      {/if}
    {:else if group !== null}
      <p class="dim">
        {tf('card.clickHint', {
          normal: cp(orders.moveCostFor(false)),
          planned: cp(orders.moveCostFor(true)),
        })}
      </p>
    {/if}
    {#if crowded && group !== null}
      <p class="warn">
        {tf('orders.overCapacity', { units: group.units, capacity: group.capacity ?? 0 })}
      </p>
    {/if}
    {#if estimate !== null}
      {@const e = estimate.result}
      <div class="estimate" role="group" aria-label={t('estimate.title')}>
        <p class="head">
          {t('estimate.title')} <span class="badge">{t('estimate.badge')}</span>
        </p>
        {#if e.kind === 'exact'}
          <p>{tf('estimate.pools', { attacker: e.attackerPool, defender: e.defenderPool })}</p>
          <p>{tf('estimate.losses', { mine: e.attackerLosses, enemy: e.defenderLosses })}</p>
          <p class="result">{e.captures ? t('estimate.takes') : t('estimate.bounces')}</p>
        {:else if e.kind === 'upper_bound'}
          <p>{tf('estimate.poolsMax', { attacker: e.attackerPool, max: e.defenderPoolMax })}</p>
          <p>{tf('estimate.unitsMax', { max: e.defenderUnitsMax })}</p>
          <p>{tf('estimate.lossesMax', { max: e.attackerLossesMax })}</p>
        {/if}
        <p class="dim">{t('estimate.note')}</p>
      </div>
    {/if}
  </section>
{/if}

<style>
  .hint {
    position: absolute;
    left: 50%;
    bottom: 12px;
    z-index: 3;
    transform: translateX(-50%);
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: max-content;
    max-width: min(480px, calc(100% - 24px));
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-size: 13px;
    text-align: center;
    /* Only reads: the map under it stays clickable. */
    pointer-events: none;
  }

  p {
    margin: 0;
  }

  .main {
    color: var(--paper);
    font-weight: 600;
  }

  .dim {
    color: var(--text-dim);
    font-size: 12px;
  }

  .warn {
    color: var(--warn);
  }

  .estimate {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
    padding: 6px 8px;
    border: 1px dashed var(--neutral);
    border-radius: 4px;
  }

  .head {
    font-weight: 600;
  }

  .badge {
    padding: 0 6px;
    border: 1px solid var(--neutral);
    border-radius: 8px;
    font-size: 12px;
    font-weight: normal;
  }

  .result {
    font-weight: 600;
  }
</style>
