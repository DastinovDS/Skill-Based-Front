import { describe, expect, it, vi } from 'vitest';
import { ApiError, type Api, type Leaderboard, type PlayerProfile } from '../api/http.ts';
import { BoardState, failed } from './boardState.svelte.ts';

const record = { wins: 0, losses: 0, draws: 0 };

function profile(id: number, nick: string): PlayerProfile {
  return {
    player_id: id,
    nick,
    has_password: true,
    rating: 1500,
    rank: id,
    calibration: null,
    rated_matches: 5,
    rated_record: record,
    record,
    matches: [],
  };
}

const board: Leaderboard = { entries: [], total: 0, min_rated_matches: 5 };

function fakeApi() {
  return {
    leaderboard: vi.fn<Api['leaderboard']>(() => Promise.resolve(board)),
    me: vi.fn<Api['me']>(() => Promise.resolve({ player_id: 7, nick: 'Me', has_password: true })),
    player: vi.fn<Api['player']>((id) => Promise.resolve(profile(id, `P${String(id)}`))),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe('BoardState', () => {
  it('loads the board and the own profile, asking who we are when the id is unknown', async () => {
    const api = fakeApi();
    const state = new BoardState(api, 'tok', null);
    await state.start();
    expect(state.board).toEqual({ status: 'ready', value: board });
    expect(state.ownId).toBe(7);
    expect(state.own).toMatchObject({ status: 'ready', value: { nick: 'P7' } });
    expect(api.player).toHaveBeenCalledWith(7, 'tok', expect.anything());
  });

  it('skips the question when the id is known', async () => {
    const api = fakeApi();
    await new BoardState(api, 'tok', 7).start();
    expect(api.me).not.toHaveBeenCalled();
  });

  it.each([
    [new ApiError('network', 0), 'network', null],
    [new ApiError('rate_limited', 429, 12), 'limited', 12],
    [new ApiError('not_found', 404), 'missing', null],
    [new ApiError('server', 500), 'server', null],
  ] as const)('names the failure of %s', (error, failure, retryAfterS) => {
    expect(failed(error)).toEqual({ status: 'failed', failure, retryAfterS });
  });

  it('fails the board without touching the profile, and retries', async () => {
    const api = fakeApi();
    api.leaderboard.mockRejectedValueOnce(new ApiError('network', 0));
    const state = new BoardState(api, 'tok', 7);
    await state.start();
    await settle();
    expect(state.board).toMatchObject({ status: 'failed', failure: 'network' });
    expect(state.own.status).toBe('ready');
    await state.loadBoard();
    expect(state.board.status).toBe('ready');
  });

  it('retries the own profile on its own', async () => {
    const api = fakeApi();
    api.player.mockRejectedValueOnce(new ApiError('network', 0));
    const state = new BoardState(api, 'tok', 7);
    await state.start();
    expect(state.own.status).toBe('failed');
    await state.loadOwn();
    expect(state.own.status).toBe('ready');
    expect(state.board.status).toBe('ready');
  });
});
