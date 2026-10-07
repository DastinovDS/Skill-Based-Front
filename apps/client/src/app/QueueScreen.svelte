<script lang="ts">
  import { Api, ApiError, type QueueStatus } from '../api/http.ts';
  import { formatClock } from '../hud/format.ts';
  import { t, tf, type MessageKey } from '../i18n/index.ts';
  import { apiErrorKey } from './appState.svelte.ts';

  interface Props {
    api: Api;
    token: string;
    /** Both players confirmed: the rated match exists and the sockets can open. */
    onstart: (matchId: string, mapId: string) => void;
    /** Took the offer of a bot match (the queue is left first). */
    onbot: () => void;
    /** Back to the menu; with a message if the server dropped us from the queue. */
    onleave: (notice: MessageKey | null) => void;
    /** How often the status is asked again, ms (it is also the heartbeat of the place). */
    pollMs?: number;
  }

  let { api, token, onstart, onbot, onleave, pollMs = 1000 }: Props = $props();

  let status = $state.raw<QueueStatus | null>(null);
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

  /** Out of the queue (a pair not confirmed in time, or the tab was silent): back to the menu. */
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
    if (error instanceof ApiError && error.code !== 'network' && status === null) {
      // Could not even enter the queue (busy, blocked, rate limited): say why in the menu.
      done = true;
      onleave(apiErrorKey(error));
      return;
    }
    failure = apiErrorKey(error);
  }

  $effect(() => {
    let current = true;
    let joined = false;
    async function poll(): Promise<void> {
      try {
        const next = joined ? await api.queueStatus(token) : await api.joinQueue(token);
        joined = true;
        if (current) update(next);
      } catch (error) {
        if (current) fail(error);
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), pollMs);
    return () => {
      current = false;
      clearInterval(timer);
    };
  });

  async function confirm(): Promise<void> {
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
</script>

<main class="screen">
  <div class="card">
    <h1>{t('queue.title')}</h1>
    <p class="hint">{t('queue.intro')}</p>
    {#if status === null}
      <p role="status">{t('common.loading')}</p>
    {:else if status.state === 'searching'}
      <p role="status">{t('queue.searching')}</p>
      <p>{tf('queue.waited', { time: formatClock(status.waited_s) })}</p>
      <p>{tf('queue.size', { count: status.queue_size })}</p>
      {#if status.bot_offer}
        <p>{t('queue.botOffer')}</p>
        <div class="actions">
          <button type="button" onclick={playBot}>{t('queue.playBot')}</button>
        </div>
      {/if}
    {:else if status.state === 'found'}
      <p role="status">{tf('queue.found', { nick: status.opponent_nick ?? '' })}</p>
      {#if status.you_confirmed}
        <p role="status">{t('queue.youConfirmed')}</p>
      {:else}
        <p>{tf('queue.confirmIn', { seconds: Math.ceil(status.confirm_in_s ?? 0) })}</p>
      {/if}
      {#if status.opponent_confirmed}
        <p>{t('queue.opponentConfirmed')}</p>
      {/if}
      <div class="actions">
        <button
          type="button"
          class="primary"
          disabled={busy || status.you_confirmed}
          onclick={confirm}>{t('queue.confirm')}</button
        >
      </div>
    {:else}
      <p role="status">{t('queue.starting')}</p>
    {/if}
    {#if failure !== null}
      <p class="error" role="alert">{t(failure)}</p>
    {/if}
    <div class="actions">
      <button type="button" onclick={leave}>
        {status?.state === 'found' ? t('queue.decline') : t('queue.leave')}
      </button>
    </div>
  </div>
</main>
