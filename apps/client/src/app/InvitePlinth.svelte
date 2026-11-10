<script lang="ts">
  import { ApiError, type Api, type Invite } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import { apiErrorKey } from './apiErrors.ts';
  import DrawingGraph from './DrawingGraph.svelte';
  import GoTablet from './GoTablet.svelte';
  import { inviteView, type BackdropState } from './play.ts';
  import { startPolling } from './poll.ts';
  import VersusLine from './VersusLine.svelte';

  interface Props {
    api: Pick<Api, 'invite' | 'readyInvite' | 'cancelInvite'>;
    token: string;
    nick: string;
    code: string;
    /** Both players are ready: the match exists and the sockets can open. */
    onstart: (matchId: string, mapId: string) => void;
    /** Back to the plinth; with a message if the invite is gone. */
    onleave: (notice: MessageKey | null) => void;
    onbackdrop: (state: BackdropState) => void;
    /** The width of the drawing sketch, px (the size of the window decides). */
    drawWidth: number;
    /** How often the invite is asked again, ms. */
    pollMs?: number;
    /** The origin of the link (the page's own; the dev scenes pin one). */
    origin?: string;
  }

  let {
    api,
    token,
    nick,
    code,
    onstart,
    onleave,
    onbackdrop,
    drawWidth,
    pollMs = 1500,
    origin = window.location.origin,
  }: Props = $props();

  let invite = $state.raw<Invite | null>(null);
  let failure = $state.raw<MessageKey | null>(null);
  let copied = $state(false);
  let busy = $state(false);

  // The code is a secret of the two players: it goes into the link and nowhere else.
  const link = $derived(`${origin}/?m=${encodeURIComponent(code)}`);
  const view = $derived(inviteView(invite, nick));

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

  $effect(() => {
    onbackdrop({
      phase: view.opponent === null ? 'search' : 'found',
      opponent: view.opponent,
      waited: 0,
    });
  });

  async function ready(): Promise<void> {
    if (busy || invite === null || view.opponent === null || invite.you_ready) return;
    busy = true;
    try {
      update(await api.readyInvite(token, code));
    } catch (error) {
      if (!gone(error)) failure = apiErrorKey(error);
    } finally {
      busy = false;
    }
  }

  /** Leaving before the start drops the invite. */
  function leave(): void {
    api.cancelInvite(token, code).catch(() => {
      // Already gone or the server is away: it drops an abandoned invite by itself.
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

  // Esc leaves (and drops the invite); Enter is Ready once a friend has joined.
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      leave();
      return;
    }
    const target = event.target;
    const onControl = target instanceof Element && target.closest('input, button, a') !== null;
    if (event.key === 'Enter' && !onControl && view.stage === 'joined') {
      event.preventDefault();
      void ready();
    }
  }

  const minutes = $derived(invite === null ? 0 : Math.max(1, Math.ceil(invite.expires_in_s / 60)));
  /** The line over the versus once both seats are taken. */
  const joinedLine = $derived(
    view.stage !== 'starting' && view.youReady
      ? t('invite.youReady')
      : view.stage !== 'starting' && view.opponentReady
        ? t('invite.opponentReady')
        : tf('invite.joined', { nick: view.opponent ?? '' }),
  );
</script>

<svelte:window {onkeydown} />

{#if failure !== null}
  <p class="alert rule-frame stone-panel" role="alert">
    <Icon name="alert" size={16} /><span>{t(failure)}</span>
  </p>
{/if}
<!-- The waiting room on the plinth (#919, variant C of round 2): the left half is what is
     happening (the map being drawn, the empty seat, then the friend's name), the right end the one
     thing to press: Copy link with its address growing out of it, then Ready. -->
<div class="plinth rule-frame stone-panel" data-way="friend">
  {#if view.stage === 'loading'}
    <div class="stat">
      <DrawingGraph width={drawWidth} still />
      <div class="two">
        <p class="sub" role="status">
          <span class="busy" aria-hidden="true"><i></i><i></i><i></i></span>
          {t('common.loading')}
        </p>
        <VersusLine you={nick} opponent={null} />
      </div>
    </div>
    <div class="end">
      <GoTablet word={t('play.go.link')} disabled />
    </div>
  {:else if view.stage === 'link' || view.stage === 'waiting'}
    <div class="stat">
      <DrawingGraph width={drawWidth} still={!view.drawing} />
      <div class="two">
        <p class="sub" role="status">
          <span class="busy" aria-hidden="true"><i></i><i></i><i></i></span>
          {view.drawing ? t('wait.drawing') : t('invite.waiting')}
        </p>
        <VersusLine you={nick} opponent={null} />
      </div>
    </div>
    <div class="end link">
      <LapisButton class="tall" aria-keyshortcuts="Escape" onclick={leave}
        >{t('invite.leave')}</LapisButton
      >
      {#if view.stage === 'link'}
        <div class="lucol">
          <div class="lkhead">
            <label class="label" for="invite-link">{t('invite.link')}</label>
            <span class="note">{tf('invite.expires', { minutes })}</span>
          </div>
          <div class="lu">
            <input
              id="invite-link"
              class="fld"
              readonly
              value={link}
              onfocus={(event) => {
                event.currentTarget.select();
              }}
            />
            <button type="button" class="lapis-btn primary go copy" onclick={copy}>
              {#if copied}<Icon name="check" size={16} />{t('invite.copied')}{:else}<svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  aria-hidden="true"
                  focusable="false"
                  ><rect x="9" y="9" width="12" height="12" /><path d="M5 15H3V3h12v2" /></svg
                >{t('invite.copy')}{/if}
            </button>
          </div>
        </div>
      {:else}
        <span class="note">{tf('invite.expires', { minutes })}</span>
      {/if}
    </div>
  {:else}
    <div class="two">
      <p class="label">{joinedLine}</p>
      <VersusLine
        you={nick}
        opponent={view.opponent}
        size={36}
        youReady={view.youReady}
        opponentReady={view.opponentReady}
      />
    </div>
    <div class="end">
      {#if view.stage === 'starting'}
        <span class="sub" role="status">
          <span class="busy" aria-hidden="true"><i></i><i></i><i></i></span>
          {view.drawing ? t('invite.drawingStart') : t('invite.starting')}
        </span>
        <LapisButton class="tall" aria-keyshortcuts="Escape" onclick={leave}
          >{t('invite.leave')}</LapisButton
        >
      {:else}
        <LapisButton class="tall" aria-keyshortcuts="Escape" onclick={leave}
          >{t('invite.leave')}</LapisButton
        >
        <GoTablet
          word={t('invite.ready')}
          short
          disabled={busy || view.youReady}
          keys="Enter"
          onclick={() => void ready()}
        />
      {/if}
    </div>
  {/if}
</div>
