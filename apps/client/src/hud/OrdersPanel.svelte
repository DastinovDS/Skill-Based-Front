<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import type { Mode } from '../protocol.gen.ts';
  import { formatCentis, formatSeconds } from './format.ts';
  import { roadCandidates, type HudData } from './hudData.ts';

  interface Props {
    data: HudData | null;
    /** Mouse and keyboard ordering: every command of the player goes through it. */
    orders: OrderController;
  }

  let { data, orders }: Props = $props();

  const MODES: readonly { mode: Mode; key: string }[] = [
    { mode: 'attack', key: '1' },
    { mode: 'defense', key: '2' },
  ];

  const ui = $derived(orders.ui.current);
  const cp = (centis: number): string => formatCentis(centis, getLocale());
  const group = $derived(data?.group ?? null);
  const mergeCount = $derived(data === null ? 0 : orders.mergeCandidates().length);
  const recruitHere = $derived(
    data?.node?.owner === 'mine' || (group !== null && group.node !== null),
  );
  // Road upgrades (DEC-16): the selected own city, its build, and the roads it may upgrade.
  const city = $derived(data?.node?.owner === 'mine' ? data.node : null);
  const pick = $derived(ui.roadPick);
  const candidates = $derived(
    data === null || pick === null ? [] : roadCandidates(data.roads, pick),
  );
  const unknown = (value: number | null): string | number => value ?? '?';

  let splitN = $state(1);
  const maxSplit = $derived(group === null ? 1 : Math.max(1, group.units - 1));
</script>

<!-- The actions of the selection card (ui-style 10.3); the answers to commands are toasts. -->
<section class="orders" aria-label={t('orders.title')}>
  {#if group !== null}
    <p class="hint">
      {tf('card.clickHint', {
        normal: cp(orders.moveCostFor(false)),
        planned: cp(orders.moveCostFor(true)),
      })}
    </p>
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
    {#if ui.preview.split}
      <p class="warn">{t('orders.previewSplit')}</p>
    {:else if ui.preview.ticks !== null}
      <p class="hint">
        {tf('orders.previewTime', {
          seconds: `${formatSeconds(ui.preview.ticks, orders.tickHz, getLocale())} ${t('unit.s')}`,
        })}
      </p>
    {/if}
  {/if}
  {#if group !== null && group.node !== null && group.capacity !== null && group.units > group.capacity}
    <p class="warn">
      {tf('orders.overCapacity', { units: group.units, capacity: group.capacity })}
    </p>
  {/if}
  {#if pick !== null}
    <div class="pick" role="group" aria-label={t('orders.upgradeRoad')}>
      <p>
        {tf('orders.roadPick', {
          node: pick,
          warehouse: unknown(city?.id === pick ? city.warehouse : null),
        })}
      </p>
      {#each candidates as road (road.id)}
        <button
          type="button"
          onclick={() => {
            orders.upgradeRoad(road.id);
          }}
        >
          {tf('orders.roadOption', {
            edge: road.id,
            node: road.a === pick ? road.b : road.a,
            width: road.width + 1,
            type: road.kind === 'none' ? t('road.choose') : t(`road.${road.kind}`),
            charges: unknown(road.charges),
          })}
        </button>
      {:else}
        <p class="hint">{t('orders.roadPickNone')}</p>
      {/each}
      <button
        type="button"
        onclick={() => {
          orders.stopRoadPick();
        }}
      >
        {t('orders.roadPickCancel')}
      </button>
    </div>
  {:else if city !== null}
    {#if city.build !== null && city.build.secondsLeft !== null}
      <p class="hint">
        {tf('orders.roadBusy', { edge: city.build.edge, seconds: city.build.secondsLeft })}
      </p>
    {:else}
      <button
        type="button"
        onclick={() => {
          orders.toggleRoadPick();
        }}
      >
        {t('orders.upgradeRoad')}
      </button>
    {/if}
  {/if}

  {#if group !== null}
    <div class="row" role="group" aria-label={t('orders.modes')}>
      {#each MODES as { mode, key } (mode)}
        <button
          type="button"
          class:active={group.mode === mode}
          aria-pressed={group.mode === mode}
          onclick={() => {
            orders.setMode(mode);
          }}
        >
          {tf('card.mode', {
            mode: t(`mode.${mode}`),
            key,
            cost: cp(orders.modeCost(mode)),
          })}
        </button>
      {/each}
    </div>
    <div class="row">
      <input
        type="number"
        min="1"
        max={maxSplit}
        step="1"
        aria-label={t('orders.splitUnits')}
        bind:value={splitN}
      />
      <button
        type="button"
        disabled={group.units < 2}
        onclick={() => {
          orders.split(Math.min(maxSplit, Math.max(1, Math.round(splitN))));
        }}
      >
        {t('orders.split')}
      </button>
    </div>
    <button
      type="button"
      onclick={() => {
        orders.cancelSelected();
      }}
    >
      {tf('orders.cancel', { cost: cp(orders.cancelCost) })}
    </button>
  {/if}
  {#if mergeCount >= 2}
    <button
      type="button"
      onclick={() => {
        orders.merge();
      }}
    >
      {tf('orders.merge', { count: mergeCount })}
    </button>
  {/if}
  {#if recruitHere}
    <button
      type="button"
      onclick={() => {
        orders.recruit();
      }}
    >
      {tf('orders.recruit', { cost: cp(orders.recruitCost) })}
    </button>
  {/if}
</section>

<style>
  .orders {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }

  p {
    margin: 0;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hint {
    font-size: 12px;
    color: var(--text-dim);
  }

  .preview {
    font-weight: 600;
  }

  /* A warning reads by its words and the marker, not only by the colour. */
  .warn {
    font-size: 12px;
    color: var(--warn);
  }

  .warn::before {
    content: '⚠ ';
  }

  .pick {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    border: 1px dashed var(--paper);
    border-radius: 4px;
  }

  .pick button {
    text-align: left;
  }

  button,
  input[type='number'] {
    font: inherit;
    color: inherit;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 8px;
  }

  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 1px;
  }

  input[type='number'] {
    width: 4em;
  }

  button {
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.5;
  }

  /* The active mode: a thick white outline as well as the colour. */
  button.active {
    border: 2px solid var(--paper);
    font-weight: 600;
  }
</style>
