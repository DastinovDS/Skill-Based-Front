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
/** A dark edge keeps the glyph readable on the snow of the baked background. */
export const GLYPH_OUTLINE = { width: 1.2, color: 0x0d1117 } as const;
export const CELL_BORDER = { width: 1, color: 0x0d1117, alpha: 0.5 } as const;
export const MAP_BORDER = { width: 2, color: 0x484f58 } as const;

export const PLAYER_COLOR: Readonly<Record<PlayerId, number>> = {
  0: 0x4c8dff,
  1: 0xff8a3d,
};
/** Territory: the cell of an owned city is tinted with the owner colour. */
export const TERRITORY_ALPHA = 0.16;

export const ROAD_COLOR = 0xaab2bd;
export const ROAD_CASING = { color: 0x0d1117, alpha: 0.55 } as const;
export const ROAD_CASING_EXTRA = 3;
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

// --- Entities on the map (CLI-04, #60) ---------------------------------------------------------
// Tokens (groups, enemy sightings) sit on a dark plate, so they read on any terrain, snow
// included. The owner shows in the plate outline colour AND its shape: one ring for player 0, a
// second inner ring for player 1 (as on the cities). A charge is a filled dot, an empty unit a
// hollow one; the mode is a glyph (triangle: attack, shield: defense, hammer: build).

export const PLATE_FILL = 0x161b22;
export const PLATE_RADIUS = 6;
export const PLATE_OUTLINE_WIDTH = 3;
export const PLATE_INNER_RING = { width: 1.5, color: 0xf0f6fc, alpha: 0.9 } as const;
export const PLATE_INNER_INSET = 4.5;
export const GLYPH_COLOR = 0xf0f6fc;
export const COUNT_FONT_SIZE = 10;
export const PIP_RADIUS = 2.6;
export const PIP_STROKE = { width: 1.2, color: 0xf0f6fc } as const;
/** A packet is a charge on the road: the filled dot, larger. */
export const PACKET_SCALE = 1.7;
/** Distance of the heading arrow from the centre of a token that moves along a road. */
export const HEADING_DISTANCE = 33;
export const HEADING_ARROW = { fill: 0xf0f6fc, stroke: { width: 1.5, color: 0x0d1117 } } as const;

/** Soft halo behind city outlines, so white rings stay visible on the snow of the baked background. */
export const HALO_INSET = 3;
export const HALO = { width: 2, color: 0x0d1117, alpha: 0.85 } as const;

export const BAR_FRAME = { fill: 0x0d1117, stroke: { width: 1.5, color: 0xf0f6fc } } as const;
export const BAR_MARK = { width: 1, color: 0x0d1117 } as const;

export const ARROW_WIDTH = 3;
export const ARROW_DASH = 9;
export const ARROW_GAP = 6;
export const ARROW_HEAD = { length: 14, width: 14 } as const;
export const ARROW_OUTLINE = { width: 6, color: 0x0d1117, alpha: 0.7 } as const;
export const ORDER_LINE_ALPHA = 0.7;
export const INTENT_ICON_DISTANCE = 15;
/** Intent icon offset direction from the city centre, degrees (-135: up and to the left). */
export const INTENT_ICON_ANGLE = -135;

export const FIGHT_COLOR = 0xff5d5d;

// --- Fog of war (CLI-05, #61) ------------------------------------------------------------------
// A hidden city is darkened AND hatched, a hidden road is darkened AND broken into dashes, a
// memory ghost is faded AND carries the age of the sighting: none of it relies on colour alone.

export const FOG_COLOR = 0x0d1117;
export const FOG_ALPHA = 0.62;
/** Hatching lines over a hidden city. */
export const FOG_HATCH = { width: 1.5, color: 0xaab2bd, alpha: 0.45 } as const;
export const FOG_HATCH_SPACING = 7;
/** A hidden city is shaded this far beyond its body. */
export const FOG_NODE_MARGIN = 6;
export const FOG_DASH = 12;
export const FOG_GAP = 8;
/** A hidden road is shaded this much wider than the road and its casing. */
export const FOG_ROAD_EXTRA = 6;
/** Opacity of a memory ghost (the marker of what was last seen in a hidden place). */
export const GHOST_ALPHA = 0.62;
export const GHOST_AGE_FONT_SIZE = 10;
export const GHOST_AGE_STROKE = { color: 0x0d1117, width: 3, join: 'round' } as const;
