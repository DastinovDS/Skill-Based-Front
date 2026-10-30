<script lang="ts">
  import type { Leaderboard, PlayerProfile } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { t, tf } from '../i18n/index.ts';
  import UnitMark from '../app/UnitMark.svelte';
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

<!-- The leaderboard (#629, L10): one wide table with the record of each player (matches, W-L-D
     and the share of wins, all from `GET /api/leaderboard`); no match list on this tab. -->
<div class="board">
  <h2>{t('menu.leaderboard')}</h2>
  {#if board.status === 'loading'}
    <p class="sr" role="status">{t('board.loading')}</p>
    <div class="skeletons" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
  {:else if board.status === 'failed'}
    <p class="alert" role="alert">
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
        <button type="button" class="action" onclick={onretry}>
          <Icon name="refresh" size={15} />{t('board.retry')}
        </button>
      </span>
    </p>
  {:else if loaded !== null}
    {@const needed = loaded.min_rated_matches}
    {@const ownStatus = own === null ? null : statusOf(own)}
    {#if loaded.entries.length === 0}
      <div class="empty">
        <span class="em">{t('board.empty.title')}</span>
        <span class="ds"
          >{tf(ownStatus?.kind === 'guest' ? 'board.empty.bodyGuest' : 'board.empty.body', {
            n: needed,
          })}</span
        >
        {#if ownStatus?.kind === 'guest'}
          <button type="button" class="action primary" onclick={onpassword}
            >{t('board.empty.password')}</button
          >
        {:else if ownStatus !== null}
          <button type="button" class="action primary" onclick={onplay}
            >{t('board.empty.play')}</button
          >
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
                {#if me}<UnitMark side="own" size={14} />{/if}<b>{entry.nick}</b>
                {#if me}<span class="sr">{t('board.you')}</span>{/if}
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
                <UnitMark side="own" size={14} /><b>{own.nick}</b>
                <span class="sr">{t('board.you')}</span>
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
        <UnitMark side="own" size={16} /><b>{own.nick}</b>
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
    box-sizing: border-box;
    max-width: 820px;
    padding: 16px 20px;
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

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 15px;
  }

  th,
  td {
    height: 38px;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }

  th {
    height: 28px;
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .r {
    text-align: right;
  }

  .rank {
    width: 34px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .dim {
    color: var(--text-dim);
  }

  .num {
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .nick {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .nick :global(svg) {
    margin-right: 6px;
    vertical-align: -1px;
  }

  /* The own row: a band and a bar at the left edge, the own triangle and "You" for assistive technology. */
  tr.me :global(td) {
    background: #1a2740;
  }

  tr.me td:first-child {
    box-shadow: inset 3px 0 0 var(--you);
    color: var(--text);
  }

  .gap td {
    height: 26px;
    text-align: center;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    border-bottom-style: dashed;
  }

  .pinned {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 10px 8px 0;
    border-top: 1px dashed var(--border);
    font-size: 14px;
  }

  .cells {
    display: inline-flex;
    gap: 3px;
  }

  .cells i {
    display: block;
    width: 16px;
    height: 8px;
    border: 1.5px solid var(--you);
    border-radius: 2px;
  }

  .cells i.on {
    background: var(--you);
  }

  .lnk {
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .skeletons i {
    display: block;
    height: 34px;
    margin: 6px 0;
    border-radius: 6px;
    background: repeating-linear-gradient(
      135deg,
      rgb(230 237 243 / 7%) 0 7px,
      rgb(230 237 243 / 2%) 7px 14px
    );
  }

  .alert {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 14px 0 0;
    color: var(--warn);
    font-size: 14px;
  }

  .alert span {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }

  .action.primary {
    height: 40px;
    margin-top: 8px;
    padding: 0 18px;
    border-color: var(--paper);
    background: var(--you);
    color: var(--bg);
    font-weight: 700;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 40px 20px;
    text-align: center;
  }

  .em {
    font-size: 20px;
    font-weight: 800;
  }

  .ds {
    font-size: 14px;
    color: var(--text-dim);
  }

  .action:focus-visible,
  .lnk:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: 2px;
  }
</style>
