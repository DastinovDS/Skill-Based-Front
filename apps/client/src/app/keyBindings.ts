/**
 * The rebindable keys of a match (#966), kept per browser like the display settings
 * (`settings.ts`): plain TypeScript, loading, saving, binding and the readable names.
 *
 * A binding is a `KeyboardEvent.code` (the place of the key, whatever the layout), one per action.
 * The keys the menus and the browser need are never bound (`bindable`): Esc, Enter, Tab, the
 * arrows, the digits 1..9 of the menus, the modifiers, F1 (help), F5, F11, F12, Home. Shift with
 * the mouse, the wheel and the help key `?` stay fixed. A key taken by another action is swapped,
 * so every action always has exactly one key.
 */

/** The actions a viewer can move to another key, in the order Settings lists them. */
export const KEY_ACTIONS = [
  'planned',
  'release',
  'cancel',
  'recruit',
  'rally',
  'fortify',
  'split',
  'merge',
  'stance',
  'terrain',
  'alert',
  'fit',
  'mute',
  'mark',
] as const;
export type KeyAction = (typeof KEY_ACTIONS)[number];

/** An action -> its key (`KeyboardEvent.code`). */
export type KeyMap = Readonly<Record<KeyAction, string>>;

export const DEFAULT_KEYS: KeyMap = {
  planned: 'KeyE',
  release: 'KeyF',
  cancel: 'KeyX',
  recruit: 'KeyR',
  rally: 'KeyP',
  fortify: 'KeyB',
  split: 'KeyS',
  merge: 'KeyG',
  stance: 'KeyQ',
  terrain: 'KeyT',
  alert: 'Space',
  fit: 'KeyH',
  mute: 'KeyM',
  // "Mark a problem" (#810): the last minute of diagnostics to the server log, for playtests.
  mark: 'F8',
};

export const KEYS_STORAGE_KEY = 'sbf.keys';

/** The punctuation keys and their names on a US keyboard (the layout map may name them better). */
const PUNCTUATION: Readonly<Record<string, string>> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  IntlBackslash: '§',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/** The names of the other keys a binding may take. */
const NAMED: Readonly<Record<string, string>> = {
  Space: 'Space',
  Backspace: 'Bksp',
  Delete: 'Del',
  Insert: 'Ins',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
};

/**
 * A key a binding may take: letters, `0`, the numpad, the punctuation keys, `Space`, a few editing
 * keys and the function keys that do nothing in the browser. Everything else (Esc, Enter, Tab, the
 * arrows, 1..9, modifiers, F1, F5, F11, F12, Home, media keys) is refused.
 */
export function bindable(code: string): boolean {
  return (
    /^Key[A-Z]$/.test(code) ||
    code === 'Digit0' ||
    /^Numpad[0-9]$/.test(code) ||
    /^F([2-4]|[6-9]|10)$/.test(code) ||
    Object.hasOwn(PUNCTUATION, code) ||
    Object.hasOwn(NAMED, code)
  );
}

/**
 * The readable name of a key: for a character key the character of the viewer's layout when the
 * browser tells it (`layout`, from `navigator.keyboard.getLayoutMap`), else the name on a US
 * keyboard (`KeyE` -> `E`, `Numpad5` -> `Num 5`, `PageUp` -> `PgUp`).
 */
export function keyLabel(code: string, layout: ReadonlyMap<string, string> | null = null): string {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  const punctuation = Object.hasOwn(PUNCTUATION, code) ? PUNCTUATION[code] : undefined;
  const us = letter ?? digit ?? punctuation;
  if (us !== undefined) {
    const local = layout?.get(code)?.trim() ?? '';
    return local === '' ? us : local.toUpperCase();
  }
  const pad = /^Numpad([0-9])$/.exec(code)?.[1];
  if (pad !== undefined) return `Num ${pad}`;
  if (/^F[0-9]+$/.test(code)) return code;
  return Object.hasOwn(NAMED, code) ? (NAMED[code] ?? code) : code;
}

/** The action on `code`, or `null`: the key is nobody's. */
export function actionOf(keys: KeyMap, code: string): KeyAction | null {
  return KEY_ACTIONS.find((action) => keys[action] === code) ?? null;
}

/** Every code is used once. */
function distinct(keys: KeyMap): boolean {
  return new Set(KEY_ACTIONS.map((action) => keys[action])).size === KEY_ACTIONS.length;
}

/**
 * The saved bindings: a missing, damaged, unknown or refused value takes its default; two actions
 * on one key (a hand-edited or an old store) give the defaults for all.
 */
export function loadKeys(storage: () => Storage): KeyMap {
  try {
    const raw = storage().getItem(KEYS_STORAGE_KEY);
    if (raw === null) return DEFAULT_KEYS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return DEFAULT_KEYS;
    const saved = parsed as Record<string, unknown>;
    const keys = Object.fromEntries(
      KEY_ACTIONS.map((action) => {
        const code = saved[action];
        return [action, typeof code === 'string' && bindable(code) ? code : DEFAULT_KEYS[action]];
      }),
    ) as Record<KeyAction, string>;
    return distinct(keys) ? keys : DEFAULT_KEYS;
  } catch {
    return DEFAULT_KEYS;
  }
}

export function saveKeys(storage: () => Storage, keys: KeyMap): void {
  try {
    storage().setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Not remembered: the next visit starts from the defaults.
  }
}

/**
 * Binding `action` to `code`: `refused` for a key no binding may take, `same` when it is its key
 * already; otherwise the new map, and `swapped`: the action that had `code` and takes the old key
 * of `action` in exchange (`null`: the key was free).
 */
export type BindResult =
  | { readonly kind: 'refused' }
  | { readonly kind: 'same' }
  | { readonly kind: 'bound'; readonly keys: KeyMap; readonly swapped: KeyAction | null };

export function bindKey(keys: KeyMap, action: KeyAction, code: string): BindResult {
  if (!bindable(code)) return { kind: 'refused' };
  if (keys[action] === code) return { kind: 'same' };
  const other = actionOf(keys, code);
  const next: Record<KeyAction, string> = { ...keys, [action]: code };
  if (other !== null) next[other] = keys[action];
  return { kind: 'bound', keys: next, swapped: other };
}

/** `action` back on its default key; the action holding that key now takes the old one. */
export function resetKey(keys: KeyMap, action: KeyAction): BindResult {
  return bindKey(keys, action, DEFAULT_KEYS[action]);
}

/**
 * The key names the dictionary strings take (`{cancelKey}` in "can only be cancelled ({cancelKey})"),
 * one per action: `plannedKey`, `releaseKey`, ... `muteKey`.
 */
export function keyNames(
  keys: KeyMap,
  layout: ReadonlyMap<string, string> | null = null,
): Readonly<Record<`${KeyAction}Key`, string>> {
  return Object.fromEntries(
    KEY_ACTIONS.map((action) => [`${action}Key`, keyLabel(keys[action], layout)]),
  ) as Record<`${KeyAction}Key`, string>;
}
