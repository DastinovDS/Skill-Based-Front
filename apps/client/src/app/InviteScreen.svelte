<script lang="ts">
  import { Api, ApiError, type Invite } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import { apiErrorKey } from './appState.svelte.ts';
  import DockFrame from './DockFrame.svelte';
  import type { DockContext } from './dock.ts';
  import { startPolling } from './poll.ts';
  import VersusStrip from './VersusStrip.svelte';

  interface Props {
    api: Api;
    token: string;
    nick: string;
    code: string;
    dock: DockContext;
    /** Both players are ready: the match exists and the sockets can open. */
    onstart: (matchId: string, mapId: string) => void;
    /** Back to the menu; with a message if the invite is gone. */
    onleave: (notice: MessageKey | null) => void;
    /** How often the invite is asked again, ms. */
    pollMs?: number;
  }

  let { api, token, nick, code, dock, onstart, onleave, pollMs = 1500 }: Props = $props();

  const KEY_LEAVE = 'Esc';

  let invite = $state.raw<Invite | null>(null);
  let failure = $state.raw<MessageKey | null>(null);
  let copied = $state(false);
  let busy = $state(false);

  // The code is a secret of the two players: it goes into the link and nowhere else.
  const link = $derived(`${window.location.origin}/?m=${encodeURIComponent(code)}`);
  const isHost = $derived(invite !== null && invite.host_nick === nick);
  const opponent = $derived(invite === null ? null : isHost ? invite.guest_nick : invite.host_nick);
  const listed = $derived(invite !== null && isHost && opponent === null && invite.public);
  const waitingForLink = $derived(invite !== null && isHost && opponent === null && !invite.public);
  const starting = $derived(
    invite !== null && opponent !== null && invite.you_ready && invite.opponent_ready,
  );

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
    async function poll(signal: AbortSignal): Promise<void> {
      try {
        const next = await api.invite(token, code, signal);
        if (current) update(next);
      } catch (error) {
        if (current && !gone(error)) failure = apiErrorKey(error);
      }
    }
    const stop = startPolling(poll, pollMs);
    return () => {
      current = false;
      stop();
    };
  });

  async function ready(): Promise<void> {
    if (busy || invite === null || opponent === null || invite.you_ready) return;
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

  const head = $derived(
    invite === null
      ? t('common.loading')
      : starting
        ? t('bot.starting')
        : opponent !== null
          ? tf('invite.joined', { nick: opponent })
          : listed
            ? t('invite.listed')
            : t('invite.sendLink'),
  );

  const status = $derived(
    invite === null || opponent === null
      ? null
      : invite.you_ready
        ? invite.opponent_ready
          ? t('invite.starting')
          : t('invite.youReady')
        : invite.opponent_ready
          ? t('invite.opponentReady')
          : t('invite.pressReady'),
  );
</script>

<!-- The waiting room is locked (the other modes and the account menu are off): leaving drops the
     invite, so the only way out is "Leave" (and Esc). -->
<DockFrame
  {dock}
  mode={invite?.public === true ? 'lobby' : 'friend'}
  locked
  phase={invite === null ? 'idle' : opponent !== null ? 'found' : 'search'}
  {opponent}
  eyebrow={t('invite.title')}
  {head}
  sub={invite === null ? null : tf('invite.map', { map: invite.map_id })}
  pause={invite?.public === true ? 'none' : 'each'}
  alert={failure === null ? null : t(failure)}
  note={invite === null
    ? null
    : tf('invite.expires', { minutes: Math.max(1, Math.ceil(invite.expires_in_s / 60)) })}
  onback={leave}
  onenter={() => void ready()}
>
  {#if invite !== null}
    {#if waitingForLink}
      <div class="lnk">
        <input
          readonly
          aria-label={t('invite.link')}
          value={link}
          onfocus={(event) => {
            event.currentTarget.select();
          }}
        />
        <button type="button" class="btn" class:pri={!copied} onclick={copy}>
          {#if copied}<Icon name="check" size={18} />{t('invite.copied')}{:else}<Icon
              name="copy"
              size={18}
            />{t('invite.copy')}{/if}
        </button>
      </div>
    {/if}
    {#if opponent === null}
      <VersusStrip opponent={null} />
      <p class="note" role="status">{listed ? t('invite.waitingLobby') : t('invite.waiting')}</p>
    {:else}
      <VersusStrip {opponent} youReady={invite.you_ready} opponentReady={invite.opponent_ready} />
      <p class="note" role="status">{status}</p>
    {/if}
  {/if}
  {#snippet actions()}
    {#if invite !== null && opponent !== null && !starting}
      <button type="button" class="btn pri" disabled={busy || invite.you_ready} onclick={ready}>
        {t('invite.ready')}<kbd class="k" aria-hidden="true">↵</kbd>
      </button>
    {/if}
    <button type="button" class="btn link" aria-keyshortcuts="Escape" onclick={leave}>
      {t('invite.leave')}<kbd class="k" aria-hidden="true">{KEY_LEAVE}</kbd>
    </button>
  {/snippet}
</DockFrame>
