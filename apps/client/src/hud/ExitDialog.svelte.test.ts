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

  function render(onforfeit = vi.fn()): string {
    setLocale('en');
    component = mount(ExitDialog, {
      target: document.body,
      props: { open: true, onforfeit, onstay: vi.fn() },
    });
    flushSync();
    return document.querySelector('[role=alertdialog]')?.textContent ?? '';
  }

  it('asks in the title and the buttons alone; there is no ranked variant at the MVP (#765, H4)', () => {
    const text = render();
    expect(text).toContain(translate('en', 'exit.title'));
    expect(text).toContain(translate('en', 'exit.confirm'));
    expect(text).not.toMatch(/This is a forfeit/);
    expect(text).not.toMatch(/queue|ranked/);
  });

  it('still forfeits only on the confirmation', () => {
    const onforfeit = vi.fn();
    render(onforfeit);
    expect(onforfeit).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('button.danger')?.click();
    expect(onforfeit).toHaveBeenCalledOnce();
  });

  it('marks the forfeit by an icon and words, and gives the focus to the safe answer', async () => {
    render();
    await tick();
    const danger = document.querySelector<HTMLButtonElement>('button.danger');
    expect(danger?.querySelector('svg')).not.toBeNull();
    expect(danger?.textContent).toContain(translate('en', 'exit.confirm'));
    expect(document.activeElement?.textContent).toContain(translate('en', 'exit.stay'));
  });

  it('keeps Tab inside the dialog: from Forfeit back to Stay, Shift+Tab from Stay to Forfeit', async () => {
    render();
    await tick();
    const stay = document.activeElement;
    const danger = document.querySelector<HTMLButtonElement>('button.danger');
    expect(stay?.textContent).toContain(translate('en', 'exit.stay'));
    danger?.focus();
    danger?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(stay);
    stay?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(danger);
  });

  it('Escape keeps playing', async () => {
    const onstay = vi.fn();
    setLocale('en');
    component = mount(ExitDialog, {
      target: document.body,
      props: { open: true, onforfeit: vi.fn(), onstay },
    });
    flushSync();
    await tick();
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    expect(onstay).toHaveBeenCalledOnce();
  });
});
