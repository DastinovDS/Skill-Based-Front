/**
 * The drawing of the chapter select, Charter (#806, round 5; `mockups/tutorial-roadmap.html`,
 * variant 4, as the walkthrough draws it): where each seal sits on the 1168 x 680 sheet, the
 * emblems (the client's menu icons, 24 x 24, 2 px stroke) and the path helpers. Plain data.
 */
import type { CharterSeat } from '../../tutorial/progress.ts';

/** The sheet's own coordinates; the page scales it to the window. */
export const SHEET = { width: 1168, height: 680 } as const;

/** The middle of each seal on the sheet, and the fork of the Advanced rule after V. */
export const SEAT: Readonly<Record<CharterSeat | 'fork', readonly [number, number]>> = {
  units: [150, 172],
  economy: [322, 172],
  building: [494, 172],
  attack: [666, 172],
  defence: [838, 172],
  match: [1020, 172],
  'group-orders': [761, 394],
  'rally-points': [916, 394],
  'supply-distribution': [1071, 394],
  fork: [916, 172],
};

/** The height of the Advanced rule. */
export const SIDE_Y = 296;

/** The radius of a seal: the first match the largest, the Advanced ones the smallest. */
export function sealRadius(seat: CharterSeat): number {
  if (seat === 'match') return 66;
  return seat === 'group-orders' || seat === 'rally-points' || seat === 'supply-distribution'
    ? 46
    : 62;
}

/** The emblem of each chapter: the client's menu icons (`hud/icons.ts`); A3 takes the road sign. */
export const EMBLEM: Readonly<Record<Exclude<CharterSeat, 'match'>, readonly string[]>> = {
  units: [
    'M3.6 15.6C3 9.4 6.6 5.2 11.8 5.2c4.4 0 7.2 2.9 7.8 6.2.2.9.8 1.5 1.9 2-3.4.3-5.6.9-6.8 1.9-1.1 1-1.9 2.3-3.7 2.3z',
    'M3.3 18.4c3.4.5 6.4.6 8.8.4 2.4-.3 3.6-2 4.8-3',
    'M11.8 18.9l1.6 3.3',
  ],
  economy: [
    'M5.5 15h13a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-2A1.5 1.5 0 0 1 5.5 15z',
    'M7.5 9.5h9a1.5 1.5 0 0 1 1.5 1.5v1.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 12.5V11a1.5 1.5 0 0 1 1.5-1.5z',
    'M9.5 4.5h5A1.5 1.5 0 0 1 16 6v1a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 7V6a1.5 1.5 0 0 1 1.5-1.5z',
  ],
  building: ['M3.5 20.5V11l5 3.2V11l5 3.2V4.5h4.5v16z', 'M7 17.5h2.5', 'M12 17.5h2.5'],
  attack: [
    'M5.5 12a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0',
    'M12 2.5v5',
    'M12 16.5v5',
    'M2.5 12h5',
    'M16.5 12h5',
    'M10.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0',
  ],
  defence: [
    'M12 2.8 19.5 5.4v6c0 4.6-3 7.9-7.5 9.8C7.5 19.3 4.5 16 4.5 11.4v-6z',
    'M12 7.6v7.6',
    'M8.8 10.6h6.4',
  ],
  'group-orders': ['M6 4l6 7 6-7', 'M12 11v9', 'M8.5 17 12 20.5 15.5 17'],
  'rally-points': ['M8 20.5V3.5', 'M8 4.5l10 3.8L8 12.1z', 'M4 20.5h8'],
  'supply-distribution': [
    'M12 13v8',
    'M12 3v3',
    'M4 6a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h13a2 2 0 0 0 1.6-.8l1.8-2.4a1 1 0 0 0 0-1.6l-1.8-2.4A2 2 0 0 0 17 6z',
  ],
};

const f1 = (v: number): string => String(Math.round(v * 10) / 10);

/** A lozenge (a square on its corner) of half-diagonal `r` around (x, y). */
export function loz(x: number, y: number, r: number): string {
  return `M${f1(x)} ${f1(y - r)}L${f1(x + r)} ${f1(y)}L${f1(x)} ${f1(y + r)}L${f1(x - r)} ${f1(y)}Z`;
}

/** A five-pointed star of outer radius `R` and inner radius `r` around (x, y). */
export function star(x: number, y: number, R: number, r: number): string {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 1 ? r : R;
    d += `${i === 0 ? 'M' : 'L'}${f1(x + rr * Math.cos(a))} ${f1(y + rr * Math.sin(a))}`;
  }
  return `${d}Z`;
}

/** The four compass points of a ring of radius `R2` around the origin (Compass on the next seal). */
export function compassPoints(R2: number): string[] {
  return [0, 90, 180, 270].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    const px = R2 * ux;
    const py = R2 * uy;
    const L = 7.5;
    const W = 3.6;
    const p = [
      [px - ux * L, py - uy * L],
      [px - uy * W, py + ux * W],
      [px + ux * L, py + uy * L],
      [px + uy * W, py - ux * W],
    ];
    return `M${p.map((q) => q.map((v) => f1(v)).join(' ')).join('L')}Z`;
  });
}

/** The check of a done seal: an ivory lozenge with a dark tick, at (x, y). */
export function tickPath(x: number, y: number, r: number): string {
  return `M${f1(x - r * 0.5)} ${f1(y)}l${f1(r * 0.34)} ${f1(r * 0.37)} ${f1(r * 0.66)}-${f1(r * 0.72)}`;
}
