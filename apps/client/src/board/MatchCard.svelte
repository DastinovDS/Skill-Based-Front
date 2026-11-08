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
    [t(KINDS[match.kind]), match.map_id, lengthText(match.ticks)]
      .filter((part) => part !== null)
      .join(' · '),
  );
  const when = $derived(agoText(match.ended_at, now, getLocale()));
</script>

<!-- One match as a card (#629, R2; Lapis, #845): the map drawn small, then the result as a shape
     and a word (a triangle up, down, a bar), the opponent, the kind, the map and the length, when,
     and the replay. The server says the result, the rating and the replay. -->
<li class="card">
  <MapThumb {map} />
  <div class="cb">
    <p class="result {result.shape}">
      <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true" focusable="false">
        {#if result.shape === 'w'}<path d="M7 1.5 13 12.5H1z" />{:else if result.shape === 'l'}<path
            d="M7 12.5 1 1.5h12z"
          />{:else}<rect x="2" y="5" width="10" height="4" />{/if}
      </svg>{t(result.key)}
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
    </p>
    <p class="opp">
      {t('history.against')}
      {#if match.opponent.bot}<Icon name="bot" size={15} />{/if}<b>{opponent}</b>
    </p>
    <p class="cx">{details}</p>
    {#if when !== null}<p class="cd">{when}</p>{/if}
    <div class="replay">
      <ReplayChip
        state={match.replay.state}
        {opponent}
        onwatch={() => {
          onwatch(match.match_id);
        }}
      />
    </div>
  </div>
</li>

<style>
  /* Not the old `.card` of app.css: no box, a doubled rule over the card. */
  .card {
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr);
    gap: 20px;
    box-sizing: border-box;
    width: auto;
    min-width: 0;
    padding: 16px 0 0;
    border: 0;
    border-radius: 0;
    list-style: none;
    background:
      linear-gradient(var(--cut), var(--cut)) 0 0 / 100% 1px no-repeat,
      linear-gradient(var(--line), var(--line)) 0 1px / 100% 1px no-repeat,
      linear-gradient(var(--lit-faint), var(--lit-faint)) 0 4px / 100% 1px no-repeat;
  }

  .card :global(.thumb) {
    width: 168px;
    height: 98px;
  }

  .cb {
    display: grid;
    align-content: start;
    justify-items: start;
    gap: 1px;
    min-width: 0;
  }

  .cb p {
    margin: 0;
  }

  .result {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 500 13px / 1.3 var(--font-display);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .result svg {
    fill: currentColor;
  }

  .result.w {
    color: var(--own-lapis);
  }

  .result.l {
    color: var(--enemy-lapis);
  }

  .result.d {
    color: var(--ink);
  }

  .delta {
    margin-left: 4px;
    color: var(--ink);
    font: 400 17px var(--font-text);
    letter-spacing: 0;
  }

  .hidden {
    margin-left: 4px;
    color: var(--ink-dim);
    font: italic 400 15px var(--font-text);
    letter-spacing: 0;
    text-transform: none;
  }

  .opp {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
    font-size: 18px;
  }

  .opp b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .cx {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-dim);
    font-size: 16px;
    font-style: italic;
  }

  .cb .cd {
    margin: 2px 0 8px;
    font: 500 10px / 1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .replay {
    display: flex;
  }
</style>
