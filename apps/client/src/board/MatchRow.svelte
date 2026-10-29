<script lang="ts">
  import type { MatchEntry } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { getLocale, t, tf, type MessageKey } from '../i18n/index.ts';
  import ReplayChip from './ReplayChip.svelte';
  import { agoText, lengthText } from './time.ts';
  import { botLabel, ratingOf } from './view.ts';

  interface Props {
    match: MatchEntry;
    /** The clock of "2 hr. ago" (ms since the epoch). */
    now: number;
    /** Open the profile of the opponent (a player, not a bot). */
    onprofile: (playerId: number) => void;
    onwatch: (matchId: number) => void;
  }

  let { match, now, onprofile, onwatch }: Props = $props();

  const RESULTS = {
    win: { key: 'history.win', shape: 'w' },
    loss: { key: 'history.loss', shape: 'l' },
    draw: { key: 'history.draw', shape: 'd' },
  } as const satisfies Record<MatchEntry['result'], { key: MessageKey; shape: string }>;

  const KINDS = {
    rated: 'history.kind.rated',
    calibration: 'history.kind.calibration',
    unrated: 'history.kind.unrated',
    casual: 'history.kind.casual',
    bot: 'history.kind.bot',
  } as const satisfies Record<MatchEntry['kind'], MessageKey>;

  const result = $derived(RESULTS[match.result]);
  const opponent = $derived(
    match.opponent.bot ? botLabel(match.opponent.nick, t) : match.opponent.nick,
  );
  const rating = $derived(ratingOf(match));
  const details = $derived(
    [match.map_id, lengthText(match.ticks), agoText(match.ended_at, now, getLocale())]
      .filter((part) => part !== null)
      .join(' · '),
  );
</script>

<li class="match">
  <span class="result {result.shape}"><i aria-hidden="true"></i>{t(result.key)}</span>
  <span class="opp">
    <span class="line">
      {#if match.opponent.bot}
        <span class="name"><Icon name="bot" size={16} /><b>{opponent}</b></span>
      {:else if match.opponent.player_id !== null}
        {@const id = match.opponent.player_id}
        <button
          type="button"
          class="name link"
          aria-label={tf('profile.opponentAria', { nick: opponent })}
          onclick={() => {
            onprofile(id);
          }}><b>{opponent}</b></button
        >
      {:else}
        <span class="name"><b>{opponent}</b></span>
      {/if}
      <span
        class="kind"
        class:ranked={match.kind === 'rated'}
        class:calibration={match.kind === 'calibration'}
      >
        {#if match.kind === 'bot'}<Icon name="bot" size={13} />{/if}{t(KINDS[match.kind])}
      </span>
    </span>
    <small>{details}</small>
  </span>
  <span class="rating">
    {#if rating.kind === 'change'}
      {rating.delta}
      <small aria-label={tf('history.rating.range', { before: rating.before, after: rating.after })}
        >{rating.before} &rarr; {rating.after}</small
      >
    {:else if rating.kind === 'hidden'}
      <small class="hidden" title={t('history.rating.hiddenTitle')}
        >{t('history.rating.hidden')}</small
      >
    {:else}
      <small class="hidden" aria-hidden="true">&ndash;</small>
    {/if}
  </span>
  <span class="replay">
    <ReplayChip
      state={match.replay.state}
      {opponent}
      onwatch={() => {
        onwatch(match.match_id);
      }}
    />
  </span>
</li>

<style>
  .match {
    display: grid;
    grid-template-columns: 78px minmax(0, 1fr) 96px 112px;
    align-items: center;
    gap: 10px;
    padding: 0 6px;
    min-height: 42px;
    border-bottom: 1px solid rgb(230 237 243 / 9%);
    font-size: 15px;
    list-style: none;
  }

  .result {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-weight: 700;
  }

  /* The result is a shape and a word: a filled, an empty or a half dot. */
  .result i {
    flex: none;
    width: 12px;
    height: 12px;
    border: 2px solid var(--you);
    border-radius: 50%;
  }

  .result.w i {
    background: var(--you);
  }

  .result.d i {
    background: linear-gradient(90deg, var(--you) 50%, transparent 50%);
  }

  .opp {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    font-weight: 700;
  }

  .name b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    text-decoration: underline;
    text-decoration-color: rgb(230 237 243 / 28%);
    text-underline-offset: 3px;
  }

  .link:hover {
    text-decoration-color: var(--text);
  }

  .link:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }

  .kind {
    display: inline-flex;
    align-items: center;
    flex: none;
    gap: 5px;
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: rgb(13 17 23 / 55%);
    color: var(--text-dim);
    font-size: 12px;
  }

  .kind.ranked {
    border-color: var(--you);
    color: var(--text);
  }

  .kind.calibration {
    border-style: dashed;
    color: var(--text);
  }

  small {
    color: var(--text-dim);
    font-size: 12.5px;
    white-space: nowrap;
  }

  .rating {
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .rating small {
    display: block;
    font-weight: 400;
    font-size: 12px;
  }

  .rating small.hidden {
    font-size: 13px;
  }

  .replay {
    display: flex;
    justify-content: flex-end;
  }
</style>
