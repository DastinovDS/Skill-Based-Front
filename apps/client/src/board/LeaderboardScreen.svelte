<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { Api } from '../api/http.ts';
  import AccountChip from '../app/AccountChip.svelte';
  import Icon from '../hud/Icon.svelte';
  import { t } from '../i18n/index.ts';
  import type { Calibration, MapFile } from '../protocol.gen.ts';
  import BoardList from './BoardList.svelte';
  import { BoardState } from './boardState.svelte.ts';
  import ProfilePanel from './ProfilePanel.svelte';
  import SplitFrame from './SplitFrame.svelte';

  interface Props {
    api: Pick<Api, 'leaderboard' | 'player' | 'me'>;
    token: string;
    /** The own player id, if the app knows it (otherwise the screen asks the server). */
    ownId: number | null;
    nick: string;
    hasPassword: boolean;
    calibration: Calibration | null;
    /** The displayed rating of the account for the corner chip, if known. */
    rating: number | null;
    map: MapFile | null;
    /**
     * `board`: the Leaderboard row; `history`: the Replays row, the own profile with its match
     * history in view (default 2 of #78).
     */
    mode: 'board' | 'history';
    /** A player to show instead of the own profile (back from a replay). */
    player: number | null;
    /** The clock of "2 hr. ago"; tests and dev scenes pass their own. */
    now?: () => number;
    /** The chosen player changed (`null`: the own profile): the app remembers it for "Back". */
    onselect: (playerId: number | null) => void;
    onwatch: (matchId: string) => void;
    onmenu: () => void;
    onbot: () => void;
    oncreate: () => void;
    onlobby: () => void;
    onreplays: () => void;
    onboard: () => void;
    onpassword: () => void;
    onlogout: () => void;
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
    mode,
    player,
    now = () => Date.now(),
    onselect,
    onwatch,
    onmenu,
    onbot,
    oncreate,
    onlobby,
    onreplays,
    onboard,
    onpassword,
    onlogout,
  }: Props = $props();

  // The data is asked once when the screen opens; the props that feed it do not change here.
  const data = untrack(() => new BoardState(api, token, ownId));
  const clock = untrack(() => now());

  onMount(() => {
    void data.start(untrack(() => player));
  });
  onDestroy(() => {
    data.stop();
  });

  // Keyboard keys are not words of a language: they are labelled the same in every locale.
  const ESC = 'Esc';

  let accountOpen = $state(false);

  const ownProfile = $derived(data.own.status === 'ready' ? data.own.value : null);
  const total = $derived(data.board.status === 'ready' ? data.board.value.total : null);

  function choose(id: number | 'own'): void {
    data.select(id);
    onselect(data.selected === 'own' ? null : data.selected);
  }

  // The rows of the menu, as on the start screen; the open one is marked.
  const rows = $derived([
    { id: 'bot', icon: 'bot', label: t('menu.bot'), key: 'B', go: onbot },
    { id: 'friend', icon: 'link', label: t('menu.create'), key: 'I', go: oncreate },
    { id: 'lobby', icon: 'users', label: t('menu.lobby'), key: 'L', go: onlobby },
    { id: 'replays', icon: 'history', label: t('menu.replays'), key: 'R', go: onreplays },
    { id: 'board', icon: 'trophy', label: t('menu.leaderboard'), key: 'T', go: onboard },
  ] as const);
  const current = $derived(mode === 'history' ? 'replays' : 'board');

  // Esc goes back to the menu; B, I, L, R and T open the other rows (the keys of the menu).
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    // The account menu keeps its own keys while it is open.
    if (accountOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onmenu();
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select')) return;
    const row = rows.find((r) => r.key.toLowerCase() === event.key.toLowerCase());
    if (row === undefined || row.id === current) return;
    event.preventDefault();
    row.go();
  }
</script>

<svelte:window {onkeydown} />

<SplitFrame {map} label={t('menu.nav')}>
  {#snippet corner()}
    <AccountChip
      {nick}
      {hasPassword}
      {calibration}
      {rating}
      {onpassword}
      {onlogout}
      bind:open={accountOpen}
    />
  {/snippet}

  {#snippet rail()}
    <button type="button" class="menuback" aria-keyshortcuts="Escape" onclick={onmenu}>
      <Icon name="chevronLeft" size={16} />{t('board.menu')}
      <kbd class="k" aria-hidden="true">{ESC}</kbd>
    </button>
    <div class="rows">
      {#each rows as row (row.id)}
        <button
          type="button"
          class="row"
          class:cur={row.id === current}
          aria-current={row.id === current ? 'page' : undefined}
          aria-keyshortcuts={row.key}
          onclick={row.id === current ? undefined : row.go}
        >
          <Icon name={row.icon} size={20} />{row.label}<kbd class="k" aria-hidden="true"
            >{row.key}</kbd
          >
        </button>
      {/each}
    </div>
  {/snippet}

  {#snippet panes()}
    <BoardList
      board={data.board}
      own={ownProfile}
      ownId={data.ownId}
      selected={data.selected}
      onselect={choose}
      onretry={() => data.loadBoard()}
      {onpassword}
      onplay={onmenu}
    />
    <ProfilePanel
      load={data.viewed}
      own={data.viewingOwn}
      {total}
      now={clock}
      focusHistory={mode === 'history' && data.viewingOwn}
      onprofile={choose}
      onwatch={(matchId) => {
        onwatch(String(matchId));
      }}
      onretry={() => {
        data.retryViewed();
      }}
      onshowown={() => {
        choose('own');
      }}
    />
  {/snippet}
</SplitFrame>
