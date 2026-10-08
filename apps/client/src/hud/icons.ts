/**
 * The icons of the HUD: Lucide (https://lucide.dev, ISC; the shapes from Feather are MIT), copied as
 * data so the page needs no icon font and no npm package (docs/design/ui-style.md, section 8).
 * `Icon.svelte` draws them with `currentColor`. The licence notices are in
 * `apps/client/THIRD_PARTY_NOTICES.md` and on the legal page. An icon without an entry there is a
 * review error.
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
  check: [path('M20 6 9 17l-5-5')],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;
