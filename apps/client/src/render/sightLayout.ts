import type { Detail, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { ringRadius } from './cityLayout.ts';

/**
 * The sight sign of the terrain map mode (#429): three bars beside a place that is not yours and
 * that you see now, filled one (`presence`), two (`range`) or three (`exact`). The level is the one
 * the server put in the snapshot (`NodeView.detail`, decided by DEC-21 and DEC-35); the client
 * decides nothing. Never told by colour: the bars are counted, and the word is in the legend.
 */
export function sightLevel(detail: Detail): 0 | 1 | 2 | 3 {
  switch (detail) {
    case 'exact':
      return 3;
    case 'range':
      return 2;
    case 'presence':
      return 1;
    case 'fog':
      return 0;
  }
}

/** The bars of one sign: width, gap and the three heights, world units. */
export const SIGHT_BARS = {
  width: 2.6,
  gap: 1.4,
  heights: [3.4, 6.2, 9] as const,
  /** The plate behind the bars: margin round them, corner radius. */
  pad: { x: 2.4, top: 6.6, height: 13.2 },
  radius: 3,
  /** Bars stand on this line, below the centre of the sign. */
  base: 4.5,
} as const;

/** The sign is drawn this much larger than the numbers above: it must read at the map's usual zoom. */
export const SIGHT_SCALE = 1.3;

/** The sign is dropped from the centre of the city by the ring radius plus this, to the lower right. */
const OFFSET = 11;
/** Below this camera scale the sign is too small to read and is not drawn. */
export const SIGHT_MIN_SCALE = 0.45;

/** Where the sign of a place is centred: the lower right of the ring of the city. */
export function signAt(center: Point, radius: number): Point {
  const d = ringRadius(radius) + OFFSET * SIGHT_SCALE;
  const angle = Math.PI / 4;
  return { x: center.x + d * Math.cos(angle), y: center.y + d * Math.sin(angle) };
}

/** A place gets a sign when it is not the viewer's own and is seen now (not in the fog). */
export function showsSight(owner: PlayerId | null, me: PlayerId, detail: Detail): boolean {
  return owner !== me && detail !== 'fog';
}
