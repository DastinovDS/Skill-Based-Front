/**
 * The Engraved map treatment (#829, decided 2026-11-08; #842): the territory as a Border band, the
 * fog as a Ruled veil, and line weights that hold under zoom.
 *
 * - **Border band** (round 3, topic o): no tint inside the land; a hatched band along the land
 *   borders of each owner (own horizontal, the enemy's at 45 degrees), and the border engraved: a
 *   dark cut on the border, the owner's rule inside it, doubled on the own side and a row of beads
 *   on the enemy's.
 * - **Ruled veil** (round 3, topic n): the hidden land greyed and darkened under one run of fine
 *   horizontal rules, with the owner's band and borders kept over it; the edge of sight a double
 *   hairline on a dark casing with ticks into the fog.
 * - **Zoom** (round 2): a stroke never thinner than one device pixel, and the hatch in zoom buckets
 *   of a power of two: inside a bucket it scales with the map (its screen pitch between `pitch` and
 *   twice that), and towards the next bucket the lines in between fade in, so the pitch halves
 *   without a jump. The hatch is a small tiling texture with mipmaps (`HatchTile`) whose lines keep
 *   their screen width.
 *
 * The geometry and the bucket arithmetic are pure functions; `HatchTile` owns one texture.
 * Mockups: docs/design/mockups/in-game-style-r2.html (zoom), -r3.html (topics n and o), -r5.html.
 *
 * The colours are the Engraved tokens of the style foundation (`theme/tokens.ts`, #841), the same
 * own/enemy pair as the pieces of the map (#847).
 */
import { BufferImageSource, Matrix, Texture } from 'pixi.js';
import type { PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { ENGRAVED } from '../theme/tokens.ts';
import { centroid, territoryBorders, type Border, type CellEdge } from './regionLayout.ts';

/** The Engraved theme colours used by the map treatment (mockup `VARIANTS.engraved`). */
export const ENGRAVE = {
  own: ENGRAVED.own,
  enemy: ENGRAVED.enemy,
  ink: ENGRAVED.ink,
  /** The dark casing under a coloured mark. */
  casing: ENGRAVED.casing,
  /** The colour of a cut into the stone. */
  cut: 0x050403,
} as const;

/** The Engraved colour of `owner` as seen by `me`: own blue, the opponent red. */
export function engravedOwnerColor(me: PlayerId, owner: PlayerId): number {
  return owner === me ? ENGRAVE.own : ENGRAVE.enemy;
}

/** A hatch: `pitch` world units at zoom 1 (css px), lines `width` css px wide (at least 1 device px). */
export interface HatchSpec {
  readonly pitch: number;
  readonly width: number;
}

/**
 * The Border band (O1): `depth` world units inside the land border (the mockup's 26-unit stroke
 * clipped to the owner's side), hatched at `alpha`; the own hatch at `ownAngle` degrees, the enemy's
 * at `enemyAngle`.
 */
export const BORDER_BAND = {
  depth: 13,
  hatch: { pitch: 3.2, width: 0.85 },
  alpha: 0.85,
  ownAngle: 0,
  enemyAngle: -45,
} as const;

/**
 * The engraved border of an owner's land (world units): a dark `cut` on the border, the owner's
 * `rule` inside it, a second rule (`rule2`) on the own side and a row of `beads` on the enemy's.
 */
export const BORDER_ENGRAVING = {
  cut: { inset: 0, width: 1.6, alpha: 0.85 },
  rule: { inset: 2.4, width: 1.1 },
  rule2: { inset: 4.6, width: 1.1 },
  beads: { inset: 5, step: 5.5, radius: 0.95 },
} as const;

/** The thin cut round every area (also between areas of one owner): faint, so the land reads clean. */
export const AREA_LINE = { width: 0.9, alpha: 0.3 } as const;

/**
 * The Ruled veil (N1): `grey` of the colour taken out of the hidden ground, a dark `veil`, the
 * `rules` over it, the owner's band and borders kept at `band` and `borders`, and the edge of sight.
 */
export const RULED_VEIL = {
  grey: 0.9,
  veil: { color: 0x0b0a08, alpha: 0.3 },
  rules: { pitch: 3.4, width: 1, alpha: 0.5, color: 0x050403, angle: 0 },
  band: 0.85,
  borders: 0.9,
  edge: {
    casing: 3.2,
    line: { width: 0.7, alpha: 0.7, offset: 1 },
    tick: { step: 7, from: 1.4, to: 4.4 },
  },
} as const;

// --- Line weights under zoom ------------------------------------------------------------------------

/** A stroke of `width` world units at least one device pixel wide at `zoom` css px per unit. */
export function hairWidth(width: number, zoom: number, resolution: number): number {
  const device = Math.max(1e-6, zoom * Math.max(1e-6, resolution));
  return Math.max(width, 1 / device);
}

/**
 * The thinnest stroke in world units (one device pixel), rounded UP to a step of a quarter octave,
 * so that a zoom gesture redraws the lines only when the floor moves by about a fifth.
 */
export function hairFloor(zoom: number, resolution: number): number {
  const exact = 1 / Math.max(1e-6, zoom * Math.max(1e-6, resolution));
  return 2 ** (Math.ceil(Math.log2(exact) * 4) / 4);
}

const smooth = (lo: number, hi: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

export interface HatchBucket {
  /** The power of two of the zoom bucket. */
  readonly bucket: number;
  /** The pitch of the main lines in world units in this bucket. */
  readonly pitch: number;
  /** How far the lines in between have faded in (0..1). */
  readonly fade: number;
}

/** The zoom bucket of a hatch of `pitch` at `zoom` css px per world unit (mockup `hatch`, SNAP). */
export function hatchBucket(pitch: number, zoom: number): HatchBucket {
  const zf = Math.log2(Math.max(0.05, zoom));
  const bucket = Math.floor(zf);
  return { bucket, pitch: pitch / 2 ** bucket, fade: smooth(0.3, 0.92, zf - bucket) };
}

/** Texels of a hatch tile across its lines (one pitch) and along them. */
export const TILE_HEIGHT = 16;
export const TILE_WIDTH = 4;

/** The cover (0..1) of row `[r, r + 1)` by a line of `width` texels centred at `centre`. */
function cover(r: number, centre: number, width: number): number {
  const lo = Math.max(r, centre - width / 2);
  const hi = Math.min(r + 1, centre + width / 2);
  return Math.max(0, hi - lo);
}

/**
 * The alpha (0..1) of every row of a hatch tile `height` texels high: the main line in the middle,
 * `width` texels wide, and the line in between on the seam (half at the top, half at the bottom),
 * at `fade`. Both lines are anti-aliased by their cover of the row.
 */
export function hatchRows(height: number, width: number, fade: number): number[] {
  const w = Math.min(height / 2, Math.max(0, width));
  const rows: number[] = [];
  for (let r = 0; r < height; r++) {
    const main = cover(r, height / 2, w);
    const between = (cover(r, 0, w) + cover(r, height, w)) * fade;
    rows.push(Math.min(1, main + between));
  }
  return rows;
}

/**
 * One hatch as a tiling texture with mipmaps: white lines on clear (the fill colours them), one
 * pitch high. `update` keeps the lines' screen width and the fade of the lines in between for the
 * zoom; the texture's pixels change, its object stays. `matrix` places the tile in the world for
 * the current bucket, rotated by `angle` degrees: a fill drawn with it needs a redraw only when the
 * bucket changes (`update` says so).
 */
export class HatchTile {
  readonly texture: Texture;
  private readonly pixels = new Uint8Array(TILE_WIDTH * TILE_HEIGHT * 4);
  private readonly source: BufferImageSource;
  private bucket = Number.NaN;
  private pitch = 1;
  private key = '';

  constructor(private readonly spec: HatchSpec) {
    this.source = new BufferImageSource({
      resource: this.pixels,
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
      alphaMode: 'premultiplied-alpha',
      autoGenerateMipmaps: true,
      scaleMode: 'linear',
      addressMode: 'repeat',
    });
    this.texture = new Texture({ source: this.source });
  }

  /** The zoom (css px per world unit) and the device pixel ratio; `true` when the bucket changed. */
  update(zoom: number, resolution: number): boolean {
    const { bucket, pitch, fade } = hatchBucket(this.spec.pitch, zoom);
    const devicePitch = pitch * zoom * Math.max(1e-6, resolution);
    const deviceWidth = Math.max(this.spec.width * resolution, 1);
    const width = (deviceWidth * TILE_HEIGHT) / Math.max(1e-6, devicePitch);
    // Rounded so a zoom gesture re-uploads the tile only when the look changes.
    const key = `${(Math.round(width * 32) / 32).toFixed(3)}|${(Math.round(fade * 32) / 32).toFixed(3)}`;
    if (key !== this.key) {
      this.key = key;
      const rows = hatchRows(TILE_HEIGHT, width, fade);
      rows.forEach((alpha, r) => {
        const v = Math.round(alpha * 255);
        for (let c = 0; c < TILE_WIDTH; c++)
          this.pixels.fill(v, (r * TILE_WIDTH + c) * 4, (r * TILE_WIDTH + c) * 4 + 4);
      });
      this.source.update();
    }
    const changed = bucket !== this.bucket;
    this.bucket = bucket;
    this.pitch = pitch;
    return changed;
  }

  /** Texels to world units for the current bucket, the lines turned by `angle` degrees. */
  matrix(angle: number): Matrix {
    const k = this.pitch / TILE_HEIGHT;
    return new Matrix().scale(k, k).rotate((angle * Math.PI) / 180);
  }

  destroy(): void {
    this.texture.destroy(true);
  }
}

// --- Geometry --------------------------------------------------------------------------------------

/**
 * The edges with an inward normal on every edge, so `territoryBorders` mitres the corners of convex
 * (Voronoi) areas too. Make it once per map: the corner shifts are cached by the array.
 */
export function withInward(
  cells: readonly (readonly Point[])[],
  edges: readonly CellEdge[],
): readonly CellEdge[] {
  return edges.map((edge) => {
    if (edge.inward !== undefined) return edge;
    const cell = cells[edge.cell];
    const length = Math.hypot(edge.b.x - edge.a.x, edge.b.y - edge.a.y) || 1;
    let n = { x: -(edge.b.y - edge.a.y) / length, y: (edge.b.x - edge.a.x) / length };
    if (cell !== undefined) {
      const c = centroid(cell);
      const mx = (edge.a.x + edge.b.x) / 2;
      const my = (edge.a.y + edge.b.y) / 2;
      if ((c.x - mx) * n.x + (c.y - my) * n.y < 0) n = { x: -n.x, y: -n.y };
    }
    return { ...edge, inward: n };
  });
}

/** A quadrilateral of the border band: the border `a b` and its inset `b' a'`. */
export interface Strip {
  readonly owner: number;
  readonly cell: number;
  readonly neighbour: number | null;
  readonly points: readonly Point[];
}

/**
 * The Border band of every owner: one strip per land border segment, from the border `depth` units
 * into the owner's land. Not along water (a coast or a river is not where an owner ends).
 */
export function bandStrips(
  cells: readonly (readonly Point[])[],
  owners: readonly (number | null)[],
  edges: readonly CellEdge[],
  depth: number,
): Strip[] {
  const outer = territoryBorders(cells, owners, 0, edges);
  const inner = territoryBorders(cells, owners, depth, edges);
  const strips: Strip[] = [];
  outer.forEach((o, i) => {
    const n = inner[i];
    if (n === undefined || o.water === true || o.neighbour === null) return;
    strips.push({
      owner: o.owner,
      cell: o.cell,
      neighbour: o.neighbour,
      points: [o.a, o.b, n.b, n.a],
    });
  });
  return strips;
}

/** The lines of the engraved border, each a set of offset border segments. */
export interface BorderLines {
  readonly cut: readonly Border[];
  readonly rule: readonly Border[];
  readonly rule2: readonly Border[];
  readonly beads: readonly Border[];
}

export type BorderLineKind = keyof BorderLines;
export const BORDER_LINE_KINDS: readonly BorderLineKind[] = ['cut', 'rule', 'rule2', 'beads'];

/** The engraved border lines of `owners`: the same segments at the insets of `BORDER_ENGRAVING`. */
export function borderLines(
  cells: readonly (readonly Point[])[],
  owners: readonly (number | null)[],
  edges: readonly CellEdge[],
): BorderLines {
  const at = (inset: number): Border[] => territoryBorders(cells, owners, inset, edges);
  return {
    cut: at(BORDER_ENGRAVING.cut.inset),
    rule: at(BORDER_ENGRAVING.rule.inset),
    rule2: at(BORDER_ENGRAVING.rule2.inset),
    beads: at(BORDER_ENGRAVING.beads.inset),
  };
}

/**
 * Points every `step` units along segments, the distance carried over from one segment to the next
 * where they join (an end of one is the start of the next), started afresh where they do not.
 */
export function pointsAlong(
  segments: readonly { readonly a: Point; readonly b: Point }[],
  step: number,
  from = step / 2,
): { at: Point; along: Point; index: number }[] {
  const out: { at: Point; along: Point; index: number }[] = [];
  let carry = from;
  let last: Point | null = null;
  for (const [index, { a, b }] of segments.entries()) {
    if (last === null || Math.hypot(a.x - last.x, a.y - last.y) > 1e-6) carry = from;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    last = b;
    if (length === 0) continue;
    const along = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    let d = carry;
    while (d <= length) {
      out.push({ at: { x: a.x + along.x * d, y: a.y + along.y * d }, along, index });
      d += step;
    }
    carry = d - length;
  }
  return out;
}

/** The edge of sight: the land borders between a hidden area and a seen one, at `inset` into the fog. */
export function sightEdge(
  cells: readonly (readonly Point[])[],
  hidden: ReadonlySet<number>,
  edges: readonly CellEdge[],
  inset: number,
): Border[] {
  const side = cells.map((_, i) => (hidden.has(i) ? 1 : 0));
  return territoryBorders(cells, side, inset, edges).filter(
    (b) => b.owner === 1 && b.neighbour !== null && b.water !== true,
  );
}
