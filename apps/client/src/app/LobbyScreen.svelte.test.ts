import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, ApiError, type Invite, type LobbyEntry } from '../api/http.ts';
import { setLocale, translate } from '../i18n/index.ts';
import { fakeMapApi, makeDock } from './dockTestKit.ts';
import LobbyScreen from './LobbyScreen.svelte';

const entry = (code: string, nick: string, map = 'crossroads'): LobbyEntry => ({
  code,
  host_nick: nick,
  map_id: map,
  age_s: 65,
});

describe('LobbyScreen (Dock, #473)', () => {
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

  function render(
    api: Partial<Api>,
    handlers: { onjoined?: () => void; oncreate?: () => void; onback?: () => void } = {},
  ) {
    const { dock, calls } = makeDock({}, { ...fakeMapApi(), ...api });
    component = mount(LobbyScreen, {
      target: document.body,
      props: {
        api: api as Api,
        token: 't',
        dock,
        oncreate: handlers.oncreate ?? vi.fn(),
        onjoined: handlers.onjoined ?? vi.fn(),
        onback: handlers.onback ?? vi.fn(),
        pollMs: 2000,
      },
    });
    return calls;
  }

  const joinButtons = (): HTMLButtonElement[] => [
    ...document.body.querySelectorAll<HTMLButtonElement>('.ents button'),
  ];
  const press = (key: string, init: KeyboardEventInit = {}): void => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
    flushSync();
  };

  it('lists the open matches, says how many wait and asks again every poll', async () => {
    const lobby = vi
      .fn<() => Promise<LobbyEntry[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValue([entry('c1', 'alice'), entry('c2', 'bob')]);
    render({ lobby });
    await settle();
    expect(document.body.textContent).toContain(translate('en', 'lobby.empty'));
    expect(document.body.textContent).toContain(translate('en', 'lobby.none'));
    await vi.advanceTimersByTimeAsync(2000);
    flushSync();
    expect(document.body.textContent).toContain('alice');
    expect(document.body.querySelector('h2')?.textContent).toBe('2 waiting');
    expect(lobby).toHaveBeenCalledTimes(2);
    expect(lobby).toHaveBeenCalledWith('t', expect.any(AbortSignal));
  });

  it('shows how long a match waits, its map and the "no pauses" and "unrated" chips', async () => {
    render({ lobby: () => Promise.resolve([entry('c1', 'alice', 'ridge')]) });
    await settle();
    expect(document.body.textContent).toContain('ridge · waiting 1:05');
    expect(document.body.textContent).toContain(translate('en', 'dock.chip.noPause'));
    expect(document.body.textContent).toContain(translate('en', 'dock.chip.unrated'));
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
    render({ lobby: () => Promise.resolve([entry('c1', 'alice')]), joinInvite }, { onjoined });
    await settle();
    joinButtons()[0]?.click();
    await settle();
    expect(joinInvite).toHaveBeenCalledWith('t', 'c1');
    expect(onjoined).toHaveBeenCalledWith('c1');
  });

  it('says "Joining" on the row while the join is on its way and blocks the others', async () => {
    render({
      lobby: () => Promise.resolve([entry('c1', 'alice'), entry('c2', 'bob')]),
      joinInvite: () => new Promise<Invite>(() => undefined),
    });
    await settle();
    joinButtons()[0]?.click();
    await settle();
    expect(document.body.querySelector('h2')?.textContent).toBe('Joining alice...');
    expect(joinButtons()[0]?.textContent).toBe(translate('en', 'lobby.joinBusy'));
    expect(joinButtons().every((b) => b.disabled)).toBe(true);
  });

  it('says the match is taken, refreshes the list and keeps the amber line on the screen', async () => {
    const lobby = vi
      .fn<() => Promise<LobbyEntry[]>>()
      .mockResolvedValueOnce([entry('c1', 'alice')])
      .mockResolvedValue([]);
    const onjoined = vi.fn();
    render(
      { lobby, joinInvite: () => Promise.reject(new ApiError('conflict', 409)) },
      { onjoined },
    );
    await settle();
    joinButtons()[0]?.click();
    await settle();
    expect(onjoined).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      translate('en', 'error.lobby.taken'),
    );
    expect(document.body.textContent).toContain(translate('en', 'lobby.empty'));
    // A later poll does not wipe the line before the player has read it.
    await vi.advanceTimersByTimeAsync(4000);
    flushSync();
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      translate('en', 'error.lobby.taken'),
    );
  });

  it('shows the loading rows and a retry line while the server cannot be reached', async () => {
    render({ lobby: () => Promise.reject(new ApiError('network', 0)) });
    await settle();
    expect(document.body.querySelectorAll('.sk')).toHaveLength(3);
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      translate('en', 'lobby.networkRetry'),
    );
  });

  it('moves the choice with the arrows, joins it with Enter and creates with C', async () => {
    const joinInvite = vi.fn(() => Promise.resolve({ code: 'c2' } as Invite));
    const oncreate = vi.fn();
    render(
      { lobby: () => Promise.resolve([entry('c1', 'alice'), entry('c2', 'bob')]), joinInvite },
      { oncreate },
    );
    await settle();
    press('ArrowDown');
    expect(document.body.querySelectorAll('.ent')[1]?.classList.contains('sel')).toBe(true);
    press('Enter');
    await settle();
    expect(joinInvite).toHaveBeenCalledWith('t', 'c2');
    press('c');
    expect(oncreate).toHaveBeenCalledTimes(1);
  });

  it('creates a match with Enter when the lobby is empty, and Esc goes back', async () => {
    const oncreate = vi.fn();
    const onback = vi.fn();
    render({ lobby: () => Promise.resolve([]) }, { oncreate, onback });
    await settle();
    press('Enter');
    expect(oncreate).toHaveBeenCalledTimes(1);
    press('Escape');
    expect(onback).toHaveBeenCalledTimes(1);
  });

  it('keeps the other modes of the rail working: B opens the bot, the current row is marked', async () => {
    const calls = render({ lobby: () => Promise.resolve([]) });
    await settle();
    const current = document.body.querySelector('.rail .row.cur');
    expect(current?.textContent).toContain(translate('en', 'menu.lobby'));
    expect(current?.getAttribute('aria-current')).toBe('page');
    press('b');
    expect(calls.onbot).toHaveBeenCalledTimes(1);
    press('l');
    expect(calls.onlobby).not.toHaveBeenCalled(); // already here
  });
});
