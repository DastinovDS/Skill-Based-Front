/**
 * The keys of the HUD itself (ui-style 10 and 11): `?` help, `Home` fit the map, `J` the journal,
 * the double `Esc` that opens the exit dialog, and `Esc` that closes an overlay. The keys of the
 * orders (`match/keyEvents.ts`) come after these.
 */
import { DOUBLE_ESC_MS, type HudChrome } from './chrome.svelte.ts';

/** The parts of a keyboard event the HUD needs. */
export interface HudKeyInput {
  readonly type: 'keydown' | 'keyup';
  readonly code: string;
  readonly key: string;
  readonly repeat?: boolean;
}

/**
 * `handled`: the HUD took the key (prevent the default); `blocked`: an overlay is open, the game
 * keys must not act but the browser keeps its default (Tab, Enter on a button); `pass`: not ours.
 */
export type HudKeyResult = 'handled' | 'blocked' | 'pass';

export interface HudKeyActions {
  /** "Fit map". */
  fit: () => void;
}

export function hudKey(
  chrome: HudChrome,
  input: HudKeyInput,
  actions: HudKeyActions,
  now: number,
): HudKeyResult {
  if (input.type !== 'keydown') return chrome.modal ? 'blocked' : 'pass';
  if (input.code === 'Escape') {
    if (chrome.modal || chrome.journalOpen) {
      chrome.closeAll();
      return 'handled';
    }
    // An Esc that closes nothing counts for the double press; the first one also reaches the map
    // (it deselects), the second asks whether to leave.
    const double = now - chrome.lastEscape <= DOUBLE_ESC_MS;
    chrome.lastEscape = double ? -Infinity : now;
    if (double) {
      chrome.openExit();
      return 'handled';
    }
    return 'pass';
  }
  if (chrome.exitOpen) return 'blocked';
  if (input.key === '?' || input.code === 'F1') {
    if (input.repeat !== true) chrome.helpOpen = !chrome.helpOpen;
    return 'handled';
  }
  if (chrome.modal) return 'blocked';
  switch (input.code) {
    case 'Home':
      actions.fit();
      return 'handled';
    case 'KeyJ':
      if (input.repeat !== true) chrome.journalOpen = !chrome.journalOpen;
      return 'handled';
    default:
      return 'pass';
  }
}

const TEXT_INPUTS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

/**
 * A keyboard event of the page through the HUD keys: `true` means the HUD took it (or an overlay
 * is open) and the order keys must not see it. `preventDefault` is called here when the key was
 * the HUD's own. Typing in a field and shortcuts with Ctrl, Meta or Alt are left alone.
 */
export function routeKey(
  chrome: HudChrome,
  event: KeyboardEvent,
  actions: HudKeyActions,
  now: number = performance.now(),
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const target = event.target;
  const typing =
    target instanceof HTMLElement &&
    TEXT_INPUTS.has(target.tagName) &&
    !(target instanceof HTMLInputElement && target.type === 'checkbox');
  if (typing && event.code !== 'Escape') return false;
  const result = hudKey(
    chrome,
    {
      type: event.type === 'keyup' ? 'keyup' : 'keydown',
      code: event.code,
      key: event.key,
      repeat: event.repeat,
    },
    actions,
    now,
  );
  if (result === 'handled') event.preventDefault();
  return result !== 'pass';
}
