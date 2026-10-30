<script lang="ts">
  import type { MatchEntry } from '../api/http.ts';
  import MapThumb from '../app/MapThumb.svelte';
  import Icon from '../hud/Icon.svelte';
  import { getLocale, t, tf, type MessageKey } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import ReplayChip from './ReplayChip.svelte';
  import { agoText, lengthText } from './time.ts';
  import { botLabel, ratingOf } from './view.ts';

  interface Props {
    match: MatchEntry;
    /** The file of the match's map for the small picture, null while it loads. */
    map: MapFile | null;
    /** The clock of "2 hr. ago" (ms since the epoch). */
    now: number;
    onwatch: (matchId: number) => void;
  }

  let { match, map, now, onwatch }: Props = $props();

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

<!-- One match as a card (#629, R2): the map drawn small, the result as a shape and a word, the
     opponent, the kind, then the replay. The server says the result, the rating and the replay. -->
<li class="card">
  <MapThumb {map} />
  <div class="head">
    <span class="result {result.shape}"><i aria-hidden="true"></i>{t(result.key)}</span>
    {#if rating.kind === 'change'}
      <span
        class="delta"
        aria-label={tf('history.rating.range', { before: rating.before, after: rating.after })}
        >{rating.delta}</span
      >
    {:else if rating.kind === 'hidden'}
      <small class="hidden" title={t('history.rating.hiddenTitle')}
        >{t('history.rating.hidden')}</small
      >
    {/if}
  </div>
  <div class="opp">
    {#if match.opponent.bot}<Icon name="bot" size={15} />{/if}<b>{opponent}</b>
    <span
      class="kind"
      class:ranked={match.kind === 'rated'}
      class:calibration={match.kind === 'calibration'}>{t(KINDS[match.kind])}</span
    >
  </div>
  <small>{details}</small>
  <div class="replay">
    <ReplayChip
      state={match.replay.state}
      {opponent}
      onwatch={() => {
        onwatch(match.match_id);
      }}
    />
  </div>
</li>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    list-style: none;
    font-size: 15px;
  }

  .card :global(.thumb) {
    width: 100%;
    height: auto;
    aspect-ratio: 16 / 9;
    margin-bottom: 4px;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .result {
    display: inline-flex;
    align-items: center;
    gap: 7px;
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

  .result.l i {
    border-color: var(--paper);
  }

  .result.d i {
    background: linear-gradient(90deg, var(--you) 50%, transparent 50%);
  }

  .delta {
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .opp {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .opp b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind {
    display: inline-flex;
    align-items: center;
    flex: none;
    height: 20px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 10px;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
    font-size: 13px;
  }

  .replay {
    display: flex;
    margin-top: 6px;
  }
</style>
