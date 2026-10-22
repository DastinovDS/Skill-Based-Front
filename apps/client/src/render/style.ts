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
/** The outer width of the casing or band of an own road of `level`: what the border tick reaches over. */
export function roadSpan(level: number): number {
  return roadLanesWidth(level) + ROAD_OWN.casing;
}
/** The "?" on a road that was never seen (its level is 1 by DEC-17): a small dashed disc. */
export const ROAD_UNKNOWN = {
  radius: 6.5,
  fill: { color: BG, alpha: 0.92 },
  stroke: { width: 1.2, color: NEUTRAL_STROKE },
  /** The share of a dash of the rim in its step (the rest is the gap). */
  dash: 0.5,
  /** The question mark drawn with strokes: the hook (radius, how far above the centre), the stem, the dot. */
  glyph: { hook: 2.3, up: 2.2, stem: 1.6, dot: 4.2, dotRadius: 0.95, width: 1.7 },
} as const;

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
// (`ROAD_FOG`), the "?" of a road never seen, the memory ghosts and the tick at the border point.

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
/** The tick across a road at its border point (DEC-21, item 5): a short light line, `overhang` px past the road on each side. */
export const BORDER_MARK = { width: 2, color: 0xe6edf3, alpha: 0.55, overhang: 5 } as const;
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

// --- Ribbon arrows of intents and orders (9.7) ---------------------------------------------------
// A planned order is a wide ribbon from the start city to the centre of the target, an arc that
// bends to the left of the way (never a straight line over the road), with a big head (HOI4, Mini
// Motorways). It has an opaque dark underlay: the road under it does not show through. Own: solid
// contour; the opponent: dashed 9/5, which also "runs" once the group has left. While the delay
// runs the ribbon fills from the start to the tip; when it ends one smooth pulse locks it in and
// leaves the contour stronger.
export const RIBBON = {
  /** Body width; the tail narrows to `tailRatio` of it. Head 38 x 30 at this body. */
  body: 16,
  tailRatio: 0.6,
  headWidth: 38,
  headLength: 30,
  /** Under the tint: the road and the terrain below do not show through the ribbon (almost opaque). */
  underlay: { color: PLATE_FILL, alpha: 0.96 },
  /** Fill of the part the delay has not reached yet, and of the filled / locked ribbon. */
  idleAlpha: 0.14,
  fillAlpha: 0.55,
  /** The pulse at the end of the delay: one swell of a paper-white fill, `pulseTicks` long. */
  flashAlpha: 0.5,
  pulseTicks: 8,
  /** Contour while the delay runs, and after the pulse (locked): the pulse leaves it stronger. */
  contour: { width: 2.2, alpha: 0.95 },
  locked: { width: 3.2, alpha: 1, fillBoost: 0.12 },
  /** Extra contour width at the peak of the pulse. */
  pulseWidth: 2.2,
  casing: { width: 6, alpha: 0.45 },
  /** The ribbon bends at most this share of its chord toward the server's path (one smooth curve). */
  maxBend: 0.3,
  /**
   * An order with no path to follow (a neighbour, or the opponent's) is an arc bending this share of
   * its chord; negative: to the left of the way on the screen (y down), always, so two orders
   * against each other on one road do not lie on top of each other. A path that bends less than
   * `minBend` of the chord gets the arc too.
   */
  arcBend: -0.45,
  minBend: 0.12,
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
