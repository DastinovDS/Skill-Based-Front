import { flushSync, mount, tick, unmount } from 'svelte';
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

  function render(rated: boolean, onforfeit = vi.fn(), banSeconds = 0): string {
    setLocale('en');
    component = mount(ExitDialog, {
      target: document.body,
      props: { open: true, rated, banSeconds, onforfeit, onstay: vi.fn() },
    });
    flushSync();
    return document.querySelector('[role=alertdialog]')?.textContent ?? '';
  }

  it('keeps the plain warning for a match that is not ranked', () => {
    const text = render(false);
    expect(text).toContain(translate('en', 'exit.text'));
    expect(text).not.toMatch(/queue/);
  });

  it('says a first forfeit in a ranked match carries no lock yet (DEC-34)', () => {
    const text = render(true);
    expect(text).toContain(translate('en', 'exit.rated.noLock'));
    expect(text).toMatch(/does not lock the matchmaking queue/);
    expect(text).toMatch(/Bots, friends and the lobby stay open/);
    expect(text).toMatch(/opponent's rating unchanged/);
    expect(text).not.toContain(translate('en', 'exit.text'));
  });

  it.each([
    [300, '5 min'],
    [1800, '30 min'],
    [7200, '2 h'],
    [90, '2 min'],
  ])('shows the lock the server announces: %i s as %s', (seconds, shown) => {
    const text = render(true, vi.fn(), seconds);
    expect(text).toContain(`locks the matchmaking queue for ${shown}.`);
    expect(text).not.toContain(translate('en', 'exit.rated.noLock'));
  });

  it('ignores the lock length in a match that is not ranked', () => {
    const text = render(false, vi.fn(), 300);
    expect(text).toContain(translate('en', 'exit.text'));
    expect(text).not.toMatch(/queue/);
  });

  it('still forfeits only on the confirmation', () => {
    const onforfeit = vi.fn();
    render(true, onforfeit);
    expect(onforfeit).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('button.danger')?.click();
    expect(onforfeit).toHaveBeenCalledOnce();
  });

  it('marks the forfeit by an icon and words, and gives the focus to the safe answer', async () => {
    render(true);
    await tick();
    const danger = document.querySelector<HTMLButtonElement>('button.danger');
    expect(danger?.querySelector('svg')).not.toBeNull();
    expect(danger?.textContent).toContain(translate('en', 'exit.confirm'));
    expect(document.activeElement?.textContent).toContain(translate('en', 'exit.stay'));
  });

  it('keeps Tab inside the dialog: Stay, Forfeit, back to Stay', async () => {
    render(false);
    await tick();
    const dialog = document.querySelector('[role=alertdialog]');
    const press = (shiftKey = false): void => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));
    };
    press();
    expect(document.activeElement).toBe(document.querySelector('button.danger'));
    press();
    expect(document.activeElement?.textContent).toContain(translate('en', 'exit.stay'));
    press(true);
    expect(document.activeElement).toBe(document.querySelector('button.danger'));
  });
});
