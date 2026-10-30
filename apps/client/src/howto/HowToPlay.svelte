<script lang="ts">
  import { t, tf } from '../i18n/index.ts';
  import Tri from './Tri.svelte';
  import { HOWTO, type Count, type Example, type HowToData } from './data.ts';

  interface Props {
    /** The examples and the rule numbers; tests pass their own. */
    data?: HowToData;
  }

  let { data = HOWTO }: Props = $props();

  const rules = $derived(data.rules);
  type Cell = 'charged' | 'empty' | 'gone';

  /** The triangles of a side: charged first, then empty ones, then the fallen as dashed outlines. */
  function cells(total: number, now: Count): Cell[] {
    return Array.from({ length: total }, (_, i) =>
      i < now.charged ? 'charged' : i < now.units ? 'empty' : 'gone',
    );
  }

  interface Frame {
    key: string;
    label: string;
    a: Count;
    b: Count;
    bonusA: number;
    bonusB: number;
  }

  function frames(ex: Example): Frame[] {
    const list: Frame[] = [
      {
        key: 'start',
        label: t('howto.ex.start'),
        a: ex.start.a,
        b: ex.start.b,
        bonusA: ex.bonus_start.a,
        bonusB: ex.bonus_start.b,
      },
    ];
    for (const r of ex.rounds) {
      list.push({
        key: `r${String(r.round)}`,
        label: tf('howto.ex.time', { seconds: r.after_seconds }),
        a: r.a,
        b: r.b,
        bonusA: r.bonus_left.a,
        bonusB: r.bonus_left.b,
      });
    }
    return list;
  }

  function aria(f: Frame): string {
    return tf('howto.ex.frameAria', {
      when: f.label,
      attack: tf('howto.ex.attackLine', { units: f.a.units, charged: f.a.charged }),
      defense: tf('howto.ex.defenseLine', { units: f.b.units, charged: f.b.charged }),
    });
  }

  const TITLE = {
    equal: 'howto.ex.equal.title',
    surplus: 'howto.ex.surplus.title',
    defenseless: 'howto.ex.defenseless.title',
    planned: 'howto.ex.planned.title',
  } as const;
  const WHY = {
    equal: 'howto.ex.equal.why',
    surplus: 'howto.ex.surplus.why',
    defenseless: 'howto.ex.defenseless.why',
    planned: 'howto.ex.planned.why',
  } as const;

  const TRI = 'M2 2h18l-9 15.5z';
</script>

<div class="hw">
  <section aria-labelledby="hw-charges">
    <h3 id="hw-charges">{t('howto.charges.title')}</h3>
    <p>
      {tf('howto.charges.text', {
        economy: rules.stance_charges_pct.economy,
        balance: rules.stance_charges_pct.balance,
        war: rules.stance_charges_pct.war,
      })}
    </p>
  </section>

  <section aria-labelledby="hw-roads">
    <h3 id="hw-roads">{t('howto.roads.title')}</h3>
    <p>{t('howto.roads.text')}</p>
    <svg
      class="pic"
      viewBox="0 0 360 96"
      role="img"
      aria-label={t('howto.pic.supply')}
      focusable="false"
    >
      <!-- Top: the capital, a road with charges on it, a city with a charged unit. -->
      <path d="M52 26H292" class="road" />
      <rect x="110" y="22" width="8" height="8" class="charge" />
      <rect x="160" y="22" width="8" height="8" class="charge" />
      <rect x="210" y="22" width="8" height="8" class="charge" />
      <circle cx="36" cy="26" r="16" class="city" />
      <path
        d="M36 15l3.2 6.5 7.1 1-5.15 5 1.2 7.1L36 31.2l-6.35 3.4 1.2-7.1-5.15-5 7.1-1z"
        class="star"
      />
      <circle cx="308" cy="26" r="16" class="city" />
      <g transform="translate(297 17)">
        <path d={TRI} class="back" />
        <path d={TRI} class="fill own" />
        <path d={TRI} class="rim" />
      </g>
      <!-- Bottom: a cut road and a city whose unit stays empty. -->
      <path d="M52 72H140" class="road" />
      <path d="M180 72H292" class="road faint" />
      <path d="M150 62l20 20M170 62l-20 20" class="cut" />
      <circle cx="36" cy="72" r="16" class="city" />
      <path
        d="M36 61l3.2 6.5 7.1 1-5.15 5 1.2 7.1L36 77.2l-6.35 3.4 1.2-7.1-5.15-5 7.1-1z"
        class="star"
      />
      <circle cx="308" cy="72" r="16" class="city" />
      <g transform="translate(297 63)">
        <path d={TRI} class="back" />
        <path d={TRI} class="rim" />
      </g>
    </svg>
  </section>

  <section aria-labelledby="hw-fight">
    <h3 id="hw-fight">{t('howto.fight.title')}</h3>
    <p>{tf('howto.fight.text', { seconds: rules.round_seconds })}</p>
    <p>{t('howto.fight.bounce')}</p>
    <p class="note">{t('howto.fight.legend')}</p>
    {#each data.examples as ex (ex.id)}
      {@const list = frames(ex)}
      {@const totals = ex.start}
      <figure class="ex">
        <figcaption>
          <strong>{t(TITLE[ex.id])}</strong>
          <span>{t(WHY[ex.id])}</span>
        </figcaption>
        <div class="cols" aria-hidden="true">
          <span class="lab"></span>
          <span class="own">{t('howto.col.attack')}</span>
          <span class="enemy">{t('howto.col.defense')}</span>
        </div>
        <ol class="frames">
          {#each list as f (f.key)}
            <li aria-label={aria(f)}>
              <span class="lab" aria-hidden="true">{f.label}</span>
              <span class="side" aria-hidden="true">
                {#each cells(totals.a.units, f.a) as cell, i (i)}
                  <Tri side="own" {cell} />
                {/each}
                {#if f.bonusA > 0}
                  <span class="bonus" aria-hidden="true"
                    ><svg
                      class="dia"
                      viewBox="0 0 14 14"
                      width="14"
                      height="14"
                      aria-hidden="true"
                      focusable="false"><path d="M7 1l6 6-6 6-6-6z" /></svg
                    >×{f.bonusA}</span
                  >
                {/if}
              </span>
              <span class="side" aria-hidden="true">
                {#each cells(totals.b.units, f.b) as cell, i (i)}
                  <Tri side="enemy" {cell} />
                {/each}
                {#if f.bonusB > 0}
                  <span class="bonus" aria-hidden="true"
                    ><svg
                      class="dia"
                      viewBox="0 0 14 14"
                      width="14"
                      height="14"
                      aria-hidden="true"
                      focusable="false"><path d="M7 1l6 6-6 6-6-6z" /></svg
                    >×{f.bonusB}</span
                  >
                {/if}
              </span>
            </li>
          {/each}
        </ol>
        <p class="result">
          {tf(ex.end.node_taken ? 'howto.ex.taken' : 'howto.ex.bounced', {
            lost: ex.end.losses.b,
          })}
        </p>
      </figure>
    {/each}
  </section>

  <section aria-labelledby="hw-orders">
    <h3 id="hw-orders">{t('howto.orders.title')}</h3>
    <p>
      {tf('howto.orders.text', {
        move: rules.cost_move_cp,
        planned: rules.cost_planned_cp,
        delay: rules.planned_delay_seconds,
        bonus: rules.planned_bonus_per_road,
      })}
    </p>
    <p>
      {tf('howto.orders.defense', {
        cost: rules.cost_defense_cp,
        seconds: rules.defense_seconds_per_bonus,
      })}
    </p>
    <svg
      class="pic"
      viewBox="0 0 360 52"
      role="img"
      aria-label={t('howto.pic.orders')}
      focusable="false"
    >
      <circle cx="36" cy="26" r="16" class="city" />
      <circle cx="324" cy="26" r="16" class="city" />
      <path d="M58 16h200l24 10-24 10H58z" class="ribbon" />
      <path d="M180 8l6 6-6 6-6-6z" class="bonusmark" />
      <path d="M212 8l6 6-6 6-6-6z" class="bonusmark" />
    </svg>
  </section>

  <section aria-labelledby="hw-victory">
    <h3 id="hw-victory">{t('howto.victory.title')}</h3>
    <p>
      {tf('howto.victory.text', {
        seconds: rules.vp_period_seconds,
        multiplier: rules.capital_multiplier,
        minutes: rules.match_minutes,
      })}
    </p>
    <svg
      class="pic"
      viewBox="0 0 360 66"
      role="img"
      aria-label={t('howto.pic.victory')}
      focusable="false"
    >
      <path d="M52 26h56M148 26h56M244 26h56" class="road" />
      <circle cx="36" cy="26" r="16" class="city" />
      <path
        d="M36 15l3.2 6.5 7.1 1-5.15 5 1.2 7.1L36 31.2l-6.35 3.4 1.2-7.1-5.15-5 7.1-1z"
        class="star"
      />
      <circle cx="128" cy="26" r="16" class="city" />
      <text x="128" y="27" class="num">1</text>
      <circle cx="224" cy="26" r="16" class="city" />
      <text x="224" y="27" class="num">1</text>
      <circle cx="320" cy="26" r="16" class="city" />
      <text x="320" y="27" class="num">1</text>
      <text x="36" y="52" class="num small">×{rules.capital_multiplier}</text>
    </svg>
  </section>
</div>

<style>
  .hw {
    display: flex;
    flex-direction: column;
    gap: 18px;
    font-size: 14px;
    line-height: 1.45;
    color: var(--text);
  }

  h3,
  p,
  figure,
  ol {
    margin: 0;
  }

  h3 {
    margin-bottom: 4px;
    font-size: 16px;
    font-weight: 800;
  }

  section p + p {
    margin-top: 6px;
  }

  .note {
    font-size: 13px;
    color: var(--text-dim);
  }

  .pic {
    display: block;
    width: 100%;
    max-width: 360px;
    margin-top: 10px;
    overflow: visible;
  }

  .road {
    fill: none;
    stroke: var(--you);
    stroke-width: 4;
    stroke-linecap: round;
  }

  .road.faint {
    stroke-dasharray: 3 6;
    stroke: var(--text-dim);
  }

  .charge {
    fill: var(--paper);
    stroke: var(--bg);
    stroke-width: 1;
  }

  .city {
    fill: var(--bg);
    stroke: var(--paper);
    stroke-width: 2;
  }

  .star {
    fill: var(--paper);
  }

  .cut {
    fill: none;
    stroke: var(--warn);
    stroke-width: 3;
    stroke-linecap: round;
  }

  .num {
    fill: var(--paper);
    font-size: 15px;
    font-weight: 800;
    text-anchor: middle;
    dominant-baseline: central;
  }

  .num.small {
    font-size: 12px;
    fill: var(--text-dim);
  }

  .ribbon {
    fill: var(--you);
    fill-opacity: 0.35;
    stroke: var(--you);
    stroke-width: 2;
    stroke-linejoin: round;
  }

  .bonusmark {
    fill: none;
    stroke: var(--paper);
    stroke-width: 2;
    stroke-linejoin: round;
  }

  .ex {
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
  }

  figcaption {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 8px;
  }

  figcaption span {
    font-size: 13px;
    color: var(--text-dim);
  }

  .cols,
  .frames li {
    display: grid;
    grid-template-columns: 48px 1fr 1fr;
    align-items: center;
    gap: 6px;
  }

  .cols {
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .frames {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
    list-style: none;
  }

  .lab {
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .side {
    display: flex;
    align-items: center;
    gap: 3px;
    min-height: 22px;
  }

  .bonus {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .dia path {
    fill: none;
    stroke: var(--paper);
    stroke-width: 1.6;
    stroke-linejoin: round;
  }

  .back {
    fill: #161b22;
  }

  .fill.own {
    fill: var(--you);
  }

  .rim {
    fill: none;
    stroke: var(--paper);
    stroke-width: 1.6;
    stroke-linejoin: round;
  }

  .result {
    margin-top: 8px;
    font-size: 13px;
  }
</style>
