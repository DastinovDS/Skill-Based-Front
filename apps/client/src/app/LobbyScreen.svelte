<script lang="ts">
  import { Api, ApiError, type LobbyEntry } from '../api/http.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import { apiErrorKey } from './appState.svelte.ts';
  import { startPolling } from './poll.ts';

  interface Props {
    api: Api;
    token: string;
    /** To the map choice of a new public match. */
    oncreate: () => void;
    /** Joined a match: on to its waiting room. */
    onjoined: (code: string) => void;
    onback: () => void;
    /** How often the list is asked again, ms. */
    pollMs?: number;
  }

  let { api, token, oncreate, onjoined, onback, pollMs = 2000 }: Props = $props();

  let entries = $state.raw<readonly LobbyEntry[] | null>(null);
  let failure = $state.raw<MessageKey | null>(null);
  let busy = $state(false);

  async function load(signal?: AbortSignal): Promise<readonly LobbyEntry[] | null> {
    try {
      return await api.lobby(token, signal);
    } catch (error) {
      failure = apiErrorKey(error);
      return null;
    }
  }

  $effect(() => {
    let current = true;
    async function poll(signal: AbortSignal): Promise<void> {
      const next = await load(signal);
      if (current && next !== null) {
        entries = next;
        failure = null;
      }
    }
    const stop = startPolling(poll, pollMs);
    return () => {
      current = false;
      stop();
    };
  });

  async function join(code: string): Promise<void> {
    busy = true;
    try {
      const invite = await api.joinInvite(token, code);
      onjoined(invite.code);
    } catch (error) {
      // Taken by someone else a moment ago, or the host left: the list is refreshed.
      failure =
        error instanceof ApiError && (error.code === 'not_found' || error.code === 'conflict')
          ? 'error.lobby.taken'
          : apiErrorKey(error);
      const next = await load();
      if (next !== null) entries = next;
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  <div class="card">
    <h1>{t('lobby.title')}</h1>
    <p class="hint">{t('lobby.intro')}</p>
    {#if entries === null}
      <p role="status">{t('common.loading')}</p>
    {:else if entries.length === 0}
      <p role="status">{t('lobby.empty')}</p>
    {:else}
      <ul class="list">
        {#each entries as entry (entry.code)}
          <li>
            <span>{tf('lobby.entry', { nick: entry.host_nick, map: entry.map_id })}</span>
            <button type="button" class="primary" disabled={busy} onclick={() => join(entry.code)}>
              {t('lobby.join')}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if failure !== null}
      <p class="error" role="alert">{t(failure)}</p>
    {/if}
    <div class="actions">
      <button type="button" class="primary" onclick={oncreate}>{t('lobby.create')}</button>
      <button type="button" onclick={onback}>{t('common.back')}</button>
    </div>
  </div>
</main>
