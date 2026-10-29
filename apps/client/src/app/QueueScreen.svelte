<script lang="ts">
  import { Api, ApiError, type QueueStatus } from '../api/http.ts';
  import { t, type MessageKey } from '../i18n/index.ts';
  import type { MapFile } from '../protocol.gen.ts';
  import { apiErrorKey } from './appState.svelte.ts';
  import { startPolling } from './poll.ts';
  import QueueView from './QueueView.svelte';
  import { flashTitle } from './titleFlash.ts';

  interface Props {
    api: Api;
    token: string;
    /** Both players confirmed: the rated match exists and the sockets can open. */
    onstart: (matchId: string, mapId: string) => void;
    /** Took the offer of a bot match (the queue is left first). */
    onbot: () => void;
    /** Back to the menu; with a message if the server dropped us from the queue. */
    onleave: (notice: MessageKey | null) => void;
    /** The queue is locked after repeated resigns (DEC-34): the seconds left. */
    onbanned?: (seconds: number) => void;
    /** The map drawn behind the screen (null: the plain dark page). */
    map?: MapFile | null;
    /** How often the status is asked again, ms (it is also the heartbeat of the place). */
    pollMs?: number;
  }

  let {
    api,
    token,
    onstart,
    onbot,
    onleave,
    onbanned,
    map = null,
    pollMs = 1000,
  }: Props = $props();

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
    if (error instanceof ApiError && error.code === 'queue_banned' && status === null) {
      // The menu shows the lock with the time left (DEC-34).
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

  // A found pair has to be confirmed in time: a player in another tab sees the title flash.
  const offered = $derived(status?.state === 'found' && !status.you_confirmed);
  $effect(() => {
    if (!offered) return undefined;
    return flashTitle(t('queue.titleFlash'));
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

<QueueView {status} {failure} {busy} {map} onconfirm={confirm} onleave={leave} onbot={playBot} />
