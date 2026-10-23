import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCALES } from '../i18n/index.ts';
import LocaleSelect from './LocaleSelect.svelte';

describe('LocaleSelect', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  it('is not shown while only one language ships', () => {
    expect(LOCALES).toHaveLength(1);
    component = mount(LocaleSelect, { target: document.body });
    flushSync();
    expect(document.body.querySelector('select')).toBeNull();
    expect(document.body.textContent).toBe('');
  });
});
