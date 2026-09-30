<script lang="ts">
  import { getLocale, t, tf } from '../i18n/index.ts';
  import type { OrderController } from '../match/orderController.ts';
  import { rejectMessageKey } from '../match/rejects.ts';
  import type { Mode, Stance } from '../protocol.gen.ts';
  import { formatCentis } from './format.ts';
  import type { HudData } from './hudData.ts';

  interface Props {
    data: HudData | null;
    /** Mouse and keyboard ordering: every command of the player goes through it. */
    orders: OrderController;
  }

  let { data, orders }: Props = $props();

  const MODES: readonly { mode: Mode; key: string }[] = [
    { mode: 'attack', key: '1' },
    { mode: 'defense', key: '2' },
    { mode: 'build', key: '3' },
  ];
  const STANCES: readonly Stance[] = ['economy', 'balance', 'war'];

  const ui = $derived(orders.ui.current);
  const cp = (centis: number): string => formatCentis(centis, getLocale());
  const group = $derived(data?.group ?? null);
  const mergeCount = $derived(data === null ? 0 : orders.mergeCandidates().length);
  const recruitHere = $derived(
    data?.node?.owner === 'mine' || (group !== null && group.node !== null),
  );

  let splitN = $state(1);
  let confirmingForfeit = $state(false);
  const maxSplit = $derived(group === null ? 1 : Math.max(1, group.units - 1));

  function noticeText(notice: NonNullable<typeof ui.notice>): string {
    const command = t(`cmd.${notice.cmd.type}`);
    if (notice.kind === 'accepted') return tf('orders.accepted', { command });
    if (notice.kind === 'lost') return t('orders.lost');
    return tf('orders.rejected', { command, reason: t(rejectMessageKey(notice.code)) });
  }
</script>

<section class="orders" aria-label={t('orders.title')}>
  <h2>{t('orders.title')}</h2>
  {#if group === null}
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
  {#if ui.road !== null}
    <p class="preview">
      {tf('orders.roadHint', {
        capacity: cp(ui.road.capacityCenti ?? 0),
        speed: ui.road.packetSpeedPct ?? 0,
        cost: cp(ui.road.cost),
      })}
    </p>
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
          {t(`mode.${mode}`)} [{key}]
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
    <button
      type="button"
      onclick={() => {
        orders.cancelSelected();
      }}
    >
      {tf('orders.cancel', { cost: cp(orders.cancelCost) })}
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

  {#if data !== null}
    <div class="row" role="group" aria-label={tf('orders.stance', { cost: cp(orders.stanceCost) })}>
      {#each STANCES as stance (stance)}
        <button
          type="button"
          class:active={data.stance === stance}
          aria-pressed={data.stance === stance}
          onclick={() => {
            orders.setStance(stance);
          }}
        >
          {t(`stance.${stance}`)}
        </button>
      {/each}
    </div>
    <p class="hint">{tf('orders.stance', { cost: cp(orders.stanceCost) })}</p>
  {/if}

  {#if confirmingForfeit}
    <div class="confirm" role="alertdialog" aria-label={t('orders.forfeitAsk')}>
      <p>{t('orders.forfeitAsk')}</p>
      <div class="row">
        <button
          type="button"
          class="danger"
          onclick={() => {
            confirmingForfeit = false;
            orders.forfeit();
          }}
        >
          {t('orders.forfeitYes')}
        </button>
        <button
          type="button"
          onclick={() => {
            confirmingForfeit = false;
          }}
        >
          {t('orders.forfeitNo')}
        </button>
      </div>
    </div>
  {:else}
    <button
      type="button"
      class="danger"
      onclick={() => {
        confirmingForfeit = true;
      }}
    >
      {t('orders.forfeit')}
    </button>
  {/if}

  {#if ui.notice !== null}
    <p class={ui.notice.kind === 'accepted' ? 'notice ok' : 'notice'} role="alert">
      {noticeText(ui.notice)}
    </p>
  {/if}
</section>

<style>
  .orders {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
  }

  h2 {
    margin: 0;
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
    color: #8b949e;
  }

  .preview {
    font-weight: 600;
  }

  .notice {
    padding: 4px 8px;
    border: 1px solid #f85149;
    border-radius: 4px;
  }

  .notice.ok {
    border-color: #3fb950;
  }

  .confirm {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    border: 1px solid #f85149;
    border-radius: 4px;
  }

  button,
  input[type='number'] {
    font: inherit;
    color: inherit;
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 2px 8px;
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

  /* The active mode or stance: a thick outline as well as the colour. */
  button.active {
    border: 2px solid #ffd33d;
    font-weight: 600;
  }

  button.danger {
    border-color: #f85149;
  }
</style>
