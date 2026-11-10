<script lang="ts">
  import { ApiError, type Api, type QueueStatus } from '../api/http.ts';
  import Icon from '../hud/Icon.svelte';
  import { formatClock } from '../hud/format.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import LapisButton from '../theme/LapisButton.svelte';
  import { apiErrorKey } from './apiErrors.ts';
  import GoTablet from './GoTablet.svelte';
  import type { BackdropState } from './play.ts';
  import { startPolling } from './poll.ts';
  import { flashTitle } from './titleFlash.ts';
  import VersusLine from './VersusLine.svelte';

  interface Props {
    api: Pick<Api, 'joinQueue' | 'queueStatus' | 'confirmQueue' | 'leaveQueue'>;
    token: string;
    nick: string;
    /** Both players confirmed: the match exists and the sockets can open. */
    onstart: (matchId: string, mapId: string) => void;
    /** Took the offer of a bot match (the queue is left first). */
    onbot: () => void;
    /** Back to the plinth; with a message if the server dropped us from the queue. */
    onleave: (notice: MessageKey | null) => void;
    /** The queue is locked after repeated resigns (DEC-34): the seconds left. */
    onbanned?: (seconds: number) => void;
    onbackdrop: (state: BackdropState) => void;
    /** How often the status is asked again, ms (it is also the heartbeat of the place). */
    pollMs?: number;
    /** A fixed status and no server (the dev scenes): nothing is polled. */
    fixed?: QueueStatus | null;
  }

  let {
    api,
    token,
    nick,
    onstart,
    onbot,
    onleave,
    onbanned,
    onbackdrop,
    pollMs = 1000,
    fixed = null,
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let status = $state.raw<QueueStatus | null>(fixed);
  let failure = $state.raw<MessageKey | null>(null);
  let busy = $state(false);
  let done = false;

  function update(next: QueueStatus): void {
    if (done) return;
    status = next;
    failure = null;
    if (next.state === 'started' && next.match_id != null && next.map_id != null) {
      done = true;
      onstart(next.match_id, next.map_id);
    }
  }

  /** Out of the queue (a pair not confirmed in time, or the tab was silent): back to the plinth. */
  function gone(error: unknown): boolean {
    if (error instanceof ApiError && error.code === 'not_found') {
      if (!done) {
        done = true;
        onleave('error.queue.dropped');
      }
      return true;
    }
    return false;
  }

  function fail(error: unknown): void {
    if (gone(error) || done) return;
    if (error instanceof ApiError && error.code === 'queue_banned' && status === null) {
      // The plinth shows the lock with the time left (DEC-34).
      done = true;
      if (onbanned === undefined || error.retryAfterS === null) {
        onleave(apiErrorKey(error));
      } else {
        onbanned(error.retryAfterS);
        onleave(null);
      }
      return;
    }
    if (error instanceof ApiError && error.code !== 'network' && status === null) {
      // Could not even enter the queue (busy, blocked, rate limited): say why on the plinth.
      done = true;
      onleave(apiErrorKey(error));
      return;
    }
    failure = apiErrorKey(error);
  }

  $effect(() => {
    if (fixed !== null) return undefined;
    let current = true;
    let joined = false;
    async function poll(signal: AbortSignal): Promise<void> {
      try {
        const next = joined
          ? await api.queueStatus(token, signal)
          : await api.joinQueue(token, signal);
        joined = true;
        if (current) update(next);
      } catch (error) {
        if (current) fail(error);
      }
    }
    // One request at a time, each with a timeout (CLI-10); it is also the heartbeat of the place.
    const stop = startPolling(poll, pollMs);
    return () => {
      current = false;
      stop();
    };
  });

  const searching = $derived(status === null || status.state === 'searching');
  const found = $derived(status?.state === 'found');
  const opponent = $derived(status?.opponent_nick ?? '');
  const waited = $derived(status?.waited_s ?? 0);

  $effect(() => {
    onbackdrop({
      phase: searching ? 'search' : status?.you_confirmed === true ? 'confirmed' : 'found',
      opponent: found ? opponent : null,
      waited,
    });
  });

  // A found pair has to be confirmed in time: a player in another tab sees the title flash.
  const offered = $derived(status?.state === 'found' && !status.you_confirmed);
  $effect(() => {
    if (!offered) return undefined;
    return flashTitle(t('queue.titleFlash'));
  });

  async function confirm(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      update(await api.confirmQueue(token));
    } catch (error) {
      fail(error);
    } finally {
      busy = false;
    }
  }

  function leaveQueue(): void {
    done = true;
    api.leaveQueue(token).catch(() => {
      // Already out, or the server is away: a silent place leaves the queue by itself.
    });
  }

  function leave(): void {
    leaveQueue();
    onleave(null);
  }

  function playBot(): void {
    leaveQueue();
    onbot();
  }

  // Enter confirms a found pair, Esc leaves the queue or declines, B takes the bot offer.
  function onkeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    const onControl = target instanceof Element && target.closest('input, select, button, a');
    if (event.key === 'Enter' && offered && !onControl) {
      event.preventDefault();
      void confirm();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      leave();
    } else if (event.key.toLowerCase() === 'b' && searching && status?.bot_offer === true) {
      event.preventDefault();
      playBot();
    }
  }
</script>

<svelte:window {onkeydown} />

{#if failure !== null}
  <p class="alert rule-frame stone-panel" role="alert">
    <Icon name="alert" size={16} /><span>{t(failure)}</span>
  </p>
{/if}
<!-- Find a match on the plinth (#919, Searching and Opponent found of round 2): the clock and the
     search on the left, Stop on the right; a found pair is the versus line and Play. -->
<div class="plinth rule-frame stone-panel" data-way="match">
  {#if searching}
    <div class="stat">
      <p class="clock" role="timer" aria-label={tf('queue.waited', { time: formatClock(waited) })}>
        {formatClock(waited)}
      </p>
      <div class="two">
        <p class="label">{t('queue.title')}</p>
        <p class="sub" role="status">
          <span class="busy" aria-hidden="true"><i></i><i></i><i></i></span>
          {status === null ? t('common.loading') : t('queue.searching')}
        </p>
      </div>
    </div>
    <div class="end">
      {#if status?.bot_offer === true}
        <button type="button" class="lnk" aria-keyshortcuts="B" onclick={playBot}
          >{t('queue.playBot')}</button
        >
      {/if}
      <LapisButton class="tall" aria-keyshortcuts="Escape" onclick={leave}
        >{t('queue.leave')}</LapisButton
      >
    </div>
  {:else}
    <div class="two">
      <p class="label">{t('queue.found')}</p>
      <VersusLine
        you={nick}
        {opponent}
        size={36}
        youReady={status?.you_confirmed === true}
        opponentReady={status?.opponent_confirmed === true}
      />
    </div>
    <div class="end">
      {#if status?.state === 'found' && !status.you_confirmed}
        <span class="sub" role="timer"
          >{tf('queue.confirmWithin', { seconds: Math.ceil(status.confirm_in_s ?? 0) })}</span
        >
        <LapisButton class="tall" aria-keyshortcuts="Escape" onclick={leave}
          >{t('queue.decline')}</LapisButton
        >
        <GoTablet word={t('queue.confirm')} short disabled={busy} keys="Enter" onclick={confirm} />
      {:else if status?.state === 'found' && status.opponent_confirmed}
        <!-- Both confirmed and the match not started yet: with GOW_QUEUE_MAPS=generated the server
             is drawing the map for the pair (#926); the countdown no longer applies. -->
        <span class="sub" role="status">
          <span class="busy" aria-hidden="true"><i></i><i></i><i></i></span>
          {t('wait.drawing')}
        </span>
      {:else if status?.state === 'found'}
        <span class="sub" role="status">
          <span class="busy" aria-hidden="true"><i></i><i></i><i></i></span>
          {tf('queue.waitingFor', {
            nick: opponent,
            seconds: Math.ceil(status.confirm_in_s ?? 0),
          })}
        </span>
      {:else}
        <span class="sub" role="status">{t('queue.starting')}</span>
      {/if}
    </div>
  {/if}
</div>
