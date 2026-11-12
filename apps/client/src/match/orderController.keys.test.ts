import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEYS, type KeyMap } from '../app/keyBindings.ts';
import { HudChrome } from '../hud/chrome.svelte.ts';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { hudKey } from '../hud/hudKeys.ts';
import { HudState } from '../hud/hudState.svelte.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Command } from '../protocol.gen.ts';
import { forwardKey } from './keyEvents.ts';
import { OrderBook } from './orderBook.ts';
import { OrderController } from './orderController.ts';

// The order keys go by the bindings (#966): a rebound key does the action, the old key nothing.
const map = DEFAULT_MAP;
const base = devSnapshot(map, DEV_RULES, 30);
const first = base.view.groups[0];
if (first?.location.kind !== 'node') throw new Error('the dev snapshot has no group in a node');
const home = first.location.node;

function setup(keys: KeyMap) {
  const hud = new HudState({ me: 0, nicks: ['Ember', 'Bot'], rules: DEV_RULES, map });
  hud.onSnapshot(base);
  const sent: Command[] = [];
  const controller = new OrderController({
    hud,
    map,
    rules: DEV_RULES,
    book: new OrderBook(),
    send: (cmd) => sent.push(cmd),
    now: () => 0,
    keys: () => keys,
  });
  return { hud, controller, sent };
}

const down = (code: string) => ({ type: 'keydown', code, shiftKey: false }) as const;
const up = (code: string) => ({ type: 'keyup', code, shiftKey: false }) as const;

describe('order keys after a rebinding (#966)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('recruits on the new key, and R does nothing', () => {
    const { controller, sent } = setup({ ...DEFAULT_KEYS, recruit: 'KeyY' });
    controller.click({ kind: 'node', id: home }, false);
    expect(controller.key(down('KeyR'))).toBe(false);
    expect(sent).toEqual([]);
    expect(controller.key(down('KeyY'))).toBe(true);
    expect(sent).toEqual([{ type: 'recruit', node: home }]);
  });

  it('swapped keys swap the actions: X recruits, R cancels the recruit', () => {
    const { controller, sent } = setup({ ...DEFAULT_KEYS, recruit: 'KeyX', cancel: 'KeyR' });
    controller.click({ kind: 'node', id: home }, false);
    controller.key(down('KeyX'));
    controller.key(down('KeyR'));
    expect(sent).toEqual([
      { type: 'recruit', node: home },
      { type: 'cancel_recruit', node: home },
    ]);
  });

  it('holds a planned order on the new key and lets it go on its keyup', () => {
    const { controller } = setup({ ...DEFAULT_KEYS, planned: 'KeyV' });
    controller.key(down('KeyE'));
    expect(controller.planned).toBe(false);
    controller.key(down('KeyV'));
    expect(controller.planned).toBe(true);
    controller.key(up('KeyE'));
    expect(controller.planned).toBe(true);
    controller.key(up('KeyV'));
    expect(controller.planned).toBe(false);
  });

  it('opens the stance menu on the new key; the menu digits stay 1, 2, 3', () => {
    const { controller } = setup({ ...DEFAULT_KEYS, stance: 'KeyZ' });
    controller.key(down('KeyQ'));
    expect(controller.radial.current.open).toBe(false);
    controller.key(down('KeyZ'));
    controller.key(up('KeyZ'));
    expect(controller.radial.current.open).toBe(true);
    controller.key(down('KeyZ'));
    expect(controller.radial.current.open).toBe(false);
  });

  it('opens and closes the split menu on the new key; S is a stray key in the menu', () => {
    const { controller } = setup({ ...DEFAULT_KEYS, split: 'KeyK' });
    controller.click({ kind: 'group', id: first.id, node: home }, false);
    controller.key(down('KeyS'));
    expect(controller.splitMenu.current.open).toBe(false);
    controller.key(down('KeyK'));
    expect(controller.splitMenu.current.open).toBe(true);
    expect(controller.key(down('KeyS'))).toBe(false);
    expect(controller.splitMenu.current.open).toBe(true);
    controller.key(down('KeyK'));
    expect(controller.splitMenu.current.open).toBe(false);
  });

  it('toggles the terrain mode on the new key', () => {
    const { controller } = setup({ ...DEFAULT_KEYS, terrain: 'Backquote' });
    controller.key(down('KeyT'));
    expect(controller.terrainMode).toBe(false);
    controller.key(down('Backquote'));
    expect(controller.terrainMode).toBe(true);
  });

  it('the page forwards the keyup of the rebound planned key even from a text field', () => {
    const { controller } = setup({ ...DEFAULT_KEYS, planned: 'KeyV' });
    controller.key(down('KeyV'));
    expect(controller.planned).toBe(true);
    const field = document.createElement('input');
    document.body.append(field);
    const event = new KeyboardEvent('keyup', { code: 'KeyV' });
    field.dispatchEvent(event);
    forwardKey(controller, Object.defineProperty(event, 'target', { value: field }));
    expect(controller.planned).toBe(false);
    field.remove();
  });
});

describe('HUD keys after a rebinding (#966)', () => {
  const press = (code: string, key = code) => ({ type: 'keydown', code, key }) as const;

  it('fits the map and mutes on the new keys; Home and ? stay', () => {
    const chrome = new HudChrome();
    const fit = vi.fn();
    const mute = vi.fn();
    const keys: KeyMap = { ...DEFAULT_KEYS, fit: 'KeyJ', mute: 'KeyN' };
    expect(hudKey(chrome, press('KeyH'), { fit, mute }, 0, keys)).toBe('pass');
    expect(hudKey(chrome, press('KeyM'), { fit, mute }, 0, keys)).toBe('pass');
    expect(hudKey(chrome, press('KeyJ'), { fit, mute }, 0, keys)).toBe('handled');
    expect(hudKey(chrome, press('Home'), { fit, mute }, 0, keys)).toBe('handled');
    expect(hudKey(chrome, press('KeyN'), { fit, mute }, 0, keys)).toBe('handled');
    expect(fit).toHaveBeenCalledTimes(2);
    expect(mute).toHaveBeenCalledTimes(1);
    expect(hudKey(chrome, press('Slash', '?'), { fit, mute }, 0, keys)).toBe('handled');
    expect(chrome.settingsOpen).toBe(true);
  });
});
