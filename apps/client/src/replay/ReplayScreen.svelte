<script lang="ts">
  import type { Api } from '../api/http.ts';
  import CrashGuard from '../app/CrashGuard.svelte';
  import { MENU_MAP } from '../app/menuMap.ts';
  import ScreenFrame from '../app/ScreenFrame.svelte';
  import Icon from '../hud/Icon.svelte';
  import { t, type MessageKey } from '../i18n/index.ts';
  import { backgroundUrlOf } from '../map/background.ts';
  import { geoOf, type GeoFile } from '../map/geography.ts';
  import { loadReplayWhenReady, ReplayLoadError, type ReplayLoadCode } from './loadReplay.ts';
  import type { PlayerId } from '../protocol.gen.ts';
  import { parseReplay, type ReplayFile } from './replayFile.ts';
  import ReplayViewer from './ReplayViewer.svelte';
  import { defaultView } from './viewAs.ts';

  interface Props {
    /** For the background of the map, which the server states in its map list. */
    api?: Pick<Api, 'maps'> | null;
    matchId: string;
    /** Guest token for a private match; rated replays are public. */
    token?: string | null;
    /** The side the viewer played, when the app knows it (the result screen): the replay opens as that side. */
    me?: PlayerId | null;
    /** The viewer's nick: a file with the nicks opens as the side that has it (a profile link). */
    nick?: string | null;
    onback?: () => void;
  }

  let { api = null, matchId, token = null, me = null, nick = null, onback }: Props = $props();

  /** What the screen says about a failure: a short title, the plain words and whether asking again can help. */
  const ERRORS: Record<
    Exclude<ReplayLoadCode, 'preparing'>,
    { title: MessageKey; text: MessageKey; retry: boolean }
  > = {
    auth: { title: 'replay.title.auth', text: 'replay.error.auth', retry: false },
    missing: { title: 'replay.title.missing', text: 'replay.error.missing', retry: false },
    unavailable: {
      title: 'replay.title.unavailable',
      text: 'replay.error.unavailable',
      retry: false,
    },
    expired: { title: 'replay.title.expired', text: 'replay.error.expired', retry: false },
    timeout: { title: 'replay.title.timeout', text: 'replay.error.timeout', retry: true },
    network: { title: 'replay.title.network', text: 'replay.error.network', retry: true },
    format: { title: 'replay.title.format', text: 'replay.error.format', retry: false },
    invalid: { title: 'replay.title.invalid', text: 'replay.error.invalid', retry: false },
  };

  let file = $state.raw<ReplayFile | null>(null);
  let backgroundUrl = $state.raw<string | null>(null);
  let geo = $state.raw<GeoFile | null>(null);
  let failure = $state.raw<Exclude<ReplayLoadCode, 'preparing'> | null>(null);
  /** The server answered "preparing": it is still building the frames of the match (#259). */
  let preparing = $state.raw(false);
  /** "Retry" asks the server again: the load effect runs once more. */
  let attempt = $state(0);

  async function fetchFile(
    id: string,
    signal: AbortSignal,
    onPreparing: () => void,
  ): Promise<ReplayFile> {
    // Dev screen: `?replay=dev` plays the bundled sample (a short match on the "siege" test map).
    // The branch is dead code in a production build, so the file is not shipped.
    if (import.meta.env.DEV && id === 'dev') {
      return parseReplay((await import('./siege.frames.json')).default);
    }
    // `?replay=dev-fights`: a recording with fights (rounds, kills) for the fight arena (#323).
    if (import.meta.env.DEV && id === 'dev-fights') {
      return parseReplay((await import('./siege-fights.frames.json')).default);
    }
    // `?replay=dev-preparing`: the server keeps answering 202, the wait never ends (#593).
    if (import.meta.env.DEV && id === 'dev-preparing') {
      onPreparing();
      return new Promise<ReplayFile>(() => undefined);
    }
    // `?replay=dev-loading`: the request never answers (#599).
    if (import.meta.env.DEV && id === 'dev-loading') {
      return new Promise<ReplayFile>(() => undefined);
    }
    // `?replay=dev-network`: the server could not be reached, "Retry" is offered (#599).
    if (import.meta.env.DEV && id === 'dev-network') {
      throw new ReplayLoadError('network');
    }
    // `?replay=dev-unavailable`: the server answered 410 (#593).
    if (import.meta.env.DEV && id === 'dev-unavailable') {
      throw new ReplayLoadError('unavailable');
    }
    return loadReplayWhenReady(id, token, { signal, onPreparing });
  }

  /** Loads the replay; the effect runs it again for a new match or after "Try again". */
  function load(id: string): () => void {
    let current = true;
    const stop = new AbortController();
    file = null;
    backgroundUrl = null;
    geo = null;
    failure = null;
    preparing = false;
    fetchFile(id, stop.signal, () => {
      if (current) preparing = true;
    })
      .then(async (loadedFile) => ({
        loadedFile,
        background: api === null ? null : await backgroundUrlOf(api, loadedFile.map_id),
        // The map as the replay played it: a stale vector file does not fit and is ignored.
        geography: await geoOf(loadedFile.map),
      }))
      .then(
        ({ loadedFile, background, geography }) => {
          if (current) {
            backgroundUrl = background;
            geo = geography;
            file = loadedFile;
          }
        },
        (error: unknown) => {
          if (!current) return;
          // `preparing` never ends the wait: it is retried, then it becomes `timeout`.
          failure =
            error instanceof ReplayLoadError && error.code !== 'preparing' ? error.code : 'invalid';
        },
      );
    return () => {
      current = false;
      stop.abort();
    };
  }

  // A new object for every "Try again": the effect runs again though the match is the same.
  const request = $derived({ id: matchId, attempt });
  $effect(() => load(request.id));

  /** The name of a key is not translated. */
  const ESC = 'Esc';

  const problem = $derived(failure === null ? null : ERRORS[failure]);

  // Enter asks again where that can help, Esc goes back; a focused button keeps its own keys.
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest('button, a')) return;
    if (event.key === 'Enter' && problem?.retry === true) {
      retry();
    } else if (event.key === 'Escape' && onback !== undefined) {
      onback();
    } else {
      return;
    }
    event.preventDefault();
  }

  function retry(): void {
    attempt += 1;
  }
</script>

<svelte:window onkeydown={file === null ? onkeydown : undefined} />

<CrashGuard onexit={onback}>
  {#if file !== null}
    <ReplayViewer
      {file}
      {backgroundUrl}
      {geo}
      initialView={defaultView(me, file.nicks ?? null, nick)}
      {onback}
    />
  {:else}
    <ScreenFrame map={MENU_MAP} label={t('replay.eyebrow')}>
      <!-- Loading, preparing and the errors share the frame of the menu: the same rail, an eyebrow, a
           big word and a line under it; a failure is an amber `!` (red is only the enemy), plain
           words, and the buttons "Retry" (where asking again can help) and "Back". -->
      <div role={failure === null ? 'status' : 'alert'}>
        <div class="eyebrow" class:warn={failure !== null}>{t('replay.eyebrow')}</div>
        {#if problem !== null}
          <div class="big sm warn">
            <Icon name="alert" size={40} />{t(problem.title)}
          </div>
          <div class="sub">{t(problem.text)}</div>
        {:else if preparing}
          <div class="big sm static">
            <span class="spinner" aria-hidden="true"></span>{t('replay.title.preparing')}
          </div>
          <div class="sub">{t('replay.preparing.hint')}</div>
        {:else}
          <div class="big sm static">
            <span class="spinner" aria-hidden="true"></span>{t('replay.title.loading')}
          </div>
          <div class="sub">{t('replay.loading.hint')}</div>
        {/if}
      </div>
      <div class="rows">
        {#if problem?.retry === true}
          <button type="button" class="row" aria-keyshortcuts="Enter" onclick={retry}>
            <Icon name="refresh" size={22} />{t('replay.retry')}<kbd class="k" aria-hidden="true"
              >↵</kbd
            >
          </button>
        {/if}
        {#if onback !== undefined}
          <button type="button" class="row" aria-keyshortcuts="Escape" onclick={onback}>
            <Icon name="chevronLeft" size={22} />{t('replay.back')}<kbd class="k" aria-hidden="true"
              >{ESC}</kbd
            >
          </button>
        {/if}
      </div>
    </ScreenFrame>
  {/if}
</CrashGuard>

<style>
  .spinner {
    flex: none;
    width: 34px;
    height: 34px;
    box-sizing: border-box;
    border: 4px solid var(--text-dim);
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
      border-right-color: var(--text-dim);
      border-style: dotted;
    }
  }
</style>
