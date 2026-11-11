/**
 * The key bindings of the page (#966), reactive: the order and HUD keys read `keys` on every key
 * press, every printed key name reads `label()` (so it follows a change at once), Settings changes
 * them. Saved per browser under `sbf.keys` (`keyBindings.ts`).
 */
import {
  bindKey,
  DEFAULT_KEYS,
  keyLabel,
  keyNames,
  loadKeys,
  resetKey,
  saveKeys,
  type BindResult,
  type KeyAction,
  type KeyMap,
} from './keyBindings.ts';

/** The part of `navigator.keyboard` (Chromium) that names the keys of the viewer's layout. */
interface LayoutSource {
  getLayoutMap: () => Promise<ReadonlyMap<string, string>>;
}

function layoutSource(): LayoutSource | null {
  if (typeof navigator === 'undefined') return null;
  const keyboard = (navigator as Navigator & { keyboard?: Partial<LayoutSource> }).keyboard;
  return typeof keyboard?.getLayoutMap === 'function' ? (keyboard as LayoutSource) : null;
}

export class KeyBindingsState {
  keys = $state.raw<KeyMap>(DEFAULT_KEYS);
  /** The characters of the viewer's layout by key code, when the browser tells them. */
  layout = $state.raw<ReadonlyMap<string, string> | null>(null);

  readonly #storage: () => Storage;

  constructor(
    storage: () => Storage = () => window.localStorage,
    layout: LayoutSource | null = layoutSource(),
  ) {
    this.#storage = storage;
    this.keys = loadKeys(storage);
    layout
      ?.getLayoutMap()
      .then((map) => {
        this.layout = map;
      })
      .catch(() => {
        // No layout map (a frame, a policy): the US names stay.
      });
  }

  /** The readable name of the key of `action`. */
  label(action: KeyAction): string {
    return keyLabel(this.keys[action], this.layout);
  }

  /** The key names for the dictionary strings (`{cancelKey}` ...). */
  names(): ReturnType<typeof keyNames> {
    return keyNames(this.keys, this.layout);
  }

  /** Puts `action` on `code` (swapping with the action that had it) and remembers it. */
  bind(action: KeyAction, code: string): BindResult {
    return this.#take(bindKey(this.keys, action, code));
  }

  /** `action` back on its default key. */
  reset(action: KeyAction): BindResult {
    return this.#take(resetKey(this.keys, action));
  }

  /** Every action back on its default key. */
  resetAll(): void {
    this.keys = DEFAULT_KEYS;
    saveKeys(this.#storage, this.keys);
  }

  #take(result: BindResult): BindResult {
    if (result.kind === 'bound') {
      this.keys = result.keys;
      saveKeys(this.#storage, this.keys);
    }
    return result;
  }
}

/** The key bindings of the page. */
export const keyBindings = new KeyBindingsState();
