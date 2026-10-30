import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate } from '../i18n/index.ts';
import BootScreen from './BootScreen.svelte';

describe('BootScreen (#601)', () => {
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

  it('shows nothing for the first second, then one quiet status line', () => {
    component = mount(BootScreen, { target: document.body, props: {} });
    flushSync();
    const status = document.querySelector('[role=status]');
    expect(status?.textContent.trim()).toBe('');
    vi.advanceTimersByTime(999);
    flushSync();
    expect(status?.textContent.trim()).toBe('');
    vi.advanceTimersByTime(1);
    flushSync();
    expect(status?.textContent.trim()).toBe(translate('en', 'common.loading'));
  });

  it('is the frame of the menu, with no control to press', () => {
    component = mount(BootScreen, { target: document.body, props: { delay: 0 } });
    flushSync();
    expect(document.querySelector('main.front')).not.toBeNull();
    expect(document.querySelector('button, input, a')).toBeNull();
    expect(document.querySelector('[role=status]')?.textContent.trim()).toBe(
      translate('en', 'common.loading'),
    );
  });
});
