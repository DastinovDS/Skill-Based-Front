<script lang="ts">
  import type { Api } from '../api/http.ts';
  import CrashGuard from '../app/CrashGuard.svelte';
  import { t, type MessageKey } from '../i18n/index.ts';
  import { backgroundUrlOf } from '../map/background.ts';
  import { loadReplayWhenReady, ReplayLoadError, type ReplayLoadCode } from './loadReplay.ts';
  import { parseReplay, type ReplayFile } from './replayFile.ts';
  import ReplayViewer from './ReplayViewer.svelte';

  interface Props {
    /** For the background of the map, which the server states in its map list. */
    api?: Pick<Api, 'maps'> | null;
    matchId: string;
    /** Guest token for a private match; rated replays are public. */
    token?: string | null;
    onback?: () => void;
  }

  let { api = null, matchId, token = null, onback }: Props = $props();

  const ERRORS: Record<Exclude<ReplayLoadCode, 'preparing'>, MessageKey> = {
    auth: 'replay.error.auth',
    missing: 'replay.error.missing',
    unavailable: 'replay.error.unavailable',
    expired: 'replay.error.expired',
    timeout: 'replay.error.timeout',
    network: 'replay.error.network',
    format: 'replay.error.format',
    invalid: 'replay.error.invalid',
  };

  let file = $state.raw<ReplayFile | null>(null);
  let backgroundUrl = $state.raw<string | null>(null);
  let failure = $state.raw<Exclude<ReplayLoadCode, 'preparing'> | null>(null);
  /** The server answered "preparing": it is still building the frames of the match (#259). */
  let preparing = $state.raw(false);

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
    return loadReplayWhenReady(id, token, { signal, onPreparing });
  }

  $effect(() => {
    let current = true;
    const stop = new AbortController();
    file = null;
    backgroundUrl = null;
    failure = null;
    preparing = false;
    fetchFile(matchId, stop.signal, () => {
      if (current) preparing = true;
    })
      .then(async (loadedFile) => ({
        loadedFile,
        background: api === null ? null : await backgroundUrlOf(api, loadedFile.map_id),
      }))
      .then(
        ({ loadedFile, background }) => {
          if (current) {
            backgroundUrl = background;
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
  });
</script>

<CrashGuard onexit={onback}>
  {#if file !== null}
    <ReplayViewer {file} {backgroundUrl} {onback} />
  {:else}
    <main class="status" role={failure === null ? 'status' : 'alert'}>
      {#if failure !== null}
        <p>{t(ERRORS[failure])}</p>
      {:else if preparing}
        <p class="waiting">
          <span class="spinner" aria-hidden="true"></span>{t('replay.preparing')}
        </p>
        <p class="hint">{t('replay.preparing.hint')}</p>
      {:else}
        <p>{t('replay.loading')}</p>
      {/if}
      {#if onback !== undefined}
        <button type="button" onclick={onback}>{t('replay.back')}</button>
      {/if}
    </main>
  {/if}
</CrashGuard>

<style>
  .status {
    padding: 24px;
  }
  .waiting {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .hint {
    opacity: 0.7;
  }
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid currentColor;
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
    }
  }
</style>
