import type { PlayerId, Terrain } from '../protocol.gen.ts';

// Visual constants of the map. Sizes are in world units (docs/design/map-format.md): cities are
// about 100 units apart on MVP maps (100 units = 3 s of travel), so these sizes do not depend on
// the map. State is never shown by colour alone (AGENTS.md §7.4): see the comments below.

// --- Palette (docs/design/ui-style.md, section 6): the only place with map colours ---------------
// Mirrors the CSS variables of `app.css`; `style.test.ts` keeps the two in step.

export const BG = 0x0d1117;
export const PAPER = 0xf0f6fc;
export const YOU = 0x5b9bff;
export const ENEMY = 0xe5484d;
export const NEUTRAL_STROKE = 0x8b949e;
export const NEUTRAL_FILL = 0x2b3139;
export const WARN = 0xffb020;
export const VP = 0xe3b341;
/** Empty segment of a capacity ring and of a warehouse bar. */
export const SEGMENT_EMPTY = 0x59636e;
export const SEGMENT_EMPTY_BAR = 0x3b4450;

export const CANVAS_BACKGROUND = BG;

export const TERRAIN_FILL: Readonly<Record<Terrain, number>> = {
  plains: 0x3a4630,
  forest: 0x25392b,
  mountains: 0x4a453e,
};
/** The baked background (or the flat terrain colours) is darkened by this (9.1). */
export const BACKDROP_DIM = { color: BG, alpha: 0.18 } as const;
/** The thin line round every area of the map (also between areas of one owner): subtle. */
export const CELL_LINE = { width: 1, color: PAPER, alpha: 0.16 } as const;
export const CELL_BORDER = { width: 1, color: BG, alpha: 0.5 } as const;
export const MAP_BORDER = { width: 2, color: 0x484f58 } as const;

// --- Sides: the viewing player is always blue, the opponent always red -----------------------------
export type Side = 'you' | 'enemy';

/** Which side `owner` is for the player `me`. */
export function sideOf(me: PlayerId, owner: PlayerId): Side {
  return owner === me ? 'you' : 'enemy';
}

/** Colour of `owner` as seen by `me`: own blue, opponent red (red means only "opponent"). */
export function ownerColor(me: PlayerId, owner: PlayerId): number {
  return sideOf(me, owner) === 'you' ? YOU : ENEMY;
}

/** Territory: the cell of an owned city is tinted with the owner colour (9.1). */
export const TERRITORY_ALPHA = 0.2;
/** The border of an area of one owner: a light line of the owner colour. */
export const TERRITORY_BORDER = { width: 2, alpha: 0.95, inset: 1.5 } as const;

// --- Terrain stamps (9.2): dark "ink" stamps on the cell of a city ------------------------------
export interface StampSpec {
  /** Grid step in world units. */
  readonly cell: { readonly width: number; readonly height: number };
  /** Ink opacity of the stamp. */
  readonly alpha: number;
}
export const STAMPS: Readonly<Record<Terrain, StampSpec>> = {
  forest: { cell: { width: 34, height: 30 }, alpha: 0.4 },
  mountains: { cell: { width: 52, height: 40 }, alpha: 0.46 },
  plains: { cell: { width: 30, height: 26 }, alpha: 0.28 },
};
/** A stamp keeps this far from a city centre and from a road axis (world units). */
export const STAMP_CITY_CLEARANCE = 30;
export const STAMP_ROAD_CLEARANCE = 12;
/** The snow cap of a mountain stamp. */
export const SNOW_ALPHA = 0.45;

// --- Roads, width 1..5 (9.3) ---------------------------------------------------------------------
export const ROAD_COLOR = { color: 0xc4cbd4, alpha: 0.8 } as const;
export const ROAD_CASING = { color: BG, alpha: 0.4 } as const;
export const ROAD_CASING_EXTRA = 3;
/** An upgraded road (DEC-26: it only speeds the supply up): dark chevrons every `spacing` px, `size` px long, notch at `depth`. */
export const ROAD_CHEVRON = { color: BG, spacing: 28, size: 9, gap: 3, depth: 0.45 } as const;
/** Road thickness grows with its level (1..3, DEC-22), so the level reads without colour: `0.5 + 1.5w`. */
export function roadThickness(width: number): number {
  return 0.5 + 1.5 * width;
}

// --- Cities (9.4) -------------------------------------------------------------------------------
/** Radius when the capacity is not known (a map without a snapshot). */
export const NODE_RADIUS = 14;
export const CAPITAL_RADIUS = 17;
export const OWNER_OUTLINE = { width: 3, color: PAPER } as const;
export const NEUTRAL_OUTLINE = { width: 2, color: NEUTRAL_STROKE } as const;
/** An enemy city has a second, dark inner ring (the shape carries the side, not only the hue). */
export const INNER_RING = { width: 1.6, color: BG } as const;
export const INNER_RING_INSET = 5;
export const CITY_HALO = { width: 3, color: BG, alpha: 0.85 } as const;
export const CITY_HALO_INSET = 3;
export const CAPITAL_STAR = { fill: PAPER, stroke: { width: 1.4, color: BG } } as const;

/** The capacity ring: `RING_GAP` outside the body, segments 4 wide on a 7 wide dark base. */
export const RING_GAP = 7;
export const RING_SEGMENT = { width: 4, base: 7, baseAlpha: 0.75, gap: 0.16 } as const;
export const RING_FILLED = PAPER;
/** Above this capacity the ring is one solid arc with a notch at every fifth unit. */
export const RING_MAX_SEGMENTS = 10;

/** The warehouse bar under the ring: one 5 x 4 segment per unit of capacity (6 apart). */
export const BAR_SEGMENT = { width: 5, height: 4, pitch: 6, pad: 1 } as const;
export const BAR_BASE = { color: BG, radius: 2 } as const;
export const BAR_GAP = 9;
/**
 * The recruit queue above the ring of an own city (DEC-25): one 8 x 4 slot per queued unit
 * (10 apart); the first fills with the progress of the unit in production.
 */
export const QUEUE_SLOT = { width: 8, height: 4, pitch: 10, pad: 1 } as const;
/** The barracks or warehouse build of an own city (DEC-26): a thin bar above the queue mark. */
export const BUILD_MARK = { width: 24, height: 2, gap: 4 } as const;

export const VP_BADGE_RADIUS = 8.5;
export const VP_BADGE = { fill: BG, stroke: { width: 2, color: VP } } as const;
export const VP_FONT_SIZE = 11;
export const VP_TEXT_COLOR = PAPER;

// --- Units on the map (9.5): inverted triangles ---------------------------------------------------
// A group is a triangle pointing down. Its side steps with the number of units; the share of
// charged units fills it from the tip (`sqrt(charged / units)` of the height), so the charge reads
// as a level. The owner is told by the outline's hue and by its shape: own, one blue outline;
// opponent, a red outline plus a light inner one; an opponent without numbers, dashed with "?".
// The mode "Defense" is a shield disc at the top right corner ("Attack" is not drawn).

export const PLATE_FILL = 0x161b22;
export const PLATE_INNER_RING = { width: 1.5, color: PAPER, alpha: 0.9 } as const;
export const GLYPH_COLOR = PAPER;
export const COUNT_FONT_SIZE = 10;

/** Side of the triangle by the number of units (steps: 1-3, 4-7, 8-15, 16+); unknown: `UNIT_SIDE_UNKNOWN`. */
export const UNIT_SIDES = [24, 30, 36, 42] as const;
export const UNIT_SIDE_UNKNOWN = 30;
/** The outline of a triangle (the colour is the owner's, set where it is drawn). */
export const UNIT_OUTLINE = { width: 2.4, join: 'round' } as const;
/** The light inner outline of an opponent triangle: visible on a dark empty plate and on its fill. */
export const UNIT_INNER_OUTLINE = { width: 1.5, color: PAPER, alpha: 0.9, join: 'round' } as const;
/** The inner outline of an opponent triangle: this share of the size. */
export const UNIT_INNER_SCALE = 0.62;
/** The casing of the icon of units standing in a city (round, in the colour of the background). */
export const UNIT_HALO = { width: 7, alpha: 0.9, join: 'round' } as const;
export const UNIT_DASH = { dash: 5, gap: 3.5 } as const;
export const UNIT_QUESTION_FONT_SIZE = 15;
/** On screen a triangle is at least this wide, and a click hits at least this wide (CSS px). */
export const UNIT_MIN_SIDE_PX = 20;
export const UNIT_MIN_HIT_PX = 28;
export const UNIT_LABEL = { fill: PLATE_FILL, alpha: 0.92, padX: 4, height: 13, gap: 3 } as const;
export const SHIELD_BADGE_SCALE = 0.9;
/** The selection outline is a copy of the triangle this much bigger (9.5). */
export const SELECT_UNIT_SCALE = 1.45;

/** A packet is a small disc without an outline (9.6); an opponent one has a dark centre. */
export const PACKET_RADIUS = 5;
/** Inside this distance past a city rim a packet shrinks and fades into the city icon. */
export const PACKET_FADE_MARGIN = 8;
export const PACKET_MIN_SCALE = 0.3;
export const PACKET_LABEL_FONT_SIZE = 10;

export const ARROW_WIDTH = 3;
export const ARROW_DASH = 9;
export const ARROW_GAP = 6;
export const ARROW_HEAD = { length: 14, width: 14 } as const;
export const ARROW_OUTLINE = { width: 6, color: BG, alpha: 0.7 } as const;
export const ORDER_LINE_ALPHA = 0.7;
export const INTENT_ICON_DISTANCE = 25;
/** Intent icon offset direction from the city centre, degrees (-135: up and to the left). */
export const INTENT_ICON_ANGLE = -135;

/** Red means only "opponent" (6), so a fight mark is paper white. */
export const FIGHT_COLOR = PAPER;

// --- Fog of war (CLI-05, #61; softer in 9.8) -----------------------------------------------------
// A hidden area is darkened (no solid hatching) and hatched at 45 degrees only in a band along the
// border of what is seen, so the border reads without colour; a hidden road is a solid line shaded dark;
// a memory ghost is faded AND carries the age of the sighting.

export const FOG_COLOR = BG;
export const FOG_ALPHA = 0.45;
/** Hatching in the band along the border of the visible area. */
export const FOG_HATCH = { width: 1.5, color: 0xaab2bd, alpha: 0.3 } as const;
export const FOG_HATCH_SPACING = 9;
export const FOG_BAND_WIDTH = 24;
/** A hidden road stays a solid line, shaded dark (the dark cell and the hatched border carry the state too). */
export const FOG_ROAD_ALPHA = 0.55;
/** Opacity of a fresh memory ghost (the marker of what was last seen in a hidden place). */
export const GHOST_ALPHA = 0.6;
/** Ghosts fade linearly from `GHOST_FADE_START_S` to nothing at `GHOST_HIDE_S` seconds after the sighting (9.8). */
export const GHOST_FADE_START_S = 60;
export const GHOST_HIDE_S = 120;
export const GHOST_AGE_FONT_SIZE = 10;
export const GHOST_AGE_STROKE = { color: BG, width: 3, join: 'round' } as const;

// --- Selection and orders (CLI-06, #62) --------------------------------------------------------
// The selection is a white outline on a dark one, so it reads on any terrain and any owner.

/** The selection is white (6): a double outline, the inner one dark. */
export const SELECT_COLOR = PAPER;
/** The selection ring of a city sits outside its capacity ring and warning ring. */
export const SELECT_RING_GAP = 18;
/**
 * Nodes the selected group can go to (DEC-20): a thin solid ring (own colour); nodes it can
 * reach only after a split: a dashed warning ring. Solid against dashed, not only colour.
 */
export const REACH_RING = { gap: 12, width: 2, alpha: 0.8, dash: 5 } as const;
/** The travel time under a hovered node: font size in world units (scaled to stay readable). */
export const ETA_FONT_SIZE = 13;
export const SELECT_WIDTH = 3;
/** Group selection: a rounded frame this far outside the token. */
export const SELECT_TOKEN_GAP = 4;
/** An order sent and not yet seen in a snapshot: dashed, see-through. */
export const ORDER_GHOST_ALPHA = 0.85;
export const ORDER_GHOST_WIDTH = 4;
export const ORDER_GHOST_DASH = 7;
export const ORDER_GHOST_GAP = 6;
/** Where a click would send the group with a planned order (Shift): a fine dotted line. */
export const PREVIEW_ALPHA = 0.55;
export const PREVIEW_DASH = 2;
export const PREVIEW_GAP = 6;
export const PREVIEW_WIDTH = 2;
/**
 * Road pick (key U, DEC-16): the roads a click would upgrade carry a dashed band.
 */
export const PICK_BAND = { extra: 6, dash: 10, gap: 7, alpha: 0.85 } as const;

// --- Road builds of cities (DEC-16) -----------------------------------------------------------
// A road being built is crossed by short bars across it ("ties"), and a hammer disc of the owner
// sits on it near the building city (the disc carries the owner's ring shape, as intent icons do);
// an own build also shows the time left, `m:ss`.

export const BUILD_TIE = { width: 3, color: PAPER, spacing: 12, extra: 8 } as const;
export const BUILD_TIE_CASING = { width: 5, color: BG, alpha: 0.8 } as const;
/** Distance of the hammer disc from the centre of the building city, along the road. */
export const BUILD_MARK_DISTANCE = 46;
export const BUILD_TIME_FONT_SIZE = 10;

// --- Fight, bounce, capture (9.9) ----------------------------------------------------------------
/** The loss numbers rise this many world units while they stay (`fightFx.ts`: how long). */
export const NUMBERS_RISE = 12;
export const BOUNCE_MS = 1000;
export const BOUNCE_LENGTH = 40;
export const WAVE_MS = 500;
export const WAVE_FILL_ALPHA = 0.28;
export const WAVE_STROKE = { width: 3, alpha: 0.9 } as const;
export const LOSS_FONT_SIZE = 13;

// --- Ribbon arrows of intents and orders (9.7) ---------------------------------------------------
// A planned order is a wide translucent ribbon, straight from the start city to the centre of the
// target, with a big head (HOI4, Mini Motorways). Own: solid contour; the opponent: dashed 9/5,
// which also "runs" once the group has left. While the delay runs the ribbon fills from the start
// to the tip; when it ends the ribbon blinks and locks into its colour.
export const RIBBON = {
  /** Body width; the tail narrows to `tailRatio` of it. Head 38 x 30 at this body. */
  body: 16,
  tailRatio: 0.6,
  headWidth: 38,
  headLength: 30,
  /** Fill of the part the delay has not reached yet, and of the filled / locked ribbon. */
  idleAlpha: 0.1,
  fillAlpha: 0.5,
  /** The blink at the end of the delay: a paper-white fill for this many ticks (two flashes). */
  flashAlpha: 0.75,
  blinkTicks: 4,
  contour: { width: 2.2, alpha: 0.95 },
  casing: { width: 6, alpha: 0.45 },
  /** The ribbon leaves the start city at radius + `startGap` and ends in the centre of the target. */
  startGap: 16,
  /** The narrow end of the body is never thinner than this on screen (CSS px). */
  minTailPx: 8,
  dash: 9,
  gap: 5,
  /** The dashes run along the contour at this speed (world units per second). */
  runSpeed: 28,
} as const;
/** The dotted ring around the target of an enemy intent. */
export const INTENT_TARGET_RING = { gap: 20, width: 2, dash: 5, gap2: 4, alpha: 0.95 } as const;
/** The disc of "Defense" with the delay arc around it. */
export const DEFENSE_ARC = { gap: 3, width: 3 } as const;

/** Thin line of an ordinary order (own only) with white chevrons every 26 units. */
export const ORDER_LINE = {
  width: 3,
  alpha: 0.9,
  casing: { width: 6, alpha: 0.5 },
  /** The part of the road the group has walked: what is left of the arrow, faint. */
  walkedAlpha: 0.22,
  /** The ring round the target is this far outside its circle. */
  ringGap: 5,
  /** The arrowhead on the ring of the target. */
  head: { length: 11, half: 6 },
} as const;
export const CHEVRON = {
  spacing: 26,
  first: 22,
  endMargin: 10,
  size: 5,
  width: 1.8,
  /** The chevrons run along the whole remaining path at this speed (world units per second). */
  runSpeed: 30,
} as const;

/** A rejected order: the ghost shakes for `SHAKE_MS`, then fades out until `REJECT_MS` (U6). */
export const GHOST_SHAKE_MS = 200;
export const GHOST_REJECT_MS = 500;
export const GHOST_SHAKE_AMPLITUDE = 3;
