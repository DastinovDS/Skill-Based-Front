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

// --- Shading BL1-1 "Restrained" (ui-style 26.3, #347) ------------------------------------------------
// Objects (cities, group triangles, badges, arena plates and chips) are baked into textures once
// (`bake.ts`) with a vertical fill gradient (the top lightened, the bottom darkened), a soft shadow
// a little below and, on an owned object, a light rim at the top. The shadow is made of a few
// stacked outlines (no blur filter): its size and strength follow the mockup (`map-style-2.html`,
// "Restrained": 1.5 px down, a blur of about 1, half opaque).

/** The fill gradient of a shaded shape: this share to white at the top, to black at the bottom. */
export const SHADE = { light: 0.16, dark: 0.14 } as const;
/**
 * The soft shadow: `dy` px down, built of outlines `grow` px wider than the shape (the widest
 * first), each at `alpha`; stacked they give a half opaque core and a soft edge of about 1.6 px.
 */
export const SHADOW = {
  dy: 1.5,
  layers: [
    { grow: 1.6, alpha: 0.14 },
    { grow: 0.8, alpha: 0.2 },
    { grow: 0, alpha: 0.28 },
  ],
} as const;
/** The light rim of an owned object, at its upper left (not on a neutral city). */
export const RIM = { alpha: 0.3, width: 1.4 } as const;
/** The room a baked sprite keeps around its shape for the shadow (world units). */
export const BAKE_MARGIN = 4;

/**
 * The glow along the border of a territory (BL1 "pronounced" border, owner's choice 2026-10-21): a
 * line of the owner's colour `width` wide at `alpha`, blurred by `blur`, on the owner's side of the
 * border only. It is drawn once into a cached texture and drawn again only when an owner changes.
 * `resolution` is the cache's pixel density: the glow is soft, half the pixels are enough.
 */
export const TERRITORY_GLOW = {
  width: 12,
  alpha: 0.85,
  blur: 4.5,
  blurQuality: 3,
  resolution: 0.5,
} as const;

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

// --- Roads, level 1..3 = the number of lanes (ui-style 26, R1 "Lanes", #345) ---------------------
// The level reads without colour: one, two or three parallel lanes. An own (internal) road has
// solid light lanes on a band of the owner's colour; a buffer road (the ends have different
// owners, or one of them none) has dashed grey lanes on a dark casing and no band; a half in fog
// has dotted lanes. Nothing here is animated.
export const ROAD_LANE = { width: 2, gap: 1.7 } as const;
/** The lanes and the band under them of a road between two cities of one owner. */
export const ROAD_OWN = { lane: 0xe6edf3, laneAlpha: 0.95, bandAlpha: 0.62, casing: 3.6 } as const;
/** A buffer road: dashed lanes, a dark casing and no band of an owner. */
export const ROAD_BUFFER = {
  lane: 0xaab2bd,
  laneAlpha: 0.95,
  dash: 7,
  gap: 5,
  casingAlpha: 0.4,
  casing: 3.6,
} as const;
/** A half of a road in fog: dotted lanes (the veil of the fog over the cell carries the state too). */
export const ROAD_FOG = {
  lane: 0xaab2bd,
  laneAlpha: 0.75,
  dash: 1.5,
  gap: 4.5,
  casingAlpha: 0.3,
  casing: 3,
} as const;
/** Width of the lanes of a road of `level` (1..3): `n` lanes and the gaps between them. */
export function roadLanesWidth(level: number): number {
  const lanes = Math.max(1, Math.round(level));
  return lanes * ROAD_LANE.width + (lanes - 1) * ROAD_LANE.gap;
}
/** The outer width of the casing or band of an own road of `level`: the tape of a road is laid over it. */
export function roadSpan(level: number): number {
  return roadLanesWidth(level) + ROAD_OWN.casing;
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
 * A warehouse place that is only room (a frame) or a level not built yet (dashed), inside the same
 * 5 x 4 cell as a charge (C1, ui-style 9.4): a charge is filled, the other two are told by the outline.
 */
export const PLACE_FRAME = { width: 1, color: SEGMENT_EMPTY } as const;
export const PLACE_DASHED = { width: 0.9, color: PAPER, alpha: 0.5, dash: 1.4, gap: 1.4 } as const;
/**
 * A province (DEC-23, C1): a small hollow ring instead of a city body, no warehouse, no VP. The
 * ring is `ring.owned` wide in the colour of the owner (`ring.neutral` and grey for nobody's), an
 * own one has a light ring `outer.inset` outside, the opponent's also a light ring `inner.inset`
 * inside, so the side reads without the colour as on a city.
 */
export const PROVINCE = {
  radius: 9,
  /** The dark plate inside the ring (`PLATE_FILL`) is this opaque. */
  plateAlpha: 0.9,
  ring: { owned: 3.6, neutral: 2.4 },
  outer: { inset: 2.6, width: 1.6 },
  inner: { inset: 3.4, width: 1.3, alpha: 0.9 },
} as const;
/**
 * The progress marks above an own city (variant A "Cells", #439; ui-style 9.4a): one cell is one
 * unit of the thing, on a dark plate. The recruit queue (DEC-25) is a row of `cell`s (a unit
 * queued, in production, ready, or a free slot of the selected city); the barracks or warehouse
 * build (DEC-26) is one wide cell beside a round badge with the kind of the build. The plates of the
 * two stack above the ring, `gap` apart. The hatch is coarser than in the mockup (a fine one
 * aliases when the map is zoomed out): stripes `thickness` wide every `period`, both measured along
 * the diagonal of the 45 degree stripe (x + y).
 */
export const PROGRESS = {
  /** The cell of a recruit queue slot. */
  cell: { width: 16, height: 10, gap: 3 },
  /** The wide cell of a build. */
  buildCell: { width: 36, height: 10 },
  /** Room round the cells inside the plate. */
  pad: 4,
  /** Between the queue plate and the build plate. */
  gap: 3,
  /** Between the capacity ring (its centre line) and the lower edge of the lowest plate. */
  ringGap: 6,
  plate: { radius: 4, alpha: 0.86, rim: 0.14 },
  /** The stroke of a cell, the margin of the growing part inside it and its head line. */
  frame: { width: 1.5, inset: 2, head: 2 },
  hatch: { period: 9, thickness: 4.5 },
  /** The dot of a queued unit: its radius is this share of the cell height (at least `min`). */
  dot: { share: 0.14, min: 1.6 },
  /** The dashed outline of a free slot. */
  slot: { dash: 3, gap: 2.5 },
  /** The dashed amber ring round a cell that needs a look (ready with no room, stopped by a fight). */
  alert: { width: 1.6, dash: 3, gap: 2, grow: 2, low: 0.45 },
  /** The round badge with the kind of a build: centre from the left of the plate, radius, rim, glyph size. */
  badge: { cx: 13, radius: 7, rim: 1.2, glyph: 4 },
} as const;
/**
 * The barracks of an own city (DEC-26): a round dark badge with a little house in it (the shape
 * tells it, not the colour), on the left of the capacity ring.
 */
/** The barracks badge; the rim is drawn in the owner's colour (`YOU` or `ENEMY`, DEC-31). */
export const BARRACKS_MARK = { radius: 7.5, fill: BG, stroke: { width: 2, color: YOU } } as const;

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
/**
 * Faint dividers inside a triangle, one per unit (#508), so the charged units can be counted on the
 * fill: drawn up to `max` units, a bigger group is told by the number alone.
 */
export const UNIT_TICKS = { max: 8, width: 1, color: PAPER, alpha: 0.34, inset: 2.4 } as const;
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
/** The pill "+N / M" beside the shield of an own group in "Defense" (DEC-30); `tuck`: how far it runs under the disc. */
export const DEFENSE_LABEL = { fontSize: 11, padX: 4, height: 15, tuck: -2, drop: 10 } as const;
/** The selection outline is a copy of the triangle this much bigger (9.5). */
export const SELECT_UNIT_SCALE = 1.45;

/**
 * A packet of the automatic supply is a small square with a tail of two fainter squares behind it
 * (a charge is a square, ui-style 21); a one-off transfer a bigger square with a double outline.
 * An opponent one (a replay shows both) has a dark centre.
 */
export const PACKET_SIDE = 8;
export const PACKET_OUTLINE = { width: 1.5, color: BG } as const;
export const PACKET_TRANSFER = { side: 11, ring: 15, ringWidth: 1.2, outline: 1.6 } as const;
/** The tail: two squares behind the packet, `distance` from it along the road, fainter and smaller. */
export const PACKET_TAIL = [
  { distance: 8, side: 6, alpha: 0.6 },
  { distance: 14, side: 5, alpha: 0.3 },
] as const;
/** A transfer is bigger: its tail starts this much further back. */
export const PACKET_TAIL_TRANSFER_EXTRA = 4;
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

// --- Fog of war (CLI-05, #61; the haze F1, #346) -----------------------------------------------
// A hidden area is a cool grey veil with a soft edge, no hatching (ui-style 26.3): the cells of the
// hidden cities are filled, blurred once and cached as one texture, redrawn only when the set of
// the hidden cities changes. What is not known of a place is carried by the dotted half of a road
// (`ROAD_FOG`, a road never seen too), the memory ghosts and the tick at the border point.

/**
 * The veil: `color` at `alpha` over the hidden cells, blurred by `blur` px (world units). The blur
 * runs at `blurResolution` of the cache texture on `blurQuality` passes: the edge is soft anyway
 * and a quarter of the pixels cost about a quarter of the rebuild (measured in #346); it is not
 * redrawn per frame. `margin` is how far the cells are pushed past the map edge so that the veil
 * stays dense up to it (the mask of the map cuts it there).
 */
export const FOG_VEIL = {
  color: 0x252d38,
  alpha: 0.66,
  blur: 9,
  blurQuality: 2,
  blurResolution: 0.25,
  margin: 40,
} as const;
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
/**
 * The travel time of a move order (#432): a plate with a small clock and the seconds, on the road
 * between the group and the hovered city. The size is in world units and is scaled to stay as big
 * on screen (`badgeScale`: 13 px of text is still 13 px at a 60% map scale). The seconds are text and
 * the clock is a shape: the label never rests on colour.
 */
export const ETA_FONT_SIZE = 13;
export const ETA_LABEL = {
  height: 22,
  padX: 7,
  /** Width of the clock and the gap between it and the number. */
  clock: 12,
  gap: 4,
  radius: 7,
  /** The plate stands this far off the road (past the half width of the widest road). */
  roadGap: 5,
} as const;
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
/** The route of the hovered order (#448): a solid band along its roads, rim to rim, past the label. */
export const ROUTE_BAND = { extra: 4, alpha: 0.4 } as const;
/**
 * Road pick (key U, DEC-16): the roads a click would upgrade carry a dashed band.
 */
export const PICK_BAND = { extra: 6, dash: 10, gap: 7, alpha: 0.85 } as const;

// --- Road builds (DEC-16, DEC-28 item 7; R1, #345) ----------------------------------------------
// A road being built carries a hazard tape under its lanes: stripes of the warning colour on a
// dark band, the part that is done is a solid band over it. A plate with the level change ("1 to 2")
// sits in the middle of the road; an own build also shows the time left under the plate, `m:ss`.

export const ROAD_TAPE = {
  /** The tape is this much wider than the casing of the road. */
  extra: 5,
  /** One warning stripe and the dark gap after it, along the road. */
  period: 11,
  stripe: 5.5,
  base: { color: BG, alpha: 0.8 },
  stripeColor: { color: WARN, alpha: 0.9 },
  done: { color: WARN, alpha: 0.55 },
} as const;
export const BUILD_PLATE = {
  width: 34,
  height: 16,
  radius: 8,
  stroke: { width: 1.5, color: WARN },
  fontSize: 11,
  /** The time left, under the plate. */
  timeGap: 12,
} as const;
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

// --- Fight effects on the map, E3 "Expressive" (ui-style 27.3, 29; #351) -----------------------------
/**
 * How strong the fight effects are: "Stronger" (owner, 2026-10-21) is 1.6. The sparks, shards, the
 * size of flashes and rings and the length of rays and traces all follow it. The fallback "medium" is
 * 1.0: one change here, if the frame budget does not hold (AGENTS.md 12, ui-style 22).
 */
export const FIGHT_FX_STRENGTH = 1.6;
/** Distance between the two groups of a fight when their tokens do not tell it (world units, as it stands now). */
export const FIGHT_GAP = 46;
/** The hot white of a flash, of sparks and of the contact ring. */
export const FLASH_COLOR = 0xffffff;

// --- Planned orders: ODb "Low relief" (#431, #519, ui-style 33.3) ----------------------------------
// A planned order is a ribbon from the start city to the target, the same for both sides: body 16,
// tail 60%, head 38 x 30, the body and the head ONE closed outline. The arc always bulges toward the
// top of the screen (it never runs over the caption of its start or its target). Layers, bottom to
// top: a short soft cast shadow (the outline moved by `shadow`), the opaque dark underlay (the road
// below does not show through), the tint, the fill (it grows from the tail to the head while the
// delay runs, with a paper line at its front; one flat tone after the departure with a soft band
// that runs along the ribbon), one pulse at the departure, the outline. (The faint inner rim of the
// mockup lies wholly under the outline and its casing: it is not drawn.) Own:
// a dark casing under one lightened line, a dot at the tail. The opponent's: the double outline
// (two thin lines with the plate between) and a double ring at the tail; the head stops on a dashed
// ring round the target that is open at the bottom, where the caption of the city sits.
export const RIBBON = {
  /** Body width; the tail narrows to `tailRatio` of it. Head 38 x 30 at this body. */
  body: 16,
  tailRatio: 0.6,
  headWidth: 38,
  headLength: 30,
  /** Under the tint: the road and the terrain below do not show through the ribbon (almost opaque). */
  underlay: { color: PLATE_FILL, alpha: 0.96 },
  /** The cast shadow: the outline moved by (dx, dy) world units, in the dark of the map. */
  shadow: { dx: 1, dy: 2, alpha: 0.35 },
  /** The tint of the part the delay has not reached, the fill the delay has filled, the fill after the departure. */
  tintAlpha: 0.14,
  prepAlpha: 0.72,
  fillAlpha: 0.74,
  /** The paper line across the ribbon at the front of the fill (`inset` short of the edges). */
  front: { width: 2, inset: 1.2 },
  /** The departure pulse: one swell of a paper-white fill, `pulseTicks` long, and the outline swells by `pulseWidth`. */
  flashAlpha: 0.5,
  pulseTicks: 8,
  pulseWidth: 2,
  /** The own outline: a dark casing under one line (the owner colour lightened). */
  outline: { width: 1.6, lighten: 0.15, casingWidth: 3.4, casingAlpha: 0.7 },
  /** The opponent's double outline: a wide line in its colour with a narrower plate line on top. */
  foe: { width: 5.2, inner: 2 },
  /** The band of light that runs along the ribbon on the way: its length, alpha and one pass in seconds. */
  sheen: { length: 18, alpha: 0.3, periodS: 1.8 },
  /** The tail marks: own a dot, the opponent a double ring (the diamond stays the bonus sign, ui-style 21). */
  tail: { dot: 4, dotRing: 1.5, ring: 5.2, ringWidth: 1.6, inner: 2.4, innerWidth: 1.1 },
  /** The ribbon bends at most this share of its chord toward the server's path (one smooth curve). */
  maxBend: 0.3,
  /**
   * An order with no path to follow (a neighbour, or the opponent's) is an arc bending this share of
   * its chord toward the top of the screen (the sign of `arcBend`: negative is up for an arrow
   * going right; `orderBend` flips it for one going left). A path that bends less than `minBend` of
   * the chord, or bends down, gets the arc too.
   */
  arcBend: -0.45,
  minBend: 0.12,
  /** The tail starts this far outside the circle of the start city, and at least `slotClear` from the barracks mark (the B1 column) and `badgeClear` from the VP badge. */
  startGap: 22,
  startMax: 60,
  slotClear: 26,
  badgeClear: 20,
  /** The own head stops this far outside the capacity ring of the target; the opponent's this far outside its circle (on the ring). */
  ownEndGap: 5,
  foeEndGap: 32,
  /** The narrow end of the body is never thinner than this on screen (CSS px). */
  minTailPx: 8,
  /** The bonus pill sits `bonusBack` before the end of the arc, on its outer side. */
  bonusBack: 62,
  bonusMin: 20,
  bonusMargin: 3,
  /**
   * The dashed ring round the target of the opponent's order: `gap` outside its circle (clear of the VP badge on its upper right), open at the
   * bottom (`open` radians each side of straight down) for the caption; `--warn` over an own city, and
   * it pulses then (`pulseS`, down to `pulseLow` of its opacity; steady with "less motion").
   */
  ring: {
    gap: 22,
    width: 2,
    casingWidth: 4.5,
    casingAlpha: 0.6,
    dash: 5,
    space: 4,
    open: 0.75,
    pulseS: 0.9,
    pulseLow: 0.45,
  },
} as const;
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

// --- The «Supply» layer (DEC-28, item 8) ---------------------------------------------------------
// A flat, minimal picture: the territory is a stronger flat tint than on the normal map, the roads
// show their level by lanes, and only what supply is about is drawn on top. Opposite flows on
// one road use opposite lanes; the automatics is a solid arrow, a transfer a dashed and wider one.

/** The territory tint of the layer (the normal map: `TERRITORY_ALPHA`): flat, no terrain under it. */
export const SUPPLY_TERRITORY_ALPHA = 0.34;
/** The flat floor of the layer instead of the terrain. */
export const SUPPLY_FLOOR = 0x141a22;
/** A flow arrow: the lane is the distance from the road axis. */
export const SUPPLY_FLOW = {
  lane: 8,
  width: 3,
  alpha: 0.95,
  head: { length: 10, width: 11 },
} as const;
export const SUPPLY_TRANSFER = { width: 4.5, dash: 9, gap: 5 } as const;
/** The number plate in the middle of a flow arrow. */
export const SUPPLY_FLOW_LABEL = { fontSize: 11, padX: 4, height: 14, radius: 4 } as const;
/** A packet on its road: a square (a charge, ui-style 21); a transfer a bigger one with a double outline. */
export const SUPPLY_PACKET = { side: 7, transferSide: 10, transferRing: 14 } as const;
/**
 * The warehouse bar of the «Supply» layer is the bar of the normal map (`BAR_SEGMENT`); this is its
 * distance under the city (the layer draws no capacity ring).
 */
export const SUPPLY_STOCK = { gap: 9 } as const;
/** The front marker: a pole with a flag carrying its number, up and to the left of the city. */
export const SUPPLY_MARKER = {
  pole: 28,
  flag: { width: 20, height: 16 },
  angle: -135,
  gap: 4,
  font: 12,
} as const;
/** The dashed ring and the badge of a cut-off city (DEC-19). */
export const SUPPLY_CUT = { gap: 9, width: 2.5, dash: 10 } as const;
/** The mark of the enemy presence: a hollow inverted triangle, no number. */
export const SUPPLY_PRESENCE = { side: 12, width: 2.2, angle: 45, gap: 9 } as const;
