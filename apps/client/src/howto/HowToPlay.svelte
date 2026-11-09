<script lang="ts">
  import BonusChevron from '../hud/BonusChevron.svelte';
  import HelmetIcon from '../units/HelmetIcon.svelte';
  import { t, tf } from '../i18n/index.ts';
  import PicCity from './PicCity.svelte';
  import UnitCell from './UnitCell.svelte';
  import { HOWTO, type Count, type Example, type HowToData } from './data.ts';

  interface Props {
    /** The examples and the rule numbers; tests pass their own. */
    data?: HowToData;
  }

  let { data = HOWTO }: Props = $props();

  const rules = $derived(data.rules);
  type Cell = 'charged' | 'empty' | 'gone';

  /** The units of a side: charged first, then empty ones, then the fallen as dashed outlines. */
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
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- The panel around it scrolls: a focusable region lets the arrow keys scroll it. -->
<div class="hw" role="region" aria-label={t('help.howTo')} tabindex="0">
  <p class="outdated" role="note">{t('howto.outdated')}</p>

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
      <!-- One capital, two roads: the upper one carries charges to a charged unit, the lower one is
           cut. The pieces are the match's Engraved ones (#839): an own road is a band of the own
           colour with a light lane, a cut one dashed lanes on a dark casing, a packet a square of
           the own colour on a casing with an ink outline, a city the disc on a dark cut. -->
      <path d="M52 44L292 26" class="road" />
      <path d="M52 44L292 26" class="lane" />
      {#each [120, 170, 220] as x (x)}
        {@const y = 44 - ((x - 52) * 18) / 240}
        <g transform={`translate(${String(x)} ${String(y)}) rotate(-4.3)`}>
          <rect x="-4.6" y="-4.6" width="9.2" height="9.2" class="pk-casing" />
          <rect x="-3" y="-3" width="6" height="6" class="pk" />
          <rect x="-4" y="-4" width="8" height="8" class="pk-ink" />
        </g>
      {/each}
      <path d="M52 52L132 66" class="road" />
      <path d="M52 52L132 66" class="lane" />
      <path d="M212 80L292 72" class="road buffer" />
      <path d="M212 80L292 72" class="lane buffer" />
      <path d="M154 60l22 22M176 60l-22 22" class="cut-casing" />
      <path d="M154 60l22 22M176 60l-22 22" class="cut" />
      <PicCity x={36} y={48} kind="own" capital />
      <PicCity x={308} y={24} kind="plate" />
      <g transform="translate(297 15)">
        <HelmetIcon side="own" size={24} engraved />
      </g>
      <PicCity x={308} y={72} kind="plate" />
      <g transform="translate(297 63)">
        <HelmetIcon side="own" size={24} share={0} engraved />
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
            <li>
              <span class="sr">{aria(f)}</span>
              <span class="lab" aria-hidden="true">{f.label}</span>
              <span class="side" aria-hidden="true">
                {#each cells(totals.a.units, f.a) as cell, i (i)}
                  <UnitCell side="own" {cell} />
                {/each}
                {#if f.bonusA > 0}
                  <span class="bonus" aria-hidden="true"><BonusChevron size={14} />×{f.bonusA}</span
                  >
                {/if}
              </span>
              <span class="side" aria-hidden="true">
                {#each cells(totals.b.units, f.b) as cell, i (i)}
                  <UnitCell side="enemy" {cell} />
                {/each}
                {#if f.bonusB > 0}
                  <span class="bonus" aria-hidden="true"><BonusChevron size={14} />×{f.bonusB}</span
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
      <defs>
        <pattern id="howto-hatch-own" width="6" height="2.6" patternUnits="userSpaceOnUse">
          <rect width="6" height="0.9" class="hatch-own" />
        </pattern>
      </defs>
      <PicCity x={36} y={26} kind="plate" />
      <PicCity x={324} y={26} kind="neutral" />
      <g transform="translate(25 17)">
        <HelmetIcon side="own" size={24} engraved />
      </g>
      <!-- The planned order: the match's Engraved ribbon, a dark plate hatched in the own colour. -->
      <path d="M58 16h200l24 10-24 10H58z" class="ribbon-casing" />
      <path d="M58 16h200l24 10-24 10H58z" class="ribbon" />
      <path d="M58 16h200l24 10-24 10H58z" class="ribbon-edge" />
      <!-- The bonus shots in front of the ribbon: the green chevrons of a bonus (#797). -->
      <path d="M174 17l6-6 6 6M206 17l6-6 6 6" class="bonusmark-out" />
      <path d="M174 17l6-6 6 6M206 17l6-6 6 6" class="bonusmark" />
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
      <path d="M52 26h56M148 26h56M244 26h56" class="lane" />
      <PicCity x={36} y={26} kind="own" capital />
      {#each [128, 224, 320] as x (x)}
        <PicCity {x} y={26} kind="own" />
        <!-- The gilt lozenge of the city's victory points, as on the map. -->
        <g transform={`translate(${String(x + 14)} 12) rotate(45)`}>
          <rect x="-7" y="-7" width="14" height="14" class="vp-plate" />
          <rect x="-6.5" y="-6.5" width="13" height="13" class="vp-rule" />
          <rect x="-4.6" y="-4.6" width="9.2" height="9.2" class="vp-rule" />
        </g>
        <text x={x + 14} y="12.5" class="num vp">1</text>
      {/each}
      <text x="36" y="52" class="num small">×{rules.capital_multiplier}</text>
    </svg>
  </section>
</div>

<style>
  .hw {
    margin-top: 14px;
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

  /* Read by a screen reader instead of the drawing of the frame. */
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .frames li {
    position: relative;
  }

  .hw:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 4px;
  }

  .outdated {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--surface-2);
    font-size: 13px;
    color: var(--text-dim);
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

  /* The match's Engraved pieces (#839; render/style.ts): an own road is a band of the own colour
     under a light lane, a buffer road dashed lanes on a dark casing. */
  .road {
    fill: none;
    stroke: var(--own);
    stroke-opacity: 0.62;
    stroke-width: 5.6;
  }

  .road.buffer {
    stroke: var(--cut);
    stroke-opacity: 0.4;
  }

  .lane {
    fill: none;
    stroke: #e6edf3;
    stroke-opacity: 0.95;
    stroke-width: 2;
  }

  .lane.buffer {
    stroke: #aab2bd;
    stroke-dasharray: 7 5;
  }

  /* A packet: a square of the own colour on a dark casing with an ink outline. */
  .pk-casing {
    fill: var(--casing);
  }

  .pk {
    fill: var(--own);
  }

  .pk-ink {
    fill: none;
    stroke: var(--ink);
    stroke-width: 0.8;
  }

  .cut,
  .cut-casing {
    fill: none;
    stroke-linecap: round;
  }

  .cut-casing {
    stroke: var(--casing);
    stroke-width: 5.6;
  }

  .cut {
    stroke: var(--warn);
    stroke-width: 2.4;
  }

  .num {
    fill: var(--ink);
    font: 600 15px var(--font-text);
    font-variant-numeric: lining-nums tabular-nums;
    text-anchor: middle;
    dominant-baseline: central;
  }

  .num.small {
    font-size: 13px;
    fill: var(--text-dim);
  }

  .num.vp {
    font-size: 11px;
    fill: var(--vp);
  }

  /* The gilt lozenge of victory points: a dark square with two gilt squares. */
  .vp-plate {
    fill: var(--casing);
  }

  .vp-rule {
    fill: none;
    stroke: var(--vp);
    stroke-width: 1;
  }

  /* The planned order: a dark casing round a dark plate hatched in the own colour, a hairline edge. */
  .ribbon-casing {
    fill: var(--plate);
    fill-opacity: 0.9;
    stroke: var(--casing);
    stroke-width: 4;
    stroke-linejoin: round;
  }

  .ribbon {
    fill: url(#howto-hatch-own);
  }

  .hatch-own {
    fill: var(--own);
    opacity: 0.85;
  }

  .ribbon-edge {
    fill: none;
    stroke: var(--own);
    stroke-width: 1.2;
    stroke-linejoin: round;
  }

  .bonusmark,
  .bonusmark-out {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .bonusmark-out {
    stroke: var(--bg);
    stroke-width: 5.6;
  }

  .bonusmark {
    stroke: var(--badge-up);
    stroke-width: 2.8;
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

  .result {
    margin-top: 8px;
    font-size: 13px;
  }
</style>
