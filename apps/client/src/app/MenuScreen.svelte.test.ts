import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate } from '../i18n/index.ts';
import MenuScreen from './MenuScreen.svelte';

describe('MenuScreen', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    setLocale('en');
  });

  function render(hasActiveMatch: boolean, onresume = vi.fn()): void {
    setLocale('en');
    component = mount(MenuScreen, {
      target: document.body,
      props: {
        nick: 'Me',
        notice: null,
        oncreate: vi.fn(),
        onqueue: vi.fn(),
        onlobby: vi.fn(),
        onbot: vi.fn(),
        onchangenick: vi.fn(),
        hasActiveMatch,
        onresume,
      },
    });
    flushSync();
  }

  function resumeButton(): HTMLButtonElement | undefined {
    const label = translate('en', 'menu.resume');
    return [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  }

  it('offers the way back into a running match', () => {
    const onresume = vi.fn();
    render(true, onresume);
    resumeButton()?.click();
    expect(onresume).toHaveBeenCalledOnce();
  });

  it('has no such button without a running match', () => {
    render(false);
    expect(resumeButton()).toBeUndefined();
  });
});
