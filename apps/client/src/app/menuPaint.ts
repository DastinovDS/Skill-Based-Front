/**
 * The map layer of the picture behind the screens before a match on one 2D canvas (#866): the
 * baked ground graded by the season, the territory as the Border band with the engraved border,
 * the roads, the cities and provinces (the capitals stand on their own SVG layer) and the names.
 * The same Engraved pieces #839 drew in SVG (`menuPieces.ts` holds their geometry), on a canvas so
 * that a capture can redraw only the box round its area while it floods (#856, "Fitted" of #819):
 * the new owner's band shows inside a front that grows from the city to the border, the front
 * engraved (a hairline of the owner's colour on a dark casing, a fainter ink line behind it), the
 * rest of the box mixes from the old border to the new as the flood cleans up, and the roads of
 * the city take their new look from its end.
 *
 * Decoration only: the owners come from the script of `menuCaptures.ts`, never from a game.
 */
import type { FloodLook } from '../render/captureLayout.ts';
import { SOFT } from '../render/softness.ts';
import { CAPTURE } from '../render/style.ts';
import type { Point } from './menuScene.ts';
import {
  MENU_BORDER,
  MENU_INK,
  MENU_LANE,
  MENU_RING,
  menuCity,
  type MenuLand,
} from './menuPieces.ts';
import type { Owners, Scene, SceneNode } from './menuScene.ts';

/** The token colours the map layer takes from the page (`app.css`). */
export interface MapColours {
  readonly own: string;
  readonly enemy: string;
  readonly neutral: string;
  readonly neutralFill: string;
  readonly cut: string;
  readonly ink: string;
  readonly plate: string;
  readonly casing: string;
  readonly display: string;
}

export const FALLBACK_COLOURS: MapColours = {
  own: '#86a6ea',
  enemy: '#e5785e',
  neutral: '#b3a88f',
  neutralFill: '#221e18',
  cut: '#050403',
  // The ink of the map's lines, darker and warmer than the text's ivory (#865).
  ink: MENU_INK,
  plate: '#0e0c09',
  casing: '#060504',
  display: "'Cinzel', 'Times New Roman', serif",
};

/** The colours of the page, read from `element`. */
export function readColours(element: Element): MapColours {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  const F = FALLBACK_COLOURS;
  return {
    own: token('--own', F.own),
    enemy: token('--enemy', F.enemy),
    neutral: token('--neutral', F.neutral),
    neutralFill: token('--neutral-fill', F.neutralFill),
    cut: token('--cut', F.cut),
    ink: F.ink,
    plate: token('--plate', F.plate),
    casing: token('--casing', F.casing),
    display: token('--font-display', F.display),
  };
}

/**
 * The lanes of a road (#839, the match's at level 1): light lanes on a band or dashed on a casing,
 * softened as the match's (`SOFT.line`, #865).
 */
export const ROAD_LOOK = {
  own: {
    casing: 3.6,
    casingAlpha: 0.62 * SOFT.line,
    lane: '#e6edf3',
    laneAlpha: 0.95 * SOFT.line,
    dash: null,
  },
  enemy: {
    casing: 3.6,
    casingAlpha: 0.62 * SOFT.line,
    lane: '#e6edf3',
    laneAlpha: 0.95 * SOFT.line,
    dash: null,
  },
  buffer: {
    casing: 3.6,
    casingAlpha: 0.4,
    lane: '#aab2bd',
    laneAlpha: 0.95 * SOFT.line,
    dash: [7, 5],
  },
  fog: {
    casing: 3,
    casingAlpha: 0.3,
    lane: '#aab2bd',
    laneAlpha: 0.75 * SOFT.line,
    dash: [1.5, 4.5],
  },
} as const;

export type RoadKind = keyof typeof ROAD_LOOK;

/** How a road between `a` and `b` is drawn with `owners`: own, the opponent's, a buffer, in the fog. */
export function roadKind(a: SceneNode, b: SceneNode, owners: Owners, scene: Scene): RoadKind {
  const hidden = scene.fog && a.x > scene.fadeStart && b.x > scene.fadeStart;
  const oa = owners[a.id] ?? null;
  const ob = owners[b.id] ?? null;
  if (oa === 0 && ob === 0) return 'own';
  if (oa === 1 && ob === 1) return hidden ? 'fog' : 'enemy';
  return hidden ? 'fog' : 'buffer';
}

/** A capture flooding its area (`menuCaptures.ts`): the owners before and after it, how far it is. */
export interface FloodPaint {
  readonly node: number;
  readonly before: Owners;
  readonly after: Owners;
  readonly look: FloodLook;
}

/** Everything the layer needs that does not change while it is shown. */
export interface MapPaint {
  readonly scene: Scene;
  /** The size of the pieces against the match (`MenuBackdrop`'s `k`). */
  readonly k: number;
  readonly colours: MapColours;
  /** The graded ground (`gradeGround`), in world units 0..width x 0..height; null: the stone. */
  readonly ground: CanvasImageSource | null;
  readonly world: { readonly width: number; readonly height: number };
  /** The areas of the nodes (world units), by node id. */
  readonly cells: readonly (readonly Point[])[];
  /** The land of an owner state (cached by the caller). */
  readonly land: (owners: Owners) => MenuLand;
}

/** A box on the screen, px. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * A hatch pattern: a stripe `thick` world units across every `pitch`, turned by `angle` degrees,
 * in `colour` at `alpha`. Its tile is drawn at a fixed resolution and scaled into world units.
 */
function hatch(
  c: CanvasRenderingContext2D,
  colour: string,
  alpha: number,
  pitch: number,
  thick: number,
  angle: number,
): CanvasPattern | null {
  const tile = document.createElement('canvas');
  const size = 32;
  tile.width = size;
  tile.height = size;
  const t = tile.getContext('2d');
  if (t === null) return null;
  t.globalAlpha = alpha;
  t.fillStyle = colour;
  t.fillRect(0, 0, size, Math.max(1, (Math.min(thick, pitch) / pitch) * size));
  const pattern = c.createPattern(tile, 'repeat');
  if (pattern === null) return null;
  pattern.setTransform(new DOMMatrix().rotate(angle).scale(pitch / size));
  return pattern;
}

interface Patterns {
  readonly own: CanvasPattern | null;
  readonly enemy: CanvasPattern | null;
  readonly neutral: CanvasPattern | null;
}

/** The patterns of a paint, made once per `MapPaint` (a flood repaints 30 times a second). */
const made = new WeakMap<MapPaint, Patterns>();

function patterns(c: CanvasRenderingContext2D, p: MapPaint): Patterns {
  const known = made.get(p);
  if (known !== undefined) return known;
  const fresh = makePatterns(c, p);
  made.set(p, fresh);
  return fresh;
}

function makePatterns(c: CanvasRenderingContext2D, p: MapPaint): Patterns {
  const px = 1 / Math.max(0.05, p.scene.scale);
  const pitch = Math.max(MENU_BORDER.band.pitch * p.k, 3 * px);
  const thick = Math.max(MENU_BORDER.band.width, px);
  const a = MENU_BORDER.band.alpha;
  return {
    own: hatch(c, p.colours.own, a, pitch, thick, 0),
    enemy: hatch(c, p.colours.enemy, a, pitch, thick, -45),
    neutral: hatch(c, p.colours.neutral, 0.7, 2.6, 0.7, 45),
  };
}

/** The territory of `land`: the band of each side clipped to its areas, then the engraved border. */
function drawLand(
  c: CanvasRenderingContext2D,
  p: MapPaint,
  land: MenuLand,
  hatches: Patterns,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const px = SOFT.weight / Math.max(0.05, p.scene.scale);
  const k = p.k;
  const B = MENU_BORDER;
  c.save();
  c.globalAlpha = alpha;
  c.lineJoin = 'round';
  for (const side of ['own', 'enemy'] as const) {
    const part = land[side];
    const pattern = hatches[side];
    if (pattern !== null && part.band !== '') {
      c.save();
      c.clip(new Path2D(part.cells));
      c.lineCap = 'round';
      c.strokeStyle = pattern;
      c.lineWidth = B.band.depth * 2 * k;
      c.stroke(new Path2D(part.band));
      c.restore();
    }
    const colour = side === 'own' ? p.colours.own : p.colours.enemy;
    c.globalAlpha = alpha * B.cut.alpha;
    c.strokeStyle = p.colours.cut;
    c.lineWidth = Math.max(B.cut.width * k, px);
    c.stroke(new Path2D(part.cut));
    c.globalAlpha = alpha * B.rule.alpha;
    c.strokeStyle = colour;
    c.lineWidth = Math.max(B.rule.width * k, px);
    c.stroke(new Path2D(part.rule));
    if (side === 'own') {
      c.lineWidth = Math.max(B.rule2.width * k, px);
      c.stroke(new Path2D(part.inner));
    } else {
      c.save();
      c.lineCap = 'round';
      c.lineWidth = Math.max(B.beads.radius * 2 * k, px);
      c.setLineDash([0, B.beads.step * k]);
      c.stroke(new Path2D(part.inner));
      c.restore();
    }
  }
  c.restore();
}

/** One stretch of a road from share `from` to `to` of it (from `a`), in the look of `kind`. */
function drawRoad(
  c: CanvasRenderingContext2D,
  p: MapPaint,
  a: Point,
  b: Point,
  from: number,
  to: number,
  kind: RoadKind,
): void {
  if (to - from <= 1e-6) return;
  const px = SOFT.weight / Math.max(0.05, p.scene.scale);
  const k = p.k;
  const look = ROAD_LOOK[kind];
  const x0 = a.x + (b.x - a.x) * from;
  const y0 = a.y + (b.y - a.y) * from;
  const x1 = a.x + (b.x - a.x) * to;
  const y1 = a.y + (b.y - a.y) * to;
  const casing =
    kind === 'own' ? p.colours.own : kind === 'enemy' ? p.colours.enemy : p.colours.cut;
  c.lineCap = 'butt';
  c.setLineDash([]);
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.globalAlpha = look.casingAlpha;
  c.strokeStyle = casing;
  c.lineWidth = (MENU_LANE + look.casing) * k;
  c.stroke();
  c.globalAlpha = look.laneAlpha;
  c.strokeStyle = look.lane;
  c.lineWidth = Math.max(MENU_LANE * k, px);
  if (look.dash !== null) {
    c.setLineDash(look.dash.map((d) => d * k));
    // The dashes run from the road's own end `a`, wherever the stretch starts.
    c.lineDashOffset = -Math.hypot(x0 - a.x, y0 - a.y);
  }
  c.stroke();
  c.setLineDash([]);
  c.lineDashOffset = 0;
}

/** The roads; while a capture floods, the roads of its city take the new look from its end. */
function drawRoads(
  c: CanvasRenderingContext2D,
  p: MapPaint,
  owners: Owners,
  flood: FloodPaint | null,
): void {
  const scene = p.scene;
  c.save();
  for (const edge of scene.edges) {
    const a = edge.a.world;
    const b = edge.b.world;
    if (flood !== null && (edge.a.id === flood.node || edge.b.id === flood.node)) {
      const before = roadKind(edge.a, edge.b, flood.before, scene);
      const after = roadKind(edge.a, edge.b, flood.after, scene);
      const cut = clamp01(flood.look.road);
      if (edge.a.id === flood.node) {
        drawRoad(c, p, a, b, 0, cut, after);
        drawRoad(c, p, a, b, cut, 1, before);
      } else {
        drawRoad(c, p, a, b, 0, 1 - cut, before);
        drawRoad(c, p, a, b, 1 - cut, 1, after);
      }
      continue;
    }
    drawRoad(c, p, a, b, 0, 1, roadKind(edge.a, edge.b, owners, scene));
  }
  c.restore();
}

function circle(c: CanvasRenderingContext2D, at: Point, r: number): void {
  c.beginPath();
  c.arc(at.x, at.y, Math.max(0.01, r), 0, Math.PI * 2);
}

/** A city (not a capital) in the Engraved look of `MenuCityMark.svelte`, scaled by `k` about it. */
function drawCity(
  c: CanvasRenderingContext2D,
  p: MapPaint,
  node: SceneNode,
  side: 'own' | 'enemy' | 'neutral',
  hatches: Patterns,
): void {
  const piece = menuCity(node.kind, node.world);
  const at = piece.at;
  const r = piece.radius;
  const C = p.colours;
  c.save();
  c.translate(at.x, at.y);
  c.scale(p.k, p.k);
  c.translate(-at.x, -at.y);
  c.globalAlpha = 0.8;
  c.strokeStyle = C.cut;
  c.lineWidth = MENU_RING.cut;
  c.stroke(new Path2D(piece.ring.cut));
  c.globalAlpha = 0.85;
  c.strokeStyle = C.ink;
  c.lineWidth = MENU_RING.room.width;
  c.stroke(new Path2D(piece.ring.room));
  c.globalAlpha = 0.85;
  c.fillStyle = C.cut;
  circle(c, at, r + 3.2);
  c.fill();
  c.globalAlpha = 1;
  c.fillStyle = side === 'own' ? C.own : side === 'enemy' ? C.enemy : C.neutralFill;
  circle(c, at, r);
  c.fill();
  if (side === 'neutral') {
    if (hatches.neutral !== null) {
      c.fillStyle = hatches.neutral;
      c.fill();
    }
  } else {
    c.globalAlpha = 0.6;
    c.strokeStyle = C.cut;
    c.lineWidth = 0.8;
    circle(c, at, r - 1.2);
    c.stroke();
    c.globalAlpha = 1;
  }
  c.strokeStyle = C.ink;
  if (side === 'enemy') {
    c.lineWidth = 0.9;
    circle(c, at, r - 4.4);
    c.stroke();
    circle(c, at, r - 6.4);
    c.stroke();
  }
  c.lineWidth = 1.1;
  circle(c, at, r + 1.6);
  c.stroke();
  c.restore();
}

/** A province: the dark plate with the owner's dot (a neutral one: a ring and a grey point). */
function drawProvince(
  c: CanvasRenderingContext2D,
  p: MapPaint,
  at: Point,
  side: 'own' | 'enemy' | 'neutral',
): void {
  const C = p.colours;
  c.save();
  c.translate(at.x, at.y);
  c.scale(p.k, p.k);
  c.translate(-at.x, -at.y);
  c.fillStyle = C.plate;
  circle(c, at, 8);
  c.fill();
  c.strokeStyle = C.ink;
  c.lineWidth = 0.9;
  if (side === 'neutral') {
    circle(c, at, 6);
    c.stroke();
    c.fillStyle = C.neutral;
    circle(c, at, 1.5);
    c.fill();
  } else {
    c.fillStyle = side === 'own' ? C.own : C.enemy;
    circle(c, at, 6.4);
    c.fill();
    circle(c, at, 7.6);
    c.stroke();
    if (side === 'enemy') {
      circle(c, at, 10);
      c.stroke();
    }
  }
  c.restore();
}

/** The names of the cities in small cut capitals, faint, on a dark halo (the Lapis plate). */
function drawNames(c: CanvasRenderingContext2D, p: MapPaint): void {
  const px = 1 / Math.max(0.05, p.scene.scale);
  c.save();
  c.font = `500 ${String(10 * px)}px ${p.colours.display}`;
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  if ('letterSpacing' in c) c.letterSpacing = `${String(1.8 * px)}px`;
  c.lineJoin = 'round';
  c.lineWidth = 2.4 * px;
  for (const node of p.scene.nodes) {
    if (!node.city) continue;
    const text = node.name.toUpperCase();
    const y = node.world.y + menuCity(node.kind, node.world).ring.radius * p.k + 11 * px;
    c.globalAlpha = 0.7;
    c.strokeStyle = p.colours.plate;
    c.strokeText(text, node.world.x, y);
    c.globalAlpha = 0.62;
    c.fillStyle = p.colours.ink;
    c.fillText(text, node.world.x, y);
  }
  c.restore();
}

/** The side a node is drawn in. */
const sideOf = (owner: 0 | 1 | null | undefined): 'own' | 'enemy' | 'neutral' =>
  owner === 0 ? 'own' : owner === 1 ? 'enemy' : 'neutral';

/** The area of `cell` scaled by `f` about `centre` (the front of a flood: `fitAt` = f, #819). */
function scaledCell(cell: readonly Point[], centre: Point, f: number): Path2D {
  const path = new Path2D();
  cell.forEach((q, i) => {
    const x = centre.x + (q.x - centre.x) * f;
    const y = centre.y + (q.y - centre.y) * f;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  });
  path.closePath();
  return path;
}

function cellPath(cell: readonly Point[]): Path2D {
  return scaledCell(cell, { x: 0, y: 0 }, 1);
}

/**
 * The front of a flood, engraved (#856, `RIM` of `floodView.ts`): the new owner's hairline on a
 * dark casing where the front stands, a fainter ink line `CAPTURE.rim.behind` behind it; widths in
 * screen px.
 */
function drawFront(
  c: CanvasRenderingContext2D,
  p: MapPaint,
  cell: readonly Point[],
  centre: Point,
  look: FloodLook,
  colour: string,
): void {
  if (look.rim <= 0) return;
  const px = 1 / Math.max(0.05, p.scene.scale);
  const R = CAPTURE.rim;
  const at = look.pos - look.feather / 2;
  c.save();
  c.clip(cellPath(cell));
  c.lineJoin = 'round';
  if (at - R.behind > 0) {
    c.globalAlpha = R.inkAlpha * look.rim;
    c.strokeStyle = p.colours.ink;
    c.lineWidth = R.ink * px;
    c.stroke(scaledCell(cell, centre, at - R.behind));
  }
  if (at > 0) {
    const front = scaledCell(cell, centre, at);
    c.globalAlpha = R.casingAlpha * look.rim;
    c.strokeStyle = p.colours.casing;
    c.lineWidth = (R.line + 2 * R.casing) * px;
    c.stroke(front);
    c.globalAlpha = look.rim;
    c.strokeStyle = colour;
    c.lineWidth = R.line * px;
    c.stroke(front);
  }
  c.restore();
}

/**
 * Paints the map layer into `c` (CSS px: the caller sets the device pixel transform): the whole
 * window, or only `box` (cleared first). `owners`: who holds what now; `flood`: a capture flooding
 * its area (its city is drawn in `owners`, the new owner).
 */
export function paintMap(
  c: CanvasRenderingContext2D,
  p: MapPaint,
  owners: Owners,
  flood: FloodPaint | null,
  box: Box | null = null,
): void {
  const scene = p.scene;
  c.save();
  if (box !== null) {
    c.beginPath();
    c.rect(box.x, box.y, box.w, box.h);
    c.clip();
    c.clearRect(box.x, box.y, box.w, box.h);
  } else {
    c.clearRect(0, 0, scene.width, scene.height);
  }
  c.translate(scene.origin.x, scene.origin.y);
  c.scale(scene.scale, scene.scale);
  if (p.ground !== null) c.drawImage(p.ground, 0, 0, p.world.width, p.world.height);
  const hatches = patterns(c, p);
  const cell = flood === null ? undefined : p.cells[flood.node];
  const node = flood === null ? undefined : scene.nodes.find((n) => n.id === flood.node);
  if (flood === null || cell === undefined || node === undefined) {
    drawLand(c, p, p.land(owners), hatches, 1);
  } else {
    const look = flood.look;
    const before = p.land(flood.before);
    const after = p.land(flood.after);
    const front = Math.max(0, look.pos - look.feather / 2);
    const revealed = scaledCell(cell, node.world, front);
    // Outside the front: the old border fades into the new one as the flood cleans up.
    c.save();
    const outside = new Path2D();
    outside.rect(-1e5, -1e5, 2e5, 2e5);
    outside.addPath(revealed);
    c.clip(outside, 'evenodd');
    drawLand(c, p, before, hatches, 1 - look.clean);
    drawLand(c, p, after, hatches, look.clean);
    c.restore();
    // Inside the front: the new owner's band.
    if (front > 0) {
      c.save();
      c.clip(cellPath(cell));
      c.clip(revealed);
      drawLand(c, p, after, hatches, 1);
      c.restore();
    }
    const by = flood.after[flood.node];
    drawFront(c, p, cell, node.world, look, by === 1 ? p.colours.enemy : p.colours.own);
  }
  drawRoads(c, p, owners, flood);
  for (const n of scene.nodes) {
    if (scene.capitalIds.includes(n.id)) continue;
    const side = sideOf(owners[n.id]);
    if (n.city) drawCity(c, p, n, side, hatches);
    else drawProvince(c, p, n.world, side);
  }
  drawNames(c, p);
  c.restore();
}

/**
 * The box on the screen a flood of `node` repaints: its area, the roads of its city to their far
 * ends, and room for the band, the border and the marks and names at the ends.
 */
export function floodBox(
  scene: Scene,
  cells: readonly (readonly Point[])[],
  node: number,
  k: number,
): Box | null {
  const cell = cells[node];
  if (cell === undefined || cell.length === 0) return null;
  const points: Point[] = [...cell];
  for (const edge of scene.edges) {
    if (edge.a.id === node) points.push(edge.b.world);
    if (edge.b.id === node) points.push(edge.a.world);
  }
  const margin = (MENU_BORDER.band.depth + 30) * k;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const q of points) {
    x0 = Math.min(x0, q.x - margin);
    y0 = Math.min(y0, q.y - margin);
    x1 = Math.max(x1, q.x + margin);
    y1 = Math.max(y1, q.y + margin);
  }
  // The names under the far cities reach further down.
  y1 += 24 / Math.max(0.05, scene.scale);
  const sx = (x: number): number => scene.origin.x + x * scene.scale;
  const sy = (y: number): number => scene.origin.y + y * scene.scale;
  const left = Math.max(0, Math.floor(sx(x0)));
  const top = Math.max(0, Math.floor(sy(y0)));
  const right = Math.min(scene.width, Math.ceil(sx(x1)));
  const bottom = Math.min(scene.height, Math.ceil(sy(y1)));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/**
 * The baked ground graded by the season (`groundMatrix`, the 4 x 5 matrix of an SVG
 * `feColorMatrix`) and fading into the stone at its edges, drawn once into a canvas of the image's
 * size. `null` without a 2D canvas.
 */
export function gradeGround(
  image: HTMLImageElement,
  matrix: string,
  world: { readonly width: number; readonly height: number },
): HTMLCanvasElement | null {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (w <= 0 || h <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d', { willReadFrequently: true });
  if (c === null) return null;
  c.drawImage(image, 0, 0);
  const data = c.getImageData(0, 0, w, h);
  const px = data.data;
  const m = matrix.split(' ').map(Number);
  const at = (i: number): number => m[i] ?? 0;
  // The soft edge of #839 (a rect 34 units in, blurred 22): half strength 34 units in.
  const ux = world.width / w;
  const uy = world.height / h;
  for (let y = 0; y < h; y += 1) {
    const dy = Math.min(y * uy, world.height - y * uy);
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = px[i] ?? 0;
      const g = px[i + 1] ?? 0;
      const b = px[i + 2] ?? 0;
      const a = px[i + 3] ?? 255;
      px[i] = at(0) * r + at(1) * g + at(2) * b + at(3) * a + at(4) * 255;
      px[i + 1] = at(5) * r + at(6) * g + at(7) * b + at(8) * a + at(9) * 255;
      px[i + 2] = at(10) * r + at(11) * g + at(12) * b + at(13) * a + at(14) * 255;
      const d = Math.min(dy, x * ux, world.width - x * ux);
      const edge = clamp01(0.5 + (d - 34) / 88);
      px[i + 3] = a * edge * edge * (3 - 2 * edge);
    }
  }
  c.putImageData(data, 0, 0);
  return canvas;
}
