<script lang="ts">
  import { Api, ApiError, type Invite } from '../api/http.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import { apiErrorKey } from './appState.svelte.ts';

  interface Props {
    api: Api;
    token: string;
    nick: string;
    code: string;
    /** Both players are ready: the match exists and the sockets can open. */
    onstart: (matchId: string, mapId: string) => void;
    /** Back to the menu; with a message if the invite is gone. */
    onleave: (notice: MessageKey | null) => void;
    /** How often the invite is asked again, ms. */
    pollMs?: number;
  }

  let { api, token, nick, code, onstart, onleave, pollMs = 1500 }: Props = $props();

  let invite = $state.raw<Invite | null>(null);
  let failure = $state.raw<MessageKey | null>(null);
  let copied = $state(false);
  let busy = $state(false);

  // The code is a secret of the two players: it goes into the link and nowhere else.
  const link = $derived(`${window.location.origin}/?m=${encodeURIComponent(code)}`);
  const isHost = $derived(invite !== null && invite.host_nick === nick);
  const opponent = $derived(invite === null ? null : isHost ? invite.guest_nick : invite.host_nick);

  function update(next: Invite): void {
    invite = next;
    failure = null;
    if (next.match_id !== null) {
      onstart(next.match_id, next.map_id);
    }
  }

  function gone(error: unknown): boolean {
    if (
      error instanceof ApiError &&
      (error.code === 'not_found' || error.code === 'unauthorized')
    ) {
      onleave('error.invite.expired');
      return true;
    }
    return false;
  }

  $effect(() => {
    let current = true;
    async function poll(): Promise<void> {
      try {
        const next = await api.invite(token, code);
        if (current) update(next);
      } catch (error) {
        if (current && !gone(error)) failure = apiErrorKey(error);
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), pollMs);
    return () => {
      current = false;
      clearInterval(timer);
    };
  });

  async function ready(): Promise<void> {
    busy = true;
    try {
      update(await api.readyInvite(token, code));
    } catch (error) {
      if (!gone(error)) failure = apiErrorKey(error);
    } finally {
      busy = false;
    }
  }

  /** Leaving before the start drops the invite, so a public entry does not stay in the lobby. */
  function leave(): void {
    api.cancelInvite(token, code).catch(() => {
      // Already gone or the server is away: it drops an abandoned entry by itself.
    });
    onleave(null);
  }

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
    } catch {
      // No clipboard access: the link is in the field, the player copies it by hand.
      copied = false;
    }
  }
</script>

<main class="screen">
  <div class="card">
    <h1>{t('invite.title')}</h1>
    {#if invite === null}
      <p role="status">{t('common.loading')}</p>
    {:else}
      <p>{tf('invite.map', { map: invite.map_id })}</p>
      {#if isHost && invite.guest_nick === null && invite.public}
        <p role="status">{t('invite.waitingLobby')}</p>
      {:else if isHost && invite.guest_nick === null}
        <label>
          {t('invite.link')}
          <input
            readonly
            value={link}
            onfocus={(event) => {
              event.currentTarget.select();
            }}
          />
        </label>
        <div class="actions">
          <button type="button" onclick={copy}>{t('invite.copy')}</button>
          {#if copied}<span role="status">{t('invite.copied')}</span>{/if}
        </div>
        <p role="status">{t('invite.waiting')}</p>
      {:else}
        <p role="status">{tf('invite.opponent', { nick: opponent ?? '' })}</p>
        <p role="status">
          {invite.you_ready
            ? invite.opponent_ready
              ? t('invite.starting')
              : t('invite.youReady')
            : invite.opponent_ready
              ? t('invite.opponentReady')
              : t('invite.pressReady')}
        </p>
        <div class="actions">
          <button type="button" class="primary" disabled={busy || invite.you_ready} onclick={ready}>
            {t('invite.ready')}
          </button>
        </div>
      {/if}
      <p class="hint">
        {tf('invite.expires', { minutes: Math.max(1, Math.ceil(invite.expires_in_s / 60)) })}
      </p>
    {/if}
    {#if failure !== null}
      <p class="error" role="alert">{t(failure)}</p>
    {/if}
    <div class="actions">
      <button
        type="button"
        onclick={() => {
          leave();
        }}>{t('invite.leave')}</button
      >
    </div>
  </div>
</main>
