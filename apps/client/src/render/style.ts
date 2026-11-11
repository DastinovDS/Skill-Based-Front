import type { PlayerColour, PlayerId, Terrain } from '../protocol.gen.ts';
import { DURATION, ENGRAVED, PLAYER_COLOURS } from '../theme/tokens.ts';
import { SOFT } from './softness.ts';

// Visual constants of the map. Sizes are in world units (docs/design/map-format.md): cities are
// about 100 units apart on MVP maps (100 units = 3 s of travel), so these sizes do not depend on
// the map. State is never shown by colour alone (AGENTS.md §7.4): see the comments below.

// --- Palette (docs/design/ui-style.md, section 6): the only place with map colours ---------------
// The pieces of the map (helmets, cities, marks) take the colour of their owner's player id
// (`PlayerColours`, DEC-49, #906): each player in the colour they chose (`PLAYER_COLOURS` of
// `theme/tokens.ts`). `YOU` and `ENEMY` are today's pair (the viewer Lapis, the opponent Minium),
// the look of a match or replay without colours (`sideColours`).
// `BG` and `PAPER` stay the old dark and white of the parts not restyled yet (roads, arrows, plates).

export const BG = 0x0d1117;
export const PAPER = 0xf0f6fc;
export const YOU = ENGRAVED.own;
export const ENEMY = ENGRAVED.enemy;
export const NEUTRAL_STROKE = ENGRAVED.neutral;
export const NEUTRAL_FILL = ENGRAVED.neutralFill;
export const WARN = ENGRAVED.warn;
export const VP = ENGRAVED.vp;
/**
 * The two colours of the advantage and disadvantage badges (#791, variant 8 "Chevrons" of #776):
 * green chevrons up, red chevrons down. Never alone: the direction of the chevrons tells them
 * apart (and in grey), and a dark outline gives at least 3:1 on every terrain (ui-style 6, 32).
 */
export const BADGE_UP = ENGRAVED.up;
export const BADGE_DOWN = ENGRAVED.down;
/** Empty segment of a capacity ring and of a warehouse bar. */
export const SEGMENT_EMPTY = ENGRAVED.segmentEmpty;
export const SEGMENT_EMPTY_BAR = 0x3b4450;

/**
 * The Engraved material of the pieces (ui-style 52 III to 57): ivory `INK` lines on a dark `CASING`
 * round every coloured mark, the `DARK_PLATE` of a dome or a city with units in it, and the `CUT`
 * into the stone under a ring. The ink is darker and warmer than the token's ivory (`SOFT.ink`,
 * #865).
 */
export const INK = SOFT.ink;
export const CASING = ENGRAVED.casing;
export const DARK_PLATE = ENGRAVED.plate;
export const CUT = 0x050403;

export const CANVAS_BACKGROUND = BG;

export const TERRAIN_FILL: Readonly<Record<Terrain, number>> = {
  plains: 0x3a4630,
  forest: 0x25392b,
  mountains: 0x4a453e,
};
/**
 * The ground of the terrain map mode (#429, "Patterns"): a flat colour per area plus a mark that
 * stays different in grey scale (dots, firs, hatching: `patternLayout.ts`), drawn in the map
 * background colour over it.
 */
export const PATTERN_GROUND = {
  floor: 0x10151c,
  /** The water of a map with a geography (DEC-36): the sea, the lakes and the rivers, flat. */
  water: 0x2a4a60,
  alpha: 0.92,
  fill: { plains: 0x7c9456, forest: 0x1f5a47, mountains: 0x6b6d75 } satisfies Record<
    Terrain,
    number
  >,
  dot: { radius: 1.5, alpha: 0.4 },
  fir: { width: 1.5, alpha: 0.5, halfWidth: 4, up: 4, down: 3 },
  hatch: { width: 2, alpha: 0.42 },
} as const;
/** The flat water of a map with a geography whose background did not load (DEC-36): W4's blue. */
export const WATER_FLAT = 0x345c74;
/** The baked background (or the flat terrain colours) is darkened by this (9.1). */
export const BACKDROP_DIM = { color: BG, alpha: 0.18 } as const;
export const CELL_BORDER = { width: 1, color: BG, alpha: 0.5 } as const;
export const MAP_BORDER = { width: 2, color: 0x484f58 } as const;

// --- Sides and colours: each player in their colour (DEC-49) -------------------------------------
// The side (own or the opponent's) is told by shape (the helmet's facing, the hatch direction, the
// enemy city's inner rings), never by the colour alone (AGENTS.md 7.4): the colour belongs to the
// player id, the shape to the viewer.
export type Side = 'you' | 'enemy';

/** Which side `owner` is for the player `me`. */
export function sideOf(me: PlayerId, owner: PlayerId): Side {
  return owner === me ? 'you' : 'enemy';
}

/** The colours of the two players by player id (0xRRGGBB): `[player 0, player 1]`. */
export type PlayerColours = readonly [number, number];

/** The colour ids of the two players by player id, as `welcome.colours` and a replay header give them. */
export type ColourIds = readonly [PlayerColour, PlayerColour];

/** Today's look, for a match or replay without colours: the viewer `me` Lapis, the opponent Minium. */
export function sideColours(me: PlayerId): PlayerColours {
  return me === 0 ? [YOU, ENEMY] : [ENEMY, YOU];
}

/** The colours of the players by id; without ids (an old replay), today's look for `me`. */
export function playerColours(me: PlayerId, ids: ColourIds | null | undefined): PlayerColours {
  return ids == null ? sideColours(me) : [PLAYER_COLOURS[ids[0]], PLAYER_COLOURS[ids[1]]];
}

/** The colour of `owner`'s pieces. */
export function ownerColor(colours: PlayerColours, owner: PlayerId): number {
  return colours[owner];
}

/** The other player. */
export function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

// Territory: the Border band and the engraved border lines of `engraving.ts` (#842); no flat tint.

// --- Shading BL1-1 "Restrained" (ui-style 26.3, #347) ------------------------------------------------
// Objects (cities, group helmets, badges, arena plates and chips) are baked into textures once
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

// --- Roads: a lane (ui-style 26, R1 "Lanes", #345) -----------------------------------------------
// A road reads without colour. An own (internal) road has
// a solid light lane on a band of the owner's colour; a buffer road (the ends have different
// owners, or one of them none) has dashed grey lanes on a dark casing and no band; a half in fog
// has a dotted lane. Nothing here is animated.
export const ROAD_LANE = { width: 2 } as const;
/** The lanes and the band under them of a road between two cities of one owner. */
export const ROAD_OWN = {
  lane: 0xe6edf3,
  laneAlpha: 0.95 * SOFT.line,
  bandAlpha: 0.62 * SOFT.line,
  casing: 3.6,
} as const;
/** A buffer road: dashed lanes, a dark casing and no band of an owner. */
export const ROAD_BUFFER = {
  lane: 0xaab2bd,
  laneAlpha: 0.95 * SOFT.line,
  dash: 7,
  gap: 5,
  casingAlpha: 0.4,
  casing: 3.6,
} as const;
/** A half of a road in fog: dotted lanes (the veil of the fog over the cell carries the state too). */
export const ROAD_FOG = {
  lane: 0xaab2bd,
  laneAlpha: 0.75 * SOFT.line,
  dash: 1.5,
  gap: 4.5,
  casingAlpha: 0.3,
  casing: 3,
} as const;
// --- Cities (9.4) -------------------------------------------------------------------------------
/** Radius when the capacity is not known (a map without a snapshot). */
export const NODE_RADIUS = 14;
export const CAPITAL_RADIUS = 17;

/** The capacity ring: `RING_GAP` outside the body, segments 4 wide on a 7 wide dark base. */
export const RING_GAP = 7;
export const RING_SEGMENT = { width: 4, base: 7, baseAlpha: 0.75, gap: 0.16 } as const;
/** Above this capacity the ring is one solid arc with a notch at every fifth unit. */
export const RING_MAX_SEGMENTS = 10;

/** The warehouse bar under the ring: one 5 x 4 segment per unit of capacity (6 apart). */
export const BAR_SEGMENT = { width: 5, height: 4, pitch: 6, pad: 1 } as const;
export const BAR_GAP = 9;
/**
 * A province (DEC-23, PB "Pale dot", #431, ui-style 35): a small solid dot of `dot` radius in a pale
 * tint of the owner (`lighten` of the owner's colour, no dark plate, so no centre that reads as a
 * target), a thin darker outline (`outline.darken`) and a dark casing; the capacity ring of 3
 * places outside it (`ringRadius(radius)`) is the same as ever. The opponent's dot has a second
 * thin light ring `enemy.inset` outside it, so the side reads without the hue; nobody's is a paler,
 * see-through grey dot with a dashed outline. No gradient, no rim, no star, no warehouse, no VP.
 */
export const PROVINCE = {
  /** The radius the capacity ring and the label are laid out by. */
  radius: 9,
  dot: 6.5,
  casing: { inset: 1.6, width: 2, alpha: 0.55 },
  /** How far the owner's colour is moved to white; nobody's is paler still and see-through. */
  tint: { owned: 0.5, neutral: 0.25, neutralAlpha: 0.6 },
  outline: { width: 1.4, darken: 0.15 },
  neutralOutline: { width: 1.3, dash: 2.6, gap: 2 },
  enemy: { inset: 3.4, width: 1.1, alpha: 0.95 },
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
  /** Economy v2: at most this many hollow dots of charges a build still waits for (DEC-41, item 7). */
  owedDots: 5,
  /** The hollow dot of an owed charge: radius and stroke. */
  owed: { radius: 2.5, width: 1.4, pitch: 7 },
} as const;
/**
 * The barracks of an own city (DEC-26): a round dark badge with a little house in it (the shape
 * tells it, not the colour), on the left of the capacity ring.
 */
/** The barracks badge; the rim is drawn in the owner's colour (`YOU` or `ENEMY`, DEC-31). */
export const BARRACKS_MARK = {
  radius: 8,
  fill: BG,
  stroke: { width: 2, color: YOU },
  /** The opponent's barracks: a light inner ring and a smaller house, so the side reads without the hue. */
  enemy: { innerRadius: 5.6, ringWidth: 1, ringAlpha: 0.85, house: 0.78 },
} as const;

/**
 * The middle of the gilt VP lozenge lies this far outside the capacity ring's centre line (#847;
 * further out since the lozenge grew, #928, so it covers less of the ring and the helmet).
 */
export const VP_BADGE_LIFT = 4.5;

// --- Units on the map (9.5): helmets (#784) ----------------------------------------------------------
// A group is a helmet (`units/helmet.ts`): own Rim facing right, the opponent's Cut facing left. Its
// size steps with the number of units; the share of charged units fills the dome from the bottom
// (`charged / units` of its height), so the charge reads as a level. An opponent without numbers
// and a memory are dashed with "?"; the top right carries the badges.

export const PLATE_FILL = 0x161b22;
export const GLYPH_COLOR = PAPER;
export const COUNT_FONT_SIZE = 10;

/**
 * The size step of a unit token by the number of units (1-3, 4-7, 8-15, 16+; unknown:
 * `UNIT_SIDE_UNKNOWN`): the helmet is `HELMET_SCALE` times this wide; it also sets the minimum size
 * on screen and the hit area.
 */
export const UNIT_SIDES = [24, 30, 36, 42] as const;
export const UNIT_SIDE_UNKNOWN = 30;
/**
 * A helmet in a city (#784) is this share of the one on a road: with its strap it stays inside the
 * capacity ring (the mockup of #775 took 8% off too).
 */
export const HELMET_INSIDE = 0.92;
export const UNIT_QUESTION_FONT_SIZE = 15;
/** On screen a unit's size step is at least this wide, and a click hits at least this wide (CSS px). */
export const UNIT_MIN_SIDE_PX = 20;
export const UNIT_MIN_HIT_PX = 28;
export const UNIT_LABEL = { fill: PLATE_FILL, alpha: 0.92, padX: 4, height: 13, gap: 3 } as const;
/**
 * The chevron badges (#791, ui-style 32): `size` is the side of a mark in world units on the map
 * (in px in the arena, `chipSize`); on screen a map mark is at least `minPx` (the exception to the
 * 20 px of section 22). Up to `maxStrokes` chevrons tell the count by strokes; above it one chevron
 * and the number, up to `maxCount`, then "9+": the keys of the baked badges stay bounded
 * (2 directions x 10 counts x 2 sizes = 40).
 */
export const BADGE = {
  size: 11,
  chipSize: 9,
  minPx: 8,
  maxStrokes: 3,
  maxCount: 9,
  /** The stroke of a chevron, a share of the size; the dark outline is this much wider (units). */
  stroke: 0.3,
  outline: 2.6,
  /** The number beside one chevron: its font size (a share of the size, at least `minFont`). */
  font: 1.05,
  minFont: 9,
} as const;
// --- The Engraved pieces (#847, part 2 of #829; ui-style 52 III to 57) ------------------------------
// Line and hatching on the dark plate, every coloured mark on a dark casing, no shadow and no glow;
// a charge is solid against hatched or hollow, so the state reads in grey. World units at 100 %.
// Mockup: docs/design/mockups/in-game-style-r5.html, the Combined view.

/**
 * A city (`cityBody`): the disc on a `cut` that reaches `grow` past it, an ink `rim` outside it, a
 * faint dark `inner` cut inside an owned one and the enemy's two ink rings (the side without the
 * hue); a neutral one is hatched in its grey. A city with units in it is the dark plate (the helmet
 * stands on it); the capital star is dark with an ink edge when the city is empty.
 */
export const CITY_ENGRAVED = {
  cut: { grow: 3.2, alpha: 0.85 },
  rim: { grow: 1.6, width: 1.1 },
  inner: { inset: 1.2, width: 0.8, alpha: 0.6 },
  enemy: { insets: [4.4, 6.4], width: 0.9 },
  neutralHatch: { pitch: 2.6, width: 0.7, alpha: 0.7 },
  star: { outer: 0.6, inner: 0.27, width: 1.2 },
} as const;
/** A province (`provinceAt`): a dark disc, the owner's dot with an ink ring, the enemy's outer ring. */
export const PROVINCE_ENGRAVED = {
  plate: 8,
  dot: 6.4,
  rim: { radius: 7.6, width: 0.9 },
  enemy: { radius: 10, width: 0.8 },
  neutral: { radius: 6, width: 0.9, dot: 1.5 },
} as const;
/**
 * The capacity ring (`ringAt`): every place on a dark cut `cut` wide; a place with a unit of the
 * viewer a solid ink arc `filled` wide, room a hollow cell: ink hairlines `width` wide `offset`
 * either side of the ring, closed at the ends, over an ink `wash` (#928: readable on the dark plate).
 */
export const RING_ENGRAVED = {
  cut: 6,
  cutAlpha: 0.8,
  filled: 3.4,
  room: { width: 0.9, offset: 1.6, wash: 0.3 },
  notch: 1.3,
} as const;
/**
 * A charge (Lozenges, 57u): a square turned 45 degrees on its own casing (`casing` across), filled in
 * the side's colour (`fill`) or hollow (the dark plate with an ink square `hollow` across). The
 * warehouse is a row of them `pitch` apart, set in threes past four (`groupGap`), its middle `drop`
 * under the capacity ring.
 */
export const LOZENGE = {
  casing: 8.2,
  fill: 5.8,
  hollow: 4.7,
  line: 0.9,
  lineAlpha: 0.92,
  pitch: 8.8,
  groupGap: 3.5,
  drop: 8.5,
} as const;
/** The VP badge (`vpBadge`): a gilt lozenge, a dark square `side` across with two gilt squares. */
export const VP_LOZENGE = { side: 18.5, outer: 17.2, inner: 12.4, width: 1.1, font: 14.5 } as const;
/**
 * The helmet (`helmet`, engraved): a dark casing (`casing`, thicker by `inside` in a city) under the
 * dome and the strap, the dome on the dark plate, hatched in the side's colour above the charge and
 * solid below it, the strap and the brim as ink lines `gear` of their width, the dome's ink `edge`.
 * The hatch runs at 45 degrees, `pitch` apart, `width` wide (mirrored with an enemy helmet).
 * A helmet without numbers or a memory: the dome on a see-through plate, its outline `beads` of
 * `radius`, the strap pale (`pale` toward white).
 */
export const HELMET_ENGRAVED = {
  casing: 6,
  inside: 1.6,
  gear: 0.55,
  edge: 1.25,
  hatch: { pitch: 3, width: 0.9 },
  bead: { count: 44, radius: 1.05 },
  pale: 0.3,
  unknownPlate: 0.85,
  /** The number in the dome: EB Garamond at this size, an ink fill on a dark halo. */
  font: 12.5,
  question: 15,
} as const;
/**
 * Cut and ring towers (53g, 55k): the barracks and the factory stand on the capacity ring, `out`
 * past its centre line, the barracks at the upper left, the factory at the left; the block is
 * `halfHeight` high either side of its middle at scale 1, drawn at `towerScale` (at least
 * `minScale`, `screen` css px per unit near zoom 1, smaller on screen zoomed far out). A built
 * tower is the owner's hatch (own horizontal, the enemy's 45 degrees) in an ink outline on a casing;
 * the barracks has a dark gate.
 */
export const TOWER = {
  barracksAngle: Math.PI * 1.25,
  factoryAngle: Math.PI * 0.95,
  out: 4,
  minScale: 1.35,
  screen: 1.7,
  /** Zoomed out past `screen / minScale`, the scale grows by this power of the zoom only (#869). */
  keep: 0.5,
  halfHeight: 5.2,
  casing: 3.2,
  line: 1,
  hatch: { pitch: 1.7, width: 0.8 },
  gate: { x: -1.4, y: 1.2, side: 2.8 },
  /** The bed joints of a tower filling with its build time: faint dark lines this far apart. */
  joint: { every: 2.3, width: 0.4, alpha: 0.55 },
  /** While charges are owed the tower is a plan: a light casing, a half-dark ground, a dotted ink outline. */
  plan: { casingAlpha: 0.55, groundAlpha: 0.5, lineAlpha: 0.75, dot: 1.3, gap: 1.5 },
  barracks: [
    [-4.6, -5.2],
    [4.6, -5.2],
    [4.6, 4],
    [-4.6, 4],
  ],
  factory: [
    [-5.4, 4],
    [-5.4, -1.6],
    [-1.6, -5.2],
    [-1.6, -1.6],
    [2.2, -5.2],
    [2.2, -1.6],
    [5.4, -1.6],
    [5.4, 4],
  ],
} as const;
/**
 * The Crown arc of a build (57k): one arc `lift` outside the top of the tower, concentric with the
 * city ring, at least `minSpan` radians; the owed charges sit on it as lozenges `step` apart (at
 * `lozenge` of their warehouse size). The time fills the arc in the side's colour (`width`) behind a
 * small ink burin point over a faint ink line, between two ink serifs. `steps`: the baked shares of
 * the time; built, the arc fades over `fadeMs` and a ring opens from the tower (`ring`).
 */
export const CROWN = {
  lift: 8,
  step: 11,
  minSpan: 1,
  lozenge: 0.9,
  width: 2.4,
  casing: 2.2,
  line: { width: 0.8, alpha: 0.55 },
  serif: { half: 3.6, width: 1, casing: 3 },
  burin: { casing: 5.4, ink: 3.4 },
  steps: 48,
  fadeMs: 500,
  ring: { ms: 600, from: 7, grow: 10, casing: 3, width: 1 },
  /**
   * The payment in motion (#872, the mockup's `payFlight`): a charge flies `flightMs` from the
   * warehouse or the group to its lozenge on an arc `lift` high, the charges of one `build_paid`
   * `staggerMs` apart; landed, the lozenge pops by `pop` over `popMs`.
   */
  pay: { flightMs: 450, lift: 12, staggerMs: 150, popMs: 220, pop: 0.3 },
  /** Paid in full: the lozenges run into the tower over `ms`, `staggerMs` apart, shrinking by `shrink`. */
  run: { ms: DURATION.buildRun, staggerMs: 60, shrink: 0.6 },
} as const;
/**
 * The recruit queue (55k Pips): a small helmet `width` wide per unit on the ring after the barracks
 * tower, the first `first` radians past it, `step` apart; the unit in production fills from the
 * bottom (`steps` baked levels), a queued one is hatched, a free slot of the selected city beaded.
 */
export const RECRUIT_PIPS = { width: 9, first: 0.38, step: 0.27, steps: 12 } as const;
/**
 * Fine rings (55p): every city highlight on one weight system, a 1 px ink line on a 2.6 px casing at
 * `R + 5`, `R + 8` and `R + 11` from the capacity ring `R`. Selected: two rings over a dark band and
 * four lozenges; a reachable target: a ring of `ticks` ticks; one reachable only after a split: a
 * dashed amber ring. A hovered city has no ring (owner 2026-11-10, #928).
 */
export const FINE_RING = {
  r1: 5,
  r2: 8,
  r3: 11,
  ink: 1,
  casing: 2.6,
  select: { band: 3.6, outer: 1.4, lozenge: 3.4, lozengeCasing: 1.1 },
  target: { ticks: 16, short: 2.6, long: 4.6, every: 4, casing: 2.4 },
  split: { dash: 4, gap: 3, width: 1.3 },
} as const;
/**
 * The outline round a selected helmet (Engraved): a dark casing `casing` wide with two ivory lines
 * `ink` wide `offset` either side of it, and a dark `halo` `haloWidth` wide under the lot, so the
 * lines read on a dark plate (the ivory) and on a pale ground such as snow (the halo and the casing)
 * alike (#940, owner 2026-11-11); a hovered one a single fainter hairline on a thinner casing.
 */
export const HELMET_SELECT = {
  casing: 5,
  ink: 1.7,
  offset: 1.9,
  haloWidth: 10.5,
  haloAlpha: 0.55,
  /**
   * The frame of a unit icon in a city lies on its dark plate and must not cover the cells of the
   * capacity ring just outside the helmet: no halo, hugging the helmet (`offset` from it).
   */
  inside: { offset: 2, casing: 3, ink: 1.5, inkOffset: 1.3 },
  hover: { casing: 2.6, ink: 1, alpha: 0.8 },
} as const;

/**
 * A packet of the automatic supply, Engraved (#858; mockup `packet`): a square of the owner's colour
 * on a dark casing (`casing` wide), an ivory outline at `outline`, turned along its road. An opponent one (a replay shows both) has a
 * dark centre.
 */
export const PACKET_SIDE = 6;
export const PACKET_ENGRAVED = { casing: 9.2, outline: 8, ink: 0.8 } as const;
/** Inside this distance past a city rim a packet shrinks and fades into the city icon. */
export const PACKET_FADE_MARGIN = 8;
export const PACKET_MIN_SCALE = 0.3;

/** Red means only "opponent" (6), so a fight mark is paper white. */
export const FIGHT_COLOR = PAPER;

// --- Fog of war (CLI-05, #61) -------------------------------------------------------------------
// A hidden area is the Ruled veil of `engraving.ts` (#842). What is not known of a place is carried
// by the dotted half of a road (`ROAD_FOG`, a road never seen too), the memory ghosts and the tick at
// the border point.

/** Opacity of a fresh memory ghost (the marker of what was last seen in a hidden place). */
export const GHOST_ALPHA = 0.6;
/** Ghosts fade linearly from `GHOST_FADE_START_S` to nothing at `GHOST_HIDE_S` seconds after the sighting (9.8). */
export const GHOST_FADE_START_S = 60;
export const GHOST_HIDE_S = 120;
export const GHOST_AGE_FONT_SIZE = 10;
export const GHOST_AGE_STROKE = { color: BG, width: 3, join: 'round' } as const;

// --- Selection and orders (CLI-06, #62) --------------------------------------------------------
// The selection is a white outline on a dark one, so it reads on any terrain and any owner.

/** The selection ring of a city sits outside its capacity ring and warning ring. */
export const SELECT_RING_GAP = 18;

// The group order and the recruit rally point (DEC-48, #896; mockup `group-order.html`): the look the
// owner chose (item K8): A1 frames and box, A2 numbered seals, B1 one hourglass seal, C3 the
// hourglass beside a waiting helmet, D2 hatched ribbons while E is held, E3 the muster ring. Sizes in
// world units; the seals, the discs and their text keep their size on screen (`badgeScale`), the
// rings and the box are drawn round the map.
export const GROUP_ORDER = {
  /** A2: the lozenge seal at the top left of a selected helmet with its place in the selection. */
  seal: { half: 7, casing: 1.6, ink: 1, fontSize: 12, dx: -0.56, dy: -0.44 },
  /** A1: the box: a faint paper ground, a dark band, an ink hairline either side, lozenge corners. */
  box: { fill: 0.06, band: 6.2, bandAlpha: 0.85, ink: 1, inner: 0.55, offset: 1.6, corner: 5 },
  /**
   * B1: the hourglass seal over the target: a disc `lift` above the ring on a leader, the seconds to
   * the arrival on its left, a lozenge per member under it (filled: on the way; a rally: merged), the
   * price on its right before the click.
   */
  arrival: {
    disc: 17,
    lift: 40,
    hourglass: 20,
    lozenge: 6.4,
    lozengeGap: 12,
    lozengeY: 27,
    textGap: 27,
    fontSize: 15,
    price: { height: 22, padding: 8, gap: 5, fontSize: 14, mark: 13, offset: 30 },
  },
  /** C3: the hourglass disc beside a waiting helmet, the seconds after it. */
  wait: { disc: 13, hourglass: 16, gap: 8, textGap: 18, fontSize: 14 },
  /** The disc of B1 and C3 (the travel time's, #627): a casing, a dark plate, a paper rim. */
  disc: { casing: 1.6, fillAlpha: 0.94, rim: 1, rimAlpha: 0.75 },
  /** E3: the muster ring round the point, four arcs; a disc with the recruit helmet on top. */
  muster: {
    gap: 13,
    arcs: 4,
    arc: 1.0,
    casing: 5.4,
    width: 2.6,
    disc: 13,
    helmet: 17,
    chevron: { gap: 12, length: 14, width: 7 },
    /** The ring a rally point pick shows at the node under the pointer. */
    pickAlpha: 0.55,
  },
} as const;
/**
 * Nodes the selected group can go to (DEC-20): a thin solid ring (own colour); nodes it can
 * reach only after a split: a dashed warning ring. Solid against dashed, not only colour.
 */
export const REACH_RING = { gap: 12, width: 2, alpha: 0.8, dash: 5 } as const;
/**
 * The travel time of a move order (#432; E4 "Hourglass", #627): a dark disc with the hourglass glyph
 * beside the road in the middle of the route, the seconds on the far side of the disc from the road.
 * The size is in world units and is scaled to stay as big on screen (`badgeScale`: 13 px of text is
 * still 13 px at a 60% map scale). The seconds are text and the hourglass is a shape: the mark never
 * rests on colour.
 */
export const ETA_FONT_SIZE = 13;
export const ETA_MARK = {
  /** The disc: dark fill, a thin paper rim. */
  radius: 17,
  fillAlpha: 0.9,
  rim: { width: 1, alpha: 0.6 },
  /** The hourglass glyph (a 96 px SpriteCook texture) drawn this wide. */
  glyph: 24,
  /** The seconds start this far from the centre of the disc (past its rim). */
  textOffset: 22,
  /** The disc stands this far off the road (past the half width of the widest road). */
  /** The disc keeps this far from the axis of the road (half the width of a road with its casing, and a margin). */
  roadGap: 11.5,
  /** A city on the way is cleared by this much more than its ring: its VP badge sits above it. */
  badgeClear: 14,
} as const;
/**
 * The bonus counter over the target of a planned order while E is held (#793, DEC-48): a dark pill with
 * an own-coloured rim just above the target city's ring; the green chevron of a bonus (#797,
 * the badge's), the bonus as text ("+3") and the gathering time it implies. Sized in world units and
 * scaled like the travel time (`badgeScale`). Shape and text carry it, never colour alone.
 */
export const BONUS_MARK = {
  height: 28,
  padding: 9,
  gap: 6,
  /** The size of the chevron of a bonus (the badge's units, `drawBonusChevron`). */
  chevron: 12,
  fontSize: 16,
  fillAlpha: 0.92,
  rim: { width: 2, alpha: 1 },
  /** The pill's lower edge stands this far above the reach ring of the city. */
  lift: 2,
} as const;
/** An order sent and not yet seen in a snapshot: dashed, see-through. */
export const ORDER_GHOST_ALPHA = 0.85;
// --- Fight, bounce, capture (9.9) ----------------------------------------------------------------
/** The loss numbers rise this many world units while they stay (`fightFx.ts`: how long). */
export const NUMBERS_RISE = 12;
/**
 * The capture of a node: "Fitted" (#819, round 2 of the mockup city-capture.html, the owner's choice of
 * 2026-11-08), in the Engraved look (#856, mockup `in-game-style-r5.html`, `drawFloodFront`). The new
 * owner's border band is revealed from the city in the shape of its own area and reaches the whole border
 * at once in `ms` (ease-out quad); `feather` is the soft edge of the front as a share of the way from the
 * city to the border. There is no fill: since #842 the map has no territory tint, the band is the owner's
 * mark (the owner's choice for the capture, #856). The front itself is engraved (`rim`): a `line` px
 * hairline of the owner's colour on a dark casing `casing` px either side, and an ink line `ink` px wide
 * `behind` it (field units) at `inkAlpha`, fading in and out over `in` and `out` of the flood. The roads
 * of the city switch as the front runs out along them (`roads`), and what is left outside the area
 * switches in `clean` (ms). The city flips in `cityMs`, and a `ring` of the owner's colour on a casing
 * leaves it: `from` world units outside the capacity ring, growing `grow` more over `ms`. No flash: the
 * Engraved style has no light (`flash.alpha` 0). An enemy capture is calmer: the rim and the ring at
 * `calm`. "Less motion": a cross-fade of `reducedMs`, no travel, no ring.
 */
export const CAPTURE = {
  ms: 1000,
  feather: 0.06,
  clean: { from: 860, to: 1120 },
  roads: { reach: 1.15, feather: 0.15 },
  rim: {
    line: 1.2,
    casing: 1,
    casingAlpha: 0.8,
    ink: 0.8,
    inkAlpha: 0.6,
    behind: 0.05,
    in: 0.08,
    out: 0.78,
  },
  cityMs: 120,
  flash: { alpha: 0, ms: 320, reach: 3.4 },
  ring: { alpha: 1, ms: 500, from: 4, grow: 34, casing: 3.2, line: 1.5 },
  calm: 0.5,
  reducedMs: 200,
} as const;
/**
 * How long the result screen waits after `match_end` when a capital was captured (#819): the render
 * delay of the snapshots (0.2 s), the flood (`CAPTURE.ms`) and 0.5 s on the settled frame. The
 * winner's walk to the ring (Walk in, #856) starts as before, but the result does not wait for it to
 * finish (the owner's call, #869: 1.7 s as before #857).
 */
export const CAPITAL_RESULT_DELAY_MS = 1700;
export const LOSS_FONT_SIZE = 13;
/**
 * The kill feed of a finished fight (#812, variant 9 of the mockup fight-bonus-and-outcome.html; Engraved,
 * #856, mockup `feedRowV`): two rows beside the node, own then the opponent's, each a cartouche with a chip
 * and the losses of the whole fight in EB Garamond; the winner's row has the heavy double rule and the
 * verdict glyph in ink, the other a thin faint rule (px at 100%).
 */
export const FEED = {
  halfWidth: 59,
  rowHeight: 34,
  rowGap: 4,
  chipX: -39,
  textX: -7,
  glyphX: 39,
  glyphScale: 1.35,
  glyphLine: 1.4 / 1.35,
  fontSize: 19,
  /** The feed slides in from this far (px), in this share of its life. */
  slide: 30,
  slideShare: 0.08,
} as const;

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

// --- Planned orders: the geometry of the ribbon (#431, #519; Engraved #851) --------------------------
// A planned order is a ribbon from the start city to the target, the same shape for both sides: the
// body and the head ONE closed outline, an arc that always bulges toward the top of the screen (it
// never runs over the caption of its start or its target). Its material is `RIBBON_ENGRAVED`.
export const RIBBON = {
  /**
   * Body width; the tail narrows to `tailRatio` of it. Head 31 x 22 at this body (the mockup's
   * `arrowShape(..., 6.6, 22, 15.5)` with its taper 0.82).
   */
  body: 13.2,
  tailRatio: 0.82,
  headWidth: 31,
  headLength: 22,
  /** The burin front across the fill stops `inset` short of the edges. */
  front: { inset: 1.2 },
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
  startGap: 13,
  startMax: 60,
  slotClear: 26,
  badgeClear: 20,
  /** The narrow end of the body is never thinner than this on screen (CSS px). */
  minTailPx: 8,
  /** The bonus pill sits `bonusBack` before the end of the arc, on its outer side. */
  bonusBack: 62,
  bonusMin: 20,
  bonusMargin: 3,
} as const;

/** A rejected order: the ghost shakes for `SHAKE_MS`, then fades out until `REJECT_MS` (U6). */
export const GHOST_SHAKE_MS = 200;
export const GHOST_REJECT_MS = 500;
export const GHOST_SHAKE_AMPLITUDE = 3;

/**
 * The cue of `X` on the map (#764): what was undone, at its place, for `ms` (Rewind fixed, #851:
 * `REWIND` below holds its look); at most `max` cues at once.
 */
export const UNDO_CUE = { ms: 1200, max: 4 } as const;

/**
 * The light outline of the own group under the pointer (#762): the selection frame's line, a
 * little closer (`HELMET_FRAME.hover`) and faint, so the hover never reads as a selection.
 */
export const HOVER_FRAME = { width: 2, alpha: 0.75, haloAlpha: 0.5 } as const;

/**
 * The outlines round a helmet (#784): this far (world units) outside the drawing of the helmet,
 * strap and brim included; the dark casing reaches 3.2 out, so both keep a gap from it.
 */
export const HELMET_FRAME = { select: 7.5, hover: 6 } as const;

/**
 * The area of the city or province under the pointer (#762): a faint paper wash over the cell
 * and a thin rim inside its edge (the rim is the cue, not the tint).
 */
export const HOVER_AREA = { alpha: 0.14, rimWidth: 2.5, rimAlpha: 0.7 } as const;

/**
 * The cut-off arrow (#762): a move refused because the CP did not pay for it. It stays clearly
 * longer than another refusal (as long as the CP badge is marked, `CP_SHORT_FLASH_MS`), fades only
 * over its last `fadeMs`, is bolder, in the alarm red, and is crossed out where it is cut: the
 * cross is the shape that tells it, not the colour.
 */
export const GHOST_CP = {
  rejectMs: 1600,
  fadeMs: 500,
  width: 6,
  alpha: 1,
  color: ENEMY,
  /** Half the span of each bar of the cross, world units. */
  cross: 8,
  crossWidth: 3.5,
} as const;

// --- The starving mark of the supply flow (the «Supply» layer was removed, DEC-50, #928) ------

/** The starving mark of a node under the flow: a triangle `half` wide each side and `height` high. */
export const FLOW_STARVE = { half: 8, height: 14 } as const;
/** The battle mode of the flow (the normal map): the starving mark off the lower right rim. */
export const FLOW_BATTLE = { starveAngle: 45, starveGap: 9 } as const;

// --- Orders on the map in the Engraved style (#851, part 3 of #829) ------------------------------
// Sources: docs/design/mockups/in-game-style-r5.html, Combined view (`burinArrow` B2, `bounceHome`
// M3, `undoArrowW` and `undoRingW` W1, `planRibbon` E1, `ribbonAt` engraved, `highlight4` H3 'att')
// and ui-style 53 to 55. World units; every hairline at least one device pixel.

/**
 * The order arrow, Cased running (54h): a paper casing outside the dark one, the owner's colour
 * between two ink hairlines `half` either side of the axis, a solid barbed head, and a burin point
 * (a small ink lozenge) running to the head, one per `burin.step`. A ghost (an order the snapshot
 * does not show yet, and the path on hover) is hollow: the owner's hatch across the body instead of
 * the core, the head dark and hatched, the paper casing fainter.
 */
export const CASED = {
  half: 1.9,
  /** The dark casing is the body plus this. */
  casing: 4.6,
  paper: { extra: 2.4, alpha: 0.34, ghost: 0.22 },
  /** The core is the body less this. */
  coreInset: 0.6,
  ink: 0.9,
  head: { length: 12, width: 0.56, paper: 5.4, casing: 3, ink: 1, overlap: 2 },
  burin: { step: 46, speed: 30, half: 4.2, side: 2.3, casing: 2.2, fade: 14, margin: 4 },
  /** The hatch across a hollow body: `pitch` world units, at least `minPx` css px (zoom buckets). */
  hatch: { pitch: 2.6, width: 0.9, alpha: 0.9 * SOFT.hatch, minPx: 3 },
  /** The part of an order already walked: ink dots. */
  walked: { step: 5, radius: 0.75, alpha: 0.6 },
  /** The arrow leaves the ring of its start city by `startGap`, and stops `endGap` outside the ring of the target. */
  startGap: 2,
  endGap: 6,
  /** The target ring of an own order: a Fine ring in the own colour at `R + FINE_RING.r1`. */
  target: { width: 1.2, alpha: 0.9 },
} as const;

/** A refusal for CP (54h): a dark lozenge with an ink X on the arrow, `at` of its length. */
export const REFUSED = {
  at: 0.62,
  half: 6.5,
  ink: 0.9,
  cross: 3.4,
  crossWidth: 1.6,
  alpha: 0.8,
} as const;

/** The path on hover (54i): the hollow Cased arrow along the server's route, drawn out in `growMs`. */
export const PATH_SHADOW = { growMs: 350 } as const;

/**
 * Bounce, Chevrons home (54m): three amber chevrons running ahead of the group to the node it came
 * from, `gap` apart, the first `lead` past the front of the helmet, at `speed` units a second, each
 * fainter by `dim`; they fade in over `inMs`. A chevron is a barbed point `tip` ahead of its centre,
 * `back` behind, `side` half wide, notched at `notch`.
 */
export const BOUNCE_HOME = {
  count: 3,
  gap: 9,
  lead: 6,
  speed: 18,
  dim: 0.22,
  inMs: 300,
  casing: 2.6,
  tip: 3.4,
  back: 2.6,
  notch: 0.6,
  side: 4.6,
  /** No chevron within this of the home ring; the cue gives up after `maxMs` on the road. */
  endGap: 4,
  maxMs: 8000,
} as const;

/**
 * Undo, Rewind fixed (54b): the cancelled order winds back into the group over `arrowMs` (at least
 * `keep` of it is left) behind a double barb that points at the group, fading from `fadeFrom` of the
 * way; a three-quarter ring winds round the group from `ring.from` over `ring.ms`, its head leading
 * the turn. "Nothing to undo" (`empty`): a crossed quarter ring beside the pointer, a short shake.
 */
export const REWIND = {
  ms: 1200,
  arrowMs: 550,
  keep: 16,
  fadeFrom: 0.85,
  barb: { length: 7.5, width: 0.7, gap: 5.5, casing: 2.6, ink: 0.9 },
  ring: { from: 300, ms: 400, fadeFrom: 800, fadeMs: 400, gap: 5, casing: 3.6, ink: 1.2 },
  ringHead: { length: 7, width: 0.62, ahead: 5.5, casing: 2.4 },
  empty: {
    ms: 1100,
    inMs: 150,
    fadeFrom: 700,
    fadeMs: 400,
    alpha: 0.75,
    radius: 6,
    slash: 7,
    casing: 3.6,
    ink: 1.2,
    shakeMs: 400,
    shake: 1.6,
    offset: { x: 18, y: -6 },
  },
} as const;

/**
 * The scheduled order's ribbon in the Engraved material (`ribbonAt`, 53e, 54e): a dark plate under
 * the owner's hatch (own horizontal, `own`; the enemy's at 45 degrees, `enemy`), the prepared share
 * solid behind a burin front, an ink outline; the enemy's has a second contour inside (`inner`, a
 * share of the body). The fill of a gathering plan eases each new bonus in over `stepMs`, from
 * `stepDelayMs` after the server reported it, while the charge flies in from the warehouse (`flightMs`).
 */
export const RIBBON_ENGRAVED = {
  casing: 4,
  plateAlpha: 0.9,
  own: { angle: 0, pitch: 2.6, width: 0.9, alpha: 0.85 * SOFT.hatch },
  /** The enemy's at the angle of its Border band (`BORDER_BAND.enemyAngle`), so the two read alike. */
  enemy: { angle: -45, pitch: 2.4, width: 1.1, alpha: SOFT.hatch },
  outline: 1,
  inner: { share: 0.64, alpha: 0.7, width: 0.8 },
  front: { casing: 3, ink: 1.2, lozenge: 4.4 },
  tail: { own: 3.4, enemy: 5.2, inner: 2.4, ink: 1.4, innerInk: 1.1 },
  /** The ghost of a sent plan (`ribbonGhost`): the outline alone on a faint own tint. */
  ghost: { fill: 0.12, casing: 3.6, ink: 1.2 },
  stepMs: 900,
  stepDelayMs: 250,
  flightMs: 500,
  flightLift: 10,
  charge: { outer: 7.2, inner: 4.8 },
  /** The pill: a thin Engraved panel with a chevron slot per asked bonus (at most `slots`), or "+N". */
  pill: {
    height: 17,
    slot: 11,
    pad: 5,
    chevron: 10,
    slots: 5,
    fontSize: 12.5,
    rimAlpha: 0.4,
    plateAlpha: 0.93,
    gap: 4,
  },
  /**
   * The target of an enemy order (Fine rings 'att'): an arc at `R + FINE_RING.r2`, `span` radians
   * each side of the way the ribbon comes in, a tick at each end; amber with chevrons marching in
   * over an own city, the enemy's colour otherwise. The enemy's head stops `foeGap` outside it.
   */
  attack: { span: 0.62, width: 1.8, tick: 2.6, tickWidth: 1.2, tickCasing: 2.4, foeGap: 3 },
  march: {
    count: 3,
    rate: 0.9,
    from: 12,
    run: 9,
    tip: 2.8,
    back: 2.2,
    notch: 0.4,
    side: 3.8,
    casing: 2.4,
  },
} as const;
