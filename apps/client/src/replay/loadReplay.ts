import { parseReplay, ReplayError, type ReplayFile } from './replayFile.ts';

export type ReplayLoadCode = 'auth' | 'missing' | 'network' | 'format' | 'invalid';

/** Why a replay could not be loaded: `auth` (401/403), `missing` (404: no match or not ready), `network`, or a file problem. */
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
    if (response.status === 404) throw new ReplayLoadError('missing');
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

/** The address of the viewer for a finished match: the result screen links here. */
export function replayUrl(matchId: string): string {
  return `/?replay=${encodeURIComponent(matchId)}`;
}
