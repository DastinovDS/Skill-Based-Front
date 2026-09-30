<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import ChargeDots from './ChargeDots.svelte';
  import type { HudData } from './hudData.ts';
  import type { HudState } from './hudState.svelte.ts';

  interface Props {
    data: HudData | null;
    hud: HudState;
  }

  let { data, hud }: Props = $props();

  // The pickers stand in for clicking the map, which arrives with map selection (CLI-06).
  const NONE = '';
  let planned = $state(false);

  const groupId = $derived(hud.selection?.kind === 'group' ? hud.selection.id : NONE);
  const nodeId = $derived(hud.selection?.kind === 'node' ? String(hud.selection.id) : NONE);
  const targetId = $derived(hud.target === null ? NONE : String(hud.target.node));

  function pickGroup(value: string): void {
    hud.select(value === NONE ? null : { kind: 'group', id: value });
    hud.aim(null);
  }

  function pickNode(value: string): void {
    hud.select(value === NONE ? null : { kind: 'node', id: Number(value) });
    hud.aim(null);
  }

  function pickTarget(value: string, isPlanned: boolean): void {
    hud.aim(value === NONE ? null : { node: Number(value), planned: isPlanned });
  }
</script>

<section class="panel">
  <h2>{t('inspect.title')}</h2>
  {#if data !== null}
    <label>
      {t('inspect.group')}
      <select
        value={groupId}
        onchange={(event) => {
          pickGroup(event.currentTarget.value);
        }}
      >
        <option value={NONE}>{t('inspect.none')}</option>
        {#each data.groups as g (g.id)}
          <option value={g.id}>
            {tf('inspect.groupOption', {
              units: g.units,
              where: g.node === null ? t('inspect.onRoad') : g.node,
            })}
          </option>
        {/each}
      </select>
    </label>
    <label>
      {t('inspect.node')}
      <select
        value={nodeId}
        onchange={(event) => {
          pickNode(event.currentTarget.value);
        }}
      >
        <option value={NONE}>{t('inspect.none')}</option>
        {#each data.nodes as n (n.id)}
          <option value={String(n.id)}>{tf('inspect.nodeOption', { id: n.id })}</option>
        {/each}
      </select>
    </label>

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

    {#if data.group !== null && data.group.node !== null}
      <label>
        {t('inspect.target')}
        <select
          value={targetId}
          onchange={(event) => {
            pickTarget(event.currentTarget.value, planned);
          }}
        >
          <option value={NONE}>{t('inspect.none')}</option>
          {#each data.nodes.filter((n) => n.owner === 'enemy') as n (n.id)}
            <option value={String(n.id)}>{tf('inspect.nodeOption', { id: n.id })}</option>
          {/each}
        </select>
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={planned}
          onchange={(event) => {
            planned = event.currentTarget.checked;
            pickTarget(targetId, planned);
          }}
        />
        {t('inspect.planned')}
      </label>
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

  select {
    font: inherit;
    color: inherit;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 2px 8px;
  }
</style>
