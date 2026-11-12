import { describe, expect, it, vi } from 'vitest';
import { HudChrome, DOUBLE_ESC_MS } from './chrome.svelte.ts';
import { hudKey, routeKey, type HudKeyInput } from './hudKeys.ts';
import { DEFAULT_KEYS } from '../app/keyBindings.ts';

const down = (code: string, key = code): HudKeyInput => ({ type: 'keydown', code, key });

describe('hudKey', () => {
  it('opens and closes the help on ? and F1', () => {
    const chrome = new HudChrome();
    const fit = vi.fn();
    expect(hudKey(chrome, down('Slash', '?'), { fit }, 0)).toBe('handled');
    expect(chrome.settingsOpen).toBe(true);
    expect(hudKey(chrome, down('F1'), { fit }, 1)).toBe('handled');
    expect(chrome.settingsOpen).toBe(false);
  });

  it('does not flip the help again on a held key', () => {
    const chrome = new HudChrome();
    hudKey(chrome, down('Slash', '?'), { fit: vi.fn() }, 0);
    hudKey(chrome, { ...down('Slash', '?'), repeat: true }, { fit: vi.fn() }, 1);
    expect(chrome.settingsOpen).toBe(true);
  });

  it('fits the map on H and on Home', () => {
    const chrome = new HudChrome();
    const fit = vi.fn();
    expect(hudKey(chrome, down('KeyH', 'h'), { fit }, 0)).toBe('handled');
    expect(hudKey(chrome, down('Home'), { fit }, 1)).toBe('handled');
    expect(fit).toHaveBeenCalledTimes(2);
  });

  it('toggles the sound on M, also while the help is open, but not in the exit dialog', () => {
    const chrome = new HudChrome();
    const mute = vi.fn();
    expect(hudKey(chrome, down('KeyM', 'm'), { fit: vi.fn(), mute }, 0)).toBe('handled');
    chrome.settingsOpen = true;
    expect(hudKey(chrome, down('KeyM', 'm'), { fit: vi.fn(), mute }, 1)).toBe('handled');
    expect(mute).toHaveBeenCalledTimes(2);
    chrome.openExit();
    expect(hudKey(chrome, down('KeyM', 'm'), { fit: vi.fn(), mute }, 2)).toBe('blocked');
    expect(mute).toHaveBeenCalledTimes(2);
  });

  it('marks a problem on F8 once per press, also while the help is open (#810)', () => {
    const chrome = new HudChrome();
    const mark = vi.fn();
    expect(hudKey(chrome, down('F8'), { fit: vi.fn(), mark }, 0)).toBe('handled');
    expect(hudKey(chrome, { ...down('F8'), repeat: true }, { fit: vi.fn(), mark }, 1)).toBe(
      'handled',
    );
    chrome.settingsOpen = true;
    expect(hudKey(chrome, down('F8'), { fit: vi.fn(), mark }, 2)).toBe('handled');
    expect(mark).toHaveBeenCalledTimes(2);
    // Without the action (the replay) the key is not the HUD's.
    chrome.settingsOpen = false;
    expect(hudKey(chrome, down('F8'), { fit: vi.fn() }, 3)).toBe('pass');
  });

  it('marks a problem on the key it was moved to', () => {
    const chrome = new HudChrome();
    const mark = vi.fn();
    const keys = { ...DEFAULT_KEYS, mark: 'F9' };
    expect(hudKey(chrome, down('F8'), { fit: vi.fn(), mark }, 0, keys)).toBe('pass');
    expect(hudKey(chrome, down('F9'), { fit: vi.fn(), mark }, 1, keys)).toBe('handled');
    expect(mark).toHaveBeenCalledOnce();
  });

  it('has no key for the removed journal: J goes on to the orders', () => {
    const chrome = new HudChrome();
    expect(hudKey(chrome, down('KeyJ', 'j'), { fit: vi.fn() }, 0)).toBe('pass');
  });

  it('passes the keys of the orders on', () => {
    const chrome = new HudChrome();
    for (const code of ['KeyQ', 'KeyU', 'KeyR', 'Digit1', 'Space', 'KeyX']) {
      expect(hudKey(chrome, down(code), { fit: vi.fn() }, 0), code).toBe('pass');
    }
  });

  it('opens the exit dialog on a double Esc and lets the first Esc through', () => {
    const chrome = new HudChrome();
    const fit = vi.fn();
    expect(hudKey(chrome, down('Escape'), { fit }, 1000)).toBe('pass');
    expect(chrome.exitOpen).toBe(false);
    expect(hudKey(chrome, down('Escape'), { fit }, 1000 + DOUBLE_ESC_MS)).toBe('handled');
    expect(chrome.exitOpen).toBe(true);
  });

  it('does not count two presses further apart than the window', () => {
    const chrome = new HudChrome();
    hudKey(chrome, down('Escape'), { fit: vi.fn() }, 0);
    expect(hudKey(chrome, down('Escape'), { fit: vi.fn() }, DOUBLE_ESC_MS + 1)).toBe('pass');
    expect(chrome.exitOpen).toBe(false);
  });

  it('needs a fresh pair after the dialog: a third quick Esc closes it, a fourth opens it', () => {
    const chrome = new HudChrome();
    const fit = vi.fn();
    hudKey(chrome, down('Escape'), { fit }, 0);
    hudKey(chrome, down('Escape'), { fit }, 100);
    expect(chrome.exitOpen).toBe(true);
    expect(hudKey(chrome, down('Escape'), { fit }, 200)).toBe('handled'); // closes: "stay"
    expect(chrome.exitOpen).toBe(false);
    expect(hudKey(chrome, down('Escape'), { fit }, 300)).toBe('pass'); // first of a new pair
  });

  it('keeps the game keys quiet while the exit dialog is open, but lets Tab through', () => {
    const chrome = new HudChrome();
    chrome.openExit();
    for (const code of ['KeyQ', 'Space', 'Home', 'Tab', 'Slash']) {
      expect(hudKey(chrome, down(code), { fit: vi.fn() }, 0), code).toBe('blocked');
    }
    expect(chrome.settingsOpen).toBe(false);
  });

  it('closes the help on Esc', () => {
    const chrome = new HudChrome();
    chrome.settingsOpen = true;
    expect(hudKey(chrome, down('Escape'), { fit: vi.fn() }, 0)).toBe('handled');
    expect(chrome.settingsOpen).toBe(false);
  });

  it('lets an Esc through that drops a selection or closes a menu, and it never counts', () => {
    const chrome = new HudChrome();
    let idle = false;
    const actions = { fit: vi.fn(), idle: () => idle };
    expect(hudKey(chrome, down('Escape'), actions, 0)).toBe('pass'); // drops the selection
    expect(hudKey(chrome, down('Escape'), actions, 100)).toBe('pass'); // closes a menu
    idle = true;
    // Nothing selected now: this is the first of a pair, the second one asks to leave.
    expect(hudKey(chrome, down('Escape'), actions, 200)).toBe('pass');
    expect(chrome.exitOpen).toBe(false);
    expect(hudKey(chrome, down('Escape'), actions, 300)).toBe('handled');
    expect(chrome.exitOpen).toBe(true);
  });

  it('does not open the exit dialog while something is selected, however fast Esc is pressed', () => {
    const chrome = new HudChrome();
    const actions = { fit: vi.fn(), idle: () => false };
    for (let i = 0; i < 4; i++) hudKey(chrome, down('Escape'), actions, i * 50);
    expect(chrome.exitOpen).toBe(false);
  });

  it('blocks the game keys while the help is open', () => {
    const chrome = new HudChrome();
    chrome.settingsOpen = true;
    expect(hudKey(chrome, down('KeyU'), { fit: vi.fn() }, 0)).toBe('blocked');
    expect(hudKey(chrome, { type: 'keyup', code: 'KeyQ', key: 'q' }, { fit: vi.fn() }, 0)).toBe(
      'blocked',
    );
  });
});

describe('routeKey', () => {
  const event = (init: KeyboardEventInit, target?: HTMLElement): KeyboardEvent => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    if (target !== undefined) Object.defineProperty(e, 'target', { value: target });
    return e;
  };

  it('prevents the default of its own keys and says they are taken', () => {
    const chrome = new HudChrome();
    const e = event({ code: 'Home', key: 'Home' });
    expect(routeKey(chrome, e, { fit: vi.fn() }, 0)).toBe(true);
    expect(e.defaultPrevented).toBe(true);
  });

  it('leaves shortcuts with Ctrl and typing in a field alone', () => {
    const chrome = new HudChrome();
    expect(routeKey(chrome, event({ code: 'Home', ctrlKey: true }), { fit: vi.fn() }, 0)).toBe(
      false,
    );
    const input = document.createElement('input');
    const fit = vi.fn();
    expect(routeKey(chrome, event({ code: 'KeyH', key: 'h' }, input), { fit }, 0)).toBe(false);
    expect(fit).not.toHaveBeenCalled();
  });

  it('does not prevent the default of a key an overlay only blocks', () => {
    const chrome = new HudChrome();
    chrome.openExit();
    const e = event({ code: 'Tab', key: 'Tab' });
    expect(routeKey(chrome, e, { fit: vi.fn() }, 0)).toBe(true);
    expect(e.defaultPrevented).toBe(false);
  });
});
