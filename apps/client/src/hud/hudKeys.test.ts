import { describe, expect, it, vi } from 'vitest';
import { HudChrome, DOUBLE_ESC_MS } from './chrome.svelte.ts';
import { hudKey, routeKey, type HudKeyInput } from './hudKeys.ts';

const down = (code: string, key = code): HudKeyInput => ({ type: 'keydown', code, key });

describe('hudKey', () => {
  it('opens and closes the help on ? and F1', () => {
    const chrome = new HudChrome();
    const fit = vi.fn();
    expect(hudKey(chrome, down('Slash', '?'), { fit }, 0)).toBe('handled');
    expect(chrome.helpOpen).toBe(true);
    expect(hudKey(chrome, down('F1'), { fit }, 1)).toBe('handled');
    expect(chrome.helpOpen).toBe(false);
  });

  it('does not flip the help again on a held key', () => {
    const chrome = new HudChrome();
    hudKey(chrome, down('Slash', '?'), { fit: vi.fn() }, 0);
    hudKey(chrome, { ...down('Slash', '?'), repeat: true }, { fit: vi.fn() }, 1);
    expect(chrome.helpOpen).toBe(true);
  });

  it('fits the map on Home and toggles the journal on J', () => {
    const chrome = new HudChrome();
    const fit = vi.fn();
    expect(hudKey(chrome, down('Home'), { fit }, 0)).toBe('handled');
    expect(fit).toHaveBeenCalledOnce();
    expect(hudKey(chrome, down('KeyJ', 'j'), { fit }, 1)).toBe('handled');
    expect(chrome.journalOpen).toBe(true);
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
    expect(chrome.helpOpen).toBe(false);
  });

  it('closes any open overlay on Esc', () => {
    const chrome = new HudChrome();
    chrome.helpOpen = true;
    chrome.journalOpen = true;
    expect(hudKey(chrome, down('Escape'), { fit: vi.fn() }, 0)).toBe('handled');
    expect(chrome.helpOpen).toBe(false);
    expect(chrome.journalOpen).toBe(false);
  });

  it('blocks the game keys while the help or the menu is open', () => {
    const chrome = new HudChrome();
    chrome.menuOpen = true;
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
    expect(routeKey(chrome, event({ code: 'KeyJ', key: 'j' }, input), { fit: vi.fn() }, 0)).toBe(
      false,
    );
    expect(chrome.journalOpen).toBe(false);
  });

  it('does not prevent the default of a key an overlay only blocks', () => {
    const chrome = new HudChrome();
    chrome.openExit();
    const e = event({ code: 'Tab', key: 'Tab' });
    expect(routeKey(chrome, e, { fit: vi.fn() }, 0)).toBe(true);
    expect(e.defaultPrevented).toBe(false);
  });
});
