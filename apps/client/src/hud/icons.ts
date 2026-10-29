/**
 * The icons of the HUD: Lucide (https://lucide.dev, ISC; the shapes from Feather are MIT), copied as
 * data so the page needs no icon font and no npm package (docs/design/ui-style.md, section 8).
 * `Icon.svelte` draws them with `currentColor`. The licence notices are in
 * `apps/client/THIRD_PARTY_NOTICES.md` and on the legal page. An icon without an entry there is a
 * review error.
 *
 * `MENU_ICONS` below are not Lucide: the 13 icons of the radial menus (set I1 "line", #350,
 * ui-style 28) are drawn for this project in the same language (24x24 grid, 2 px stroke, round
 * ends), so they need no licence notice.
 */

/** One drawn element of an icon (24x24 grid, 2 px stroke). */
export type IconShape =
  | { readonly tag: 'path'; readonly d: string }
  | { readonly tag: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | {
      readonly tag: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
    }
  | {
      /** A short label drawn as text (a digit in a flag): filled, not stroked, centred on `x`, `y`. */
      readonly tag: 'text';
      readonly x: number;
      readonly y: number;
      readonly size: number;
      readonly content: string;
    };

const path = (d: string): IconShape => ({ tag: 'path', d });
const circle = (cx: number, cy: number, r: number): IconShape => ({ tag: 'circle', cx, cy, r });
const rect = (x: number, y: number, width: number, height: number, rx: number): IconShape => ({
  tag: 'rect',
  x,
  y,
  width,
  height,
  rx,
});

const text = (x: number, y: number, size: number, content: string): IconShape => ({
  tag: 'text',
  x,
  y,
  size,
  content,
});

/** The flag of a front marker (DEC-28): a staff and a pennant, a digit in the pennant. */
const flag = (n: string): readonly IconShape[] => [
  path('M6 21V4'),
  path('M6 5h12l-3.2 4.2L18 13.4H6'),
  text(11.4, 9.3, 6.6, n),
];

export const ICONS = {
  menu: [path('M4 12h16'), path('M4 18h16'), path('M4 6h16')],
  clock: [circle(12, 12, 10), path('M12 6v6l4 2')],
  logout: [
    path('m16 17 5-5-5-5'),
    path('M21 12H9'),
    path('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'),
  ],
  pause: [rect(14, 4, 4, 16, 1), rect(6, 4, 4, 16, 1)],
  play: [path('M6 3 20 12 6 21Z')],
  help: [circle(12, 12, 10), path('M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3'), path('M12 17h.01')],
  volumeOn: [
    path(
      'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
    ),
    path('M16 9a5 5 0 0 1 0 6'),
    path('M19.364 18.364a9 9 0 0 0 0-12.728'),
  ],
  volumeOff: [
    path(
      'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
    ),
    path('m22 9-6 6'),
    path('m16 9 6 6'),
  ],
  economy: [
    circle(8, 8, 6),
    path('M18.09 10.37A6 6 0 1 1 10.34 18'),
    path('M7 6h1v4'),
    path('m16.71 13.88.7.71-2.82 2.82'),
  ],
  balance: [
    path('m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z'),
    path('m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z'),
    path('M7 21h10'),
    path('M12 3v18'),
    path('M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2'),
  ],
  war: [
    path('m14.5 17.5-11.5-11.5V3h3l11.5 11.5'),
    path('m13 19 6-6'),
    path('m16 16 4 4'),
    path('m19 21 2-2'),
    path('m14.5 6.5 3.5-3.5h3v3l-3.5 3.5'),
    path('m5 14 4 4'),
    path('m7 17-3 3'),
    path('m3 19 2 2'),
  ],
  shield: [
    path(
      'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z',
    ),
  ],
  road: [
    path('M12 13v8'),
    path('M12 3v3'),
    path(
      'M4 6a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h13a2 2 0 0 0 1.6-.8l1.8-2.4a1 1 0 0 0 0-1.6l-1.8-2.4A2 2 0 0 0 17 6z',
    ),
  ],
  plus: [path('M5 12h14'), path('M12 5v14')],
  list: [
    path('M3 5h.01'),
    path('M3 12h.01'),
    path('M3 19h.01'),
    path('M8 5h13'),
    path('M8 12h13'),
    path('M8 19h13'),
  ],
  alert: [
    path('m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'),
    path('M12 9v4'),
    path('M12 17h.01'),
  ],
  flag: [path('M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z'), path('M4 22v-7')],
  info: [circle(12, 12, 10), path('M12 16v-4'), path('M12 8h.01')],
  settings: [
    path(
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
    ),
    circle(12, 12, 3),
  ],
  x: [path('M18 6 6 18'), path('m6 6 12 12')],
  // The start menu (#471): the rows of the modes and the account chip.
  bot: [
    path('M12 8V4'),
    rect(4, 8, 16, 11, 2),
    circle(12, 3.5, 1),
    circle(9, 13.5, 1),
    circle(15, 13.5, 1),
  ],
  link: [
    path('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1'),
    path('M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
  ],
  users: [
    path('M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1'),
    circle(9.5, 8, 3.5),
    path('M21 20v-1a4 4 0 0 0-3-3.9'),
    path('M16 4.1a3.5 3.5 0 0 1 0 6.8'),
  ],
  user: [path('M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'), circle(12, 7, 4)],
  key: [circle(8, 15, 4), path('m10.8 12.2 9-9'), path('m16 7 3 3')],
  check: [path('M20 6 9 17l-5-5')],
  // The pre-match screens (#473): copy the invite link.
  copy: [rect(9, 9, 13, 13, 2), path('M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1')],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;

/**
 * The icons of the radial menus (set I1 "line", mockup `docs/design/mockups/objects-style.html`,
 * block 4): the city (recruit, barracks, warehouse), the group (split, Defense, cancel, merge), the
 * stance (economy, balance, war) and the supply (transfer, markers 1 and 2). Own drawings.
 */
export const MENU_ICONS = {
  recruit: [rect(7, 6, 10, 15, 2), path('M10 3h4v3h-4z'), path('M12 11v6'), path('M9 14h6')],
  barracks: [path('M3.5 11 12 4l8.5 7'), path('M5.5 9.5V20h13V9.5'), path('M10 20v-5.5h4V20')],
  warehouse: [rect(8.5, 3.5, 7, 7, 0), rect(3.5, 13.5, 7, 7, 0), rect(13.5, 13.5, 7, 7, 0)],
  split: [
    path('M12 21v-8'),
    path('M12 13 6 6'),
    path('M12 13l6-7'),
    path('M6 10V6h4'),
    path('M14 6h4v4'),
  ],
  defense: [path('M12 3 5 6v6c0 4.3 3 7.4 7 9 4-1.6 7-4.7 7-9V6z')],
  cancel: [circle(12, 12, 9), path('M8.5 8.5l7 7'), path('M15.5 8.5l-7 7')],
  merge: [path('M6 4l6 7 6-7'), path('M12 11v9'), path('M8.5 17 12 20.5 15.5 17')],
  stanceEconomy: [rect(4, 15, 16, 5, 1.5), rect(6, 9.5, 12, 4.5, 1.5), rect(8, 4.5, 8, 4, 1.5)],
  stanceBalance: [
    path('M12 4v16'),
    path('M5 8h14'),
    path('M8 20h8'),
    path('M5 8 2.5 14h5z'),
    path('M19 8l-2.5 6h5z'),
  ],
  stanceWar: [
    circle(12, 12, 6.5),
    path('M12 2.5v5'),
    path('M12 16.5v5'),
    path('M2.5 12h5'),
    path('M16.5 12h5'),
    circle(12, 12, 1.2),
  ],
  transfer: [rect(3, 8.5, 7, 7, 0), path('M12.5 12H21'), path('M17.5 8l4 4-4 4')],
  front1: flag('1'),
  front2: flag('2'),
} as const satisfies Record<string, readonly IconShape[]>;

export type MenuIconName = keyof typeof MENU_ICONS;

/** Every icon `Icon.svelte` can draw. */
export type AnyIconName = IconName | MenuIconName;

/** The shapes of an icon by name. */
export function shapesOf(name: AnyIconName): readonly IconShape[] {
  return name in MENU_ICONS ? MENU_ICONS[name as MenuIconName] : ICONS[name as IconName];
}
