<script lang="ts">
  import type { PlayerProfile } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { t, tf } from '../i18n/index.ts';
  import UnitMark from '../app/UnitMark.svelte';
  import type { Load } from './boardState.svelte.ts';
  import MatchRow from './MatchRow.svelte';
  import RecordBlock from './RecordBlock.svelte';
  import { statusOf, visibleMatches } from './view.ts';

  interface Props {
    load: Load<PlayerProfile>;
    /** The profile of the player themself: every kind of match is listed, "You" is written. */
    own: boolean;
    /** How many players are ranked (the leaderboard's `total`), if the board has loaded. */
    total: number | null;
    /** The clock of "2 hr. ago" (ms since the epoch). */
    now: number;
    /** The Replays row of the menu: bring the match history into view. */
    focusHistory?: boolean;
    onprofile: (playerId: number) => void;
    onwatch: (matchId: number) => void;
    onretry: () => void;
    onshowown: () => void;
  }

  let {
    load,
    own,
    total,
    now,
    focusHistory = false,
    onprofile,
    onwatch,
    onretry,
    onshowown,
  }: Props = $props();

  /** The server sends the last 20 finished matches (README, `GET /api/players/{id}`). */
  const HISTORY_LIMIT = 20;

  let heading = $state<HTMLElement | undefined>();

  // The Replays row opens this panel on its history: scroll there once the profile is on screen.
  $effect(() => {
    if (!focusHistory || load.status !== 'ready' || heading === undefined) return;
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
  });

  const retryIn = (seconds: number | null): string | null =>
    seconds === null ? null : tf('profile.error.limitedIn', { seconds });

  // The profile once it has loaded (the template reads it through this, not through `load`).
  const loaded = $derived(load.status === 'ready' ? load.value : null);
</script>

<section class="pane" aria-label={t('board.detailLabel')} aria-busy={load.status === 'loading'}>
  {#if load.status === 'loading'}
    <p class="sr" role="status">{t('profile.loading')}</p>
    <div class="skeleton name" aria-hidden="true"></div>
    <div class="skeleton numbers" aria-hidden="true"></div>
    <div class="skeleton line" aria-hidden="true"></div>
    <div class="skeleton line" aria-hidden="true"></div>
    <div class="skeleton line" aria-hidden="true"></div>
  {:else if load.status === 'failed' && load.failure === 'missing'}
    <div class="notice" role="alert">
      <span class="em">{t('profile.missing.title')}</span>
      <span class="ds">{t('profile.missing.body')}</span>
      <button type="button" class="action" onclick={onshowown}>
        <Icon name="chevronLeft" size={15} />{t('profile.missing.own')}
      </button>
    </div>
  {:else if load.status === 'failed'}
    <p class="alert" role="alert">
      <Icon name="alert" size={16} />
      <span>
        {#if load.failure === 'limited'}
          {retryIn(load.retryAfterS) ?? t('profile.error.limited')}
        {:else if load.failure === 'network'}
          {t('profile.error.network')}
        {:else}
          {t('profile.error.server')}
        {/if}
        <button type="button" class="action" onclick={onretry}>
          <Icon name="refresh" size={15} />{t('board.retry')}
        </button>
      </span>
    </p>
  {:else if loaded !== null}
    {@const profile = loaded}
    {@const status = statusOf(profile)}
    {@const matches = visibleMatches(profile, own)}
    <div class="identity">
      <UnitMark side={own ? 'own' : 'enemy'} size={44} />
      <div class="ident">
        <h2>
          {profile.nick}{#if own}<span class="you">{t('board.you')}</span>{/if}
        </h2>
        <div class="status">
          {#if status.kind === 'ranked'}
            <span class="badge ranked"
              ><Icon name="trophy" size={13} />{status.rank === null
                ? t('profile.status.ranked')
                : tf('profile.status.rankedAt', { rank: status.rank })}</span
            >
          {:else if status.kind === 'calibrating'}
            <span class="badge calibration">
              <span
                class="cells"
                role="img"
                aria-label={tf('menu.calibrationAria', {
                  played: status.played,
                  total: status.total,
                })}
              >
                {#each Array.from({ length: status.total }, (_, i) => i) as i (i)}
                  <i class:on={i < status.played}></i>
                {/each}
              </span>
              {tf('profile.status.calibration', { played: status.played, total: status.total })}
            </span>
          {:else}
            <span class="badge guest"><Icon name="user" size={13} />{t('menu.guest')}</span>
          {/if}
        </div>
      </div>
    </div>

    <div class="stats">
      {#if status.kind === 'ranked'}
        <div class="stat">
          <b class="big">{status.rating}</b>
          <span class="cap">{t('profile.rating')}</span>
        </div>
        {#if status.rank !== null}
          <div class="stat">
            <b class="mid">#{status.rank}</b>
            <span class="cap"
              >{total === null ? t('profile.rank') : tf('profile.rankOf', { total })}</span
            >
          </div>
        {/if}
      {:else if status.kind === 'calibrating'}
        <div class="stat">
          <b class="big dash" aria-label={t('profile.noRating')}>&ndash;</b>
          <span class="cap">{t('profile.rating')}</span>
        </div>
        <div class="stat">
          <b class="mid">{status.played}/{status.total}</b>
          <span class="cap">{t('profile.calibration')}</span>
          <small>{tf('profile.calibration.hidden', { total: status.total })}</small>
        </div>
      {:else}
        <div class="stat">
          <b class="big dash" aria-label={t('profile.noRating')}>&ndash;</b>
          <span class="cap">{t('profile.rating')}</span>
        </div>
        <div class="stat">
          <span class="gap"></span>
          <span class="cap">{t('profile.noRating')}</span>
          <small>{own ? t('profile.noRating.own') : t('profile.noRating.other')}</small>
        </div>
      {/if}
    </div>

    <div class="records">
      <RecordBlock label={t('profile.record.ranked')} record={profile.rated_record} />
      <RecordBlock label={t('profile.record.all')} record={profile.record} />
    </div>

    <h3 class="history" tabindex="-1" bind:this={heading}>
      {t('profile.history')}
      <span class="badge">{tf('profile.history.max', { n: HISTORY_LIMIT })}</span>
      {#if !own}<span class="badge">{t('profile.history.rankedOnly')}</span>{/if}
    </h3>
    {#if matches.length > 0}
      <div class="head" aria-hidden="true">
        <span>{t('history.col.result')}</span>
        <span>{t('history.col.opponent')}</span>
        <span class="right">{t('history.col.rating')}</span>
        <span class="right">{t('history.col.replay')}</span>
      </div>
      <ul class="matches">
        {#each matches as match (match.match_id)}
          <MatchRow {match} {now} {onprofile} {onwatch} />
        {/each}
      </ul>
    {:else if profile.matches.length > 0}
      <div class="empty">
        <b>{t('profile.noRanked.title')}</b>
        {t('profile.noRanked.body')}
      </div>
    {:else}
      <div class="empty">
        <b>{t('profile.empty.title')}</b>
        {own ? t('profile.empty.own') : t('profile.empty.other')}
      </div>
    {/if}
  {/if}
</section>

<style>
  .pane {
    box-sizing: border-box;
    min-width: 0;
    max-height: 100%;
    overflow-y: auto;
    padding: 20px 22px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .identity {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .ident {
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.1;
    overflow-wrap: anywhere;
  }

  .you {
    display: inline-flex;
    align-items: center;
    height: 20px;
    margin-left: 10px;
    padding: 0 8px;
    border: 1px solid var(--paper);
    border-radius: 10px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    vertical-align: 4px;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: rgb(13 17 23 / 55%);
    color: var(--text-dim);
    font-size: 13px;
    letter-spacing: 0;
    text-transform: none;
    white-space: nowrap;
  }

  .badge.ranked {
    border-color: var(--you);
    color: var(--text);
  }

  .badge.calibration {
    border-style: dashed;
    color: var(--text);
  }

  .badge.guest {
    border-style: dashed;
    border-color: var(--warn);
    color: var(--warn);
  }

  .stats {
    display: flex;
    align-items: flex-end;
    gap: 26px;
    margin-top: 10px;
  }

  .stat {
    display: flex;
    flex-direction: column;
  }

  .stat .big {
    font-size: 38px;
    line-height: 1.05;
    font-weight: 800;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .stat .mid {
    font-size: 28px;
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .stat .dash {
    color: var(--text-dim);
  }

  .stat .gap {
    height: 46px;
  }

  .cap {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  small {
    font-size: 13px;
    color: var(--text-dim);
  }

  .records {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 10px;
  }

  .history {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin: 14px 0 4px;
    font-size: 12px;
    font-weight: 400;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .history:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 4px;
  }

  .head {
    display: grid;
    grid-template-columns: 78px minmax(0, 1fr) 96px 112px;
    gap: 10px;
    padding: 0 6px;
    min-height: 24px;
    align-items: center;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .head .right {
    text-align: right;
  }

  .matches {
    margin: 0;
    padding: 0;
  }

  .empty {
    padding: 18px 4px;
    color: var(--text-dim);
    font-size: 15px;
  }

  .empty b {
    display: block;
    margin-bottom: 2px;
    font-size: 20px;
    color: var(--text);
  }

  .alert span {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .alert {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    color: var(--warn);
    font-size: 14px;
    line-height: 1.35;
  }

  .notice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .notice .em {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .notice .ds {
    font-size: 14px;
    color: var(--text-dim);
  }

  .action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }

  .action:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }

  .skeleton {
    margin: 6px 0;
    border-radius: 6px;
    background: repeating-linear-gradient(
      135deg,
      rgb(230 237 243 / 7%) 0 7px,
      rgb(230 237 243 / 2%) 7px 14px
    );
  }

  .skeleton.name {
    height: 52px;
  }

  .skeleton.numbers {
    height: 64px;
  }

  .skeleton.line {
    height: 34px;
  }

  @media (max-width: 760px) {
    .records {
      grid-template-columns: 1fr;
    }
  }
</style>
