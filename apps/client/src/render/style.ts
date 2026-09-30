import type { PlayerId, Terrain } from '../protocol.gen.ts';

// Visual constants of the map. Sizes are in world units (docs/design/map-format.md): cities are
// about 100 units apart on MVP maps (100 units = 3 s of travel), so these sizes do not depend on
// the map. State is never shown by colour alone (AGENTS.md §7.4): see the comments below.

export const CANVAS_BACKGROUND = 0x0d1117;

export const TERRAIN_FILL: Readonly<Record<Terrain, number>> = {
  plains: 0x2b3a28,
  forest: 0x1a3223,
  mountains: 0x3a3631,
};
/** Terrain is also marked by a glyph next to the city; plains have none. */
export const TERRAIN_GLYPH = 0xc9d1d9;
export const CELL_BORDER = { width: 1, color: 0x0d1117, alpha: 0.5 } as const;
export const MAP_BORDER = { width: 2, color: 0x484f58 } as const;

export const PLAYER_COLOR: Readonly<Record<PlayerId, number>> = {
  0: 0x4c8dff,
  1: 0xff8a3d,
};
/** Territory: the cell of an owned city is tinted with the owner colour. */
export const TERRITORY_ALPHA = 0.16;

export const ROAD_COLOR = 0xaab2bd;
/** Road thickness grows with its width (1..5), so width reads without colour. */
export function roadThickness(width: number): number {
  return 2 + 2 * width;
}

export const NODE_RADIUS = 16;
export const CAPITAL_RADIUS = 21;
export const NEUTRAL_FILL = 0x2b3139;
export const NEUTRAL_OUTLINE = { width: 2, color: 0x8b949e } as const;
/**
 * Owner outlines differ in shape as well as colour: player 0 has one thick ring, player 1 a thick
 * ring with a second inner ring, a neutral city a thin grey ring.
 */
export const OWNER_OUTLINE = { width: 4, color: 0xf0f6fc } as const;
export const INNER_RING = { width: 2, color: 0x0d1117 } as const;
export const INNER_RING_INSET = 6;

export const CAPITAL_STAR = { fill: 0xf0f6fc, stroke: { width: 1.5, color: 0x0d1117 } } as const;

export const VP_BADGE_RADIUS = 8;
export const VP_BADGE = { fill: 0x0d1117, stroke: { width: 1.5, color: 0xf0f6fc } } as const;
export const VP_FONT_SIZE = 11;
export const VP_TEXT_COLOR = 0xf0f6fc;
