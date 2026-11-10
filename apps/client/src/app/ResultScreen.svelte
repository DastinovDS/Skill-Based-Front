<script lang="ts">
  import { onMount } from 'svelte';
  import { lengthText } from '../board/time.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import { vpShare } from '../hud/topBar.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import type { EndReason, MapFile, MatchEndMsg, PlayerId } from '../protocol.gen.ts';
  import type { MatchSummary } from './matchSummary.ts';
  import ScreenFrame from './ScreenFrame.svelte';
  import UnitMark from './UnitMark.svelte';
  import { colourVar } from '../theme/tokens.ts';

  interface Props {
    me: PlayerId;
    end: MatchEndMsg;
    /** Own data of the match (the nicks); null when the client has none (a reload). */
    summary?: MatchSummary | null;
    /** The map drawn behind the screen (null: the plain dark page). */
    map?: MapFile | null;
    /** The map of the match, its code for the player to name it (#771). */
    mapId?: string | null;
    onreplay: () => void;
    onmenu: () => void;
  }

  let { me, end, summary = null, map = null, mapId = null, onreplay, onmenu }: Props = $props();

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

  // Each side in its player's colour when the match told them (DEC-49), else today's pair.
  const colours = $derived(summary?.colours ?? null);

  const mineVp = $derived(end.vp[me]);
  const enemyVp = $derived(end.vp[me === 0 ? 1 : 0]);
  const share = $derived(vpShare(mineVp, enemyVp));

  // The numbers are the server's totals of the whole match in match_end (#824; definitions:
  // docs/design/ui-style.md 13.6); without them only the match length is shown.
  // The order of the Lapis result (#845): the units, the places, the attacks and defenses, the length.
  interface Stat {
    key: MessageKey;
    value: string;
    /** "9 of 11": the total, set apart by an italic "of". */
    of?: number;
  }
  // The spaces round "of" are part of the text (read aloud and copied as "9 of 11").
  const ofWord = $derived(` ${t('result.stat.of')} `);
  const stats = $derived.by((): Stat[] => {
    const length = { key: 'result.stat.length', value: lengthText(end.tick) ?? '' } as const;
    const s = end.stats;
    if (s === null) return [length];
    return [
      { key: 'result.stat.unitsKilled', value: String(s.units_killed) },
      { key: 'result.stat.unitsLost', value: String(s.units_lost) },
      { key: 'result.stat.citiesCaptured', value: String(s.cities_captured) },
      { key: 'result.stat.provincesCaptured', value: String(s.provinces_captured) },
      { key: 'result.stat.attacksWon', value: String(s.attacks_won), of: s.attacks },
      { key: 'result.stat.defensesHeld', value: String(s.defenses_held), of: s.defenses },
      length,
    ];
  });

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

<ScreenFrame {map} label={t('result.title')} wide>
  <!-- The result (Lapis, #845): the verdict in big cut capitals with the helmets of the outcome,
       the reason, the score as a tug, the server's totals, the rating; the replay first. -->
  <div
    class="res"
    class:player-sides={colours !== null}
    style:--own={colours === null ? undefined : colourVar(colours[me])}
    style:--enemy={colours === null ? undefined : colourVar(colours[me === 0 ? 1 : 0])}
  >
    <p class="kicker">
      {mapId === null ? t('result.title') : `${t('result.title')} · ${mapId}`}
    </p>
    <h2 class="verdict" tabindex="-1" bind:this={verdictEl}>
      <span class="marks" aria-hidden="true">
        {#if outcome !== 'lose'}<UnitMark side="own" size={46} />{/if}
        {#if outcome !== 'win'}<UnitMark side="enemy" size={46} />{/if}
      </span>
      {t(VERDICTS[outcome])}
    </h2>
    <p class="reason">{reason}</p>

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
      <span class="vp mine" aria-hidden="true">{mineVp}</span>
      <span class="tug" aria-hidden="true">
        <span class="tug-mine" style:flex-basis="{share}%"></span>
        <span class="tug-enemy"></span>
      </span>
      <span class="vp enemy" aria-hidden="true">{enemyVp}</span>
      <b class="nm enemy">{enemyNick}</b>
    </div>

    <dl class="stats">
      {#each stats as stat (stat.key)}
        <div>
          <dt>{t(stat.key)}</dt>
          <dd>
            {stat.value}{#if stat.of !== undefined}<span class="of">{ofWord}</span>{stat.of}{/if}
          </dd>
        </div>
      {/each}
    </dl>

    {#if end.rating !== null}
      <div class="rate">
        <span class="cap">{t('result.rating')}</span>
        <span class="delta" class:up={delta > 0}
          ><span aria-hidden="true">{delta < 0 ? '↓' : delta > 0 ? '↑' : '='}</span>
          {delta > 0 ? `+${String(delta)}` : String(delta)}</span
        >
        <span class="range"
          >{tf('result.ratingFrom', { before: end.rating.before, after: end.rating.after })}</span
        >
      </div>
    {/if}
    {#if end.calibration !== null}
      <div class="rate">
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
    {/if}
    <!-- No rating at the MVP (#919): an unrated match says nothing about the rating. The rating
         and the calibration above show only if the server sends them (off, GOW_RATING_ENABLED). -->

    <div class="acts">
      <LapisButton variant="primary" aria-keyshortcuts="Enter" onclick={onreplay}
        >{t('result.replay')}</LapisButton
      >
      <button type="button" class="lnk" aria-keyshortcuts="Escape" onclick={onmenu}>
        {t('result.menu')}
      </button>
    </div>
  </div>
</ScreenFrame>

<style>
  /* The result stands on the stone of the play screens, left, under the bar (Lapis, #845). */
  .res {
    padding-bottom: 32px;
    /* The two sides: today's Lapis pair, or the players' colours of the match (DEC-49). */
    --mine: var(--own-lapis);
    --theirs: var(--enemy-lapis);
  }

  .res.player-sides {
    --mine: var(--own);
    --theirs: var(--enemy);
  }

  .verdict {
    display: flex;
    align-items: center;
    gap: 28px;
    margin: 10px 0 0;
    font: 400 104px / 1.05 var(--font-display);
    letter-spacing: 0.14em;
    color: var(--ink);
  }

  .verdict:focus {
    outline: none;
  }

  .marks {
    display: inline-flex;
    gap: 6px;
  }

  .reason {
    margin: 6px 0 0;
    font-size: 23px;
    font-style: italic;
    color: var(--ink);
  }

  .score {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 14px;
    width: 760px;
    max-width: 100%;
    margin-top: 34px;
  }

  /* The nicks are in ink, the points in the players' colours (DEC-49, item 5). */
  .nm {
    min-width: 0;
    overflow-wrap: anywhere;
    font: 500 15px / 1.2 var(--font-display);
    letter-spacing: 0.14em;
    color: var(--ink);
  }

  .vp.mine {
    color: var(--mine);
  }

  .vp.enemy {
    color: var(--theirs);
  }

  .vp {
    font-size: 42px;
    line-height: 1;
  }

  .tug {
    display: flex;
    height: 6px;
  }

  .tug-mine {
    flex: 0 0 auto;
    background: var(--mine);
  }

  .tug-enemy {
    flex: 1 1 0;
    background: var(--theirs);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    column-gap: 40px;
    width: 1024px;
    max-width: 100%;
    margin: 30px 0 0;
    padding-top: 5px;
    background:
      linear-gradient(var(--cut), var(--cut)) 0 0 / 100% 1px no-repeat,
      linear-gradient(var(--line), var(--line)) 0 1px / 100% 1px no-repeat,
      linear-gradient(var(--lit-faint), var(--lit-faint)) 0 4px / 100% 1px no-repeat;
  }

  .stats div {
    padding: 14px 0 12px;
    border-bottom: 1px solid rgb(61 55 45 / 45%);
  }

  .stats dt {
    font: 500 11.5px / 1.3 var(--font-display);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .stats dd {
    margin: 2px 0 0;
    font-size: 34px;
    line-height: 1.1;
  }

  .of {
    margin: 0 2px;
    font-size: 19px;
    font-style: italic;
    color: var(--ink-dim);
  }

  .rate {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 14px;
    margin: 26px 0 0;
  }

  .rate .cells {
    align-self: center;
  }

  .cap {
    font: 500 11.5px / 1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .delta {
    font-size: 30px;
  }

  .delta.up {
    color: var(--mine);
  }

  .range {
    color: var(--ink-dim);
    font-style: italic;
  }

  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
    margin-top: 34px;
  }

  @media (max-width: 1279px) {
    .verdict {
      font-size: 80px;
    }
  }

  @media (max-width: 899px), (max-height: 560px) {
    .verdict {
      gap: 16px;
      font-size: 52px;
    }

    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
