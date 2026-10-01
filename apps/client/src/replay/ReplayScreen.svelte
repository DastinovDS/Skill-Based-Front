<script lang="ts">
  import { t, type MessageKey } from '../i18n/index.ts';
  import { loadReplay, ReplayLoadError, type ReplayLoadCode } from './loadReplay.ts';
  import { parseReplay, type ReplayFile } from './replayFile.ts';
  import ReplayViewer from './ReplayViewer.svelte';

  interface Props {
    matchId: string;
    /** Guest token for a private match; rated replays are public. */
    token?: string | null;
    onback?: () => void;
  }

  let { matchId, token = null, onback }: Props = $props();

  const ERRORS: Record<ReplayLoadCode, MessageKey> = {
    auth: 'replay.error.auth',
    missing: 'replay.error.missing',
    network: 'replay.error.network',
    format: 'replay.error.format',
    invalid: 'replay.error.invalid',
  };

  let file = $state.raw<ReplayFile | null>(null);
  let failure = $state.raw<ReplayLoadCode | null>(null);

  async function fetchFile(id: string): Promise<ReplayFile> {
    // Dev screen: `?replay=dev` plays the bundled sample (a short match on the "siege" test map).
    // The branch is dead code in a production build, so the file is not shipped.
    if (import.meta.env.DEV && id === 'dev') {
      return parseReplay((await import('./siege.frames.json')).default);
    }
    return loadReplay(id, token);
  }

  $effect(() => {
    let current = true;
    file = null;
    failure = null;
    fetchFile(matchId).then(
      (loadedFile) => {
        if (current) file = loadedFile;
      },
      (error: unknown) => {
        if (current) failure = error instanceof ReplayLoadError ? error.code : 'invalid';
      },
    );
    return () => {
      current = false;
    };
  });
</script>

{#if file !== null}
  <ReplayViewer {file} {onback} />
{:else}
  <main class="status" role={failure === null ? 'status' : 'alert'}>
    <p>{failure === null ? t('replay.loading') : t(ERRORS[failure])}</p>
    {#if onback !== undefined}
      <button type="button" onclick={onback}>{t('replay.back')}</button>
    {/if}
  </main>
{/if}

<style>
  .status {
    padding: 24px;
  }
</style>
