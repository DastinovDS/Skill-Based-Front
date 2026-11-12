import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import MatchSettings from '../hud/MatchSettings.svelte';
import { DEFAULT_KEYS } from './keyBindings.ts';
import { keyBindings, KeyBindingsState } from './keyBindingsState.svelte.ts';
import KeysDialog from './KeysDialog.svelte';

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => {
      data.clear();
    },
    getItem: (key) => data.get(key) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

let component: Record<string, unknown> | undefined;
afterEach(() => {
  if (component !== undefined) void unmount(component);
  component = undefined;
  document.body.innerHTML = '';
  keyBindings.resetAll();
});

function press(target: Element, code: string, type: 'keydown' | 'keyup' = 'keydown'): void {
  const key = code === 'Escape' ? 'Escape' : '';
  target.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));
  flushSync();
}

/** The key button of an action, by its accessible name ("Recruit: R. Change it"). */
function cap(action: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button.cap')].find((b) =>
    (b.getAttribute('aria-label') ?? '').startsWith(`${action}:`),
  );
  if (found === undefined) throw new Error(`no key button for ${action}`);
  return found;
}

const status = (): string => document.querySelector('[role=status]')?.textContent ?? '';

describe('KeysDialog (#966)', () => {
  function render(onclose = vi.fn()) {
    setLocale('en');
    const bindings = new KeyBindingsState(() => memory(), null);
    component = mount(KeysDialog, { target: document.body, props: { onclose, bindings } });
    flushSync();
    return { bindings, onclose };
  }

  it('lists every rebindable action with its key and the fixed keys', () => {
    render();
    expect(document.querySelectorAll('button.cap')).toHaveLength(14);
    expect(cap('Recruit').textContent.trim()).toBe('R');
    expect(cap('Mark a problem').textContent.trim()).toBe('F8');
    expect(cap('Go to the alert').textContent.trim()).toBe('Space');
    const text = document.body.textContent;
    expect(text).toContain('Shift + LMB');
    expect(text).toContain('Fixed keys');
    // Nothing is changed yet: no reset beside a key.
    expect(document.querySelectorAll('button.reset')).toHaveLength(0);
  });

  it('a click waits for a key; the new key binds and the old holder is swapped, with a message', () => {
    const { bindings } = render();
    cap('Recruit').click();
    flushSync();
    expect(cap('Recruit').textContent.trim()).toBe('Press a key');
    expect(status()).toBe('Press the new key for Recruit. Esc cancels.');
    press(cap('Recruit'), 'KeyX');
    expect(bindings.keys).toEqual({ ...DEFAULT_KEYS, recruit: 'KeyX', cancel: 'KeyR' });
    expect(cap('Recruit').textContent.trim()).toBe('X');
    expect(cap('Cancel, undo').textContent.trim()).toBe('R');
    expect(status()).toBe('Recruit is on X now; Cancel, undo moved to R.');
  });

  it('Esc cancels the capture and does not close the dialog', () => {
    const { bindings, onclose } = render();
    cap('Recruit').click();
    flushSync();
    press(cap('Recruit'), 'Escape');
    expect(bindings.keys).toEqual(DEFAULT_KEYS);
    expect(cap('Recruit').textContent.trim()).toBe('R');
    expect(status()).toBe('Nothing changed.');
    expect(onclose).not.toHaveBeenCalled();
    // With no capture Esc closes the dialog.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' }));
    expect(onclose).toHaveBeenCalled();
  });

  it('refuses a key of the menus or the browser with a message and keeps waiting', () => {
    const { bindings } = render();
    cap('Recruit').click();
    flushSync();
    press(cap('Recruit'), 'Digit2');
    expect(status()).toBe('2 is kept for the menus or the browser: choose another key.');
    expect(cap('Recruit').textContent.trim()).toBe('Press a key');
    press(cap('Recruit'), 'KeyY');
    expect(bindings.keys.recruit).toBe('KeyY');
  });

  it('resets one key, then all', () => {
    const { bindings } = render();
    cap('Recruit').click();
    flushSync();
    press(cap('Recruit'), 'KeyY');
    cap('Merge the groups').click();
    flushSync();
    press(cap('Merge the groups'), 'KeyU');
    expect(document.querySelectorAll('button.reset')).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('button[aria-label="Reset Recruit to R"]')?.click();
    flushSync();
    expect(bindings.keys.recruit).toBe('KeyR');
    expect(bindings.keys.merge).toBe('KeyU');
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Reset all')?.click();
    flushSync();
    expect(bindings.keys).toEqual(DEFAULT_KEYS);
    expect(status()).toBe('Every key is back on its default.');
  });
});

describe('the settings of a match follow the bindings (#966)', () => {
  it('shows the rebound keys and names them in its texts', () => {
    setLocale('en');
    keyBindings.bind('recruit', 'KeyY');
    keyBindings.bind('planned', 'KeyV');
    keyBindings.bind('terrain', 'KeyK');
    component = mount(MatchSettings, {
      target: document.body,
      props: { open: true, onclose: vi.fn() },
    });
    flushSync();
    const rows = [...document.querySelectorAll('.keys dt')].map((dt) => dt.textContent.trim());
    expect(rows).toContain('Y');
    expect(rows).toContain('V + LMB');
    expect(rows).toContain('V + wheel');
    expect(rows).not.toContain('R');
    expect(rows).not.toContain('E + LMB');
    expect(document.body.textContent).toContain('K again: leave');
    // A change while it is open shows at once.
    keyBindings.bind('recruit', 'KeyW');
    flushSync();
    const after = [...document.querySelectorAll('.keys dt')].map((dt) => dt.textContent.trim());
    expect(after).toContain('W');
    expect(after).not.toContain('Y');
  });
});
