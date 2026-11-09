/**
 * The five fights of the opening scene (#839, intro B "Grain" of out-of-game-style-r3.html, its
 * first 2.75 s): on the dark stage, at staggered, irregular moments, a soft pool of light opens
 * over a road at the edges of the menu map; two small groups stand in it and three shots fly, then
 * the light fades from its edge to its centre. The pools are holes in the dark stage over the menu
 * map behind it (the map is lit to its full strength while they are up); the groups and the shots
 * are the match's Engraved pieces (`menuMotion.ts`). A pure function of the time, like the scene.
 *
 * Timings, places and sizes are the mockup's `TL.battles` (hand-set, deterministic); its artboard
 * is 1280 px wide with the menu map laid over it as `layoutEntry` lays it, so a size scales with
 * the scale of the map against the mockup's 1.6.
 */
import { drawHelmet, type Palette } from './menuMotion.ts';
import type { Point, Scene } from './menuScene.ts';

export interface Battle {
  /** The road it is on: two node ids of the menu map; the fight stands at its middle. */
  readonly between: readonly [number, number];
  /** Onset, then the lengths of the rise, the hold and the fade of the light (seconds). */
  readonly at: number;
  readonly rise: number;
  readonly hold: number;
  readonly fade: number;
  /** The radius of the light (mockup px) and its width against its height. */
  readonly radius: number;
  readonly sx: number;
  /** Who wins the three shots, and a nudge of the place down (mockup px). */
  readonly win: 'own' | 'enemy';
  readonly dy: number;
  /** When the three shots leave, after the onset. */
  readonly shots: readonly [number, number, number];
}

export const BATTLES: readonly Battle[] = [
  {
    between: [6, 0],
    at: 0.38,
    rise: 0.64,
    hold: 0.92,
    fade: 1.66,
    radius: 152,
    sx: 1.1,
    win: 'own',
    dy: -10,
    shots: [0.36, 0.7, 1.12],
  },
  {
    between: [18, 24],
    at: 0.97,
    rise: 0.82,
    hold: 0.5,
    fade: 2.08,
    radius: 188,
    sx: 0.92,
    win: 'enemy',
    dy: 8,
    shots: [0.44, 0.86, 1.04],
  },
  {
    between: [2, 7],
    at: 1.56,
    rise: 0.52,
    hold: 1.16,
    fade: 1.44,
    radius: 134,
    sx: 1.16,
    win: 'enemy',
    dy: 0,
    shots: [0.29, 0.8, 1.33],
  },
  {
    between: [17, 22],
    at: 2.19,
    rise: 0.7,
    hold: 0.71,
    fade: 1.9,
    radius: 168,
    sx: 0.98,
    win: 'own',
    dy: 0,
    shots: [0.38, 0.6, 0.98],
  },
  {
    between: [10, 5],
    at: 2.63,
    rise: 0.57,
    hold: 0.38,
    fade: 1.62,
    radius: 116,
    sx: 1.22,
    win: 'enemy',
    dy: -6,
    shots: [0.31, 0.55, 0.83],
  },
];

/** A shot flies this long. */
const SHOT_DUR = 0.17;
/** The scale of the menu map on the mockup's artboard: its sizes are in px at this scale. */
const MOCKUP_SCALE = 1.6;

const clamp = (v: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, v));
const easeOut = (p: number): number => 1 - (1 - p) ** 3;
/** Smootherstep: zero slope at both ends, so a light neither pops in nor snaps off. */
const soft = (p: number): number => {
  const x = clamp(p);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** The last moment a light is up. */
export const BATTLES_END = Math.max(...BATTLES.map((b) => b.at + b.rise + b.hold + b.fade));

/** The light of `b` at `t`: its radius (mockup px) and strength 0..1, or null when it is out. */
export function battleLight(b: Battle, t: number): { r: number; a: number } | null {
  const u = t - b.at;
  if (u <= 0) return null;
  if (u < b.rise) {
    const s = soft(u / b.rise);
    return { r: b.radius * (0.62 + 0.38 * s), a: s };
  }
  if (u < b.rise + b.hold) return { r: b.radius, a: 1 };
  const p = soft((u - b.rise - b.hold) / b.fade);
  if (p >= 1) return null;
  return { r: b.radius * (1 - 0.42 * p), a: 1 - p };
}

/** Where the fight of `b` stands on the screen, or null when the map has no such road. */
export function battlePlace(scene: Scene, b: Battle): Point | null {
  const a = scene.nodes.find((n) => n.id === b.between[0]);
  const c = scene.nodes.find((n) => n.id === b.between[1]);
  if (a === undefined || c === undefined) return null;
  const k = scene.scale / MOCKUP_SCALE;
  return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 + b.dy * k };
}

/** Whether any light is up at `t`. */
export function anyLight(t: number): boolean {
  return BATTLES.some((b) => battleLight(b, t) !== null);
}

/** A shot: a short etched streak of ink fading to its tail (the mockup's `drawShot`). */
function shot(c: CanvasRenderingContext2D, k: Palette, from: Point, to: Point, p: number): void {
  const x = from.x + (to.x - from.x) * p;
  const y = from.y + (to.y - from.y) * p;
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  c.save();
  c.lineCap = 'round';
  c.strokeStyle = k.casing;
  c.lineWidth = 3;
  c.globalAlpha *= 0.7;
  c.beginPath();
  c.moveTo(x - ux * 18, y - uy * 18);
  c.lineTo(x, y);
  c.stroke();
  c.restore();
  c.save();
  const g = c.createLinearGradient(x - ux * 18, y - uy * 18, x, y);
  g.addColorStop(0, 'rgba(236, 228, 209, 0)');
  g.addColorStop(1, 'rgba(236, 228, 209, 1)');
  c.strokeStyle = g;
  c.lineWidth = 1.6;
  c.beginPath();
  c.moveTo(x - ux * 18, y - uy * 18);
  c.lineTo(x, y);
  c.stroke();
  c.restore();
}

/** A hit: four short cut marks open out and fade (q 0..1 after the hit). */
function hit(c: CanvasRenderingContext2D, k: Palette, at: Point, q: number): void {
  if (q <= 0 || q >= 1) return;
  c.save();
  c.globalAlpha *= 1 - soft(q);
  c.strokeStyle = k.paper;
  c.lineWidth = 1.2;
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4;
    const r0 = 4 + easeOut(q) * 6;
    const r1 = r0 + 4;
    c.beginPath();
    c.moveTo(at.x + Math.cos(a) * r0, at.y + Math.sin(a) * r0);
    c.lineTo(at.x + Math.cos(a) * r1, at.y + Math.sin(a) * r1);
    c.stroke();
  }
  c.restore();
}

/** The two groups of `b` and its shots at `t`, `a` the strength of its light. */
function fight(
  c: CanvasRenderingContext2D,
  k: Palette,
  place: Point,
  b: Battle,
  t: number,
  a: number,
  size: number,
): void {
  const u = t - b.at;
  const own = { x: place.x - 30 * size, y: place.y + 4 * size };
  const enemy = { x: place.x + 30 * size, y: place.y - 4 * size };
  const winner = b.win;
  const loser = winner === 'own' ? 'enemy' : 'own';
  const units = { [winner]: 3, [loser]: 2 } as Record<'own' | 'enemy', number>;
  const charged = { ...units };
  const order = [winner, loser, winner] as const;
  const fx: (() => void)[] = [];
  b.shots.forEach((s, i) => {
    const shooter = order[i] ?? winner;
    const target = shooter === 'own' ? 'enemy' : 'own';
    const from = shooter === 'own' ? own : enemy;
    const to = target === 'own' ? own : enemy;
    const p = (u - s) / SHOT_DUR;
    if (p >= 1) charged[target] = Math.max(0, charged[target] - 1);
    if (p >= 0 && p < 1) {
      const start = { x: from.x + (to.x > from.x ? 14 : -14) * size, y: from.y - 2 * size };
      fx.push(() => {
        shot(c, k, start, to, easeOut(p));
      });
    }
    if (p >= 1) {
      fx.push(() => {
        hit(c, k, to, (u - s - SHOT_DUR) / 0.38);
      });
    }
  });
  const end = u - b.shots[2] - SHOT_DUR;
  const fading = end > 0 ? 1 - soft(end / 0.7) * 0.65 : 1;
  const width = 38 * size;
  drawHelmet(c, k, own, 0, {
    width,
    share: charged.own / units.own,
    alpha: a * (loser === 'own' ? fading : 1),
  });
  drawHelmet(c, k, enemy, 1, {
    width,
    share: charged.enemy / units.enemy,
    alpha: a * (loser === 'enemy' ? fading : 1),
  });
  c.save();
  c.globalAlpha *= a;
  for (const f of fx) f();
  c.restore();
}

/**
 * Draws the dark stage at `t` into `c` (CSS px, the caller sets the device pixel transform): the
 * dark everywhere but the pools of the lights, then the fights in them. Returns whether a light
 * was up.
 */
export function drawStage(
  c: CanvasRenderingContext2D,
  k: Palette,
  scene: Scene,
  t: number,
  dark: string,
): boolean {
  c.save();
  c.globalCompositeOperation = 'source-over';
  c.globalAlpha = 1;
  c.clearRect(0, 0, scene.width, scene.height);
  c.fillStyle = dark;
  c.fillRect(0, 0, scene.width, scene.height);
  const size = scene.scale / MOCKUP_SCALE;
  const lit: { b: Battle; place: Point; a: number }[] = [];
  // A soft elliptical pool per light: a long, even falloff, no hard rim (the mockup's stops).
  c.globalCompositeOperation = 'destination-out';
  for (const b of BATTLES) {
    const light = battleLight(b, t);
    const place = battlePlace(scene, b);
    if (light === null || place === null) continue;
    lit.push({ b, place, a: light.a });
    const r = light.r * size;
    c.save();
    c.translate(place.x, place.y);
    c.scale(b.sx, 1);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
    for (const [at, share] of [
      [0, 1],
      [0.3, 0.95],
      [0.55, 0.74],
      [0.78, 0.34],
      [0.92, 0.09],
      [1, 0],
    ] as const) {
      g.addColorStop(at, `rgba(0, 0, 0, ${String(light.a * share)})`);
    }
    c.fillStyle = g;
    c.fillRect(-r, -r, r * 2, r * 2);
    c.restore();
  }
  c.globalCompositeOperation = 'source-over';
  for (const { b, place, a } of lit) fight(c, k, place, b, t, a, size);
  c.restore();
  return lit.length > 0;
}
