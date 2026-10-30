import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/http.ts';
import { BOARD_NOW, BOARD_SCENES, ME, sceneApi, type BoardSceneId } from '../dev/boardScenes.ts';
import { setLocale, translate, type MessageKey } from '../i18n/index.ts';
import type { MapFile } from '../protocol.gen.ts';
import LeaderboardScreen from './LeaderboardScreen.svelte';
import ReplaysScreen from './ReplaysScreen.svelte';
import { winShare } from './view.ts';

const tr = (key: MessageKey): string => translate('en', key);

let component: Record<string, unknown> | undefined;
beforeEach(() => {
  setLocale('en');
});
afterEach(() => {
  if (component !== undefined) void unmount(component);
  component = undefined;
  document.body.innerHTML = '';
});

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
  flushSync();
}

const tabs = () => ({
  onplay: vi.fn(),
  onreplays: vi.fn(),
  onboard: vi.fn(),
  onhowto: vi.fn(),
});

const text = (): string => document.body.textContent;
const rowOf = (nick: string): HTMLTableRowElement | undefined =>
  Array.from(document.querySelectorAll<HTMLTableRowElement>('tbody tr')).find((r) =>
    r.textContent.includes(nick),
  );
const buttonLabelled = (label: string): HTMLButtonElement | undefined =>
  Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === label);

describe('LeaderboardScreen (#629, L10)', () => {
  async function render(id: BoardSceneId, over: Record<string, unknown> = {}) {
    const scene = BOARD_SCENES[id];
    const h = { ...tabs(), onpassword: vi.fn(), onlogout: vi.fn() };
    component = mount(LeaderboardScreen, {
      target: document.body,
      props: {
        api: sceneApi(scene),
        token: 'tok',
        ownId: ME,
        nick: 'Danya',
        hasPassword: scene.hasPassword,
        calibration: scene.calibration,
        rating: scene.rating,
        map: null,
        ...h,
        ...over,
      },
    });
    await settle();
    return h;
  }

  it('ranked: the record columns of every player, the own row marked, no match list', async () => {
    await render('board-ranked');
    expect(document.querySelectorAll('th')).toHaveLength(6);
    const alina = rowOf('Alina');
    // Alina: 31-9-2 of 42 ranked matches, 74 % wins, rating 1712 (the scene's numbers).
    expect(alina?.textContent).toContain('42');
    expect(alina?.textContent).toContain('31–9–2');
    expect(alina?.textContent).toContain('74%');
    expect(alina?.textContent).toContain('1712');
    const own = rowOf('Danya');
    expect(own?.getAttribute('aria-current')).toBe('true');
    expect(own?.textContent).toContain(tr('board.you'));
    expect(document.querySelector('.watch')).toBeNull();
    expect(document.querySelector('li')).toBeNull();
  });

  it('far: the own row with the real rank and record under a gap', async () => {
    await render('board-far');
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const own = rows[rows.length - 1];
    expect(own?.textContent).toContain('143');
    expect(own?.textContent).toContain('7–12–1');
    expect(own?.textContent).toContain('1102');
    expect(text()).toContain(tr('board.pinned.beyond'));
  });

  it('calibration: the cells and when the player will appear', async () => {
    await render('board-calibration');
    expect(document.querySelector('.pinned .cells')?.getAttribute('aria-label')).toBe(
      'Calibration: 2 of 5 matches played',
    );
    expect(text()).toContain('You appear here after 5 ranked matches');
  });

  it('guest: a link to set a password', async () => {
    const h = await render('board-guest');
    buttonLabelled(tr('board.empty.password'))?.click();
    expect(h.onpassword).toHaveBeenCalledOnce();
  });

  it('empty: says so and offers the queue', async () => {
    const h = await render('board-empty');
    expect(text()).toContain(tr('board.empty.title'));
    buttonLabelled(tr('board.empty.play'))?.click();
    expect(h.onplay).toHaveBeenCalledOnce();
  });

  it('a failed board says why and tries again', async () => {
    const h = await render('board-limited');
    expect(text()).toContain('Too many requests. Try again in 12 s.');
    expect(h.onplay).not.toHaveBeenCalled();
  });

  it('the tabs lead to the other screens, Esc to the menu', async () => {
    const h = await render('board-ranked');
    const current = document.querySelector('.tabs [aria-current="page"]');
    expect(current?.textContent).toBe(tr('menu.leaderboard'));
    buttonLabelled(tr('menu.replays'))?.click();
    expect(h.onreplays).toHaveBeenCalledOnce();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(h.onplay).toHaveBeenCalledOnce();
    expect(document.querySelector('kbd')).toBeNull();
  });
});

describe('ReplaysScreen (#629, R2)', () => {
  const map = (id: string): MapFile => ({ meta: { name: id } }) as MapFile;

  async function render(id: BoardSceneId, over: Record<string, unknown> = {}) {
    const scene = BOARD_SCENES[id];
    const h = {
      ...tabs(),
      onwatch: vi.fn(),
      onbot: vi.fn(),
      onpassword: vi.fn(),
      onlogout: vi.fn(),
    };
    const maps = { get: vi.fn(() => null), ensure: vi.fn((m: string) => Promise.resolve(map(m))) };
    component = mount(ReplaysScreen, {
      target: document.body,
      props: {
        api: sceneApi(scene),
        token: 'tok',
        ownId: ME,
        nick: 'Danya',
        hasPassword: scene.hasPassword,
        calibration: scene.calibration,
        rating: scene.rating,
        map: null,
        maps,
        now: () => BOARD_NOW,
        ...h,
        ...over,
      },
    });
    await settle();
    return { h, maps };
  }

  it('a card per match: result, opponent, kind, rating change and the replay state', async () => {
    const { maps } = await render('replays');
    expect(document.querySelectorAll('li.card')).toHaveLength(6);
    expect(document.querySelectorAll('li.card .watch')).toHaveLength(4);
    expect(text()).toContain(tr('history.replay.expired'));
    expect(text()).toContain(tr('history.replay.unavailable'));
    expect(text()).toContain('+14');
    expect(text()).toContain(tr('history.kind.rated'));
    // Each map file is asked for once, however many cards share it.
    expect(maps.ensure.mock.calls.map(([m]) => m).sort()).toEqual([
      'crossroads',
      'highway',
      'ridge',
    ]);
  });

  it('opens a replay by the match id', async () => {
    const { h } = await render('replays');
    document.querySelector<HTMLButtonElement>('li.card .watch')?.click();
    expect(h.onwatch).toHaveBeenCalledWith(expect.stringMatching(/^\d+$/));
  });

  it('no matches: says so and offers a bot', async () => {
    const { h } = await render('replays-empty');
    expect(text()).toContain(tr('replays.empty.title'));
    buttonLabelled(tr('menu.bot'))?.click();
    expect(h.onbot).toHaveBeenCalledOnce();
  });

  it('a failure says why and loads again', async () => {
    const scene = BOARD_SCENES.replays;
    const api = sceneApi(scene);
    const player = vi
      .fn<typeof api.player>()
      .mockRejectedValueOnce(new ApiError('network', 0))
      .mockImplementation(api.player);
    await render('replays', { api: { ...api, player } });
    expect(text()).toContain(tr('profile.error.network'));
    buttonLabelled(tr('board.retry'))?.click();
    await settle();
    expect(document.querySelectorAll('li.card')).toHaveLength(6);
  });

  it('marks its tab', async () => {
    await render('replays');
    expect(document.querySelector('.tabs [aria-current="page"]')?.textContent).toBe(
      tr('menu.replays'),
    );
  });
});

describe('winShare', () => {
  it('rounds to whole percent and has none without matches', () => {
    expect(winShare({ wins: 31, losses: 9, draws: 2 }, 42)).toBe(74);
    expect(winShare({ wins: 1, losses: 1, draws: 1 }, 3)).toBe(33);
    expect(winShare({ wins: 0, losses: 0, draws: 0 }, 0)).toBeNull();
  });
});
