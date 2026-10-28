/**
 * One global logger for what nothing else catches: an uncaught error and an unhandled promise
 * rejection (CLI-03, #418). It writes a line to the console and nothing else: no network, no
 * toast. Whatever looks like a token or a long secret is cut out of the line first (AGENTS.md 14:
 * no tokens in logs); only the name and the message are written, not the whole error object.
 */

/** A run this long of URL-safe characters can be a token: it is not logged. */
const SECRET = /[A-Za-z0-9_-]{32,}/g;
const MAX_LENGTH = 300;

/** The line to log for a thrown value. */
export function describeError(error: unknown): string {
  const text =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : 'a non-error value was thrown';
  return text.replace(SECRET, '[cut]').slice(0, MAX_LENGTH);
}

/** Starts the logger on `target` (the window); returns the function that stops it. */
export function installErrorLog(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  log: (line: string) => void = (line) => {
    console.error(line);
  },
): () => void {
  const onError = (event: ErrorEvent): void => {
    log(`[client] uncaught error: ${describeError(event.error ?? event.message)}`);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    log(`[client] unhandled rejection: ${describeError(event.reason)}`);
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
