<script lang="ts">
  import { onMount } from 'svelte';
  import { lengthText } from '../board/time.ts';
  import Icon from '../hud/Icon.svelte';
  import { vpShare } from '../hud/topBar.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import type { EndReason, MapFile, MatchEndMsg, PlayerId } from '../protocol.gen.ts';
  import type { MatchSummary } from './matchSummary.ts';
  import ScreenFrame from './ScreenFrame.svelte';
  import UnitMark from './UnitMark.svelte';

  interface Props {
    me: PlayerId;
    end: MatchEndMsg;
    /** Own data of the match (nicks, cities, VP peak); null when the client has none (a reload). */
    summary?: MatchSummary | null;
    /** The map drawn behind the screen (null: the plain dark page). */
    map?: MapFile | null;
    onreplay: () => void;
    onmenu: () => void;
  }

  let { me, end, summary = null, map = null, onreplay, onmenu }: Props = $props();

  // Keyboard keys are not words of a language: they are labelled the same in every locale.
  const KEY_REPLAY = '↵';
  const KEY_MENU = 'Esc';

  type Outcome = 'win' | 'lose' | 'draw';
  const outcome = $derived<Outcome>(
    end.winner === null ? 'draw' : end.winner === me ? 'win' : 'lose',
  );
  const VERDICTS = {
    win: 'result.victory',
    lose: 'result.defeat',
    draw: 'result.draw',
  } as const satisfies Record<Outcome, MessageKey>;

  // The reason is worded from our side; the winner is known from the message (no game logic here).
  const REASONS: Record<EndReason, Partial<Record<Outcome, MessageKey>>> = {
    capital_captured: {
      win: 'result.reason.capital_captured.win',
      lose: 'result.reason.capital_captured.lose',
    },
    timer: {
      win: 'result.reason.timer.win',
      lose: 'result.reason.timer.lose',
      draw: 'result.reason.timer.draw',
    },
    forfeit: { win: 'result.reason.forfeit.win', lose: 'result.reason.forfeit.lose' },
    disconnect: { win: 'result.reason.disconnect.win', lose: 'result.reason.disconnect.lose' },
    double_defeat: { draw: 'result.reason.double_defeat.draw' },
  };

  const mineNick = $derived(summary?.nicks.mine ?? t('result.you'));
  const enemyNick = $derived(summary?.nicks.enemy ?? t('result.opponent'));
  const reason = $derived(
    tf(REASONS[end.reason][outcome] ?? (`result.reason.${end.reason}` as const), {
      nick: enemyNick,
    }),
  );

  const mineVp = $derived(end.vp[me]);
  const enemyVp = $derived(end.vp[me === 0 ? 1 : 0]);
  const share = $derived(vpShare(mineVp, enemyVp));

  // The three numbers the client has from its own screen; units lost and charges delivered need
  // the server (follow-up of #596).
  const stats = $derived(
    [
      summary?.cities != null ? { key: 'result.stat.cities', value: String(summary.cities) } : null,
      summary?.vpPeak != null
        ? { key: 'result.stat.vpPeak', value: String(Math.max(summary.vpPeak, mineVp)) }
        : null,
      { key: 'result.stat.length', value: lengthText(end.tick) ?? '' },
    ].filter((stat) => stat !== null),
  );

  const delta = $derived(end.rating === null ? 0 : end.rating.after - end.rating.before);

  let verdictEl: HTMLElement | undefined = $state();
  // The verdict is read out when the screen opens; Enter and Esc work from the first moment.
  onMount(() => {
    verdictEl?.focus({ preventScroll: true });
  });

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const onControl = target instanceof Element && target.closest('input, select, button, a');
    if (event.key === 'Escape') {
      event.preventDefault();
      onmenu();
    } else if (event.key === 'Enter' && !onControl) {
      event.preventDefault();
      onreplay();
    }
  }
</script>

<svelte:window {onkeydown} />

<ScreenFrame {map} label={t('result.title')}>
  <div class="eyebrow">{t('result.title')}</div>
  <h2 class="verdict {outcome}" tabindex="-1" bind:this={verdictEl}>
    <span class="marks" aria-hidden="true">
      {#if outcome !== 'lose'}<UnitMark side="own" size={34} />{/if}
      {#if outcome !== 'win'}<UnitMark side="enemy" size={34} />{/if}
    </span>
    {t(VERDICTS[outcome])}
  </h2>
  <p class="sub reason">{reason}</p>

  <div
    class="score"
    role="group"
    aria-label={tf('result.score', {
      mine: mineVp,
      mineNick,
      enemy: enemyVp,
      enemyNick,
    })}
  >
    <b class="nm mine">{mineNick}</b>
    <b class="nm enemy">{enemyNick}</b>
    <span class="vp mine" aria-hidden="true">{mineVp}</span>
    <span class="tug" aria-hidden="true">
      <span class="tug-mine" style:flex-basis="{share}%"></span>
      <span class="tug-enemy"></span>
    </span>
    <span class="vp enemy" aria-hidden="true">{enemyVp}</span>
  </div>

  <dl class="stats">
    {#each stats as stat (stat.key)}
      <div>
        <dd>{stat.value}</dd>
        <dt>{t(stat.key as MessageKey)}</dt>
      </div>
    {/each}
  </dl>

  {#if end.rating !== null}
    <div class="rate">
      <span class="cap">{t('result.rating')}</span>
      <span class="delta"
        ><span aria-hidden="true">{delta < 0 ? '↓' : delta > 0 ? '↑' : '='}</span>
        {delta > 0 ? `+${String(delta)}` : String(delta)}</span
      >
      <span class="range"
        >{tf('result.ratingFrom', { before: end.rating.before, after: end.rating.after })}</span
      >
    </div>
  {/if}
  {#if end.calibration !== null}
    <div class="cal">
      <span
        class="cells"
        role="img"
        aria-label={tf('result.calibration', {
          played: end.calibration.played,
          total: end.calibration.total,
        })}
      >
        {#each Array.from({ length: end.calibration.total }, (_, i) => i) as i (i)}
          <i class:on={i < (end.calibration?.played ?? 0)}></i>
        {/each}
      </span>
      <span class="cap"
        >{tf('result.calibration', {
          played: end.calibration.played,
          total: end.calibration.total,
        })}</span
      >
    </div>
    {#if end.rating === null}
      <p class="hint">{t('result.calibrationHidden')}</p>
    {/if}
  {/if}
  <!-- DEC-34: a match that did not change the rating says why. -->
  {#if !end.rated && end.unrated_reason !== null}
    <p class="unrated" role="status">
      <span class="chip">{t('result.notRanked')}</span>
      {t(`result.unrated.${end.unrated_reason}`)}
    </p>
  {/if}

  <div class="acts">
    <button type="button" class="cta" aria-keyshortcuts="Enter" onclick={onreplay}>
      <Icon name="history" size={20} />{t('result.replay')}<kbd class="k" aria-hidden="true"
        >{KEY_REPLAY}</kbd
      >
    </button>
    <button type="button" class="linkbtn" aria-keyshortcuts="Escape" onclick={onmenu}>
      {t('result.menu')}<kbd class="k" aria-hidden="true">{KEY_MENU}</kbd>
    </button>
  </div>
</ScreenFrame>

<style>
  .verdict {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 8px 0 4px;
    font-size: 40px;
    line-height: 1.1;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--text);
  }
  .verdict:focus {
    outline: none;
  }
  .verdict.win {
    color: var(--you);
  }
  .verdict.lose {
    color: var(--enemy);
  }
  .marks {
    display: inline-flex;
    gap: 2px;
  }
  .reason {
    margin: 0;
    font-size: 16px;
    color: var(--text);
  }

  .score {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 4px 12px;
    margin-top: 22px;
    width: 370px;
    max-width: 100%;
  }
  .nm {
    grid-row: 1;
    font-size: 14px;
    overflow-wrap: anywhere;
  }
  .nm.mine {
    grid-column: 1 / 3;
  }
  .nm.enemy {
    grid-column: 3;
    text-align: right;
  }
  .vp {
    grid-row: 2;
    font-size: 28px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .vp.mine {
    grid-column: 1;
    color: var(--you);
  }
  .vp.enemy {
    grid-column: 3;
    color: var(--enemy);
  }
  .tug {
    grid-row: 2;
    grid-column: 2;
    display: flex;
    height: 10px;
    overflow: hidden;
    border: 1px solid var(--paper);
    border-radius: 3px;
  }
  .tug-mine {
    flex: 0 0 auto;
    background: var(--you);
  }
  .tug-enemy {
    flex: 1 1 0;
    background: var(--enemy);
  }

  .stats {
    display: flex;
    gap: 28px;
    margin: 22px 0 0;
    padding: 12px 0 0;
    border-top: 1px solid rgb(230 237 243 / 10%);
    width: 370px;
    max-width: 100%;
  }
  .stats div {
    display: flex;
    flex-direction: column-reverse;
  }
  .stats dd {
    margin: 0;
    font-size: 26px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .stats dt {
    font-size: 13px;
    color: var(--text-dim);
  }

  .rate,
  .cal {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
    margin-top: 18px;
  }
  .cal {
    align-items: center;
  }
  .cap {
    font-size: 13px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .delta {
    font-size: 28px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .range {
    font-size: 14px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .unrated {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    margin: 18px 0 0;
    font-size: 14px;
    color: var(--text-dim);
  }

  .acts {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    margin-top: 28px;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 48px;
    padding: 0 16px;
    border: 0;
    border-radius: 8px;
    background: var(--you);
    color: var(--bg);
    font: inherit;
    font-size: 18px;
    font-weight: 700;
    cursor: pointer;
  }
  .cta:hover {
    filter: brightness(1.1);
  }
  .cta :global(.k) {
    background: rgb(13 17 23 / 18%);
    border-color: rgb(13 17 23 / 45%);
    color: var(--bg);
  }
</style>
