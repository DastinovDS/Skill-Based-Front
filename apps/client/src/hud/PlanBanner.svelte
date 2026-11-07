<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import { PLAN_BONUS, type OrderController } from '../match/orderController.ts';
  import BonusChevron from './BonusChevron.svelte';
  import type { GroupInfo } from './hudData.ts';

  interface Props {
    orders: OrderController;
    /** The selected own group; `null`: none. */
    group: GroupInfo | null;
  }

  let { orders, group }: Props = $props();

  const ui = $derived(orders.ui.current);
  // A planned order is being made (Shift held or the switch on): the pill stands out (#762).
  const planning = $derived(ui.planning);
  // Economy v2 (DEC-41, item 10): a planned order asks for a bonus and gathers it in its node, one
  // charge of the warehouse per `plan_ticks_per_bonus`. Shown while an own group in a node is selected
  // (that is when Shift+click gives the order), and for a gathering plan its progress and the release.
  // The bonus itself is set only over the target, by Shift and the wheel (#793, #797): no setting here.
  const shown = $derived(
    orders.v2 && group !== null && group.node !== null && !ui.supplyMode && !ui.terrainMode,
  );
  const gathering = $derived(group?.gathering ?? null);
  const nextSeconds = $derived(
    gathering?.nextIn == null ? null : Math.ceil(gathering.nextIn / orders.tickHz),
  );

  /** Key labels are the keys themselves, not translations. */
  const SHIFT = 'Shift';
  const RELEASE_KEY = 'F';
</script>

{#if shown}
  <section class="plan" aria-label={t('plan.banner')}>
    {#if gathering !== null}
      <!-- The plan of the selected group gathers: the bonus so far against the request, the release. -->
      <div class="pill gather" aria-live="polite">
        <!-- The bonus as the chevrons of the badges (#797): green gathered, hollow still asked for. -->
        <span class="pips" aria-hidden="true">
          {#each Array.from({ length: Math.min(gathering.plan, PLAN_BONUS.max) }, (_, i) => i) as i (i)}
            <BonusChevron size={12} hollow={i >= gathering.bonus} />
          {/each}
        </span>
        <span>{tf('plan.gathering', { bonus: gathering.bonus, plan: gathering.plan })}</span>
        {#if nextSeconds !== null}
          <span class="dim">{tf('plan.next', { seconds: nextSeconds })}</span>
        {/if}
        <button
          type="button"
          class="tbtn"
          onclick={(event) => {
            orders.releasePlan();
            event.currentTarget.blur();
          }}>{t('plan.release')}<kbd class="k" aria-hidden="true">{RELEASE_KEY}</kbd></button
        >
      </div>
    {:else}
      <div class="pill" class:planning>
        <strong>{planning ? t('plan.choosing') : t('plan.banner')}</strong><kbd
          class="k"
          aria-hidden="true">{SHIFT}</kbd
        >
        <span class="sep" aria-hidden="true"></span>
        <BonusChevron size={14} />
        <span class="dim cap">{t('plan.wheel')}</span>
      </div>
    {/if}
  </section>
{/if}

<style>
  /*
   * In the bottom left corner, like the «Supply» pill (S3, #627), which never shows with it: one
   * pill with the name of the order, its key and how its bonus is set (Shift and the wheel over the
   * target, #797); for a group whose plan gathers, its progress and the release instead.
   */
  .plan {
    position: absolute;
    /* The HUD is a flex column: without an explicit `top` the banner would stretch from its static position. */
    top: auto;
    bottom: 12px;
    left: 12px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    max-width: calc(100% - 24px);
    color: var(--text);
    font-size: 14px;
    pointer-events: none;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    min-height: 40px;
    padding: 5px 8px 5px 14px;
    box-sizing: border-box;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    white-space: nowrap;
  }

  /* A planned order is being made: a thicker frame, a bigger value and the words change (#762). */
  .pill.planning {
    border: 2px solid var(--you);
    padding: 4px 7px 4px 13px;
  }

  .cap {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .pill.gather {
    gap: 10px;
    border-color: var(--you);
  }

  strong {
    font-weight: 700;
  }

  .dim {
    color: var(--text-dim);
  }

  .sep {
    width: 1px;
    height: 18px;
    background: var(--border);
  }

  .tbtn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 6px 0 10px;
    border: 1px solid var(--you);
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    pointer-events: auto;
  }

  .tbtn:hover {
    border-color: var(--text-dim);
  }

  .tbtn:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 1px;
  }

  /* The gathered bonus as chevrons: green for a point gathered, hollow for one still asked for. */
  .pips {
    display: inline-flex;
    align-items: center;
    gap: 1px;
  }

  .k {
    display: inline-block;
    min-width: 20px;
    height: 20px;
    box-sizing: border-box;
    padding: 0 5px;
    border: 1px solid #3d444d;
    border-bottom-width: 2px;
    border-radius: 5px;
    background: var(--surface-2);
    color: var(--text-dim);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    line-height: 17px;
    text-align: center;
  }
</style>
