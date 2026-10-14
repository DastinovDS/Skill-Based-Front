import { parseReplay, ReplayError, type ReplayFile } from './replayFile.ts';

export type ReplayLoadCode =
  'auth' | 'missing' | 'unavailable' | 'preparing' | 'timeout' | 'network' | 'format' | 'invalid';

/**
 * Why a replay could not be loaded: `auth` (401/403), `missing` (404: there is no such match; 422:
 * the id is not a match id), `unavailable` (410: the match is over and the server has no frames
 * for it and will make none), `preparing` (202: the server is still building the frames, ask
 * again; `loadReplayWhenReady` turns it into `timeout` when it takes too long), `network`, or a
 * file problem.
 */
export class ReplayLoadError extends Error {
  constructor(readonly code: ReplayLoadCode) {
    super(`replay not loaded: ${code}`);
    this.name = 'ReplayLoadError';
  }
}

/**
 * `GET /api/replays/{id}` (SRV-07): the browser unzips (`Content-Encoding: gzip`), so the body is
 * the JSON of the frames file. Rated matches are public; a private one needs the guest `token`.
 */
export async function loadReplay(
  matchId: string,
  token: string | null = null,
  fetchFn: typeof fetch = fetch,
): Promise<ReplayFile> {
  let response: Response;
  let body: unknown;
  try {
    response = await fetchFn(`/api/replays/${encodeURIComponent(matchId)}`, {
      headers: token === null ? {} : { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401 || response.status === 403) throw new ReplayLoadError('auth');
    if (response.status === 404 || response.status === 422) throw new ReplayLoadError('missing');
    if (response.status === 410) throw new ReplayLoadError('unavailable');
    if (response.status === 202) throw new ReplayLoadError('preparing');
    if (!response.ok) throw new ReplayLoadError('network');
    body = await response.json();
  } catch (error) {
    if (error instanceof ReplayLoadError) throw error;
    throw new ReplayLoadError('network');
  }
  try {
    return parseReplay(body);
  } catch (error) {
    if (error instanceof ReplayError) throw new ReplayLoadError(error.code);
    throw error;
  }
}

/** The first pause between asks, the longest one and how long to wait in all (#259). */
export const POLL_FIRST_MS = 2000;
export const POLL_MAX_MS = 5000;
export const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export interface WaitOptions {
  fetchFn?: typeof fetch;
  /** Pause between two asks; tests pass a fake. */
  sleep?: (ms: number) => Promise<void>;
  /** Stops the waiting (the screen went away); the promise then rejects with the abort reason. */
  signal?: AbortSignal;
  /** Called once, on the first answer "still preparing" (the screen shows the waiting window). */
  onPreparing?: () => void;
  timeoutMs?: number;
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * `loadReplay` that waits while the server prepares the frames after a match (#259): asks again
 * with a growing pause (2 s, 3 s, 4.5 s, then 5 s) until the file is there, a real error comes
 * or `timeoutMs` of waiting has passed (`timeout`).
 */
export async function loadReplayWhenReady(
  matchId: string,
  token: string | null = null,
  options: WaitOptions = {},
): Promise<ReplayFile> {
  const { fetchFn, sleep = pause, signal, onPreparing, timeoutMs = POLL_TIMEOUT_MS } = options;
  let waited = 0;
  let delay = POLL_FIRST_MS;
  for (let announced = false; ; announced = true) {
    signal?.throwIfAborted();
    try {
      return await loadReplay(matchId, token, fetchFn);
    } catch (error) {
      if (!(error instanceof ReplayLoadError) || error.code !== 'preparing') throw error;
      if (!announced) onPreparing?.();
    }
    if (waited + delay > timeoutMs) throw new ReplayLoadError('timeout');
    await sleep(delay);
    waited += delay;
    delay = Math.min(Math.round(delay * 1.5), POLL_MAX_MS);
  }
}

/** The address of the viewer for a finished match: the result screen links here. */
export function replayUrl(matchId: string): string {
  return `/?replay=${encodeURIComponent(matchId)}`;
}
