import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, ApiError, type Invite, type LobbyEntry } from '../api/http.ts';
import { setLocale, translate } from '../i18n/index.ts';
import LobbyScreen from './LobbyScreen.svelte';

const entry = (code: string, nick: string): LobbyEntry => ({
  code,
  host_nick: nick,
  map_id: 'pass',
  age_s: 1,
});

describe('LobbyScreen', () => {
  let component: Record<string, unknown> | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    setLocale('en');
  });
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
  }

  function render(api: Partial<Api>, onjoined = vi.fn()): void {
    component = mount(LobbyScreen, {
      target: document.body,
      props: {
        api: api as Api,
        token: 't',
        oncreate: vi.fn(),
        onjoined,
        onback: vi.fn(),
        pollMs: 2000,
      },
    });
  }

  it('lists the open matches and asks again every poll', async () => {
    const lobby = vi
      .fn<() => Promise<LobbyEntry[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([entry('c1', 'alice')]);
    render({ lobby });
    await settle();
    expect(document.body.textContent).toContain(translate('en', 'lobby.empty'));
    await vi.advanceTimersByTimeAsync(2000);
    flushSync();
    expect(document.body.textContent).toContain('alice');
    expect(lobby).toHaveBeenCalledTimes(2);
    expect(lobby).toHaveBeenCalledWith('t');
  });

  it('shows a nick as text, never as markup', async () => {
    render({ lobby: () => Promise.resolve([entry('c1', '<img src=x>')]) });
    await settle();
    expect(document.body.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x>');
  });

  it('joins a match from the list', async () => {
    const joinInvite = vi.fn(() => Promise.resolve({ code: 'c1' } as Invite));
    const onjoined = vi.fn();
    render({ lobby: () => Promise.resolve([entry('c1', 'alice')]), joinInvite }, onjoined);
    await settle();
    document.body.querySelector<HTMLButtonElement>('ul button')?.click();
    await settle();
    expect(joinInvite).toHaveBeenCalledWith('t', 'c1');
    expect(onjoined).toHaveBeenCalledWith('c1');
  });

  it('says the match is taken and refreshes the list when the join fails', async () => {
    const lobby = vi
      .fn<() => Promise<LobbyEntry[]>>()
      .mockResolvedValueOnce([entry('c1', 'alice')])
      .mockResolvedValue([]);
    const onjoined = vi.fn();
    render({ lobby, joinInvite: () => Promise.reject(new ApiError('conflict', 409)) }, onjoined);
    await settle();
    document.body.querySelector<HTMLButtonElement>('ul button')?.click();
    await settle();
    expect(onjoined).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(translate('en', 'error.lobby.taken'));
    expect(document.body.textContent).toContain(translate('en', 'lobby.empty'));
  });
});
