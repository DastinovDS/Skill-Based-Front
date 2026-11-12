import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOARD_SCENES, ME, sceneApi } from '../dev/boardScenes.ts';
import { setLocale } from '../i18n/index.ts';
import ProfileScreen from './ProfileScreen.svelte';

describe('ProfileScreen header (#1003)', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  function render(onsettings = vi.fn()): void {
    setLocale('en');
    component = mount(ProfileScreen, {
      target: document.body,
      props: {
        api: sceneApi(BOARD_SCENES.profile),
        token: 't',
        ownId: ME,
        nick: 'Ember',
        hasPassword: true,
        map: null,
        onwatch: vi.fn(),
        onbot: vi.fn(),
        colour: 'lapis',
        oncolour: () => Promise.resolve(null),
        onsettings,
        onhelp: vi.fn(),
        onback: vi.fn(),
      },
    });
    flushSync();
  }

  const labels = (): string[] =>
    [...document.querySelectorAll('button')].map((b) => b.textContent.trim());

  it('has no way to change the nick and no log-out: both live elsewhere', () => {
    render();
    expect(document.body.textContent).not.toContain('Change the nick');
    expect(labels()).not.toContain('Log out');
  });

  it('says nothing under the colour picker', () => {
    render();
    expect(document.body.textContent).not.toContain('Your colour in matches');
  });

  it('opens the settings from a framed button', () => {
    const onsettings = vi.fn();
    render(onsettings);
    const button = [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Settings',
    );
    expect(button?.classList.contains('lapis-btn')).toBe(true);
    button?.click();
    expect(onsettings).toHaveBeenCalledOnce();
  });
});
