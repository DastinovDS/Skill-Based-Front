/**
 * The particle core of the map effects (ui-style 20, item 7; 22; 27, 29; #351): two built-in
 * `ParticleContainer`s for every effect of every fight (one normal, one additive: the blend mode
 * belongs to a container), one atlas of baked white shapes that a particle tints, no filters.
 * The shots of #352 use the same core: the four heads of a tracer (a square or a diamond, own or the
 * opponent's) are more frames of the atlas, baked in the colours of the sides and drawn untinted.
 *
 * Nothing here knows about fights. A frame is `begin()`, any number of `put()`, `end()`; the
 * particles are pooled (a fixed number, the surplus of a frame is dropped) and a particle that is
 * not put in a frame is hidden, so nothing is created per frame and `destroy()` frees it all.
 *
 * The pure half (`rnd`, `burst`) makes the position of a particle a function of the progress of its
 * effect, so a paused or frozen scene shows a burst in the state of its tick and nothing is stored.
 */
import { Container, Particle, ParticleContainer, ParticleShader, Rectangle, Texture } from 'pixi.js';
import type { Point } from './camera.ts';
import { BG, ENEMY, PAPER, PLATE_FILL, YOU } from './style.ts';

/**
 * What a particle looks like. Baked white (a tint colours it): the form says what it is, not the hue.
 * The four heads are the exception: a head of a shot (ui-style 29.1) is a real shot, a filled square
 * ■ (the charge, ui-style 21), or a bonus one, a hollow diamond ◇, in the colour of its side with
 * the second, dark (square) or light (diamond) contour of the opponent; baked in colour, tint white.
 */
export type HeadKind = 'headOwn' | 'headEnemy' | 'headOwnBonus' | 'headEnemyBonus';
export type ParticleKind =
  'dot' | 'square' | 'triangle' | 'diamond' | 'ring' | 'dashRing' | 'cross' | 'glow' | HeadKind;

/** The colours of the two sides, for the heads of the shots. */
export interface SideColors {
  readonly own: number;
  readonly enemy: number;
}

/** The head of a shot of a side: a square, or a diamond for a bonus shot. */
export function headKind(side: 'own' | 'enemy', bonus: boolean): HeadKind {
  if (side === 'own') return bonus ? 'headOwnBonus' : 'headOwn';
  return bonus ? 'headEnemyBonus' : 'headEnemy';
}

/** A particle of a frame: `size` is the width of its shape in world units, `aspect` stretches the height. */
export interface ParticleSpec {
  readonly kind: ParticleKind;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color: number;
  readonly alpha: number;
  readonly add?: boolean;
  readonly rotation?: number;
  /** Height over width, 1 by default (a ray is a thin square). */
  readonly aspect?: number;
}

export type Emit = (particle: ParticleSpec) => void;

// --- Pure: where a burst of particles is at a progress ------------------------------------------------

/** A repeatable number in [0, 1) from an index and a seed (no random generator: a frame is a function of the tick). */
export function rnd(index: number, seed: number): number {
  const x = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export interface BurstOptions {
  readonly x: number;
  readonly y: number;
  /** Progress of the burst, 0..1; nothing is emitted outside [0, 1). */
  readonly p: number;
  readonly count: number;
  /** How far a particle flies by the end (world units, before the nominal spread of 0.45..1.25). */
  readonly speed: number;
  /** A cone: its direction (radians) and its width; without it the burst goes all round. */
  readonly cone?: readonly [number, number];
  /** How far gravity pulls a particle down by the end, and how far it floats up. */
  readonly fall?: number;
  readonly rise?: number;
  readonly colors: readonly number[];
  /** Width of a particle at the start; it shrinks by 45% by the end. */
  readonly size: number;
  readonly kind: ParticleKind;
  /** Turns over the whole burst, radians. */
  readonly spin?: number;
  /** Alpha is `(1 - p) ** fade`. */
  readonly fade?: number;
  readonly add?: boolean;
  readonly seed: number;
}

/** Emits the particles of a burst at progress `o.p`: ease-out flight, shrinking, fading, the same every frame of a tick. */
export function burst(emit: Emit, o: BurstOptions): void {
  if (o.p < 0 || o.p >= 1 || o.colors.length === 0) return;
  const ease = 1 - (1 - o.p) * (1 - o.p);
  for (let j = 0; j < o.count; j++) {
    const angle = o.cone
      ? o.cone[0] + (rnd(j, o.seed) - 0.5) * o.cone[1]
      : rnd(j, o.seed) * 2 * Math.PI;
    const reach = o.speed * (0.45 + 0.8 * rnd(j, o.seed + 3));
    emit({
      kind: o.kind,
      x: o.x + Math.cos(angle) * reach * ease,
      y: o.y + Math.sin(angle) * reach * ease + (o.fall ?? 0) * o.p * o.p - (o.rise ?? 0) * ease,
      size: o.size * (1 - 0.45 * o.p) * (0.7 + 0.6 * rnd(j, o.seed + 6)),
      color: o.colors[j % o.colors.length] ?? 0xffffff,
      alpha: Math.pow(1 - o.p, o.fade ?? 1),
      rotation: rnd(j, o.seed + 9) * 2 * Math.PI + (o.spin ?? 0) * o.p,
      add: o.add === true,
    });
  }
}

/** A thin ray from `r0` to `r1` out of `centre` at `angle`: a stretched square. */
export function ray(
  centre: Point,
  angle: number,
  r0: number,
  r1: number,
  width: number,
  color: number,
  alpha: number,
): ParticleSpec {
  const length = Math.max(0, r1 - r0);
  const mid = (r0 + r1) / 2;
  return {
    kind: 'square',
    x: centre.x + Math.cos(angle) * mid,
    y: centre.y + Math.sin(angle) * mid,
    size: length,
    aspect: length > 0 ? width / length : 1,
    color,
    alpha,
    rotation: angle,
  };
}

// --- The atlas ----------------------------------------------------------------------------------------

/** Side of a cell of the atlas, px; a shape fills it up to a margin that keeps neighbours apart. */
const CELL = 64;
const SHAPES: readonly ParticleKind[] = [
  'dot',
  'square',
  'triangle',
  'diamond',
  'ring',
  'dashRing',
  'cross',
  'glow',
  'headOwn',
  'headEnemy',
  'headOwnBonus',
  'headEnemyBonus',
];
const COLUMNS = 4;

const css = (color: number): string => `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;

function drawHead(c: CanvasRenderingContext2D, kind: HeadKind, colors: SideColors): void {
  const m = CELL / 2;
  const enemy = kind === 'headEnemy' || kind === 'headEnemyBonus';
  const color = css(enemy ? colors.enemy : colors.own);
  c.lineJoin = 'round';
  if (kind === 'headOwn' || kind === 'headEnemy') {
    // The charge: a filled square with a light contour; the opponent's has a second, dark one inside,
    // the own one a light patch (so the side reads without the hue).
    const half = 25;
    c.fillStyle = color;
    c.strokeStyle = css(PAPER);
    c.lineWidth = 6;
    c.fillRect(m - half, m - half, 2 * half, 2 * half);
    c.strokeRect(m - half, m - half, 2 * half, 2 * half);
    if (enemy) {
      c.strokeStyle = css(BG);
      c.lineWidth = 4;
      c.strokeRect(m - half + 9, m - half + 9, 2 * half - 18, 2 * half - 18);
    } else {
      c.fillStyle = 'rgba(255,255,255,0.55)';
      c.fillRect(m - half + 5, m - half + 5, half * 0.8, half * 0.8);
    }
    return;
  }
  // The bonus shot: a hollow diamond (dark inside, so it reads over the road), the opponent's with a second light contour.
  const r = CELL / 2 - 4;
  const diamond = (k: number): void => {
    c.beginPath();
    c.moveTo(m, m - r * k);
    c.lineTo(m + r * k, m);
    c.lineTo(m, m + r * k);
    c.lineTo(m - r * k, m);
    c.closePath();
  };
  diamond(1);
  c.fillStyle = css(PLATE_FILL);
  c.fill();
  c.strokeStyle = color;
  c.lineWidth = 8;
  c.stroke();
  if (enemy) {
    diamond(0.5);
    c.strokeStyle = css(PAPER);
    c.lineWidth = 4;
    c.stroke();
  }
}

function drawShape(c: CanvasRenderingContext2D, kind: ParticleKind, colors: SideColors): void {
  if (
    kind === 'headOwn' ||
    kind === 'headEnemy' ||
    kind === 'headOwnBonus' ||
    kind === 'headEnemyBonus'
  ) {
    drawHead(c, kind, colors);
    return;
  }
  const m = CELL / 2;
  const r = CELL / 2 - 3;
  c.fillStyle = '#fff';
  c.strokeStyle = '#fff';
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.beginPath();
  switch (kind) {
    case 'dot':
      c.arc(m, m, r, 0, 2 * Math.PI);
      c.fill();
      break;
    case 'square':
      c.fillRect(m - r, m - r, 2 * r, 2 * r);
      break;
    case 'triangle':
      // The inverted triangle of a unit (ui-style 21): a shard of a unit that died.
      c.moveTo(m - r, m - r * 0.88);
      c.lineTo(m + r, m - r * 0.88);
      c.lineTo(m, m + r * 0.88);
      c.closePath();
      c.fill();
      break;
    case 'diamond':
      // Hollow: the bonus shot (ui-style 21).
      c.lineWidth = 7;
      c.moveTo(m, m - r + 3);
      c.lineTo(m + r - 3, m);
      c.lineTo(m, m + r - 3);
      c.lineTo(m - r + 3, m);
      c.closePath();
      c.stroke();
      break;
    case 'ring':
      c.lineWidth = 5;
      c.arc(m, m, r - 3, 0, 2 * Math.PI);
      c.stroke();
      break;
    case 'dashRing': {
      c.lineWidth = 5;
      c.lineCap = 'butt';
      const dashes = 14;
      for (let i = 0; i < dashes; i++) {
        const from = (i / dashes) * 2 * Math.PI;
        c.beginPath();
        c.arc(m, m, r - 3, from, from + (Math.PI * 2) / dashes / 2);
        c.stroke();
      }
      break;
    }
    case 'cross':
      c.lineWidth = 7;
      c.moveTo(m - r + 6, m - r + 6);
      c.lineTo(m + r - 6, m + r - 6);
      c.moveTo(m + r - 6, m - r + 6);
      c.lineTo(m - r + 6, m + r - 6);
      c.stroke();
      break;
    case 'glow': {
      const g = c.createRadialGradient(m, m, 0, m, m, r + 3);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.arc(m, m, r + 3, 0, 2 * Math.PI);
      c.fill();
      break;
    }
  }
}

/** The shapes of every kind as frames of one texture; without a canvas (tests) every frame is a white pixel. */
function bakeAtlas(colors: SideColors): {
  base: Texture;
  frames: Readonly<Record<ParticleKind, Texture>>;
} {
  const rows = Math.ceil(SHAPES.length / COLUMNS);
  // No canvas in a test (jsdom has none and says so on every try): white pixels instead of the shapes.
  const canvas =
    typeof document === 'undefined' || /jsdom/i.test(navigator.userAgent)
      ? null
      : document.createElement('canvas');
  const c = canvas?.getContext('2d') ?? null;
  if (canvas === null || c === null) {
    const frames = Object.fromEntries(SHAPES.map((k) => [k, Texture.WHITE])) as Record<
      ParticleKind,
      Texture
    >;
    return { base: Texture.WHITE, frames };
  }
  canvas.width = COLUMNS * CELL;
  canvas.height = rows * CELL;
  SHAPES.forEach((kind, i) => {
    c.save();
    c.translate((i % COLUMNS) * CELL, Math.floor(i / COLUMNS) * CELL);
    drawShape(c, kind, colors);
    c.restore();
  });
  const base = Texture.from(canvas);
  const frames = {} as Record<ParticleKind, Texture>;
  SHAPES.forEach((kind, i) => {
    frames[kind] = new Texture({
      source: base.source,
      frame: new Rectangle((i % COLUMNS) * CELL, Math.floor(i / COLUMNS) * CELL, CELL, CELL),
    });
  });
  return { base, frames };
}

// --- The pooled layer ---------------------------------------------------------------------------------

/** Particles a container holds at most; the surplus of a frame is dropped (3 fights need about 100). */
export const PARTICLE_CAPACITY = 256;

interface Pool {
  readonly container: ParticleContainer;
  readonly particles: Particle[];
  used: number;
  /** How many were visible last frame: only those are hidden when a frame uses fewer. */
  shown: number;
}

/**
 * Two particle containers over one atlas, in `parent`: normal blending and additive blending.
 * `put()` draws a particle of the frame into the right one, and `end()` hides what is left.
 */
export class ParticleLayer {
  private readonly atlas: ReturnType<typeof bakeAtlas>;
  private readonly normal: Pool;
  private readonly additive: Pool;
  private readonly root = new Container({ label: 'particles' });

  constructor(parent: Container, colors: SideColors = { own: YOU, enemy: ENEMY }) {
    this.atlas = bakeAtlas(colors);
    this.normal = this.pool('particles-normal', false);
    this.additive = this.pool('particles-add', true);
    parent.addChild(this.root);
  }

  private pool(label: string, add: boolean): Pool {
    const container = new ParticleContainer({
      label,
      texture: this.atlas.base,
      // Everything moves, scales, turns, fades and changes shape from frame to frame.
      dynamicProperties: { position: true, vertex: true, rotation: true, color: true, uvs: true },
      blendMode: add ? 'add' : 'normal',
      // Its own shader, destroyed with the container: the renderer's shared particle shader would
      // keep the atlas bound after the layer is gone, and destroying the atlas then warns (#600).
      shader: new ParticleShader(),
    });
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_CAPACITY; i++) {
      const particle = new Particle({
        texture: this.atlas.frames.dot,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: 0,
        scaleY: 0,
        alpha: 0,
      });
      particles.push(particle);
      container.addParticle(particle);
    }
    this.root.addChild(container);
    return { container, particles, used: 0, shown: 0 };
  }

  begin(): void {
    this.normal.used = 0;
    this.additive.used = 0;
  }

  put(spec: ParticleSpec): void {
    const pool = spec.add === true ? this.additive : this.normal;
    const particle = pool.particles[pool.used];
    if (particle === undefined || spec.alpha <= 0.004 || spec.size <= 0.1) return;
    pool.used++;
    const scale = spec.size / CELL;
    particle.texture = this.atlas.frames[spec.kind];
    particle.x = spec.x;
    particle.y = spec.y;
    particle.scaleX = scale;
    particle.scaleY = scale * (spec.aspect ?? 1);
    particle.rotation = spec.rotation ?? 0;
    particle.tint = spec.color;
    particle.alpha = Math.min(1, spec.alpha);
  }

  end(): void {
    for (const pool of [this.normal, this.additive]) {
      for (let i = pool.used; i < pool.shown; i++) {
        const particle = pool.particles[i];
        if (particle === undefined) continue;
        particle.scaleX = 0;
        particle.scaleY = 0;
        particle.alpha = 0;
      }
      pool.shown = pool.used;
    }
  }

  /** How many particles the last frame drew, by blending (tests and the dev tools). */
  count(): { normal: number; additive: number } {
    return { normal: this.normal.used, additive: this.additive.used };
  }

  destroy(): void {
    this.root.destroy({ children: true });
    // The frames share the source of the base texture; the base goes last.
    for (const kind of SHAPES) {
      const frame = this.atlas.frames[kind];
      if (frame !== Texture.WHITE) frame.destroy(false);
    }
    if (this.atlas.base !== Texture.WHITE) this.atlas.base.destroy(true);
  }
}
