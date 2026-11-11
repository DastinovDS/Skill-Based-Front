<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import type { Api, MatchEntry, PlayerProfile } from '../api/http.ts';
  import type { AccountFailure } from '../app/account.ts';
  import ColourPicker from '../app/ColourPicker.svelte';
  import LogoutDialog from '../app/LogoutDialog.svelte';
  import NickDialog from '../app/NickDialog.svelte';
  import UnitMark from '../app/UnitMark.svelte';
  import Icon from '../hud/Icon.svelte';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import type { MapFile, PlayerColour } from '../protocol.gen.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import { colourVar } from '../theme/tokens.ts';
  import { failed, type Load } from './load.ts';
  import ReplayChip from './ReplayChip.svelte';
  import SheetFrame from './SheetFrame.svelte';
  import { lengthText } from './time.ts';
  import { botLevel, levelCells, profileFacts, recordText } from './view.ts';

  interface Props {
    api: Pick<Api, 'player' | 'me'>;
    token: string;
    /** The own player id, if the app knows it (otherwise the screen asks the server). */
    ownId: number | null;
    nick: string;
    hasPassword: boolean;
    map: MapFile | null;
    onwatch: (matchId: string) => void;
    /** The empty list offers a match against a bot. */
    onbot: () => void;
    /** A new nick (`PUT /api/me/nick`); the answer is why it failed, or null. */
    onnick: (nick: string) => Promise<AccountFailure | null>;
    /** The colour asked for in matches (DEC-49); null while unknown. */
    colour?: PlayerColour | null;
    /** A new colour (`PUT /api/me/colour`); the answer is why it failed, or null. Without it no picker. */
    oncolour?: (colour: PlayerColour) => Promise<MessageKey | null>;
    /** The two quiet links of the header (#919): the settings and the way out. */
    onsettings: () => void;
    onlogout: () => void;
    /** The guest's log-out warning offers to set a password first. */
    onpassword: () => void;
    /** The "?" of the bar: How to play. */
    onhelp: () => void;
    /** Esc: back to the screen the profile was opened from. */
    onback: () => void;
  }

  let {
    api,
    token,
    ownId,
    nick,
    hasPassword,
    map,
    onwatch,
    onbot,
    onnick,
    colour = null,
    oncolour,
    onsettings,
    onlogout,
    onpassword,
    onhelp,
    onback,
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
  const matches = $derived(own.status === 'ready' ? own.value.matches : []);

  let nickOpen = $state(false);
  let confirmingLogout = $state(false);
  let saved = $state(false);
  let changeLink: HTMLButtonElement | undefined = $state();

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    // The nick dialog and the log-out warning keep their own keys while they are open.
    if (nickOpen || confirmingLogout) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onback();
    }
  }

  /** A guest without a password loses the account by logging out: the warning asks first. */
  function logout(): void {
    if (hasPassword) onlogout();
    else confirmingLogout = true;
  }

  const RESULTS = {
    win: { key: 'history.win', shape: 'w' },
    loss: { key: 'history.loss', shape: 'l' },
    draw: { key: 'history.draw', shape: 'd' },
  } as const satisfies Record<MatchEntry['result'], { key: MessageKey; shape: string }>;

  /** The opponent of a row: the nick, or "Normal bot" (the level as lozenges beside it). */
  function opponentOf(match: MatchEntry): string {
    if (!match.opponent.bot) return match.opponent.nick;
    const level = botLevel(match.opponent.nick);
    return level === null
      ? match.opponent.nick
      : tf('bot.seat', { level: t(`bot.level.${level}`) });
  }
</script>

<svelte:window {onkeydown} />

<SheetFrame
  {map}
  label={t('profile.title')}
  player={{ nick, guest: !hasPassword, onprofile: () => undefined, here: true }}
  {onhelp}
>
  <!-- The own profile (#919, III Plinth: the sheet on the blurred stone): the player with the two
       quiet links, the colour and the facts, then the matches with Watch (the replays live here). -->
  <div class="profile">
    <div class="prof-h">
      <span class="mark" style:--own={colour === null ? undefined : colourVar(colour)}>
        <UnitMark side="own" size={56} />
      </span>
      <div class="name">
        <p class="kicker">{t('profile.kicker')}</p>
        <h2>{nick}</h2>
      </div>
      <button
        bind:this={changeLink}
        type="button"
        class="lnk change"
        onclick={() => {
          saved = false;
          nickOpen = true;
        }}>{t('profile.nick.change')}</button
      >
      {#if saved}<p class="sr" role="status">{t('profile.nick.saved')}</p>{/if}
      <div class="tools">
        <button type="button" class="lnk" onclick={onsettings}>{t('settings.title')}</button>
        <button type="button" class="lnk" onclick={logout}>{t('menu.logout')}</button>
      </div>
    </div>

    <div class="prow">
      {#if oncolour !== undefined}
        <div class="colour">
          <ColourPicker value={colour} onchange={oncolour} />
        </div>
      {/if}
      {#if facts !== null}
        <dl class="facts">
          <div>
            <dt>{t('profile.fact.matches')}</dt>
            <dd>{facts.matches}</dd>
          </div>
          <div>
            <dt>{t('profile.fact.record')}</dt>
            <dd
              aria-label={tf('profile.fact.recordAria', {
                wins: facts.record.wins,
                losses: facts.record.losses,
                draws: facts.record.draws,
              })}
            >
              {recordText(facts.record)}
            </dd>
          </div>
        </dl>
      {/if}
    </div>

    {#if own.status === 'loading'}
      <p class="sr" role="status">{t('profile.loading')}</p>
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
    {:else}
      <h3 class="sec">{t('profile.matches')}</h3>
      {#if matches.length === 0}
        <div class="empty">
          <p class="eh">{t('profile.empty.title')}</p>
          <LapisButton variant="primary" onclick={onbot}>{t('menu.bot')}</LapisButton>
        </div>
      {:else}
        <div class="histbox">
          <table class="hist">
            <thead>
              <tr>
                <th class="c-res">{t('profile.col.result')}</th>
                <th>{t('profile.col.opponent')}</th>
                <th>{t('profile.col.map')}</th>
                <th class="r c-len">{t('profile.col.length')}</th>
                <th class="c-rp">{t('profile.col.replay')}</th>
              </tr>
            </thead>
            <tbody>
              {#each matches as match (match.match_id)}
                {@const result = RESULTS[match.result]}
                {@const opponent = opponentOf(match)}
                {@const level = match.opponent.bot ? botLevel(match.opponent.nick) : null}
                <tr>
                  <td class="res {result.shape}">
                    <svg viewBox="0 0 11 10" width="11" height="10" aria-hidden="true">
                      {#if result.shape === 'w'}<path
                          d="M5.5 .5 10.5 9.5H.5Z"
                        />{:else if result.shape === 'l'}<path
                          d="M5.5 9.5 10.5 .5H.5Z"
                        />{:else}<rect x="1" y="4" width="9" height="2.2" />{/if}
                    </svg>{t(result.key)}
                  </td>
                  <td class="opp">
                    {#if level !== null}
                      {@const cells = levelCells(level)}
                      <span
                        class="botmark"
                        role="img"
                        aria-label={tf('bot.difficultyAria', { level: cells, total: 4 })}
                      >
                        {#each [1, 2, 3, 4] as i (i)}<i class:on={i <= cells}></i>{/each}
                      </span>
                    {/if}<span>{opponent}</span>
                  </td>
                  <td>{match.map_id}</td>
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
        </div>
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
    {#if confirmingLogout}
      <LogoutDialog
        onpassword={() => {
          confirmingLogout = false;
          onpassword();
        }}
        {onlogout}
        onstay={() => {
          confirmingLogout = false;
        }}
      />
    {/if}
  {/snippet}
</SheetFrame>

<style>
  .profile {
    max-width: 1240px;
    margin: 0 auto;
  }

  /* The player: the helmet, the label and the nick, "Change the nick", and on the right the two
     quiet links (the mockup's `.prof-h`). */
  .prof-h {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 22px;
  }

  .prof-h p {
    margin: 0;
  }

  .mark {
    display: inline-flex;
  }

  .name {
    display: grid;
    gap: 4px;
  }

  .name h2 {
    margin: 0;
    font: 400 44px / 1 var(--font-display);
    letter-spacing: 0.1em;
  }

  .change {
    align-self: flex-end;
    margin-bottom: 6px;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 22px;
    margin-left: auto;
  }

  /* The colour and the facts on one line, their feet aligned. */
  .prow {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 18px 80px;
    margin-top: 24px;
  }

  .facts {
    display: flex;
    gap: 56px;
    margin: 0;
  }

  .facts div {
    display: grid;
    gap: 4px;
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
    margin: 0;
    font-size: 30px;
    line-height: 1;
    font-variant-numeric: lining-nums tabular-nums;
  }

  /* A section label with its doubled rule running to the right edge. */
  .sec {
    display: flex;
    align-items: center;
    gap: 18px;
    margin: 24px 0 12px;
  }

  .sec::after {
    content: '';
    flex: 1;
    height: 5px;
    background: var(--rule-dbl);
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  /* The match list grows with the matches. Where the sheet is a fixed frame under the bar (not the
     short or narrow windows, where the page flows), the profile fills it and only the list scrolls
     in its own box: the header, the colour and the facts stay, the page never scrolls (#940). */
  @media (min-width: 900px) and (min-height: 561px) {
    .profile {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }

    .profile > * {
      flex-shrink: 0;
    }

    .profile > .histbox {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: var(--line) transparent;
    }

    .histbox th {
      position: sticky;
      top: 0;
      z-index: 1;
      padding-top: 4px;
      background: #16130f;
    }
  }

  th {
    padding: 0 0 10px;
    text-align: left;
    border-bottom: 1px solid var(--cut);
    box-shadow: 0 1px 0 var(--line);
    font-size: 11px;
  }

  td {
    height: 46px;
    padding: 0;
    border-bottom: 1px solid rgb(61 55 45 / 70%);
    font-size: 18px;
    white-space: nowrap;
  }

  .c-res {
    width: 150px;
  }

  .c-len {
    width: 110px;
  }

  .c-rp {
    width: 120px;
  }

  .r {
    text-align: right;
    padding-right: 18px;
  }

  .num {
    font-variant-numeric: lining-nums tabular-nums;
  }

  .res {
    font: 500 12px / 1 var(--font-display);
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  .res svg {
    margin-right: 9px;
    vertical-align: 0;
    fill: currentColor;
  }

  .res.w {
    color: var(--own-lapis);
  }

  .res.l {
    color: var(--enemy-lapis);
  }

  .res.d {
    color: var(--ink-soft);
  }

  .opp {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The bot's level: four lozenges, filled up to it (a shape, not a colour). */
  .botmark {
    display: inline-flex;
    gap: 2px;
    margin-right: 8px;
    vertical-align: 1px;
  }

  .botmark i {
    display: block;
    width: 6px;
    height: 6px;
    border: 1px solid var(--ink-dim);
    transform: rotate(45deg);
  }

  .botmark i.on {
    background: var(--ink-dim);
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

  .rows-skel {
    margin-top: 62px;
  }

  .rows-skel i {
    height: 34px;
    border-bottom: 1px solid rgb(61 55 45 / 45%);
  }
</style>
