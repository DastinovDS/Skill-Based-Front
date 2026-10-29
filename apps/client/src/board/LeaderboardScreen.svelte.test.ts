import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http.ts';
import {
  BOARD_NOW,
  BOARD_SCENES,
  ME,
  VEGA,
  sceneApi,
  type BoardSceneId,
} from '../dev/boardScenes.ts';
import { setLocale, translate, type MessageKey } from '../i18n/index.ts';
import LeaderboardScreen from './LeaderboardScreen.svelte';

const tr = (key: MessageKey): string => translate('en', key);

describe('LeaderboardScreen', () => {
  let component: Record<string, unknown> | undefined;
  beforeEach(() => {
    setLocale('en');
    // jsdom has no layout: the Replays row scrolls the history into view.
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  const handlers = () => ({
    onselect: vi.fn(),
    onwatch: vi.fn(),
    onmenu: vi.fn(),
    onbot: vi.fn(),
    oncreate: vi.fn(),
    onlobby: vi.fn(),
    onreplays: vi.fn(),
    onboard: vi.fn(),
    onpassword: vi.fn(),
    onlogout: vi.fn(),
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    flushSync();
  }

  async function render(id: BoardSceneId, over: Record<string, unknown> = {}) {
    const scene = BOARD_SCENES[id];
    const h = handlers();
    const api = sceneApi(scene);
    component = mount(LeaderboardScreen, {
      target: document.body,
      props: {
        api,
        token: 'tok',
        ownId: ME,
        nick: 'Danya',
        hasPassword: scene.hasPassword,
        calibration: scene.calibration,
        rating: scene.rating,
        map: null,
        mode: scene.mode,
        player: scene.player,
        now: () => BOARD_NOW,
        ...h,
        ...over,
      },
    });
    await settle();
    return { h, api };
  }

  const text = (): string => document.body.textContent;
  const rowOf = (nick: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('button.entry')).find((b) =>
      b.textContent.includes(nick),
    );
  const buttonLabelled = (label: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes(label));

  it('ranked: the top list with the own row marked and the own profile beside it', async () => {
    await render('board-ranked');
    expect(rowOf('Alina')).toBeDefined();
    const own = rowOf('Danya');
    expect(own?.getAttribute('aria-current')).toBe('true');
    expect(own?.textContent).toContain(tr('board.you'));
    expect(text()).toContain('1480');
    expect(text()).toContain('#6');
    expect(text()).toContain('of 37 ranked');
    expect(text()).toContain('12 wins');
    expect(text()).toContain('19 wins');
    // The history: ready replays open, the others say why not, in words.
    expect(document.querySelectorAll('li .watch')).toHaveLength(4);
    expect(text()).toContain(tr('history.replay.expired'));
    expect(text()).toContain(tr('history.replay.unavailable'));
    expect(text()).toContain('+14');
    expect(text()).toContain('1466 → 1480');
    // The corner chip carries the rating.
    expect(text()).toContain(tr('menu.rating'));
  });

  it('opens a replay by the match id', async () => {
    const { h } = await render('board-ranked');
    document.querySelector<HTMLButtonElement>('li .watch')?.click();
    expect(h.onwatch).toHaveBeenCalledWith(expect.stringMatching(/^\d+$/));
  });

  it('far: pins the own row with the real rank under the table', async () => {
    await render('board-far');
    expect(document.querySelector('.pinned .entry.me')?.textContent).toContain('143');
    expect(document.querySelector('[role="separator"]')).not.toBeNull();
  });

  it('calibration: shows the cells and when the player will appear', async () => {
    await render('board-calibration');
    expect(text()).toContain('Calibration 2/5');
    expect(text()).toContain('You appear here after 5 ranked matches');
    expect(text()).not.toContain('of 37 ranked');
    expect(text()).toContain(tr('history.rating.hidden'));
  });

  it('guest: no rating, a hint to set a password, the pinned guest card', async () => {
    await render('board-guest');
    expect(text()).toContain(tr('profile.noRating.own'));
    expect(text()).toContain('Set a password and play 5 ranked matches to appear here.');
    expect(text()).toContain(tr('menu.guest'));
  });

  it('empty board: says so and offers the next step', async () => {
    const { h } = await render('board-empty');
    expect(text()).toContain(tr('board.empty.title'));
    buttonLabelled(tr('board.empty.play'))?.click();
    expect(h.onmenu).toHaveBeenCalledOnce();
  });

  it('empty board for a guest offers the password', async () => {
    const guest = BOARD_SCENES['board-guest'];
    const api = sceneApi({
      ...guest,
      leaderboard: () => Promise.resolve({ entries: [], total: 0, min_rated_matches: 5 }),
    });
    const { h } = await render('board-guest', { api });
    buttonLabelled(tr('board.empty.password'))?.click();
    expect(h.onpassword).toHaveBeenCalledOnce();
  });

  it('loading: a status line and no rows yet', async () => {
    await render('board-loading');
    expect(document.querySelector('[role="status"]')?.textContent).toBe(tr('board.loading'));
    expect(document.querySelectorAll('button.entry')).toHaveLength(0);
    // The profile does not wait for the list.
    expect(text()).toContain('1480');
  });

  it('network error: an alert with a retry that asks again', async () => {
    const scene = BOARD_SCENES['board-network'];
    const leaderboard = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('network', 0))
      .mockImplementation(BOARD_SCENES['board-ranked'].leaderboard);
    const api = { ...sceneApi(scene), leaderboard };
    await render('board-network', { api });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      tr('board.error.network'),
    );
    buttonLabelled(tr('board.retry'))?.click();
    await settle();
    expect(rowOf('Alina')).toBeDefined();
    expect(leaderboard).toHaveBeenCalledTimes(2);
  });

  it('429: says how long to wait', async () => {
    await render('board-limited');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Try again in 12 s');
  });

  it("another player's profile lists ranked matches only", async () => {
    await render('profile-other');
    expect(text()).toContain('Vega');
    expect(text()).toContain('1590');
    expect(text()).not.toContain(tr('board.you').toUpperCase());
    expect(text()).not.toContain(tr('history.kind.casual'));
    expect(text()).not.toContain(tr('history.kind.bot'));
    expect(text()).toContain(tr('history.replay.preparing'));
    expect(text()).toContain(tr('history.replay.expired'));
    expect(text()).toContain(tr('profile.history.rankedOnly'));
  });

  it('a calibrating player shows cells, no rating and hidden rating changes', async () => {
    await render('profile-calibrating');
    expect(text()).toContain('Pavel');
    expect(text()).toContain('Calibration 3/5');
    expect(text()).toContain('Shown after 5 ranked matches');
  });

  it('a guest profile opens without a rating', async () => {
    await render('profile-guest');
    expect(text()).toContain('Ilya');
    expect(text()).toContain(tr('profile.noRating.other'));
  });

  it('a ranked player without ranked matches says so', async () => {
    await render('profile-empty');
    expect(text()).toContain('Newcomer');
    expect(text()).toContain(tr('profile.empty.title'));
  });

  it('404: an unknown player, with the way back to the own profile', async () => {
    await render('profile-missing');
    expect(text()).toContain(tr('profile.missing.title'));
    buttonLabelled(tr('profile.missing.own'))?.click();
    await settle();
    expect(text()).toContain('1480');
    expect(text()).not.toContain(tr('profile.missing.title'));
  });

  it('profile loading and a network error keep the list usable', async () => {
    await render('profile-loading');
    expect(text()).toContain(tr('profile.loading'));
    expect(rowOf('Alina')).toBeDefined();
    if (component !== undefined) void unmount(component);
    document.body.innerHTML = '';
    await render('profile-network');
    expect(text()).toContain(tr('profile.error.network'));
    expect(rowOf('Alina')).toBeDefined();
  });

  it('a click on a row shows that player and tells the app', async () => {
    const { h } = await render('board-ranked');
    rowOf('Vega')?.click();
    await settle();
    expect(rowOf('Vega')?.getAttribute('aria-pressed')).toBe('true');
    expect(h.onselect).toHaveBeenLastCalledWith(VEGA);
    expect(text()).toContain('22 wins');
    rowOf('Danya')?.click();
    await settle();
    expect(h.onselect).toHaveBeenLastCalledWith(null);
  });

  it("a click on the opponent's name opens their profile", async () => {
    await render('board-ranked');
    const link = document.querySelector<HTMLButtonElement>('li button.link');
    link?.click();
    await settle();
    expect(text()).toContain(tr('profile.history.rankedOnly'));
  });

  it('Replays mode marks the Replays row and brings the history into view', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    await render('replays');
    const current = document.querySelector('.rail .row.cur, nav .row.cur');
    expect(current?.textContent).toContain(tr('menu.replays'));
    expect(scrolled).toHaveBeenCalled();
  });

  it('keys: Esc goes to the menu, R and T switch between the rows, B opens the bot', async () => {
    const { h } = await render('board-ranked');
    const press = (key: string): void => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    };
    press('Escape');
    expect(h.onmenu).toHaveBeenCalledOnce();
    press('r');
    expect(h.onreplays).toHaveBeenCalledOnce();
    press('t');
    expect(h.onboard).not.toHaveBeenCalled();
    press('b');
    press('i');
    press('l');
    expect(h.onbot).toHaveBeenCalledOnce();
    expect(h.oncreate).toHaveBeenCalledOnce();
    expect(h.onlobby).toHaveBeenCalledOnce();
  });
});
