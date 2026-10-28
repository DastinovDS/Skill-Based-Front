/**
 * The polling of the waiting screens (queue, waiting room, lobby), CLI-10: one request at a time,
 * each with a timeout, the next one `intervalMs` after the previous has finished. A `setInterval`
 * would start a new request every period whether or not the last one has answered, so a slow
 * server got a growing pile of them, and a request that never answered was never given up.
 */

/** A poll that has not answered by then is aborted (the place of the queue is dropped after 15 s). */
export const POLL_TIMEOUT_MS = 5_000;

/**
 * Runs `tick` now and then again `intervalMs` after each run has finished; `tick` gets a signal
 * that is aborted after `timeoutMs` (pass it to the request) and when polling stops. A `tick`
 * that throws is polled again like any other: it is the caller's job to deal with errors.
 * Returns the function that stops it; a run in flight is aborted.
 */
export function startPolling(
  tick: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  timeoutMs: number = POLL_TIMEOUT_MS,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  async function run(): Promise<void> {
    const own = new AbortController();
    controller = own;
    const limit = setTimeout(() => {
      own.abort();
    }, timeoutMs);
    try {
      await tick(own.signal);
    } catch {
      // Handled by the caller's tick; a failed poll does not end the polling.
    } finally {
      clearTimeout(limit);
    }
    if (!stopped) {
      timer = setTimeout(() => {
        void run();
      }, intervalMs);
    }
  }

  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
  };
}
