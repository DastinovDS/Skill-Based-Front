import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplayLinkState } from '../api/http.ts';
import { setLocale, translate, type MessageKey } from '../i18n/index.ts';
import ReplayChip from './ReplayChip.svelte';

describe('ReplayChip', () => {
  let component: Record<string, unknown> | undefined;
  beforeEach(() => {
    setLocale('en');
  });
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  function render(state: ReplayLinkState, onwatch = vi.fn()): void {
    component = mount(ReplayChip, {
      target: document.body,
      props: { state, opponent: 'Vega', onwatch },
    });
    flushSync();
  }

  it('opens the viewer from a ready replay only', () => {
    const onwatch = vi.fn();
    render('ready', onwatch);
    const button = document.querySelector('button');
    expect(button?.textContent).toContain(translate('en', 'history.replay.watch'));
    expect(button?.getAttribute('aria-label')).toContain('Vega');
    button?.click();
    expect(onwatch).toHaveBeenCalledOnce();
  });

  it.each([
    ['preparing', 'history.replay.preparing'],
    ['expired', 'history.replay.expired'],
    ['unavailable', 'history.replay.unavailable'],
    ['private', 'history.replay.private'],
  ] as const satisfies readonly (readonly [ReplayLinkState, MessageKey])[])(
    'says "%s" in words and offers no button',
    (state, key) => {
      render(state);
      expect(document.querySelector('button')).toBeNull();
      expect(document.body.textContent).toContain(translate('en', key));
    },
  );
});
