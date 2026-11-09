/**
 * The "Cut" icons of the in-match interface (ui-style 53g, 54g, the round 5 Combined view): a solid
 * silhouette ruled in the ink colour, the outline in ink over a dark casing, square ends. Drawn for
 * this project on a 26-unit box centred on 0, so they need no licence notice. The radial menus, the
 * stance chip and the factory counter of the top bar use them; the fortify icon is its own per-size
 * drawing (`fortIcon.ts`).
 */

export const CUT_ICONS = {
  // the game's own helmet and a plus
  recruit:
    'M-10.6 6.4 C-11.4 -0.4 -8 -5.2 -2.6 -5.2 C1.6 -5.2 4.6 -2.4 5.2 0.8 C5.4 1.8 5.8 2.4 6.6 3 C4 3.2 2 3.6 0.8 4.4 C-0.4 5.2 -1.2 6.4 -3.2 6.4 Z M-11 8.4 C-8.4 8.8 -5.6 9 -3.2 8.8 C-1.2 8.6 0 7.2 1 6.4 C2 5.6 4 5.2 6.8 5 M5.5 -11 V-4.5 M2.25 -7.75 H8.75',
  barracks: 'M-9 9 V-1 L0 -8.5 L9 -1 V9 Z M-3 9 V3 H3 V9 M0 -8.5 V-12.5 L4.5 -11 L0 -9.5',
  factory: 'M-10 9 V-1.5 L-5 -5 V-1.5 L0 -5 V-1.5 L5 -5 V-10 H8.5 V9 Z M-6.5 4 H-3 M0 4 H3.5',
  split: 'M0 10 V2 L-7 -6 M0 2 L7 -6 M-7 -6 H-2.5 M-7 -6 V-1.5 M7 -6 H2.5 M7 -6 V-1.5',
  release: 'M-9 -8 V8 M-5 0 H9 M4.5 -4.5 L9 0 L4.5 4.5',
  cancel: 'M-7 -7 L7 7 M7 -7 L-7 7',
  merge: 'M-7 -9 L0 -2 L7 -9 M0 -2 V10 M-4 6.5 L0 10.5 L4 6.5',
  economy: 'M0 -9 L7 -2 L0 5 L-7 -2 Z M-9 9 H9 M0 5 V9',
  balance: 'M0 -10 V9 M-6 9.5 H6 M-9 -6 H9 M-9 -6 L-11.5 1 H-6.5 Z M9 -6 L6.5 1 H11.5 Z',
  war: 'M-9 -9 L7 7 M9 -9 L-7 7 M3.5 9.5 L9.5 3.5 M-3.5 9.5 L-9.5 3.5',
} as const;

export type CutIconName = keyof typeof CUT_ICONS;

/** The solid part of an icon, ruled in the ink colour under its outline. */
export const CUT_SOLIDS: Partial<Record<CutIconName, string>> = {
  recruit:
    'M-10.6 6.4 C-11.4 -0.4 -8 -5.2 -2.6 -5.2 C1.6 -5.2 4.6 -2.4 5.2 0.8 C5.4 1.8 5.8 2.4 6.6 3 C4 3.2 2 3.6 0.8 4.4 C-0.4 5.2 -1.2 6.4 -3.2 6.4 Z',
  barracks: 'M-9 9 V-1 L0 -8.5 L9 -1 V9 Z',
  factory: 'M-10 9 V-1.5 L-5 -5 V-1.5 L0 -5 V-1.5 L5 -5 V-10 H8.5 V9 Z',
  economy: 'M0 -9 L7 -2 L0 5 L-7 -2 Z',
};

/** The client's other icon names that have a cut drawing. */
const ALIASES: Readonly<Record<string, CutIconName>> = {
  stanceEconomy: 'economy',
  stanceBalance: 'balance',
  stanceWar: 'war',
};

/** The cut icon for a name of the client's icon sets; `null`: it has none. */
export function cutIconOf(name: string): CutIconName | null {
  if (Object.hasOwn(CUT_ICONS, name)) return name as CutIconName;
  return Object.hasOwn(ALIASES, name) ? (ALIASES[name] ?? null) : null;
}

/**
 * The small glyphs of the top bar's buttons and clock (16-unit box), engraved: a thin ink line,
 * no fill.
 */
export const BAR_GLYPHS = {
  soundOn: 'M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z M11 5.5a3.5 3.5 0 0 1 0 5',
  soundOff: 'M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z M11 6l3.5 4 M14.5 6L11 10',
  help: 'M5.6 6a2.4 2.4 0 1 1 3.2 2.3c-.6.2-.8.6-.8 1.2v.6 M8 12.2v.4',
  exit: 'M9 3H3v10h6M7 8h7M11.5 5.5 14 8l-2.5 2.5',
  pause: 'M5.5 3.5v9 M10.5 3.5v9',
  clock: 'M8 1.8a6.2 6.2 0 1 1 0 12.4a6.2 6.2 0 1 1 0-12.4z M8 4.8V8l2.2 1.4',
} as const;

export type BarGlyphName = keyof typeof BAR_GLYPHS;
