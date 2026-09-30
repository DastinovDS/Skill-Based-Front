<script lang="ts">
  import { t, tf, getLocale } from '../i18n/index.ts';
  import { rejectMessageKey } from '../match/rejects.ts';
  import type { OrderController } from '../match/orderController.ts';
  import ChargeDots from './ChargeDots.svelte';
  import { formatCentis } from './format.ts';
  import type { HudData } from './hudData.ts';

  interface Props {
    data: HudData | null;
    /** Mouse and keyboard ordering: selection itself happens by clicking the map. */
    orders: OrderController;
  }

  let { data, orders }: Props = $props();

  const ui = $derived(orders.ui.current);
  const cp = (centis: number): string => formatCentis(centis, getLocale());
</script>

<section class="panel">
  <h2>{t('inspect.title')}</h2>
  {#if data !== null}
    {#if data.group !== null}
      {@const g = data.group}
      <dl>
        <dt>{t('sel.units')}</dt>
        <dd>{g.units}</dd>
        <dt>{t('sel.charged')}</dt>
        <dd><ChargeDots units={g.units} charged={g.charged} /> {g.charged}</dd>
        <dt>{t('sel.mode')}</dt>
        <dd>{t(`mode.${g.mode}`)}</dd>
        {#if g.capacity !== null}
          <dt>{t('sel.capacity')}</dt>
          <dd>{g.capacity}</dd>
        {/if}
      </dl>
      <p class="hint">
        {#if g.node !== null}
          {tf('sel.atNode', { node: g.node })}
        {:else if g.progress !== null}
          {tf('sel.onEdge', { percent: Math.round(g.progress / 10) })}
        {/if}
        {#if g.destination !== null}
          <br />{tf(g.planned ? 'sel.heading.planned' : 'sel.heading', { node: g.destination })}
        {/if}
      </p>
    {/if}

    {#if data.node !== null}
      {@const n = data.node}
      <dl>
        <dt>{tf('inspect.nodeOption', { id: n.id })}</dt>
        <dd>
          {t(`owner.${n.owner}`)}{n.capital ? `, ${t('sel.capital')}` : ''}
        </dd>
        <dt>{t('sel.terrain')}</dt>
        <dd>{t(`terrain.${n.terrain}`)}</dd>
        <dt>{t('sel.vp')}</dt>
        <dd>{n.vp}</dd>
        <dt>{t('sel.capacity')}</dt>
        <dd>{n.capacity}</dd>
        {#if n.warehouse !== null}
          <dt>{t('sel.warehouse')}</dt>
          <dd>{n.warehouse}</dd>
        {/if}
        <dt>{t('sel.here')}</dt>
        <dd>
          {n.mine.units}
          {#if n.mine.units > 0}<ChargeDots units={n.mine.units} charged={n.mine.charged} />{/if}
        </dd>
        <dt>{t('sel.enemy')}</dt>
        <dd>
          {#if n.enemy === null}
            {t('sel.enemyHidden')}
          {:else if n.enemy.modes.length === 0}
            {t('sel.enemyNone')}
          {:else}
            {n.enemy.modes.map((mode) => t(`mode.${mode}`)).join(', ')}
            {#if n.enemy.units !== null && n.enemy.charged !== null}
              : {n.enemy.units}
              <ChargeDots units={n.enemy.units} charged={n.enemy.charged} />
            {:else}
              ({t('sel.enemyHidden')})
            {/if}
          {/if}
        </dd>
      </dl>
      {#if n.enemy?.stale === true}
        <p class="hint">{tf('sel.enemyOld', { tick: n.enemy.seenTick })}</p>
      {/if}
      <p class="hint">{t(`detail.${n.detail}`)}</p>
    {/if}

    <section class="orders" aria-label={t('orders.title')}>
      <h3>{t('orders.title')}</h3>
      {#if data.group === null}
        <p class="hint">{t('orders.pickGroup')}</p>
      {/if}
      <label class="check">
        <input
          type="checkbox"
          checked={ui.planned}
          onchange={(event) => {
            orders.setPlanned(event.currentTarget.checked);
          }}
        />
        {t('orders.planned')}
      </label>
      {#if ui.preview !== null}
        <p class="preview">
          {tf(ui.preview.planned ? 'orders.previewPlanned' : 'orders.previewMove', {
            node: ui.preview.node,
            cost: cp(ui.preview.cost),
          })}
        </p>
      {/if}
      {#if data.group !== null}
        <button
          type="button"
          onclick={() => {
            orders.cancelSelected();
          }}
        >
          {tf('orders.cancel', { cost: cp(orders.cancelCost) })}
        </button>
      {/if}
      {#if ui.notice !== null}
        <p class="notice" role="alert">
          {#if ui.notice.kind === 'rejected'}
            {tf('orders.rejected', { reason: t(rejectMessageKey(ui.notice.code)) })}
          {:else}
            {t('orders.lost')}
          {/if}
        </p>
      {/if}
    </section>

    {#if data.estimate !== null}
      {@const e = data.estimate.result}
      <section class="estimate" aria-label={t('estimate.title')}>
        <h3>{t('estimate.title')} <span class="badge">{t('estimate.badge')}</span></h3>
        {#if e.kind === 'exact'}
          <p>{t('estimate.exact')}</p>
          <p>{tf('estimate.pools', { attacker: e.attackerPool, defender: e.defenderPool })}</p>
          <p>{tf('estimate.losses', { mine: e.attackerLosses, enemy: e.defenderLosses })}</p>
          <p class="result">{e.captures ? t('estimate.takes') : t('estimate.bounces')}</p>
        {:else if e.kind === 'upper_bound'}
          <p>{t('estimate.upper')}</p>
          <p>{tf('estimate.poolsMax', { attacker: e.attackerPool, max: e.defenderPoolMax })}</p>
          <p>{tf('estimate.unitsMax', { max: e.defenderUnitsMax })}</p>
          <p>{tf('estimate.lossesMax', { max: e.attackerLossesMax })}</p>
        {/if}
        <p class="hint">{t('estimate.note')}</p>
      </section>
    {/if}
  {:else}
    <p class="hint">{t('sel.nothing')}</p>
  {/if}
</section>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }

  h2,
  h3 {
    margin: 0;
    font-size: 14px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .orders {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 4px;
    border-top: 1px solid #30363d;
  }

  .preview {
    font-weight: 600;
  }

  .notice {
    padding: 4px 8px;
    border: 1px solid #f85149;
    border-radius: 4px;
  }

  button {
    font: inherit;
    color: inherit;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
  }

  .check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0;
  }

  dt {
    color: #8b949e;
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  p {
    margin: 0;
  }

  .hint {
    font-size: 12px;
    color: #8b949e;
  }

  .estimate {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    border: 1px dashed #8b949e;
    border-radius: 4px;
  }

  .badge {
    font-weight: normal;
    font-size: 12px;
    padding: 0 6px;
    border: 1px solid #8b949e;
    border-radius: 8px;
  }

  .result {
    font-weight: 600;
  }
</style>
