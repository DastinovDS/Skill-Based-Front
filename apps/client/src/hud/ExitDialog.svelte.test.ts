import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale, translate } from '../i18n/index.ts';
import ExitDialog from './ExitDialog.svelte';

describe('ExitDialog', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
    setLocale('en');
  });

  function render(rated: boolean, onforfeit = vi.fn()): string {
    setLocale('en');
    component = mount(ExitDialog, {
      target: document.body,
      props: { open: true, rated, onforfeit, onstay: vi.fn() },
    });
    flushSync();
    return document.querySelector('[role=alertdialog]')?.textContent ?? '';
  }

  it('keeps the plain warning for a match that is not ranked', () => {
    const text = render(false);
    expect(text).toContain(translate('en', 'exit.text'));
    expect(text).not.toMatch(/queue/);
  });

  it('explains the queue lock before a forfeit in a ranked match (DEC-34)', () => {
    const text = render(true);
    expect(text).toContain(translate('en', 'exit.ratedText'));
    expect(text).toMatch(/lock the matchmaking queue/);
    expect(text).toMatch(/bots, friends and the lobby stay open/);
    expect(text).toMatch(/opponent's rating unchanged/);
    expect(text).not.toContain(translate('en', 'exit.text'));
  });

  it('still forfeits only on the confirmation', () => {
    const onforfeit = vi.fn();
    render(true, onforfeit);
    expect(onforfeit).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('button.danger')?.click();
    expect(onforfeit).toHaveBeenCalledOnce();
  });
});
