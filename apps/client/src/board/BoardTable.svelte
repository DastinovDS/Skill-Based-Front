<script lang="ts">
  import type { Leaderboard, PlayerProfile } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { t, tf } from '../i18n/index.ts';
  import UnitMark from '../app/UnitMark.svelte';
  import LapisButton from '../theme/LapisButton.svelte';
  import type { Load } from './boardState.svelte.ts';
  import RecordCells from './RecordCells.svelte';
  import { statusOf } from './view.ts';

  interface Props {
    board: Load<Leaderboard>;
    /** The own profile, once it is known: the pinned row of a player who is not in the top. */
    own: PlayerProfile | null;
    ownId: number | null;
    onretry: () => void;
    /** The empty board offers the next step: a password for a guest, the queue for an account. */
    onpassword: () => void;
    onplay: () => void;
  }

  let { board, own, ownId, onretry, onpassword, onplay }: Props = $props();

  const loaded = $derived(board.status === 'ready' ? board.value : null);
</script>

<!-- The leaderboard (#629, L10; Lapis, #845): one wide table with the record of each player
     (matches, W-L-D and the share of wins, all from `GET /api/leaderboard`). The own row has a band,
     the own helmet and "You". -->
<div class="board">
  <div class="sheethead">
    <p class="kicker">{t('board.kicker')}</p>
    <h2>{t('menu.leaderboard')}</h2>
  </div>
  {#if board.status === 'loading'}
    <p class="sr" role="status">{t('board.loading')}</p>
    <div class="skeletons" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
  {:else if board.status === 'failed'}
    <div class="empty">
      <p class="wl" role="alert">
        <Icon name="alert" size={16} />
        <span>
          {#if board.failure === 'limited'}
            {board.retryAfterS === null
              ? t('board.error.limited')
              : tf('board.error.limitedIn', { seconds: board.retryAfterS })}
          {:else if board.failure === 'network'}
            {t('board.error.network')}
          {:else}
            {t('board.error.server')}
          {/if}
        </span>
      </p>
      <LapisButton onclick={onretry}>{t('board.retry')}</LapisButton>
    </div>
  {:else if loaded !== null}
    {@const needed = loaded.min_rated_matches}
    {@const ownStatus = own === null ? null : statusOf(own)}
    {#if loaded.entries.length === 0}
      <div class="empty">
        <p class="eh">{t('board.empty.title')}</p>
        <p>
          {tf(ownStatus?.kind === 'guest' ? 'board.empty.bodyGuest' : 'board.empty.body', {
            n: needed,
          })}
        </p>
        {#if ownStatus?.kind === 'guest'}
          <LapisButton variant="primary" onclick={onpassword}
            >{t('board.empty.password')}</LapisButton
          >
        {:else if ownStatus !== null}
          <LapisButton variant="primary" onclick={onplay}>{t('board.empty.play')}</LapisButton>
        {/if}
      </div>
    {:else}
      {@const inTop = loaded.entries.some((e) => e.player_id === ownId)}
      <table>
        <thead>
          <tr>
            <th class="rank">{t('board.col.rank')}</th>
            <th>{t('board.col.player')}</th>
            <th class="r">{t('board.col.matches')}</th>
            <th class="r">{t('board.col.record')}</th>
            <th class="r">{t('board.col.wins')}</th>
            <th class="r">{t('board.col.rating')}</th>
          </tr>
        </thead>
        <tbody>
          {#each loaded.entries as entry (entry.player_id)}
            {@const me = entry.player_id === ownId}
            <tr class:me aria-current={me ? 'true' : undefined}>
              <td class="rank">{entry.rank}</td>
              <td class="nick">
                {#if me}<UnitMark side="own" size={18} />{/if}<b>{entry.nick}</b>
                {#if me}<span class="you">{t('board.you')}</span>{/if}
              </td>
              <RecordCells matches={entry.rated_matches} tally={entry.record} />
              <td class="r num">{entry.rating}</td>
            </tr>
          {/each}
          <!-- The own place when the top does not show it: a gap, then the own row. -->
          {#if own !== null && ownStatus?.kind === 'ranked' && ownStatus.rank !== null && !inTop}
            <tr class="gap">
              <td colspan="6">
                <span aria-hidden="true">&middot; &middot; &middot;</span>
                <span class="sr">{t('board.pinned.beyond')}</span>
              </td>
            </tr>
            <tr class="me" aria-current="true">
              <td class="rank">{ownStatus.rank}</td>
              <td class="nick">
                <UnitMark side="own" size={18} /><b>{own.nick}</b>
                <span class="you">{t('board.you')}</span>
              </td>
              <RecordCells matches={own.rated_matches} tally={own.rated_record} />
              <td class="r num">{ownStatus.rating}</td>
            </tr>
          {/if}
        </tbody>
      </table>
    {/if}
    {#if own !== null && ownStatus?.kind === 'calibrating'}
      <p class="pinned">
        <UnitMark side="own" size={18} /><b>{own.nick}</b>
        <span
          class="cells"
          role="img"
          aria-label={tf('menu.calibrationAria', {
            played: ownStatus.played,
            total: ownStatus.total,
          })}
        >
          {#each Array.from({ length: ownStatus.total }, (_, i) => i) as i (i)}
            <i class:on={i < ownStatus.played}></i>
          {/each}
        </span>
        <span class="dim">{tf('board.pinned.calibration', { n: needed })}</span>
      </p>
    {:else if own !== null && ownStatus?.kind === 'guest' && loaded.entries.length > 0}
      <p class="pinned">
        <button type="button" class="lnk" onclick={onpassword}>{t('board.empty.password')}</button>
        <span class="dim">{t('board.pinned.guestShort')}</span>
      </p>
    {/if}
  {/if}
</div>

<style>
  .board {
    max-width: 1024px;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 18px;
  }

  th,
  td {
    padding: 5px 14px 5px 0;
    border-bottom: 1px solid rgb(61 55 45 / 45%);
    text-align: left;
    white-space: nowrap;
  }

  th {
    padding: 0 14px 12px 0;
    border-bottom: 1px solid var(--cut);
    box-shadow: 0 1px 0 var(--line);
    font: 500 11.5px / 1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .r {
    text-align: right;
  }

  .rank {
    width: 56px;
    color: var(--ink-dim);
  }

  .dim {
    color: var(--ink-dim);
  }

  .num {
    font-size: 22px;
  }

  .nick {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nick b {
    font: 500 15px / 1.2 var(--font-display);
    letter-spacing: 0.12em;
  }

  .nick :global(svg) {
    margin-right: 8px;
    vertical-align: -4px;
  }

  /* The own row: a lapis band, the own helmet and "You" (the words carry it, not the band). */
  tr.me :global(td) {
    background: rgb(125 156 226 / 10%);
  }

  .you {
    margin-left: 8px;
    padding: 2px 6px 1px;
    border: 1px solid var(--own-lapis);
    color: var(--own-lapis);
    font: 500 10px / 1.2 var(--font-display);
    letter-spacing: 0.2em;
    text-transform: uppercase;
    vertical-align: 2px;
  }

  .gap td {
    text-align: center;
    color: var(--ink-dim);
    letter-spacing: 0.1em;
    border-bottom-style: dashed;
  }

  .pinned {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin: 0;
    padding: 14px 0 0;
    font-size: 17px;
  }

  .pinned b {
    font: 500 15px / 1.2 var(--font-display);
    letter-spacing: 0.12em;
  }

  .pinned .dim {
    font-style: italic;
  }

  .skeletons i {
    display: block;
    height: 34px;
    margin: 0;
    border-bottom: 1px solid rgb(61 55 45 / 45%);
    background: repeating-linear-gradient(
      135deg,
      rgb(236 228 209 / 5%) 0 7px,
      rgb(236 228 209 / 1%) 7px 14px
    );
  }
</style>
