/**
 * The motion behind the start menu (#474, BG5 "Set" of docs/design/mockups/menu-background.html): a
 * scripted decoration drawn on one 2D canvas. Nothing here is the game: no simulation, no server,
 * no rule. The pieces borrow the looks of the match map (a supply packet, a unit triangle, the
 * planned order ODb, the opponent's intent IN3, the shot tracer SH1) and move along the roads of the
 * menu map on a fixed script that depends only on the clock:
 *
 * - idle and from found on, BG1 "Living front": supply packets ride from the capital to the own
 *   cities, a recruit leaves the capital every 11 s, a group walks an own road; once a pair is found
 *   the own order and the opponent's intent meet in the middle city; once confirmed the two groups
 *   march there and fight in rounds of 2 s;
 * - searching, the BG2 scout: it walks the front road into the fog and waits at its edge; its sight
 *   is a hole in the fog (`sightOf`), cut by the fog layer, not drawn here;
 * - queue locked: the supply stands, dimmed.
 */
import type { BackdropPhase, Point, Scene } from './menuScene.ts';
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
}

export const FALLBACK_PALETTE: Palette = {
  bg: '#0d1117',
  paper: '#f0f6fc',
  dim: '#9da7b3',
  you: '#5b9bff',
  enemy: '#e5484d',
};

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

function ring(
  c: CanvasRenderingContext2D,
  p: Point,
  r: number,
  colour: string,
  width: number,
  alpha: number,
  dash: readonly number[] = [],
): void {
  c.save();
  c.globalAlpha *= alpha;
  c.beginPath();
  c.arc(p.x, p.y, Math.max(0.1, r), 0, Math.PI * 2);
  c.strokeStyle = colour;
  c.lineWidth = width;
  c.setLineDash(dash);
  c.stroke();
  c.restore();
}

/** A unit triangle of the match map: filled when charged, a count next to a stack. */
function unit(
  c: CanvasRenderingContext2D,
  k: Palette,
  p: Point,
  side: 0 | 1,
  alpha = 1,
  count = 0,
): void {
  const colour = side === 0 ? k.you : k.enemy;
  c.save();
  c.globalAlpha *= alpha;
  c.beginPath();
  c.moveTo(p.x - 7, p.y - 5.5);
  c.lineTo(p.x + 7, p.y - 5.5);
  c.lineTo(p.x, p.y + 7);
  c.closePath();
  c.lineJoin = 'round';
  c.lineWidth = 4;
  c.strokeStyle = 'rgba(13, 17, 23, 0.85)';
  c.stroke();
  c.fillStyle = colour;
  c.fill();
  c.lineWidth = 1.6;
  c.strokeStyle = k.paper;
  c.stroke();
  if (count > 1) {
    c.font = '700 10px system-ui, sans-serif';
    c.lineWidth = 3;
    c.strokeStyle = k.bg;
    c.fillStyle = k.paper;
    c.strokeText(`×${String(count)}`, p.x + 9, p.y + 3);
    c.fillText(`×${String(count)}`, p.x + 9, p.y + 3);
  }
  c.restore();
}

/** A supply packet: a square with a short tail of two fading squares. */
function packet(c: CanvasRenderingContext2D, k: Palette, p: At, alpha: number): void {
  const dx = Math.cos(p.angle);
  const dy = Math.sin(p.angle);
  c.save();
  for (const [back, size, a] of [
    [14, 4, 0.3],
    [8, 5, 0.6],
  ] as const) {
    c.globalAlpha = alpha * a;
    c.fillStyle = k.you;
    c.fillRect(p.x - dx * back - size / 2, p.y - dy * back - size / 2, size, size);
  }
  c.globalAlpha = alpha;
  c.fillStyle = k.you;
  c.strokeStyle = k.bg;
  c.lineWidth = 1.4;
  c.fillRect(p.x - 3.5, p.y - 3.5, 7, 7);
  c.strokeRect(p.x - 3.5, p.y - 3.5, 7, 7);
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
      ring(c, route[route.length - 1] as Point, 11 + 3 * u, k.you, 1.6, (1 - u) * alpha);
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
    ring(c, capital, 18 + 8 * ease(s / 1.2), k.you, 1.5, 1 - s / 1.2);
    unit(c, k, { x: capital.x + 14, y: capital.y - 16 }, 0, clamp(s / 0.3, 0, 1));
  } else {
    const d = (s - 1.2) * speed;
    const end = route[route.length - 1] as Point;
    if (d <= length) unit(c, k, along(route, d), 0);
    else if (d <= length + 18)
      unit(c, k, { x: end.x + 10, y: end.y - 12 }, 0, 1 - (d - length) / 18);
  }
}

/** The planned order ODb ("Low relief", smaller for the menu): a ribbon with a head on one outline. */
function order(
  c: CanvasRenderingContext2D,
  k: Palette,
  from: Point,
  to: Point,
  o: {
    readonly flash: number;
    readonly fixed: boolean;
    readonly run: number | null;
    readonly alpha: number;
  },
): void {
  const full = arc(from, to, 0.28);
  const total = lengthOf(full);
  const path = slice(full, 14, total - 12);
  const length = lengthOf(path);
  const head = 17;
  const halfHead = 11;
  const left: Point[] = [];
  const right: Point[] = [];
  const steps = 36;
  for (let i = 0; i <= steps; i += 1) {
    const d = ((length - head) * i) / steps;
    const p = along(path, d);
    const w = (9 * (0.6 + 0.4 * clamp(d / (length * 0.35), 0, 1))) / 2;
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    left.push({ x: p.x + nx * w, y: p.y + ny * w });
    right.push({ x: p.x - nx * w, y: p.y - ny * w });
  }
  const base = along(path, length - head);
  const tip = along(path, length);
  const nx = -Math.sin(base.angle);
  const ny = Math.cos(base.angle);
  const outline = [
    ...left,
    { x: base.x + nx * halfHead, y: base.y + ny * halfHead },
    tip,
    { x: base.x - nx * halfHead, y: base.y - ny * halfHead },
    ...right.reverse(),
  ];
  const shape = (): void => {
    trace(c, outline);
    c.closePath();
  };
  c.save();
  c.globalAlpha = o.alpha;
  c.lineJoin = 'round';
  shape();
  c.fillStyle = 'rgba(13, 17, 23, 0.96)';
  c.fill();
  c.lineWidth = 6;
  c.strokeStyle = 'rgba(13, 17, 23, 0.45)';
  c.stroke();
  c.globalAlpha = o.alpha * 0.55;
  c.fillStyle = k.you;
  c.fill();
  if (o.flash > 0) {
    c.globalAlpha = o.alpha * 0.5 * o.flash;
    c.fillStyle = '#fff';
    c.fill();
  }
  c.globalAlpha = o.alpha * 0.95;
  c.lineWidth = o.fixed ? 3.2 : 2.2;
  c.strokeStyle = k.you;
  if (o.run !== null) {
    c.setLineDash([8, 5]);
    c.lineDashOffset = -o.run;
  }
  c.stroke();
  c.restore();
}

/** The opponent's intent IN3 "Crosshair": a thin dashed arrow, a small head, a crosshair on the target. */
function intent(
  c: CanvasRenderingContext2D,
  k: Palette,
  from: Point,
  to: Point,
  o: { readonly alpha: number; readonly run: number; readonly pulse: number },
): void {
  const target = 16;
  const full = arc(from, to, 0.28);
  const path = slice(full, 10, lengthOf(full) - target - 3);
  c.save();
  c.globalAlpha = o.alpha;
  c.lineCap = 'round';
  trace(c, path);
  c.strokeStyle = 'rgba(13, 17, 23, 0.7)';
  c.lineWidth = 4.5;
  c.stroke();
  c.strokeStyle = k.enemy;
  c.lineWidth = 1.8;
  c.setLineDash([9, 5]);
  c.lineDashOffset = -o.run;
  c.stroke();
  c.setLineDash([]);
  const head = along(path, lengthOf(path));
  c.translate(head.x, head.y);
  c.rotate(head.angle);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(-9, -5);
  c.lineTo(-9, 5);
  c.closePath();
  c.fillStyle = k.enemy;
  c.fill();
  c.restore();
  c.save();
  c.globalAlpha = o.alpha;
  ring(c, to, target, k.bg, 4.5, 0.7);
  ring(c, to, target, k.enemy, 1.8, 1);
  ring(c, to, target - 6, k.enemy, 1.2, 0.9);
  c.strokeStyle = k.enemy;
  c.lineWidth = 1.6;
  for (let q = 0; q < 4; q += 1) {
    const a = (q * Math.PI) / 2;
    c.beginPath();
    c.moveTo(to.x + Math.cos(a) * (target - 3), to.y + Math.sin(a) * (target - 3));
    c.lineTo(to.x + Math.cos(a) * (target + 4), to.y + Math.sin(a) * (target + 4));
    c.stroke();
  }
  ring(c, to, target + 3, k.enemy, 5 + 3 * o.pulse, 0.15 + 0.35 * o.pulse);
  c.restore();
}

/** A shot (SH1): a curved tracer with a square head, the opponent's with a dark core. */
function tracer(
  c: CanvasRenderingContext2D,
  k: Palette,
  from: Point,
  to: Point,
  u: number,
  side: 0 | 1,
): void {
  const path = arc(from, to, 0.35, 24);
  const d = lengthOf(path) * clamp(u, 0, 1);
  const tail = Math.min(d, 28);
  const colour = side === 0 ? k.you : k.enemy;
  c.save();
  c.lineCap = 'round';
  for (let i = 0; i < 6; i += 1) {
    const s0 = d - (tail * (i + 1)) / 6;
    const s1 = d - (tail * i) / 6;
    if (s0 < 0) continue;
    const p0 = along(path, s0);
    const p1 = along(path, s1);
    c.globalAlpha = 0.8 * (1 - i / 6);
    c.beginPath();
    c.moveTo(p0.x, p0.y);
    c.lineTo(p1.x, p1.y);
    c.strokeStyle = colour;
    c.lineWidth = 2.6 - i * 0.3;
    c.stroke();
  }
  const h = along(path, d);
  c.globalAlpha = 1;
  c.fillStyle = colour;
  c.strokeStyle = side === 0 ? k.bg : k.paper;
  c.lineWidth = 1.2;
  c.fillRect(h.x - 3, h.y - 3, 6, 6);
  c.strokeRect(h.x - 3, h.y - 3, 6, 6);
  if (side === 1) {
    c.fillStyle = k.bg;
    c.fillRect(h.x - 1, h.y - 1, 2, 2);
  }
  c.restore();
}

/** A unit hit by a shot: four shards fly off, "−1" rises. */
function shatter(c: CanvasRenderingContext2D, k: Palette, p: Point, u: number, side: 0 | 1): void {
  c.save();
  c.fillStyle = side === 0 ? k.you : k.enemy;
  for (let i = 0; i < 4; i += 1) {
    const a = -Math.PI / 2 + (i - 1.5) * 0.7;
    const d = 6 + 16 * ease(u);
    c.globalAlpha = 1 - u;
    c.save();
    c.translate(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d + 8 * u * u);
    c.rotate(u * 3 + i);
    c.beginPath();
    c.moveTo(-3, -2);
    c.lineTo(3, -2);
    c.lineTo(0, 3);
    c.closePath();
    c.fill();
    c.restore();
  }
  c.globalAlpha = 1 - u;
  c.font = '700 12px system-ui, sans-serif';
  c.lineWidth = 3;
  c.strokeStyle = k.bg;
  c.fillStyle = k.paper;
  c.strokeText('−1', p.x + 8, p.y - 10 - 12 * u);
  c.fillText('−1', p.x + 8, p.y - 10 - 12 * u);
  c.restore();
}

/** The fight in the middle city: rounds of 2 s; every third round the two shots cancel, else one kills. */
function fight(c: CanvasRenderingContext2D, k: Palette, at: Point, t: number): void {
  const a = { x: at.x - 15, y: at.y - 2 };
  const b = { x: at.x + 15, y: at.y - 2 };
  ring(c, at, 26, k.paper, 1.2, 0.35, [3, 4]);
  unit(c, k, a, 0);
  unit(c, k, b, 1);
  if (t < 0) return;
  const r = Math.floor(t / ROUND);
  const u = t - r * ROUND;
  if (r % 3 === 0) {
    const f = clamp((u - 0.35) / 0.3, 0, 1);
    if (u > 0.35 && u < 0.65) {
      tracer(c, k, a, b, f * 0.5, 0);
      tracer(c, k, b, a, f * 0.5, 1);
    }
    if (u >= 0.65 && u < 1.1) {
      const q = (u - 0.65) / 0.45;
      const mx = (a.x + b.x) / 2;
      const my = Math.min(a.y, b.y) - 6;
      c.save();
      c.globalAlpha = 1 - q;
      c.strokeStyle = k.paper;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(mx - 4, my - 4);
      c.lineTo(mx + 4, my + 4);
      c.moveTo(mx + 4, my - 4);
      c.lineTo(mx - 4, my + 4);
      c.stroke();
      c.restore();
    }
    return;
  }
  const side: 0 | 1 = r % 2 === 0 ? 0 : 1;
  const from = side === 0 ? a : b;
  const to = side === 0 ? b : a;
  if (u > 0.35 && u < 0.95) tracer(c, k, from, to, (u - 0.35) / 0.6, side);
  if (u >= 0.95 && u < 1.95) shatter(c, k, to, u - 0.95, side === 0 ? 1 : 0);
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
): void {
  const { phase, t, g, reduced } = clock;
  const scale = scene.scale;
  const stack = (count: number): void => {
    unit(c, k, { x: story.frontCity.x + 12, y: story.frontCity.y - 14 }, 0, 1, count);
  };

  if (phase === 'banned') {
    supply(c, k, story, scale, 4.2, 0.45, true);
    stack(2);
    return;
  }
  if (phase === 'idle') {
    supply(c, k, story, scale, g, 1, false);
    drills(c, k, story, scale, g);
    stack(2);
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
    if (fade > 0) ring(c, sight, sight.r, k.paper, 1.2, (0.25 + 0.25 * breathe) * fade, [3, 5]);
    unit(c, k, { x: sight.x, y: sight.y - 2 }, 0);
  }

  if (phase === 'search') {
    stack(Math.min(9, 2 + Math.floor((clock.waited + t) / 12)));
    return;
  }

  if (phase === 'found') {
    stack(6);
    const pulse = reduced ? 1 : clamp(t / 0.8, 0, 1);
    order(c, k, story.frontCity, story.meeting, {
      flash: reduced ? 0 : Math.sin(Math.PI * pulse) ** 2,
      fixed: pulse >= 1,
      run: reduced ? null : (g * 20) % 13,
      alpha: 1,
    });
    intent(c, k, story.entry, story.meeting, {
      alpha: reduced ? 1 : ease(t / 0.6),
      run: reduced ? 0 : (g * 28) % 14,
      pulse: reduced ? 0.5 : 0.5 - 0.5 * Math.cos((g * Math.PI * 2) / 0.8),
    });
    return;
  }

  // Confirmed: both groups march to the meeting point (3 s), then the rounds.
  const march = reduced ? 1 : clamp(t / 3, 0, 1);
  if (march < 1) {
    order(c, k, story.frontCity, story.meeting, {
      flash: 0,
      fixed: true,
      run: null,
      alpha: 1 - march,
    });
    const own = arc(story.frontCity, story.meeting, 0.28);
    const enemy = [story.entry, story.meeting];
    unit(c, k, along(own, lengthOf(own) * ease(march) * 0.92), 0, 1, 6);
    unit(c, k, along(enemy, lengthOf(enemy) * ease(march) * 0.85), 1);
  } else {
    fight(c, k, story.meeting, reduced ? -1 : t - 3);
  }
}
