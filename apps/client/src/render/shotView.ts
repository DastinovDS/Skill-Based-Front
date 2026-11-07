import { Container, Graphics } from 'pixi.js';
import type { BakedSprite, SpriteCache } from './bake.ts';
import { octagramSpec } from './bakedShapes.ts';
import { easeOutCubic } from './tween.ts';
import type { PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { lighten, type FightPlace, type RoundFx } from './fightFx.ts';
import { fxSeed, impactsOf, type Contacts, type Side } from './fightImpact.ts';
import { dashAlong } from './intentLayout.ts';
import { burst, headKind, type Emit } from './particles.ts';
import {
  GLOW_SPOT_COUNT,
  OCTA_POP,
  TAIL_SEGMENTS,
  TRACER_END_SHARE,
  arcAt,
  brightness,
  octaAngles,
  pathPoints,
  shotPhase,
  shotsOf,
  sparksOf,
  tailFactor,
  tailOutline,
  type Shot,
} from './shotLayout.ts';
import { BG, FIGHT_FX_STRENGTH, FLASH_COLOR, ownerColor } from './style.ts';

/** Shots drawn at once at most: two sides of each of the eight arenas (`FightView`). */
const MAX_SHOTS = 16;
/** How wide the glow of a tail is, and the width of its white (opponent: dark) core, world units at 100%. */
const GLOW_WIDTH = 8;
const CORE_WIDTH = 1.3;
/**
 * Size of a head (the width of the atlas cell, world units at 100%) and of the glow behind it. The baked square
 * fills 56 of the 64 px of its cell: 20 px, the least of a significant symbol (ui-style 22).
 */
const HEAD_SIZE = 23;
const HEAD_GLOW = 2 * 1.4 * 14;
/** The width of the faded path. */
const PATH_WIDTH = { real: 2.2, bonus: 1.6 } as const;
/** How much wider than the tail its dark underlay is, world units at 100%. */
const UNDERLAY_PAD = 4;
const UNDERLAY_ALPHA = 0.5;
/** The tail is this opaque at the head, and the share of that at its tail end; how much lighter than its colour the head end is. */
const TAIL_ALPHA = 0.95;
const TAIL_FLOOR = 0.25;
const TAIL_HOT = 0.35;
/** The glow along a tail: this many soft additive spots, as far apart as this share of the path. */
const GLOW_STEP = 0.11;

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/**
 * The tracers of the map (shot style 1, ui-style 29.1, 29.4; #352): the curved comets of the shots of the rounds
 * that are still playing. A real shot has a solid tail that tapers (eight segments, each a little more
 * opaque than the one behind it, over a dark underlay) with a white core (the opponent's: dark), a glow
 * along it and a head that is a square ■; a bonus shot has the same tail and a head of two squares, one turned 45 degrees
 * and the two turning against each other, with a small one in the middle (#812, "Octagram"; the chevron is
 * the static badge of the unit, not a projectile). Two shots that meet bend round each other and end in the middle. After the hit
 * the path stays and fades as an arc, it is not cut off.
 *
 * The tails are pooled `Graphics` (one per shot, redrawn while the shot is in the air: its shape
 * changes every frame), each drawn in the frame of its own path (rotated along it). The fade of the tail
 * is the alpha of its segments, not a `FillGradient`: the prototype of #352 (PR description) found the
 * gradient cheap and CSP-safe on a test page, but the gradient polygon did not show in the app next to
 * the particle containers, and a texture-free fill needs no cause found. The heads, glows, sparks and
 * squares of a bonus head are particles of the shared `ParticleLayer` (`emit`), no filters. Everything is a function of the render tick and of the
 * fields of `fight_round` (shots, virtual shots, losses): a paused scene shows a round in the state of that
 * tick, nothing is decided here (AGENTS.md 7.1). `destroy()` frees the pool.
 */
export class ShotView {
  private readonly layer = new Container({ label: 'fight-tracers' });
  private readonly tails: Graphics[] = [];
  /** The head of a bonus shot: two baked squares per shot, pooled like the tails (#812). */
  private readonly headLayer = new Container({ label: 'fight-bonus-heads' });
  private readonly heads: { outer: BakedSprite; inner: BakedSprite }[] = [];
  private readonly colors: Readonly<Record<Side, number>>;

  constructor(
    parent: Container,
    private readonly me: PlayerId,
    private readonly sprites: SpriteCache,
  ) {
    const enemy: PlayerId = me === 0 ? 1 : 0;
    this.colors = { own: ownerColor(me, me), enemy: ownerColor(me, enemy) };
    parent.addChild(this.layer, this.headLayer);
  }

  /** Puts the heads of the bonus shots on top of `parent` (above the particles: a head lies over its own glow). */
  raiseHeads(parent: Container): void {
    parent.addChild(this.headLayer);
  }

  /** How many bonus heads (octagrams) are drawn now (tests). */
  bonusHeads(): number {
    return this.heads.filter((pair) => pair.outer.visible).length;
  }

  /** How many tails are drawn now (tests, the dev tools). */
  shown(): number {
    return this.tails.filter((tail) => tail.visible).length;
  }

  /**
   * Draws the tracers of the frame: the tails into the pool, the rest into `emit`.
   * `scale`: the size of everything on the map (more when zoomed out).
   */
  update(
    emit: Emit,
    tick: number,
    rounds: readonly RoundFx[],
    roundTicks: number,
    contactsOf: (place: FightPlace) => Contacts,
    scale: number,
    strength: number = FIGHT_FX_STRENGTH,
  ): void {
    let used = 0;
    for (const fx of rounds) {
      const age = tick - fx.tick;
      if (age < 0 || age >= TRACER_END_SHARE * roundTicks) continue;
      const contacts = contactsOf(fx.place);
      const seed = fxSeed(fx);
      for (const impact of impactsOf(fx, this.me)) {
        for (const shot of shotsOf(impact, contacts, strength, scale)) {
          if (used >= MAX_SHOTS) break;
          const phase = shotPhase(age, shot, roundTicks);
          if (phase === null) continue;
          const slot = used++;
          const tail = this.tail(slot);
          this.showHead(slot, false);
          this.draw(
            tail,
            emit,
            shot,
            phase,
            scale,
            strength,
            seed + (shot.shooter === 'own' ? 0 : 5),
            slot,
            octaAngles(age, roundTicks),
          );
        }
      }
    }
    for (let i = used; i < this.tails.length; i++) {
      const tail = this.tails[i];
      if (tail !== undefined) tail.visible = false;
    }
    for (let i = used; i < this.heads.length; i++) this.showHead(i, false);
  }

  private draw(
    g: Graphics,
    emit: Emit,
    shot: Shot,
    phase: NonNullable<ReturnType<typeof shotPhase>>,
    scale: number,
    strength: number,
    seed: number,
    slot: number,
    octa: { outer: number; inner: number },
  ): void {
    const color = this.colors[shot.shooter];
    const enemy = shot.shooter === 'enemy';
    const bright = brightness(strength);
    const kk = tailFactor(strength);
    // The frame of the path: x runs along it from its start to its end.
    const angle = Math.atan2(shot.b.y - shot.p0.y, shot.b.x - shot.p0.x);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const local = (p: Point): Point => {
      const x = p.x - shot.p0.x;
      const y = p.y - shot.p0.y;
      return { x: x * cos - y * sin, y: x * sin + y * cos };
    };
    g.clear();
    g.position.set(shot.p0.x, shot.p0.y);
    g.rotation = angle;
    g.visible = true;
    const trace = (points: readonly Point[]): void => {
      const [first, ...rest] = points.map(local);
      if (first === undefined) return;
      g.moveTo(first.x, first.y);
      for (const p of rest) g.lineTo(p.x, p.y);
    };
    if (phase.kind === 'fade') {
      // The path stays and fades as the arc it was: a thin line, dashed for a bonus shot.
      const path = pathPoints(shot);
      const alpha = 0.55 * bright * (1 - phase.fade);
      if (shot.bonus) {
        for (const dash of dashAlong(path.map(local), 2, 5, 0)) {
          const [from, ...tail] = dash;
          if (from === undefined) continue;
          g.moveTo(from.x, from.y);
          for (const p of tail) g.lineTo(p.x, p.y);
        }
        g.stroke({ width: PATH_WIDTH.bonus * scale, color, alpha, cap: 'round' });
      } else {
        trace(path);
        g.stroke({ width: PATH_WIDTH.real * scale, color, alpha, cap: 'round', join: 'round' });
      }
      if (shot.cancel) {
        // Where two shots met the sparks of both fly sideways off the end of the path.
        for (let j = 0; j < 3; j++) {
          const at = arcAt(shot, 1 - 0.13 * j);
          burst(emit, {
            x: at.x,
            y: at.y,
            p: phase.fade,
            count: 1,
            speed: 22 * scale,
            cone: [Math.atan2(shot.normal.y, shot.normal.x), 1.6],
            colors: [color],
            size: 5.4 * scale,
            kind: 'square',
            add: true,
            seed: seed + 20 + j,
          });
        }
      }
      return;
    }
    const tail = tailOutline(shot, phase.s, scale, strength);
    const head = tail.axis[tail.axis.length - 1];
    if (head === undefined) return;
    trace(tail.axis);
    g.stroke({
      width: GLOW_WIDTH * kk * scale,
      color,
      alpha: 0.22 * bright,
      cap: 'round',
      join: 'round',
    });
    // A dark underlay, a little wider, so that the tail reads over a city of its own colour.
    const under = tailOutline(shot, phase.s, scale, strength, UNDERLAY_PAD);
    g.poly(flat([...under.left, ...under.right.slice().reverse()].map(local))).fill({
      color: BG,
      alpha: UNDERLAY_ALPHA * bright,
    });
    // The tail itself: its segments fade from nothing at the tail end to the full colour at the head.
    for (let j = 0; j < TAIL_SEGMENTS; j++) {
      const [l0, l1, r0, r1] = [tail.left[j], tail.left[j + 1], tail.right[j], tail.right[j + 1]];
      if (l0 === undefined || l1 === undefined || r0 === undefined || r1 === undefined) continue;
      const t = (j + 1) / TAIL_SEGMENTS;
      g.poly(flat([l0, l1, r1, r0].map(local))).fill({
        // Hotter towards the head, as the glow of a tracer is.
        color: lighten(color, TAIL_HOT * t),
        alpha: TAIL_ALPHA * (TAIL_FLOOR + (1 - TAIL_FLOOR) * t),
      });
    }
    trace(tail.axis.slice(2));
    g.stroke({
      width: CORE_WIDTH * scale,
      color: enemy ? BG : FLASH_COLOR,
      alpha: 0.95,
      cap: 'round',
      join: 'round',
    });
    // The glow along the tail: soft additive spots that fade away from the head.
    for (let k = 1; k <= GLOW_SPOT_COUNT; k++) {
      const at = arcAt(shot, Math.max(0, phase.s - k * GLOW_STEP * kk));
      emit({
        kind: 'glow',
        x: at.x,
        y: at.y,
        size: HEAD_GLOW * kk * scale * (1 - 0.2 * k),
        color,
        alpha: 0.4 * bright * (1 - k / (GLOW_SPOT_COUNT + 1)),
        add: true,
      });
    }
    emit({
      kind: 'glow',
      x: head.x,
      y: head.y,
      size: HEAD_GLOW * kk * scale,
      color,
      alpha: 0.5 * bright,
      add: true,
    });
    if (shot.bonus) {
      // The octagram (#812): the outer square lighter and turned 45 degrees, the inner one in the colour of the
      // side with a small square in the middle, the two turning against each other. It swells from the start.
      const pop = Math.min(1, Math.max(0, (phase.s - shot.start) / OCTA_POP.over));
      const k = scale * (OCTA_POP.from + (1 - OCTA_POP.from) * easeOutCubic(pop));
      const pair = this.head(slot);
      pair.outer.set(octagramSpec('outer', enemy, color));
      pair.inner.set(octagramSpec('inner', enemy, color));
      for (const [square, angle] of [
        [pair.outer, octa.outer],
        [pair.inner, octa.inner],
      ] as const) {
        square.position.set(head.x, head.y);
        square.rotation = angle;
        square.scale.set(k);
      }
      this.showHead(slot, true);
    } else {
      emit({
        kind: headKind(shot.shooter),
        x: head.x,
        y: head.y,
        size: HEAD_SIZE * scale,
        color: 0xffffff,
        alpha: 1,
      });
    }
    for (const [j, spark] of sparksOf(shot, phase.flown, seed, strength).entries()) {
      emit({
        kind: 'square',
        x: spark.at.x,
        y: spark.at.y,
        size: 4.8 * (1 - spark.life) * scale,
        color: j % 2 === 1 ? FLASH_COLOR : color,
        alpha: 1 - spark.life,
        add: true,
      });
    }
  }

  private head(index: number): { outer: BakedSprite; inner: BakedSprite } {
    let pair = this.heads[index];
    if (pair === undefined) {
      const make = (): BakedSprite => {
        const sprite = this.headLayer.addChild(this.sprites.sprite());
        sprite.visible = false;
        return sprite;
      };
      pair = { outer: make(), inner: make() };
      this.heads.push(pair);
    }
    return pair;
  }

  /** Shows or hides the head of slot `index`; a shown head takes the look of the side that shoots from the slot. */
  private showHead(index: number, visible: boolean): void {
    const pair = this.heads[index];
    if (pair === undefined) return;
    pair.outer.visible = visible;
    pair.inner.visible = visible;
  }

  private tail(index: number): Graphics {
    let tail = this.tails[index];
    if (tail === undefined) {
      tail = this.layer.addChild(new Graphics());
      tail.label = 'tracer';
      this.tails.push(tail);
    }
    return tail;
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.headLayer.destroy({ children: true });
  }
}
