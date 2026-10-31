<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import { PLAN_BONUS, type OrderController } from '../match/orderController.ts';
  import type { GroupInfo } from './hudData.ts';

  interface Props {
    orders: OrderController;
    /** The selected own group; `null`: none. */
    group: GroupInfo | null;
  }

  let { orders, group }: Props = $props();

  const ui = $derived(orders.ui.current);
  const bonus = $derived(ui.planBonus);
  // Economy v2 (DEC-41, item 10): a planned order asks for a bonus and gathers it in its node, one
  // charge of the warehouse per `plan_ticks_per_bonus`. Shown while an own group in a node is selected
  // (that is when Shift+click gives the order), and for a gathering plan its progress and the release.
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
  const STEP_KEYS = '[ ]';
</script>

{#if shown}
  <section class="plan" aria-label={t('plan.banner')}>
    {#if gathering !== null}
      <!-- The plan of the selected group gathers: the bonus so far against the request, the release. -->
      <div class="pill gather" aria-live="polite">
        <span class="pips" aria-hidden="true">
          {#each Array.from({ length: Math.min(gathering.plan, PLAN_BONUS.max) }, (_, i) => i) as i (i)}
            <span class="pip" class:on={i < gathering.bonus}></span>
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
      <div class="pill">
        <strong>{t('plan.banner')}</strong><kbd class="k" aria-hidden="true">{SHIFT}</kbd>
        <span class="sep" aria-hidden="true"></span>
        <div class="step" role="group" aria-label={t('plan.bonus')} title={t('plan.bonusTip')}>
          <button
            type="button"
            class="sbtn"
            aria-label={t('plan.less')}
            disabled={bonus <= PLAN_BONUS.min}
            onclick={(event) => {
              orders.stepPlanBonus(-1);
              // The map takes the keys again (a focused button would keep them).
              event.currentTarget.blur();
            }}>−</button
          >
          <!-- The diamond of a bonus shot, as on the pill of a planned order on the map. -->
          <svg class="diamond" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 4 20 12 12 20 4 12z" />
          </svg>
          <output aria-live="polite">+{bonus}</output>
          <button
            type="button"
            class="sbtn"
            aria-label={t('plan.more')}
            disabled={bonus >= PLAN_BONUS.max}
            onclick={(event) => {
              orders.stepPlanBonus(1);
              event.currentTarget.blur();
            }}>+</button
          >
        </div>
        <kbd class="k" aria-hidden="true">{STEP_KEYS}</kbd>
      </div>
    {/if}
  </section>
{/if}

<style>
  /*
   * In the bottom left corner, like the «Supply» pill (S3, #627), which never shows with it: one
   * pill with the name of the order, its key and the stepper of the requested bonus; for a group
   * whose plan gathers, its progress and the release instead.
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

  .step {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto;
  }

  /* A 28 px hit area (ui-style 22). */
  .sbtn {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 17px;
    font-weight: 700;
    line-height: 1;
    cursor: pointer;
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

  .sbtn:hover:not(:disabled),
  .tbtn:hover {
    border-color: var(--text-dim);
  }

  .sbtn:focus-visible,
  .tbtn:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 1px;
  }

  /* Off is told by more than the colour: the button loses its frame too. */
  .sbtn:disabled {
    border-style: dashed;
    color: var(--text-dim);
    cursor: default;
    opacity: 0.6;
  }

  .diamond {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linejoin: round;
  }

  output {
    min-width: 2.5ch;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  /* The gathered bonus as diamonds: filled for a point gathered, hollow for one still asked for. */
  .pips {
    display: inline-flex;
    gap: 3px;
  }

  .pip {
    width: 8px;
    height: 8px;
    box-sizing: border-box;
    border: 1.6px solid var(--paper);
    transform: rotate(45deg);
  }

  .pip.on {
    background: var(--you);
    border-color: var(--paper);
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
