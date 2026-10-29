<script lang="ts">
  import type { Leaderboard, PlayerProfile } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { t, tf } from '../i18n/index.ts';
  import UnitMark from '../app/UnitMark.svelte';
  import type { Load } from './boardState.svelte.ts';
  import { statusOf } from './view.ts';

  interface Props {
    board: Load<Leaderboard>;
    /** The own profile, once it is known: the pinned row of a player who is not in the top. */
    own: PlayerProfile | null;
    ownId: number | null;
    /** The row the right panel shows: a player id, or `'own'`. */
    selected: number | 'own';
    onselect: (playerId: number | 'own') => void;
    onretry: () => void;
    /** The empty board offers the next step: a password for a guest, the queue for an account. */
    onpassword: () => void;
    onplay: () => void;
  }

  let { board, own, ownId, selected, onselect, onretry, onpassword, onplay }: Props = $props();

  // The list once it has loaded (the template reads it through this, not through `board`).
  const loaded = $derived(board.status === 'ready' ? board.value : null);

  const isSelected = (playerId: number): boolean =>
    selected === playerId || (selected === 'own' && playerId === ownId);

  // The arrow keys move between the rows; Tab still leaves the list.
  function onkeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const list = event.currentTarget;
    if (!(list instanceof HTMLElement)) return;
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('button.entry'));
    const at = rows.findIndex((row) => row === document.activeElement);
    const next = rows[at + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
  }
</script>

<section class="pane" aria-label={t('board.listLabel')}>
  <div class="over">{t('board.eyebrow')}</div>
  <h2>{t('board.title')}</h2>
  <div class="cols" aria-hidden="true">
    <span>{t('board.col.rank')}</span>
    <span>{t('board.col.player')}</span>
    <span class="right">{t('board.col.rating')}</span>
  </div>

  {#if board.status === 'loading'}
    <p class="sr" role="status">{t('board.loading')}</p>
    <div class="skeletons" aria-hidden="true">
      <i></i><i></i><i></i><i></i><i></i>
    </div>
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
    {@const entries = loaded.entries}
    {@const needed = loaded.min_rated_matches}
    {@const ownStatus = own === null ? null : statusOf(own)}
    {#if entries.length === 0}
      <div class="empty">
        <span class="triangles" aria-hidden="true">
          <UnitMark side="own" size={34} share={0.4} />
          <UnitMark side="own" size={34} share={0.7} />
          <UnitMark side="own" size={34} />
        </span>
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
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <ol class="entries" {onkeydown}>
        {#each entries as entry (entry.player_id)}
          {@const me = entry.player_id === ownId}
          <li>
            <button
              type="button"
              class="entry"
              class:me
              class:sel={isSelected(entry.player_id)}
              aria-current={me ? 'true' : undefined}
              aria-pressed={isSelected(entry.player_id)}
              onclick={() => {
                onselect(entry.player_id);
              }}
            >
              <span class="rank">{entry.rank}</span>
              <span class="nick">
                {#if me}<UnitMark side="own" size={16} />{/if}
                <b>{entry.nick}</b>
                {#if me}<span class="sr">{t('board.you')}</span>{/if}
              </span>
              <span class="rating">{entry.rating}</span>
            </button>
          </li>
        {/each}
      </ol>
    {/if}

    <!-- The own place when the top list does not show it: beyond the top, or not ranked yet. -->
    {#if own !== null && ownStatus !== null && !entries.some((e) => e.player_id === ownId)}
      {#if ownStatus.kind === 'ranked' && ownStatus.rank !== null}
        <div class="gap" role="separator" aria-label={t('board.pinned.beyond')}>
          &middot; &middot; &middot;
        </div>
        <div class="pinned">
          <button
            type="button"
            class="entry me"
            class:sel={selected === 'own'}
            aria-current="true"
            aria-pressed={selected === 'own'}
            onclick={() => {
              onselect('own');
            }}
          >
            <span class="rank">{ownStatus.rank}</span>
            <span class="nick"><UnitMark side="own" size={16} /><b>{own.nick}</b></span>
            <span class="rating">{ownStatus.rating}</span>
          </button>
        </div>
      {:else if ownStatus.kind === 'calibrating'}
        <button
          type="button"
          class="pincard"
          class:sel={selected === 'own'}
          aria-pressed={selected === 'own'}
          onclick={() => {
            onselect('own');
          }}
        >
          <UnitMark side="own" size={20} />
          <b>{own.nick}</b>
          <span class="state">
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
            <span class="cap">{ownStatus.played}/{ownStatus.total}</span>
          </span>
        </button>
        <p class="note">{tf('board.pinned.calibration', { n: needed })}</p>
      {:else if ownStatus.kind === 'guest'}
        <button
          type="button"
          class="pincard"
          class:sel={selected === 'own'}
          aria-pressed={selected === 'own'}
          onclick={() => {
            onselect('own');
          }}
        >
          <UnitMark side="own" size={20} />
          <b>{own.nick}</b>
          <span class="state guest">{t('menu.guest')}</span>
        </button>
        <p class="note">{tf('board.pinned.guest', { n: needed })}</p>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-width: 0;
    max-height: 100%;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
  }

  .over {
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  h2 {
    margin: 2px 0 12px;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .cols,
  .entry {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) 56px;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
  }

  .cols {
    flex: none;
    height: 24px;
    border-bottom: 1px solid var(--border);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .right {
    text-align: right;
  }

  .entries {
    flex: 1 1 auto;
    min-height: 120px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  .entry {
    width: 100%;
    height: 38px;
    border: 0;
    border-bottom: 1px solid rgb(230 237 243 / 9%);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
  }

  .entry:hover {
    background: rgb(230 237 243 / 6%);
  }

  .entry:focus-visible,
  .pincard:focus-visible,
  .action:focus-visible {
    outline: 2px solid var(--paper);
    outline-offset: -2px;
  }

  /* The chosen row: a band and a bar at the left edge, not only a tint. */
  .entry.sel {
    background: rgb(230 237 243 / 10%);
    box-shadow: inset 3px 0 0 var(--paper);
  }

  /* The own row: a blue band, the own triangle and the word "You" for assistive technology. */
  .entry.me {
    background: linear-gradient(90deg, rgb(91 155 255 / 24%), rgb(91 155 255 / 6%));
    border-bottom-color: var(--you);
  }

  .entry.me.sel {
    box-shadow: inset 3px 0 0 var(--paper);
  }

  .rank {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
  }

  .entry.me .rank {
    color: var(--text);
  }

  .nick {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .nick b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rating {
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .gap {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 30px;
    color: var(--text-dim);
    font-size: 13px;
    letter-spacing: 0.1em;
  }

  .gap::before,
  .gap::after {
    content: '';
    flex: 1;
    border-top: 1px dashed var(--border);
  }

  .pinned {
    flex: none;
    border-top: 2px solid var(--border);
  }

  .pinned .entry {
    border-bottom: 0;
  }

  .pincard {
    flex: none;
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: rgb(13 17 23 / 55%);
    color: var(--text);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }

  .pincard.sel {
    border-color: var(--paper);
  }

  .pincard b {
    font-size: 16px;
  }

  .state {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .state.guest {
    height: 22px;
    padding: 0 9px;
    border: 1px dashed var(--warn);
    border-radius: 11px;
    color: var(--warn);
    font-size: 12px;
  }

  .cap {
    white-space: nowrap;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .note {
    flex: none;
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--text-dim);
  }

  .skeletons {
    margin-top: 6px;
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
    margin: 14px 0 0;
    color: var(--warn);
    font-size: 14px;
    line-height: 1.35;
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

  .action.primary {
    margin: 6px 0 0;
    border-color: var(--paper);
    background: var(--you);
    color: var(--bg);
    font-weight: 700;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 16px 4px 4px;
  }

  .triangles {
    display: flex;
    align-items: flex-end;
    gap: 6px;
  }

  .em {
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .ds {
    font-size: 14px;
    color: var(--text-dim);
  }
</style>
