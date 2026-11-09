<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import type { Api, MatchEntry, PlayerProfile } from '../api/http.ts';
  import type { AccountFailure } from '../app/account.ts';
  import AccountChip from '../app/AccountChip.svelte';
  import MenuTabs from '../app/MenuTabs.svelte';
  import type { AccountPages, MenuTabActions } from '../app/menuTabs.ts';
  import NickDialog from '../app/NickDialog.svelte';
  import UnitMark from '../app/UnitMark.svelte';
  import Icon from '../hud/Icon.svelte';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import type { Calibration, MapFile } from '../protocol.gen.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import { failed, type Load } from './boardState.svelte.ts';
  import ReplayChip from './ReplayChip.svelte';
  import SheetFrame from './SheetFrame.svelte';
  import { lengthText } from './time.ts';
  import {
    botLabel,
    profileFacts,
    ratingOf,
    recordText,
    visibleMatches,
    type FactValue,
  } from './view.ts';

  interface Props extends MenuTabActions, AccountPages {
    api: Pick<Api, 'player' | 'me'>;
    token: string;
    /** The own player id, if the app knows it (otherwise the screen asks the server). */
    ownId: number | null;
    nick: string;
    hasPassword: boolean;
    calibration: Calibration | null;
    rating: number | null;
    map: MapFile | null;
    onwatch: (matchId: string) => void;
    /** The empty list offers a match against a bot. */
    onbot: () => void;
    /** A new nick (`PUT /api/me/nick`); the answer is why it failed, or null. */
    onnick: (nick: string) => Promise<AccountFailure | null>;
    onpassword: () => void;
    onlogout: () => void;
    /** Esc: back to the screen the profile was opened from. */
    onback: () => void;
  }

  let {
    api,
    token,
    ownId,
    nick,
    hasPassword,
    calibration,
    rating,
    map,
    onwatch,
    onbot,
    onnick,
    onpassword,
    onlogout,
    onback,
    onplay,
    onreplays,
    onboard,
    onhowto,
    onprofile,
    onsettings,
  }: Props = $props();

  const stop = new AbortController();
  let own = $state.raw<Load<PlayerProfile>>({ status: 'loading' });

  /** The own profile: the facts and the last matches (`GET /api/players/{id}`). */
  async function load(): Promise<void> {
    own = { status: 'loading' };
    try {
      const id = untrack(() => ownId) ?? (await api.me(token)).player_id;
      own = { status: 'ready', value: await api.player(id, token, stop.signal) };
    } catch (error) {
      if (!stop.signal.aborted) own = failed(error);
    }
  }

  onMount(() => {
    void load();
  });
  onDestroy(() => {
    stop.abort();
  });

  const facts = $derived(own.status === 'ready' ? profileFacts(own.value) : null);
  const matches = $derived(own.status === 'ready' ? visibleMatches(own.value, true) : []);

  let accountOpen = $state(false);
  let nickOpen = $state(false);
  let saved = $state(false);
  let changeLink: HTMLButtonElement | undefined = $state();

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    // The account menu and the nick dialog keep their own keys while they are open.
    if (accountOpen || nickOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onback();
    }
  }

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

  /** A number, or the word for a hidden (calibration) or missing (guest) one. */
  function factText(fact: FactValue): string {
    if (fact.kind === 'number') return String(fact.value);
    return t(fact.kind === 'hidden' ? 'profile.value.hidden' : 'profile.value.none');
  }

  const opponentOf = (match: MatchEntry): string =>
    match.opponent.bot ? botLabel(match.opponent.nick, t) : match.opponent.nick;
</script>

<svelte:window {onkeydown} />

<SheetFrame {map} label={t('profile.title')}>
  {#snippet tabs()}
    <MenuTabs current="board" {onplay} {onreplays} {onboard} {onhowto} />
  {/snippet}
  {#snippet corner()}
    <AccountChip
      {nick}
      {hasPassword}
      {calibration}
      {rating}
      {onprofile}
      {onsettings}
      {onpassword}
      {onlogout}
      bind:open={accountOpen}
    />
  {/snippet}

  <!-- The own profile (#871, Lapis round 2 `profile`): the player, the facts, the matches. -->
  <div class="profile">
    <div class="sheethead">
      <UnitMark side="own" size={46} />
      <div class="name">
        <p class="kicker">{t('profile.kicker')}</p>
        <h2>{nick}</h2>
      </div>
      <button
        bind:this={changeLink}
        type="button"
        class="lnk"
        onclick={() => {
          saved = false;
          nickOpen = true;
        }}>{t('profile.nick.change')}</button
      >
      {#if saved}<p class="sr" role="status">{t('profile.nick.saved')}</p>{/if}
    </div>

    {#if own.status === 'loading'}
      <p class="sr" role="status">{t('profile.loading')}</p>
      <div class="skel facts-skel" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <div class="skel rows-skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    {:else if own.status === 'failed'}
      <div class="empty">
        <p class="wl" role="alert">
          <Icon name="alert" size={16} />
          <span>
            {#if own.failure === 'limited'}
              {own.retryAfterS === null
                ? t('profile.error.limited')
                : tf('profile.error.limitedIn', { seconds: own.retryAfterS })}
            {:else if own.failure === 'network'}
              {t('profile.error.network')}
            {:else}
              {t('profile.error.server')}
            {/if}
          </span>
        </p>
        <LapisButton onclick={load}>{t('board.retry')}</LapisButton>
      </div>
    {:else if facts !== null}
      <dl class="facts">
        <div>
          <dt>{t('profile.fact.rating')}</dt>
          <dd class={facts.rating.kind === 'number' ? 'num' : 'word'}>{factText(facts.rating)}</dd>
        </div>
        <div>
          <dt>{t('profile.fact.rank')}</dt>
          <dd class={facts.rank.kind === 'number' ? 'num' : 'word'}>{factText(facts.rank)}</dd>
        </div>
        <div>
          <dt>{t(facts.matchesLabel)}</dt>
          <dd class="num">{facts.matches}</dd>
        </div>
        <div>
          <dt>{t('profile.fact.record')}</dt>
          <dd
            class="num"
            aria-label={tf('profile.fact.recordAria', {
              wins: facts.record.wins,
              losses: facts.record.losses,
              draws: facts.record.draws,
            })}
          >
            {recordText(facts.record)}
          </dd>
        </div>
        <div>
          <dt>{t('profile.fact.calibration')}</dt>
          {#if facts.status.kind === 'ranked'}
            <dd class="word on">{t('profile.calibration.done')}</dd>
          {:else if facts.status.kind === 'calibrating'}
            {@const status = facts.status}
            <dd class="word on">
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
              <span aria-hidden="true"
                >{tf('profile.calibration.progress', {
                  played: status.played,
                  total: status.total,
                })}</span
              >
            </dd>
          {:else}
            <dd class="word">
              <button type="button" class="lnk" onclick={onpassword}>{t('menu.setPassword')}</button
              >
            </dd>
          {/if}
        </div>
      </dl>

      <h3 class="sec">{t('profile.matches')}</h3>
      {#if matches.length === 0}
        <div class="empty">
          <p class="eh">{t('profile.empty.title')}</p>
          <LapisButton variant="primary" onclick={onbot}>{t('menu.bot')}</LapisButton>
        </div>
      {:else}
        <table class="hist">
          <thead>
            <tr>
              <th>{t('profile.col.result')}</th>
              <th>{t('profile.col.opponent')}</th>
              <th>{t('profile.col.map')}</th>
              <th>{t('profile.col.kind')}</th>
              <th class="r">{t('profile.col.rating')}</th>
              <th class="r">{t('profile.col.length')}</th>
              <th>{t('profile.col.replay')}</th>
            </tr>
          </thead>
          <tbody>
            {#each matches as match (match.match_id)}
              {@const result = RESULTS[match.result]}
              {@const change = ratingOf(match)}
              {@const opponent = opponentOf(match)}
              <tr>
                <td class="res {result.shape}">
                  <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
                    {#if result.shape === 'w'}<path
                        d="M7 1.5 13 12.5H1z"
                      />{:else if result.shape === 'l'}<path d="M7 12.5 1 1.5h12z" />{:else}<rect
                        x="2"
                        y="5"
                        width="10"
                        height="4"
                      />{/if}
                  </svg>{t(result.key)}
                </td>
                <td class="opp">
                  {#if match.opponent.bot}<Icon name="bot" size={15} />{/if}<span>{opponent}</span>
                </td>
                <td>{match.map_id}</td>
                <td>{t(KINDS[match.kind])}</td>
                <td class="r num">
                  {#if change.kind === 'change'}
                    <span
                      aria-label={tf('history.rating.range', {
                        before: change.before,
                        after: change.after,
                      })}>{change.delta}</span
                    >
                  {:else if change.kind === 'hidden'}
                    <span class="dim" title={t('history.rating.hiddenTitle')}
                      >{t('history.rating.hidden')}</span
                    >
                  {/if}
                </td>
                <td class="r num">{lengthText(match.ticks) ?? ''}</td>
                <td class="rp">
                  <ReplayChip
                    state={match.replay.state}
                    {opponent}
                    onwatch={() => {
                      onwatch(String(match.match_id));
                    }}
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}
  </div>

  {#snippet overlay()}
    {#if nickOpen}
      <NickDialog
        {nick}
        onsubmit={async (next: string) => {
          const failure = await onnick(next);
          if (failure === null) saved = true;
          return failure;
        }}
        onclose={() => {
          nickOpen = false;
          // The focus goes back to the link that opened the dialog.
          void tick().then(() => changeLink?.focus());
        }}
      />
    {/if}
  {/snippet}
</SheetFrame>

<style>
  .profile {
    max-width: 1024px;
  }

  /* The player: the helmet, the label and the nick in a row (the mockup's `.profile .sheethead`). */
  .sheethead {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 20px;
  }

  .sheethead p {
    margin: 0;
  }

  .sheethead .lnk {
    align-self: flex-end;
    margin-bottom: 4px;
    font-size: 16px;
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: 18px 64px;
    margin: 0;
  }

  .facts div {
    min-width: 0;
  }

  .facts dt,
  .sec,
  th {
    font: 500 11.5px / 1.3 var(--font-display);
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-dim);
  }

  .facts dd {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    margin: 2px 0 0;
    font-size: 30px;
    line-height: 1.2;
  }

  .facts dd.word {
    color: var(--ink-dim);
    font-size: 22px;
    font-style: italic;
  }

  .facts dd.word.on {
    color: var(--ink);
  }

  .facts dd .lnk {
    font-size: 20px;
  }

  /* The calibration cells, as the leaderboard draws them: filled for a match played. */
  .cells {
    display: inline-flex;
    gap: 3px;
  }

  .cells i {
    display: block;
    width: 9px;
    height: 14px;
    border: 1px solid var(--ink-dim);
  }

  .cells i.on {
    border-color: var(--ink);
    background: var(--ink);
  }

  /* A section label with its incised rule running to the right edge. */
  .sec {
    display: flex;
    align-items: center;
    gap: 18px;
    margin: 34px 0 14px;
  }

  .sec::after {
    content: '';
    flex: 1;
    border-top: 1px solid var(--cut);
    box-shadow: 0 1px 0 var(--line);
  }

  table {
    width: 100%;
    border-collapse: collapse;
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
  }

  td {
    font-size: 17px;
  }

  .r {
    text-align: right;
  }

  .num {
    font-variant-numeric: tabular-nums;
  }

  .dim {
    color: var(--ink-dim);
    font-style: italic;
  }

  .res {
    font: 500 13px / 1.3 var(--font-display);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .res svg {
    margin-right: 8px;
    vertical-align: -1px;
    fill: currentColor;
  }

  .res.w {
    color: var(--own-lapis);
  }

  .res.l {
    color: var(--enemy-lapis);
  }

  .res.d {
    color: var(--ink);
  }

  .opp {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .opp :global(svg) {
    display: inline-block;
    margin-right: 6px;
    vertical-align: -2px;
    color: var(--ink-dim);
  }

  .rp {
    padding-right: 0;
  }

  .rp :global(.st) {
    font-size: 17px;
  }

  .skel i {
    display: block;
    background: repeating-linear-gradient(
      135deg,
      rgb(236 228 209 / 5%) 0 7px,
      rgb(236 228 209 / 1%) 7px 14px
    );
  }

  .facts-skel {
    display: flex;
    gap: 64px;
  }

  .facts-skel i {
    width: 120px;
    height: 64px;
  }

  .rows-skel {
    margin-top: 62px;
  }

  .rows-skel i {
    height: 34px;
    border-bottom: 1px solid rgb(61 55 45 / 45%);
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
