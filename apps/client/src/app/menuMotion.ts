/**
 * The motion behind the start menu (#474, BG5 "Set" of docs/design/mockups/menu-background.html): a
 * scripted decoration drawn on one 2D canvas. Nothing here is the game: no simulation, no server,
 * no rule. The pieces borrow the Engraved looks of the match map (#839, after #829: the packet, the
 * helmet, the planned order's ribbon of either side with the amber target, the etched shot and its
 * hit of Parry, the edge of sight) and move along the roads of the menu map on a fixed script that
 * depends only on the clock:
 *
 * - idle and from found on, BG1 "Living front": supply packets ride from the capital to the own
 *   cities, a recruit leaves the capital every 11 s, a group walks an own road; once a pair is found
 *   the own order and the opponent's intent meet in the middle city; once confirmed the two groups
 *   march there and fight in rounds of 2 s;
 * - searching, the BG2 scout: it walks the front road into the fog and waits at its edge; its sight
 *   is a hole in the fog (`sightOf`), cut by the fog layer, not drawn here;
 * - queue locked: the supply stands, dimmed.
 */
import { ringRadius } from '../render/cityLayout.ts';
import { CAPTURE } from '../render/style.ts';
import { WALK, walkPoint } from '../render/walkLayout.ts';
import { clipBelow, helmet } from '../units/helmet.ts';
import {
  CAPTURE_TIMES,
  LAST_SHOT,
  captureLook,
  capturesAt,
  type CaptureScript,
} from './menuCaptures.ts';
import {
  PIECES_PX,
  menuCityRadius,
  type BackdropPhase,
  type Point,
  type Scene,
} from './menuScene.ts';
import type { Story } from './menuStory.ts';

export interface MotionClock {
  readonly phase: BackdropPhase;
  /** Seconds since the phase began. */
  readonly t: number;
  /** Seconds of a clock that never restarts: the loops do not jump when the phase changes. */
  readonly g: number;
  /** Seconds in the queue when the phase began: where the scout is, how big the stack has grown. */
  readonly waited: number;
  /** `prefers-reduced-motion`: one still frame without pulses. */
  readonly reduced: boolean;
}

/** The colours of the tokens (app.css), read once from the page. */
export interface Palette {
  readonly bg: string;
  readonly paper: string;
  readonly dim: string;
  readonly you: string;
  readonly enemy: string;
  /** The dark casing under every coloured mark (Engraved, #839). */
  readonly casing: string;
  /** The font of numbers (EB Garamond). */
  readonly text: string;
}

export const FALLBACK_PALETTE: Palette = {
  bg: '#16130f',
  paper: '#ece4d1',
  dim: '#ada38f',
  you: '#86a6ea',
  enemy: '#e5785e',
  casing: '#060504',
  text: "'EB Garamond', Georgia, serif",
};

/** The token colours of the page (`app.css`), read from `element`. */
export function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string): string =>
    style.getPropertyValue(name).trim() || fallback;
  return {
    bg: token('--bg', FALLBACK_PALETTE.bg),
    paper: token('--paper', FALLBACK_PALETTE.paper),
    dim: token('--text-dim', FALLBACK_PALETTE.dim),
    you: token('--you', FALLBACK_PALETTE.you),
    enemy: token('--enemy', FALLBACK_PALETTE.enemy),
    casing: token('--casing', FALLBACK_PALETTE.casing),
    text: token('--font-text', FALLBACK_PALETTE.text),
  };
}

/**
 * The moment a still frame shows for each phase (reduced motion): idle mid-loop, the scout on its
 * way, the order fixed, the two groups in the fight, the supply stopped.
 */
export const STILL_AT: Readonly<Record<BackdropPhase, number>> = {
  idle: 20.6,
  search: 14,
  found: 2.2,
  confirmed: 5.4,
  banned: 1,
};

/** The scout walks this fast (px per second at scale 1) and sees this far (px at scale 1). */
const SCOUT_SPEED = 18;
const SIGHT = 64;
/** A fight round lasts 2 s (DEC-32, as on the arena). */
const ROUND = 2;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const ease = (u: number): number => 1 - (1 - clamp(u, 0, 1)) ** 3;

/** A stable pseudo random number in [0, 1) for the k-th event of a loop (no `Math.random`). */
export function pick(k: number, salt: number): number {
  let x = Math.imul(k + 1, 374761393) ^ Math.imul(salt + 7, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

interface At extends Point {
  readonly angle: number;
}

function lengthOf(path: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] as Point;
    const b = path[i] as Point;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** The point `d` px along `path`, with the direction of its road. */
export function along(path: readonly Point[], d: number): At {
  let rest = d;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] as Point;
    const b = path[i] as Point;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= l || i === path.length - 1) {
      const u = l > 0 ? clamp(rest / l, 0, 1) : 0;
      return {
        x: a.x + (b.x - a.x) * u,
        y: a.y + (b.y - a.y) * u,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
      };
    }
    rest -= l;
  }
  const first = path[0] ?? { x: 0, y: 0 };
  return { x: first.x, y: first.y, angle: 0 };
}

/** The part of `path` from `d0` to `d1` px. */
function slice(path: readonly Point[], d0: number, d1: number): Point[] {
  const out: Point[] = [along(path, d0)];
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1] as Point;
    const b = path[i] as Point;
    total += Math.hypot(b.x - a.x, b.y - a.y);
    if (total > d0 && total < d1) out.push(b);
  }
  out.push(along(path, d1));
  return out;
}

/** A gentle arc from `a` to `b` (the shape of an order on the match map), as points. */
function arc(a: Point, b: Point, bend: number, steps = 32): Point[] {
  const cx = (a.x + b.x) / 2 + (b.y - a.y) * bend;
  const cy = (a.y + b.y) / 2 - (b.x - a.x) * bend;
  const out: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const u = i / steps;
    const v = 1 - u;
    out.push({
      x: v * v * a.x + 2 * v * u * cx + u * u * b.x,
      y: v * v * a.y + 2 * v * u * cy + u * u * b.y,
    });
  }
  return out;
}

function trace(c: CanvasRenderingContext2D, path: readonly Point[]): void {
  c.beginPath();
  path.forEach((p, i) => {
    if (i === 0) c.moveTo(p.x, p.y);
    else c.lineTo(p.x, p.y);
  });
}

/**
 * A ring of the Engraved weight system (Fine rings, ui-style 55p): a hairline of `colour` on a dark
 * casing, `dash` for a dashed one.
 */
function fineRing(
  c: CanvasRenderingContext2D,
  k: Palette,
  p: Point,
  r: number,
  colour: string,
  alpha: number,
  dash: readonly number[] = [],
): void {
  if (alpha <= 0) return;
  c.save();
  c.globalAlpha *= alpha;
  c.setLineDash(dash);
  c.beginPath();
  c.arc(p.x, p.y, Math.max(0.1, r), 0, Math.PI * 2);
  c.strokeStyle = k.casing;
  c.lineWidth = 2.6;
  c.stroke();
  c.strokeStyle = colour;
  c.lineWidth = 1;
  c.stroke();
  c.restore();
}

/**
 * A unit of the match map, the Engraved helmet (#847): the own faces right, the enemy's left; a
 * dark casing under the dome and the strap, the charged part solid in the side's colour, the strap,
 * the brim and the dome's edge as ink lines; the dark plate above the charge level (`share`).
 */
export function drawHelmet(
  c: CanvasRenderingContext2D,
  k: Palette,
  p: Point,
  side: 0 | 1,
  o: { readonly width?: number; readonly share?: number; readonly alpha?: number } = {},
): void {
  const width = o.width ?? 18;
  const share = Math.max(0, Math.min(1, o.share ?? 1));
  const w = width / 18;
  // Centred on the point; the enemy's mirrored.
  const h = helmet(side === 0 ? 'own' : 'enemy', width);
  const flip = side === 0 ? 1 : -1;
  const outline = (points: readonly Point[], close: boolean): void => {
    c.beginPath();
    points.forEach((q, i) => {
      if (i === 0) c.moveTo(p.x + flip * q.x, p.y + q.y);
      else c.lineTo(p.x + flip * q.x, p.y + q.y);
    });
    if (close) c.closePath();
  };
  const gear = h.band === null ? [h.strap] : [h.strap, h.band];
  c.save();
  c.globalAlpha *= o.alpha ?? 1;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = k.casing;
  c.lineWidth = 3.4 * w;
  for (const line of gear) {
    outline(line, false);
    c.stroke();
  }
  c.lineWidth = 3.2 * w;
  outline(h.dome, true);
  c.stroke();
  // The dark plate, the charge solid below its level (the share of charged units).
  c.fillStyle = k.casing;
  c.fill();
  if (share > 0) {
    const ys = h.dome.map((q) => q.y);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    outline(clipBelow(h.dome, bottom - share * (bottom - top)), true);
    c.fillStyle = side === 0 ? k.you : k.enemy;
    c.fill();
  }
  c.strokeStyle = k.paper;
  c.lineWidth = 1.1 * w;
  for (const line of gear) {
    outline(line, false);
    c.stroke();
  }
  c.lineWidth = 1 * w;
  outline(h.dome, true);
  c.stroke();
  c.restore();
}

/**
 * A unit 18 px wide, charged (`share` of it). No number over it: the backgrounds count nothing
 * (owner, #866).
 */
function unit(
  c: CanvasRenderingContext2D,
  k: Palette,
  p: Point,
  side: 0 | 1,
  alpha = 1,
  share = 1,
): void {
  drawHelmet(c, k, p, side, { alpha, share });
}

/**
 * A supply packet, Engraved (#858): a square of the own colour on a dark casing with an ink outline,
 * turned along its road; no tail.
 */
function packet(c: CanvasRenderingContext2D, k: Palette, p: At, alpha: number): void {
  c.save();
  c.globalAlpha = alpha;
  c.translate(p.x, p.y);
  c.rotate(p.angle);
  c.fillStyle = k.casing;
  c.fillRect(-4.6, -4.6, 9.2, 9.2);
  c.fillStyle = k.you;
  c.fillRect(-3, -3, 6, 6);
  c.strokeStyle = k.paper;
  c.lineWidth = 0.8;
  c.strokeRect(-4, -4, 8, 8);
  c.restore();
}

/** Supply: a packet leaves the capital every 1.4 s for one of the own nodes; `frozen` stops it. */
function supply(
  c: CanvasRenderingContext2D,
  k: Palette,
  story: Story,
  scale: number,
  g: number,
  alpha: number,
  frozen: boolean,
): void {
  const routes = story.supply;
  if (routes.length === 0) return;
  const every = 1.4;
  const speed = 55 * scale;
  for (let n = Math.floor((g - 14) / every); n <= Math.floor(g / every); n += 1) {
    if (n < 0) continue;
    const route = routes[Math.floor(pick(n, 1) * routes.length)] as readonly Point[];
    const length = lengthOf(route);
    const s = g - n * every;
    const d = s * speed;
    if (d <= length - 10) packet(c, k, along(route, d), alpha);
    else if (!frozen && s - length / speed < 0.6) {
      const u = (s - length / speed) / 0.6;
      fineRing(c, k, route[route.length - 1] as Point, 11 + 3 * u, k.you, (1 - u) * alpha);
    }
  }
}

/** Drills and recruits: a group walks an own road every 6.5 s; a recruit leaves the capital every 11 s. */
function drills(
  c: CanvasRenderingContext2D,
  k: Palette,
  story: Story,
  scale: number,
  g: number,
): void {
  const roads = story.ownRoads;
  const speed = 22 * scale;
  if (roads.length > 0) {
    const every = 6.5;
    for (let n = Math.floor((g - 14) / every); n <= Math.floor(g / every); n += 1) {
      if (n < 0) continue;
      const road = roads[Math.floor(pick(n, 2) * roads.length)] as readonly [Point, Point];
      const [from, to] = pick(n, 3) < 0.5 ? road : ([road[1], road[0]] as const);
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      const s = g - n * every;
      const d = s * speed;
      if (d <= length) unit(c, k, along([from, to], d), 0, clamp(s / 0.4, 0, 1));
      else if (s - length / speed < 0.8) {
        unit(c, k, { x: to.x + 10, y: to.y - 12 }, 0, 1 - (s - length / speed) / 0.8);
      }
    }
  }
  const routes = story.supply;
  if (routes.length === 0) return;
  const every = 11;
  const n = Math.floor(g / every);
  const s = g - n * every;
  const route = routes[Math.floor(pick(n, 5) * routes.length)] as readonly Point[];
  const capital = route[0] as Point;
  const length = lengthOf(route);
  if (s < 1.2) {
    fineRing(c, k, capital, 18 + 8 * ease(s / 1.2), k.you, 1 - s / 1.2);
    unit(c, k, { x: capital.x + 14, y: capital.y - 16 }, 0, clamp(s / 0.3, 0, 1));
  } else {
    const d = (s - 1.2) * speed;
    const end = route[route.length - 1] as Point;
    if (d <= length) unit(c, k, along(route, d), 0);
    else if (d <= length + 18)
      unit(c, k, { x: end.x + 10, y: end.y - 12 }, 0, 1 - (d - length) / 18);
  }
}

/** The outline of a ribbon along `path` (`body` wide at its head, `head` long), as points. */
function ribbonOutline(
  path: readonly Point[],
  body: number,
  head: number,
  halfHead: number,
): Point[] {
  const length = lengthOf(path);
  const left: Point[] = [];
  const right: Point[] = [];
  const steps = 36;
  for (let i = 0; i <= steps; i += 1) {
    const d = ((length - head) * i) / steps;
    const p = along(path, d);
    // The tail narrows to 0.82 of the body (RIBBON.tailRatio of the match).
    const w = (body * (0.82 + 0.18 * clamp(d / (length * 0.35), 0, 1))) / 2;
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  const base = along(path, length - head);
  const tip = along(path, length);
  const nx = -Math.sin(base.angle);
  const ny = Math.cos(base.angle);
  return [
    ...left,
    { x: base.x + nx * halfHead, y: base.y + ny * halfHead },
    tip,
    { x: base.x - nx * halfHead, y: base.y - ny * halfHead },
    ...right.reverse(),
  ];
}

/**
 * A planned order, the Engraved ribbon of the match (`RIBBON_ENGRAVED`, smaller for the menu): a
 * dark casing round a dark plate hatched in the side's colour (the own horizontal, the enemy's at
 * 45 degrees, as their Border bands) inside a hairline of the colour; the own one runs a dash
 * while it is not fixed yet.
 */
function order(
  c: CanvasRenderingContext2D,
  k: Palette,
  from: Point,
  to: Point,
  o: {
    readonly side: 0 | 1;
    readonly flash: number;
    readonly fixed: boolean;
    readonly run: number | null;
    readonly alpha: number;
  },
): void {
  const full = arc(from, to, o.side === 0 ? 0.28 : -0.28);
  const total = lengthOf(full);
  const path = slice(full, 14, total - 12);
  const outline = ribbonOutline(path, 9.5, 15, 11);
  const colour = o.side === 0 ? k.you : k.enemy;
  const shape = (): void => {
    trace(c, outline);
    c.closePath();
  };
  c.save();
  c.globalAlpha = o.alpha;
  c.lineJoin = 'round';
  shape();
  c.strokeStyle = k.casing;
  c.lineWidth = 4;
  c.stroke();
  c.fillStyle = k.casing;
  c.globalAlpha = o.alpha * 0.9;
  c.fill();
  // The hatch: lines across a box round the ribbon, clipped to it.
  c.save();
  shape();
  c.clip();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of outline) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  c.globalAlpha = o.alpha * 0.85;
  c.strokeStyle = colour;
  c.lineWidth = o.side === 0 ? 0.9 : 1.1;
  c.beginPath();
  if (o.side === 0) {
    for (let y = y0; y <= y1; y += 2.6) {
      c.moveTo(x0, y);
      c.lineTo(x1, y);
    }
  } else {
    const span = x1 - x0 + (y1 - y0);
    for (let d = 0; d <= span; d += 2.4 * Math.SQRT2) {
      c.moveTo(x0 + d, y0);
      c.lineTo(x0 + d - (y1 - y0), y1);
    }
  }
  c.stroke();
  if (o.flash > 0) {
    c.globalAlpha = o.alpha * 0.45 * o.flash;
    c.fillStyle = k.paper;
    c.fill();
  }
  c.restore();
  c.globalAlpha = o.alpha;
  shape();
  c.strokeStyle = colour;
  c.lineWidth = o.fixed ? 1.4 : 1;
  if (o.run !== null) {
    c.setLineDash([8, 5]);
    c.lineDashOffset = -o.run;
  }
  c.stroke();
  c.restore();
}

/**
 * The target of the opponent's order over a node: an amber arc with marching chevrons, the match's
 * 'att' mark over an own city (the meeting city is where the own order goes too).
 */
function target(
  c: CanvasRenderingContext2D,
  k: Palette,
  at: Point,
  o: { readonly alpha: number; readonly run: number },
): void {
  const r = 17;
  c.save();
  c.globalAlpha = o.alpha;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(at.x, at.y, r, Math.PI * 0.95, Math.PI * 2.05);
  c.strokeStyle = k.casing;
  c.lineWidth = 4.2;
  c.stroke();
  c.strokeStyle = WARN;
  c.lineWidth = 1.6;
  c.stroke();
  // Chevrons on the arc, pointing in, marching along it.
  const count = 4;
  for (let i = 0; i < count; i += 1) {
    const u = (((i + o.run) % count) + count) % count;
    const a = Math.PI * (1.05 + (0.9 * u) / count);
    const x = at.x + Math.cos(a) * (r + 5);
    const y = at.y + Math.sin(a) * (r + 5);
    c.save();
    c.translate(x, y);
    c.rotate(a + Math.PI);
    c.beginPath();
    c.moveTo(-2.4, -3);
    c.lineTo(1.6, 0);
    c.lineTo(-2.4, 3);
    c.strokeStyle = k.casing;
    c.lineWidth = 3;
    c.stroke();
    c.strokeStyle = WARN;
    c.lineWidth = 1.2;
    c.stroke();
    c.restore();
  }
  c.restore();
}

/** The amber of warnings (`--warn`): never the opponent. */
const WARN = '#e6ab42';

/**
 * An etched shot (Parry, #856): a casing with a hairline of the side's colour fading to its tail
 * and a lozenge head of the side's colour in an ink outline.
 */
function shot(
  c: CanvasRenderingContext2D,
  k: Palette,
  from: Point,
  to: Point,
  u: number,
  side: 0 | 1,
): void {
  const path = arc(from, to, 0.35, 24);
  const d = lengthOf(path) * clamp(u, 0, 1);
  const tail = Math.min(d, 26);
  const colour = side === 0 ? k.you : k.enemy;
  // Relative to the alpha it is drawn at (a capture fading into the fog).
  const base = c.globalAlpha;
  c.save();
  c.lineCap = 'round';
  trace(c, slice(path, Math.max(0, d - tail), Math.max(0.1, d)));
  c.strokeStyle = k.casing;
  c.lineWidth = 3;
  c.globalAlpha = base * 0.8;
  c.stroke();
  for (let i = 0; i < 6; i += 1) {
    const s0 = d - (tail * (i + 1)) / 6;
    const s1 = d - (tail * i) / 6;
    if (s0 < 0) continue;
    const p0 = along(path, s0);
    const p1 = along(path, s1);
    c.globalAlpha = base * (1 - i / 6);
    c.beginPath();
    c.moveTo(p0.x, p0.y);
    c.lineTo(p1.x, p1.y);
    c.strokeStyle = colour;
    c.lineWidth = 1.2;
    c.stroke();
  }
  const h = along(path, d);
  c.globalAlpha = base;
  c.translate(h.x, h.y);
  c.rotate(h.angle + Math.PI / 4);
  c.fillStyle = k.casing;
  c.fillRect(-4, -4, 8, 8);
  c.fillStyle = colour;
  c.fillRect(-2.6, -2.6, 5.2, 5.2);
  c.strokeStyle = k.paper;
  c.lineWidth = 0.8;
  c.strokeRect(-2.6, -2.6, 5.2, 5.2);
  c.restore();
}

/** A unit hit by a shot (Parry): twelve cuts burst out, every other in ink (no "−1": #866). */
function hit(c: CanvasRenderingContext2D, k: Palette, p: Point, u: number, side: 0 | 1): void {
  const colour = side === 0 ? k.you : k.enemy;
  c.save();
  c.globalAlpha *= 1 - u;
  c.lineCap = 'round';
  for (let i = 0; i < 12; i += 1) {
    const a = (i * Math.PI) / 6 + 0.26;
    const r0 = 6 + 9 * ease(u);
    const r1 = r0 + 4;
    c.beginPath();
    c.moveTo(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0);
    c.lineTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
    c.strokeStyle = k.casing;
    c.lineWidth = 2.6;
    c.stroke();
    c.strokeStyle = i % 2 === 0 ? k.paper : colour;
    c.lineWidth = 1;
    c.stroke();
  }
  c.restore();
}

/** The fight in the middle city: rounds of 2 s; every third round the two shots cancel, else one kills. */
function fight(c: CanvasRenderingContext2D, k: Palette, at: Point, t: number): void {
  const a = { x: at.x - 15, y: at.y - 2 };
  const b = { x: at.x + 15, y: at.y - 2 };
  fineRing(c, k, at, 26, k.paper, 0.5, [3, 4]);
  unit(c, k, a, 0);
  unit(c, k, b, 1);
  if (t < 0) return;
  const r = Math.floor(t / ROUND);
  const u = t - r * ROUND;
  if (r % 3 === 0) {
    glance(c, k, a, b, u);
    return;
  }
  const side: 0 | 1 = r % 2 === 0 ? 0 : 1;
  const from = side === 0 ? a : b;
  const to = side === 0 ? b : a;
  if (u > 0.35 && u < 0.95) shot(c, k, from, to, (u - 0.35) / 0.6, side);
  if (u >= 0.95 && u < 1.95) hit(c, k, to, u - 0.95, side === 0 ? 1 : 0);
}

/**
 * The flag over a captured city (#819; Engraved, #856, `flagContext` of the match): a hatched
 * pennant of the owner's colour on a dark casing, the pole and the outline in ink; `at` is the foot
 * of the pole.
 */
function flag(
  c: CanvasRenderingContext2D,
  k: Palette,
  at: Point,
  colour: string,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const pennant = (): void => {
    c.beginPath();
    c.moveTo(0, -16);
    c.lineTo(11, -12.5);
    c.lineTo(0, -9);
    c.closePath();
  };
  const pole = (): void => {
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, -16);
  };
  c.save();
  c.globalAlpha *= alpha;
  c.translate(at.x, at.y);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = k.casing;
  c.lineWidth = 4;
  pole();
  c.stroke();
  pennant();
  c.fillStyle = k.casing;
  c.fill();
  c.stroke();
  // The hatch: lines of the owner's colour across the pennant, 1.8 apart.
  c.beginPath();
  for (let y = -15.2; y < -9.4; y += 1.8) {
    const half = y < -12.5 ? (y + 16) / 3.5 : (-9 - y) / 3.5;
    c.moveTo(0.8, y);
    c.lineTo(Math.max(0.8, 11 * half), y);
  }
  c.strokeStyle = colour;
  c.lineWidth = 0.9;
  c.lineCap = 'butt';
  c.stroke();
  c.lineCap = 'round';
  c.strokeStyle = k.paper;
  c.lineWidth = 0.8;
  pennant();
  c.stroke();
  c.lineWidth = 1.5;
  pole();
  c.stroke();
  c.restore();
}

/** Two shots glance off each other at the top of their arch (Parry's collision): four ink ticks. */
function glance(c: CanvasRenderingContext2D, k: Palette, a: Point, b: Point, u: number): void {
  if (u > 0.35 && u < 0.65) {
    const f = clamp((u - 0.35) / 0.3, 0, 1);
    shot(c, k, a, b, f * 0.5, 0);
    shot(c, k, b, a, f * 0.5, 1);
  }
  if (u < 0.65 || u >= 1.1) return;
  const q = (u - 0.65) / 0.45;
  const mx = (a.x + b.x) / 2;
  const my = Math.min(a.y, b.y) - 6;
  c.save();
  c.globalAlpha *= 1 - q;
  c.lineCap = 'round';
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const r0 = 3 + 4 * ease(q);
    c.beginPath();
    c.moveTo(mx + Math.cos(angle) * r0, my + Math.sin(angle) * r0);
    c.lineTo(mx + Math.cos(angle) * (r0 + 3.5), my + Math.sin(angle) * (r0 + 3.5));
    c.strokeStyle = k.casing;
    c.lineWidth = 2.6;
    c.stroke();
    c.strokeStyle = k.paper;
    c.lineWidth = 1;
    c.stroke();
  }
  c.restore();
}

/**
 * The captures of the loop (#866, `menuCaptures.ts`) as the match draws one (#856, #857): the
 * group walks from its city to the gate of the one it takes (just outside its ring, on the road it
 * came by), the garrison shows in the middle; two rounds (the first two shots glance off each other,
 * the second lands); the winner walks in, the ring of its colour leaves the city and the flag goes
 * up as it crosses the ring (the flood of the area is the map layer's, `menuPaint.ts`). The
 * opponent's pieces fade into the fog like everything of theirs; its capture is half as strong
 * (`calm`, as the match draws an enemy capture).
 */
export function drawCaptures(
  c: CanvasRenderingContext2D,
  k: Palette,
  scene: Scene,
  script: CaptureScript,
  g: number,
  reduced: boolean,
): void {
  if (reduced) return;
  // Px a world unit of a piece on the screen.
  const ps = Math.min(scene.scale, PIECES_PX);
  const fogged = (p: Point): number =>
    scene.fog
      ? 1 - clamp((p.x - scene.fadeStart) / Math.max(1, scene.fogStart - scene.fadeStart), 0, 1)
      : 1;
  for (const { capture, u } of capturesAt(script, g)) {
    const node = scene.nodes.find((n) => n.id === capture.node);
    const from = scene.nodes.find((n) => n.id === capture.from);
    if (node === undefined || from === undefined) continue;
    const look = captureLook(u, capture.by === 1);
    const attacker = capture.by;
    const defender: 0 | 1 = attacker === 0 ? 1 : 0;
    const seen = (side: 0 | 1, p: Point): number => (side === 1 ? fogged(p) : 1);
    const ring = ringRadius(menuCityRadius(node.kind)) * ps;
    const fromRing = ringRadius(menuCityRadius(from.kind)) * ps;
    const length = Math.hypot(from.x - node.x, from.y - node.y) || 1;
    const ux = (from.x - node.x) / length;
    const uy = (from.y - node.y) / length;
    const off = (d: number): Point => ({ x: node.x + ux * d, y: node.y + uy * d });
    const gate = off(Math.min(length / 2, ring + 9 + WALK.gap * ps));
    const start = off(Math.max(length / 2, length - fromRing - 9));
    if (look.guard !== null) {
      unit(c, k, node, defender, look.guard.alpha * seen(defender, node), look.guard.share);
    }
    if (look.approach !== null) {
      const p = walkPoint(start, gate, look.approach.share);
      unit(c, k, p, attacker, look.approach.alpha * seen(attacker, p));
    }
    if (look.walk !== null) {
      const p = walkPoint(gate, node, look.walk.share);
      unit(c, k, p, attacker, look.walk.alpha * seen(attacker, p));
    }
    // The shots: a glance in the first round, the winner's shot landing in the second.
    c.save();
    c.globalAlpha = Math.min(seen(attacker, gate), seen(defender, node));
    if (look.round?.index === 0) glance(c, k, gate, node, look.round.u);
    if (look.round?.index === 1 && look.round.u > CAPTURE_TIMES.shot[0]) {
      const q =
        (look.round.u - CAPTURE_TIMES.shot[0]) / (CAPTURE_TIMES.shot[1] - CAPTURE_TIMES.shot[0]);
      if (q < 1) shot(c, k, gate, node, q, attacker);
    }
    const hitU = u - LAST_SHOT;
    if (hitU >= 0 && hitU < 1) hit(c, k, node, hitU, defender);
    c.restore();
    const colour = attacker === 0 ? k.you : k.enemy;
    if (look.ring !== null && look.ring.ring > 0) {
      const r = ring + look.ring.ringRadius * ps;
      c.save();
      c.globalAlpha = look.ring.ring * seen(attacker, node);
      c.beginPath();
      c.arc(node.x, node.y, r, 0, Math.PI * 2);
      c.strokeStyle = k.casing;
      c.lineWidth = CAPTURE.ring.casing;
      c.stroke();
      c.strokeStyle = colour;
      c.lineWidth = CAPTURE.ring.line;
      c.stroke();
      c.restore();
    }
    if (look.flag !== null) {
      // The foot of the pole just outside the ring, upper right (the match's place).
      const foot = { x: node.x + ring + 4 * ps, y: node.y - ring + 4 * ps };
      flag(c, k, foot, colour, look.flag * seen(attacker, node));
    }
  }
}

/**
 * The edge of the scout's sight, as the match draws the edge of sight (the Ruled veil): a double
 * hairline on a dark casing with short ticks out into the fog.
 */
function sightEdge(
  c: CanvasRenderingContext2D,
  k: Palette,
  s: Point & { r: number },
  alpha: number,
): void {
  c.save();
  c.globalAlpha = alpha;
  c.beginPath();
  c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  c.strokeStyle = k.casing;
  c.lineWidth = 3.2;
  c.stroke();
  c.strokeStyle = k.paper;
  c.lineWidth = 0.7;
  for (const off of [-1, 1]) {
    c.beginPath();
    c.arc(s.x, s.y, s.r + off, 0, Math.PI * 2);
    c.stroke();
  }
  const ticks = Math.max(12, Math.round((2 * Math.PI * s.r) / 7));
  c.beginPath();
  for (let i = 0; i < ticks; i += 1) {
    const a = (i * 2 * Math.PI) / ticks;
    c.moveTo(s.x + Math.cos(a) * (s.r + 1.4), s.y + Math.sin(a) * (s.r + 1.4));
    c.lineTo(s.x + Math.cos(a) * (s.r + 4.4), s.y + Math.sin(a) * (s.r + 4.4));
  }
  c.stroke();
  c.restore();
}

/** Where the scout is and how far it sees; `null` outside the queue. */
export interface Sight extends Point {
  readonly r: number;
  /** The scout is at the end of its road and waits. */
  readonly waiting: boolean;
  /** How far the scout has walked along `Story.scoutPath` (px): its trail. */
  readonly walked: number;
}

/** The scout of the search, and its sight widening to the enemy capital once a pair is found. */
export function sightOf(scene: Scene, story: Story, clock: MotionClock): Sight | null {
  if (clock.phase === 'idle' || clock.phase === 'banned') return null;
  const path = story.scoutPath;
  const length = lengthOf(path);
  const searching = clock.phase === 'search';
  const elapsed = clock.waited + (searching ? clock.t : 0);
  const d = searching ? Math.min(length, elapsed * SCOUT_SPEED * scene.scale) : length;
  const p = along(path, d);
  const base = Math.max(40, SIGHT * scene.scale);
  if (searching) return { x: p.x, y: p.y, r: base, waiting: d >= length, walked: d };
  const need = Math.hypot(scene.enemyCapital.x - p.x, scene.enemyCapital.y - p.y) + 40;
  const u = clock.reduced || clock.phase === 'confirmed' ? 1 : ease(clock.t / 1.2);
  return { x: p.x, y: p.y, r: base + (need - base) * u, waiting: false, walked: d };
}

/** Draws one frame of the motion into `c` (CSS px, the caller sets the device pixel transform). */
export function drawMotion(
  c: CanvasRenderingContext2D,
  k: Palette,
  scene: Scene,
  story: Story,
  clock: MotionClock,
  script: CaptureScript | null = null,
): void {
  const { phase, t, g, reduced } = clock;
  const scale = scene.scale;
  // The group gathering at the front city (no count over it: #866).
  const stack = (): void => {
    unit(c, k, { x: story.frontCity.x + 12, y: story.frontCity.y - 14 }, 0);
  };

  if (phase === 'banned') {
    supply(c, k, story, scale, 4.2, 0.45, true);
    stack();
    return;
  }
  // The captures of the loop go on behind every other phase (#866).
  if (script !== null) drawCaptures(c, k, scene, script, g, reduced);
  if (phase === 'idle') {
    supply(c, k, story, scale, g, 1, false);
    drills(c, k, story, scale, g);
    stack();
    return;
  }

  supply(c, k, story, scale, g, 0.7, false);
  const sight = sightOf(scene, story, clock);
  if (sight !== null && phase !== 'confirmed') {
    const trail = slice(story.scoutPath, 0, Math.max(0.1, sight.walked));
    c.save();
    c.globalAlpha = 0.35;
    c.strokeStyle = k.paper;
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    trace(c, trail);
    c.stroke();
    c.restore();
    const breathe = sight.waiting && !reduced ? 0.5 - 0.5 * Math.cos((g * Math.PI * 2) / 2.4) : 0.5;
    const fade = phase === 'found' ? 1 - (reduced ? 1 : ease(t / 1.2)) : 1;
    if (fade > 0) sightEdge(c, k, sight, (0.45 + 0.35 * breathe) * fade);
    unit(c, k, { x: sight.x, y: sight.y - 2 }, 0);
  }

  if (phase === 'search') {
    stack();
    return;
  }

  if (phase === 'found') {
    stack();
    const pulse = reduced ? 1 : clamp(t / 0.8, 0, 1);
    const shown = reduced ? 1 : ease(t / 0.6);
    order(c, k, story.entry, story.meeting, {
      side: 1,
      flash: 0,
      fixed: true,
      run: null,
      alpha: shown,
    });
    order(c, k, story.frontCity, story.meeting, {
      side: 0,
      flash: reduced ? 0 : Math.sin(Math.PI * pulse) ** 2,
      fixed: pulse >= 1,
      run: reduced ? null : (g * 20) % 13,
      alpha: 1,
    });
    target(c, k, story.meeting, { alpha: shown, run: reduced ? 0 : (g * 1.6) % 4 });
    return;
  }

  // Confirmed: both groups march to the meeting point (3 s), then the rounds.
  const march = reduced ? 1 : clamp(t / 3, 0, 1);
  if (march < 1) {
    for (const [side, from] of [
      [1, story.entry],
      [0, story.frontCity],
    ] as const) {
      order(c, k, from, story.meeting, {
        side,
        flash: 0,
        fixed: true,
        run: null,
        alpha: 1 - march,
      });
    }
    const own = arc(story.frontCity, story.meeting, 0.28);
    const enemy = [story.entry, story.meeting];
    unit(c, k, along(own, lengthOf(own) * ease(march) * 0.92), 0);
    unit(c, k, along(enemy, lengthOf(enemy) * ease(march) * 0.85), 1);
  } else {
    fight(c, k, story.meeting, reduced ? -1 : t - 3);
  }
}
