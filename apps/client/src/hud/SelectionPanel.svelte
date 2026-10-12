<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import ChargeDots from './ChargeDots.svelte';
  import { formatSeconds } from './format.ts';
  import type { HudData } from './hudData.ts';

  interface Props {
    data: HudData;
    /** Ticks per second, for the countdown of overcrowding. */
    tickHz: number;
  }

  let { data, tickHz }: Props = $props();

  const seconds = (ticks: number): string => formatSeconds(ticks, tickHz, getLocale());
</script>

<!-- The facts of the selected group or city: the head of the selection card (ui-style 10.3). -->
<div class="facts">
  {#if data.group !== null}
    {@const g = data.group}
    <h2>{tf('card.group', { units: g.units })}</h2>
    <dl>
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

  <!-- With a group selected the card is about the group: the city under it is a hover away. -->
  {#if data.node !== null && data.group === null}
    {@const n = data.node}
    <h2>
      {tf(n.capital ? 'tip.capital' : 'tip.city', { node: n.id, owner: t(`owner.${n.owner}`) })}
    </h2>
    <dl>
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
      {#if n.build !== null}
        <dt>{t('sel.build')}</dt>
        <dd>
          {n.build.secondsLeft === null
            ? tf('sel.buildEnemy', { edge: n.build.edge })
            : tf('sel.buildOwn', { edge: n.build.edge, seconds: n.build.secondsLeft })}
        </dd>
      {/if}
      {#if n.attritionIn !== null}
        <dt class="warn">{t('tip.overflow')}</dt>
        <dd class="warn">
          {tf('tip.overflowIn', { seconds: `${seconds(n.attritionIn)} ${t('unit.s')}` })}
        </dd>
      {:else if n.graceLeft !== null}
        <dt class="warn">{t('tip.overflow')}</dt>
        <dd class="warn">
          {tf('tip.overflowGrace', { seconds: `${seconds(n.graceLeft)} ${t('unit.s')}` })}
        </dd>
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
</div>

<style>
  .facts {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }

  h2,
  h3 {
    margin: 0;
    font-size: 15px;
  }

  h3 {
    font-size: 14px;
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0;
  }

  dt {
    color: var(--text-dim);
  }

  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .warn {
    color: var(--warn);
  }

  p {
    margin: 0;
  }

  .hint {
    font-size: 12px;
    color: var(--text-dim);
  }

  .estimate {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    border: 1px dashed var(--neutral);
    border-radius: 4px;
  }

  .badge {
    font-weight: normal;
    font-size: 12px;
    padding: 0 6px;
    border: 1px solid var(--neutral);
    border-radius: 8px;
  }

  .result {
    font-weight: 600;
  }
</style>
