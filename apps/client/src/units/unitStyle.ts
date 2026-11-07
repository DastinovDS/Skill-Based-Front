/**
 * The viewer's choice of unit look (#784): helmets (the default, the owner's choice of #775) or the
 * triangles they replaced, kept per browser like the sound (`audio/prefs.ts`). A plain module, no
 * Svelte: the map renderer reads `unitStyle()` when it draws a token and listens for a change; the
 * markup reads the reactive mirror `unitStyleState.svelte.ts`. Storage may be missing or throw.
 */

export type UnitStyle = 'helmet' | 'triangle';

export const UNIT_STYLE_KEY = 'sbf.units';
export const DEFAULT_UNIT_STYLE: UnitStyle = 'helmet';

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The saved choice, or the default when nothing (or nothing valid) is saved. */
export function loadUnitStyle(store: Storage | null = storage()): UnitStyle {
  try {
    const raw = store?.getItem(UNIT_STYLE_KEY) ?? null;
    return raw === 'triangle' || raw === 'helmet' ? raw : DEFAULT_UNIT_STYLE;
  } catch {
    return DEFAULT_UNIT_STYLE;
  }
}

let current: UnitStyle = loadUnitStyle();
const listeners = new Set<(style: UnitStyle) => void>();

/** The unit look now. */
export function unitStyle(): UnitStyle {
  return current;
}

/** Switches the look, remembers it and tells the listeners (the map redraws its tokens). */
export function setUnitStyle(style: UnitStyle, store: Storage | null = storage()): void {
  try {
    store?.setItem(UNIT_STYLE_KEY, style);
  } catch {
    // Not remembered: the next visit starts from the default.
  }
  if (style === current) return;
  current = style;
  for (const listener of listeners) listener(style);
}

/** Calls `listener` on every change; returns the call that stops it. */
export function onUnitStyle(listener: (style: UnitStyle) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
