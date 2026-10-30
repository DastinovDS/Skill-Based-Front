<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { Api, PlayerProfile } from '../api/http.ts';
  import AccountChip from '../app/AccountChip.svelte';
  import type { MapCache } from '../app/mapCache.svelte.ts';
  import MenuTabs from '../app/MenuTabs.svelte';
  import type { MenuTabActions } from '../app/menuTabs.ts';
  import Icon from '../hud/Icon.svelte';
  import { t, tf } from '../i18n/index.ts';
  import type { Calibration, MapFile } from '../protocol.gen.ts';
  import { failed, type Load } from './boardState.svelte.ts';
  import MatchCard from './MatchCard.svelte';
  import SheetFrame from './SheetFrame.svelte';
  import { visibleMatches } from './view.ts';

  interface Props extends MenuTabActions {
    api: Pick<Api, 'player' | 'me'>;
    token: string;
    /** The own player id, if the app knows it (otherwise the screen asks the server). */
    ownId: number | null;
    nick: string;
    hasPassword: boolean;
    calibration: Calibration | null;
    rating: number | null;
    map: MapFile | null;
    /** The pool maps: the small picture of each card. */
    maps: Pick<MapCache, 'get' | 'ensure'>;
    /** The clock of "2 hr. ago"; tests and dev scenes pass their own. */
    now?: () => number;
    onwatch: (matchId: string) => void;
    /** The empty list offers a match against a bot. */
    onbot: () => void;
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
    maps,
    now = () => Date.now(),
    onwatch,
    onbot,
    onpassword,
    onlogout,
    onplay,
    onreplays,
    onboard,
    onhowto,
  }: Props = $props();

  const clock = untrack(() => now());
  const stop = new AbortController();
  let own = $state.raw<Load<PlayerProfile>>({ status: 'loading' });

  /** The own profile holds the last matches with their replays (`GET /api/players/{id}`). */
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

  const matches = $derived(own.status === 'ready' ? visibleMatches(own.value, true) : []);
  // The files of the maps of the cards, each asked for once; the pictures fill in as they arrive.
  $effect(() => {
    for (const id of new Set(matches.map((m) => m.map_id))) void maps.ensure(id);
  });

  let accountOpen = $state(false);

  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (accountOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      onplay();
    }
  }
</script>

<svelte:window {onkeydown} />

<SheetFrame {map} label={t('menu.replays')}>
  {#snippet tabs()}
    <MenuTabs current="replays" {onplay} {onreplays} {onboard} {onhowto} />
  {/snippet}
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

  <h2>{t('menu.replays')}</h2>
  {#if own.status === 'loading'}
    <p class="sr" role="status">{t('profile.loading')}</p>
    <div class="cards skel" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  {:else if own.status === 'failed'}
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
    <button type="button" class="retry" onclick={load}>
      <Icon name="refresh" size={15} />{t('board.retry')}
    </button>
  {:else if matches.length === 0}
    <div class="empty">
      <b>{t('replays.empty.title')}</b>
      <span>{t('replays.empty.body')}</span>
      <button type="button" class="pri" onclick={onbot}>{t('menu.bot')}</button>
    </div>
  {:else}
    <ul class="cards">
      {#each matches as match (match.match_id)}
        <MatchCard
          {match}
          map={maps.get(match.map_id)}
          now={clock}
          onwatch={(matchId) => {
            onwatch(String(matchId));
          }}
        />
      {/each}
    </ul>
  {/if}
</SheetFrame>

<style>
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 12px;
    max-width: 1180px;
    margin: 0;
    padding: 0;
  }

  .skel i {
    display: block;
    height: 230px;
    border-radius: 10px;
    background: repeating-linear-gradient(
      135deg,
      rgb(230 237 243 / 7%) 0 7px,
      rgb(230 237 243 / 2%) 7px 14px
    );
  }

  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    max-width: 1180px;
    box-sizing: border-box;
    padding: 56px 20px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    text-align: center;
  }

  .empty b {
    font-size: 20px;
  }

  .empty span {
    margin-bottom: 10px;
    color: var(--text-dim);
  }

  .pri,
  .retry {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 40px;
    padding: 0 18px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }

  .pri {
    border-color: var(--paper);
    background: var(--you);
    color: var(--bg);
    font-weight: 700;
  }

  .retry {
    margin-top: 10px;
  }
</style>
