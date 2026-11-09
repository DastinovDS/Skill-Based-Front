/**
 * The fortify icon (#858; #829 round 5, topic l "Per size", the owner's pick "Wall on the road"): the
 * battlement of the map's own wall seen face on, a square tower each side of a gate, and the road
 * running through the gate. Drawn on its own pixel grid at 16, 24 and 32 px, every edge axis-aligned
 * so it renders crisp: two merlons a side at 32, one at 24, a one-pixel crenel at 16 where the
 * square towers carry the read; the road 2 px wide at 24 and 32, 1 px at 16. The cut style fills
 * the wall with a ruled pattern (`pitch`) inside the casing and the ink line.
 *
 * One geometry for every renderer: `FortIcon.svelte` draws it as SVG (the radial menu, the HUD), and
 * a PixiJS bake may draw the same paths. The HUD piece (#829, part 6) takes it from here.
 */

export type FortIconSize = 16 | 24 | 32;

export interface FortIconSpec {
  /** The grid: the view box is `0 0 grid grid`. */
  readonly grid: FortIconSize;
  /** The left half of the wall (a closed path of H and V moves), and the right half, mirrored. */
  readonly left: string;
  readonly right: string;
  /** The road through the gate, top to bottom. */
  readonly road: string;
  /** Widths: the road, the ink line round the wall, the dark casing under both. */
  readonly roadWidth: number;
  readonly ink: number;
  readonly casing: number;
  /** The pitch of the ruled fill (one-unit rules). */
  readonly pitch: number;
}

/** The left halves of the mockup (`FORT_PX` of `in-game-style-r5.html`). */
const LEFT: Record<FortIconSize, string> = {
  32: 'M1.5 21 V10.5 H4.5 V13 H7 V10.5 H9.5 V7.5 H13 V24.5 H9.5 V21 Z',
  24: 'M1 16 V8 H3.5 V10 H6 V5.5 H10 V18.5 H6 V16 Z',
  16: 'M0.5 10.5 V6.5 H1.5 V7.5 H2.5 V6.5 H3.5 V3.5 H7 V12.5 H3.5 V10.5 Z',
};

/** A path of M, H, V and Z moves mirrored across the middle of a `grid` wide box. */
export function mirrorPath(d: string, grid: number): string {
  return d.replace(
    /([MHVZ])\s*([-\d.]*)(?:\s+([-\d.]+))?/g,
    (_m, cmd: string, a: string, b?: string) => {
      if (cmd === 'Z') return 'Z';
      if (cmd === 'V') return `V${a}`;
      if (cmd === 'H') return `H${String(grid - Number(a))}`;
      // M x y
      return `M${String(grid - Number(a))} ${b ?? ''}`;
    },
  );
}

function spec(
  grid: FortIconSize,
  road: string,
  roadWidth: number,
  ink: number,
  casing: number,
  pitch: number,
): FortIconSpec {
  const left = LEFT[grid];
  return { grid, left, right: mirrorPath(left, grid), road, roadWidth, ink, casing, pitch };
}

export const FORT_ICON: Readonly<Record<FortIconSize, FortIconSpec>> = {
  32: spec(32, 'M16 1 V31', 2, 1.5, 3.6, 2.5),
  24: spec(24, 'M12 1 V23', 2, 1.25, 3.2, 2),
  16: spec(16, 'M8 0.5 V15.5', 1, 1, 2.4, 2),
};

/** The drawing for a size in px: its own grid at 16, 24 and 32, the nearest larger one between. */
export function fortIconFor(size: number): FortIconSpec {
  return FORT_ICON[size <= 16 ? 16 : size <= 24 ? 24 : 32];
}
