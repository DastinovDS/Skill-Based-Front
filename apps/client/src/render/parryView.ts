import { Container, Graphics } from 'pixi.js';
import type { BakedSprite, SpriteCache } from './bake.ts';
import { CHIP_HELMET_WIDTH, OCTA_LOOK, helmetChipSpec, octagramSpec } from './bakedShapes.ts';
import type { PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { FightPlace, RoundFx } from './fightFx.ts';
import type { Contacts } from './fightImpact.ts';
import {
  ETCH,
  archEnds,
  archPoint,
  easeInOut,
  easeOut,
  easeOutQuad,
  endShare,
  etchPoints,
  headDirection,
  octaAngles,
  parryMarks,
  roundLayout,
  type Ends,
  type ParryMark,
  type Side,
} from './parryLayout.ts';
import { CASING, INK, WARN, ownerColor, sideColours, type PlayerColours } from './style.ts';

/** Rounds drawn at once at most (two sides of each of the eight arenas of `FightView`). */
const MAX_ROUNDS = 8;
/** Octagram heads and dropping helmets drawn at once at most. */
const MAX_HEADS = 16;
const MAX_DROPS = 16;

/** The glance of a pair (mockup `meetFx`, X3): two curls of this radius, their heads, four ticks. */
const GLANCE = { radius: 5.5, sweep: Math.PI * 1.25, hair: 1.4, casing: 3, tick: 1, square: 3.5 };
/** The burst of a hit (mockup `hitV` 3): twelve ticks out to this radius, every third in ink. */
const BURST = { from: 4, grow: 13, ink: 1.1, color: 0.8, drop: 16, fall: 16 };
/** The burn (DEC-45; mockup `burnFx`): a charge of this size sinking this far, three amber ticks under it. */
const BURN = { size: 4.2, sink: 14, ticks: 6, rise: 6, casing: 2.6, hair: 1.1, below: 9, ring: 4 };

const flat = (points: readonly Point[]): number[] => points.flatMap((p) => [p.x, p.y]);

/**
 * The shots of the fights on the map, "Parry" (#856, ui-style 54; the owner's pick of round 4): each
 * round is laid out from its `fight_round` fields (`parryLayout.ts`, AGENTS.md 7.1) and drawn as etched
 * arcs between the two sides: a casing and a hairline of the side's colour fading towards its tail, a
 * lozenge head (an octagram for a bonus shot). The two shots of a pair meet at the top of their arch
 * and glance off each other, curling back home; a hit bursts into a ring of ticks on the unit and a
 * small hatched helmet drops away; a charge the terrain burned sinks into the plains before the shots.
 * No glow, no sparks, no light: every coloured line lies on a dark casing.
 *
 * The lines are one `Graphics` redrawn while a round plays; the octagram heads and the dropping helmets
 * are baked sprites, pooled. Everything is a function of the render tick, so a paused scene shows a
 * round in the state of that tick. With "less motion" nothing is drawn: the arena and the losses tell
 * the round. `destroy()` frees it all.
 */
export class ParryView {
  private readonly layer = new Container({ label: 'fight-parry' });
  private readonly lines = new Graphics({ label: 'parry-lines' });
  private readonly headLayer = new Container({ label: 'parry-heads' });
  private readonly heads: { outer: BakedSprite; inner: BakedSprite }[] = [];
  private readonly drops: BakedSprite[] = [];
  private readonly colors: Readonly<Record<Side, number>>;
  private usedHeads = 0;
  /** The last frame drew lines (an idle frame does not clear the Graphics again). */
  private drewLines = false;
  private usedDrops = 0;
  /** The size of the effects (more when the map is zoomed out) and the thinnest line (one device pixel). */
  private scale = 1;
  private floor = 0;

  constructor(
    parent: Container,
    private readonly me: PlayerId,
    private readonly sprites: SpriteCache,
    /** The colours of the players by id (DEC-49); today's look by default. */
    private readonly colours: PlayerColours = sideColours(me),
  ) {
    const enemy: PlayerId = me === 0 ? 1 : 0;
    this.colors = { own: ownerColor(this.colours, me), enemy: ownerColor(this.colours, enemy) };
    this.layer.addChild(this.lines, this.headLayer);
    parent.addChild(this.layer);
  }

  /** How many octagram heads are drawn now (tests). */
  bonusHeads(): number {
    return this.heads.filter((pair) => pair.outer.visible).length;
  }

  /** How many units drop away now (tests). */
  dropping(): number {
    return this.drops.filter((drop) => drop.visible).length;
  }

  /** Whether any line is drawn now (tests, the dev tools). */
  drawing(): boolean {
    return this.lines.visible;
  }

  /**
   * Draws the rounds still playing at `tick`. `scale`: the size of the effects (more when zoomed
   * out); `floor`: the thinnest line in world units (one device pixel).
   */
  update(
    tick: number,
    rounds: readonly RoundFx[],
    roundTicks: number,
    contactsOf: (place: FightPlace) => Contacts,
    scale: number,
    floor: number,
    reduced: boolean,
  ): void {
    // The lines are redrawn only while a round plays; an idle frame leaves the cleared Graphics alone.
    const g = this.lines;
    if (this.drewLines) g.clear();
    this.scale = scale;
    this.floor = floor;
    this.usedHeads = 0;
    this.usedDrops = 0;
    let drawn = 0;
    const ticks = Math.max(1, roundTicks);
    if (!reduced) {
      for (const fx of rounds) {
        const age = (tick - fx.tick) / ticks;
        const layout = roundLayout(fx, this.me);
        if (age < 0 || age >= endShare(layout)) continue;
        if (drawn++ >= MAX_ROUNDS) break;
        const contacts = contactsOf(fx.place);
        const ends = archEnds(contacts.own, contacts.enemy, scale);
        for (const mark of parryMarks(layout, age)) this.mark(g, mark, fx.place, contacts, ends);
      }
    }
    this.lines.visible = drawn > 0;
    this.drewLines = drawn > 0;
    for (let i = this.usedHeads; i < this.heads.length; i++) this.showHead(i, false);
    for (let i = this.usedDrops; i < this.drops.length; i++) {
      const drop = this.drops[i];
      if (drop !== undefined) drop.visible = false;
    }
  }

  /** A line `w` world units wide at 100 %, grown with the effects and never under a device pixel. */
  private hair(w: number): number {
    return Math.max(w * this.scale, this.floor);
  }

  private mark(
    g: Graphics,
    mark: ParryMark,
    place: FightPlace,
    contacts: Contacts,
    ends: Ends,
  ): void {
    const other = (side: Side): Side => (side === 'own' ? 'enemy' : 'own');
    switch (mark.kind) {
      case 'burn':
        this.burn(g, mark.side, contacts[mark.side], place, mark.q);
        return;
      case 'shot':
        this.shot(
          g,
          mark.side,
          ends[mark.side],
          ends[other(mark.side)],
          mark.s,
          mark.bonus,
          mark.age,
        );
        return;
      case 'glance': {
        const top = archPoint(ends.own, ends.enemy, 0.5, this.scale);
        const before = archPoint(ends.own, ends.enemy, 0.46, this.scale);
        this.glance(g, top, Math.atan2(top.y - before.y, top.x - before.x), mark.q, mark.bonus);
        return;
      }
      case 'burst': {
        const target = ends[other(mark.side)];
        this.burst(g, mark.side, { x: target.x, y: target.y + 4 * this.scale }, mark.q, mark.bonus);
        return;
      }
    }
  }

  /** An etched shot of `side` from `from` to `to`, its head at `s`: the cut fades towards its tail. */
  private shot(
    g: Graphics,
    side: Side,
    from: Point,
    to: Point,
    s: number,
    bonus: boolean,
    age: number,
  ): void {
    const color = this.colors[side];
    const points = etchPoints(from, to, s, this.scale);
    const head = points[points.length - 1];
    if (head === undefined || points.length < 2) return;
    g.poly(flat(points), false).stroke({
      width: ETCH.casing * this.scale,
      color: CASING,
      cap: 'round',
      join: 'round',
    });
    // The hairline: each step a little more opaque, from nothing at the tail to the colour at the head.
    const n = points.length - 1;
    for (let i = 0; i < n; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (a === undefined || b === undefined) continue;
      g.moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: this.hair(ETCH.hair), color, alpha: (i + 1) / n, cap: 'round' });
    }
    const dir = headDirection(points);
    if (bonus) {
      this.octagram(side, head, age, Math.min(1, 0.6 + s * 2));
      return;
    }
    const { half, side: w, casing, edge } = ETCH.head;
    const k = this.scale;
    const lozenge = flat([
      { x: head.x + dir.x * half * k, y: head.y + dir.y * half * k },
      { x: head.x + dir.y * w * k, y: head.y - dir.x * w * k },
      { x: head.x - dir.x * half * k, y: head.y - dir.y * half * k },
      { x: head.x - dir.y * w * k, y: head.y + dir.x * w * k },
    ]);
    g.poly(lozenge)
      .stroke({ width: casing * k, color: CASING, join: 'round' })
      .fill(color)
      .stroke({ width: this.hair(edge), color: INK, join: 'round' });
  }

  /**
   * Two heads glancing off each other at the top of the arch (Parry, mockup `meetFx` X3): each curls
   * back the way it came, the own one up, the enemy's down (in the frame of the meeting, the own shot
   * travelling along +x), with four short ink ticks round the spot; a bonus pair adds an ink square.
   */
  private glance(g: Graphics, at: Point, angle: number, q: number, bonus: boolean): void {
    if (q <= 0 || q >= 1) return;
    const alpha = 1 - easeOutQuad(q);
    const k = this.scale;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const world = (x: number, y: number): Point => ({
      x: at.x + (x * cos - y * sin) * k,
      y: at.y + (x * sin + y * cos) * k,
    });
    const sweep = GLANCE.sweep * easeOut(q);
    const r = GLANCE.radius;
    for (const [cy, start, side] of [
      [-r, Math.PI / 2, 'own'],
      [r, -Math.PI / 2, 'enemy'],
    ] as const) {
      const steps = 12;
      const curl: Point[] = [];
      for (let i = 0; i <= steps; i++) {
        const a = start - (sweep * i) / steps;
        curl.push(world(Math.cos(a) * r, cy + Math.sin(a) * r));
      }
      const color = this.colors[side];
      g.poly(flat(curl), false)
        .stroke({ width: GLANCE.casing * k, color: CASING, alpha, cap: 'round', join: 'round' })
        .stroke({ width: this.hair(GLANCE.hair), color, alpha, cap: 'round', join: 'round' });
      // The head at the end of the curl, along it.
      const end = start - sweep;
      const hx = Math.cos(end) * r;
      const hy = cy + Math.sin(end) * r;
      const ta = end - Math.PI / 2;
      const tx = Math.cos(ta);
      const ty = Math.sin(ta);
      g.poly(
        flat([
          world(hx + tx * 3, hy + ty * 3),
          world(hx + ty * 1.8, hy - tx * 1.8),
          world(hx - tx * 3, hy - ty * 3),
          world(hx - ty * 1.8, hy + tx * 1.8),
        ]),
      )
        .stroke({ width: 1.6 * k, color: CASING, alpha, join: 'round' })
        .fill({ color, alpha });
    }
    for (let j = 0; j < 4; j++) {
      const a = angle + Math.PI / 4 + (j * Math.PI) / 2;
      const r0 = (3 + 5 * q) * k;
      const r1 = r0 + 4 * k;
      g.moveTo(at.x + Math.cos(a) * r0, at.y + Math.sin(a) * r0).lineTo(
        at.x + Math.cos(a) * r1,
        at.y + Math.sin(a) * r1,
      );
    }
    g.stroke({ width: this.hair(GLANCE.tick), color: INK, alpha, cap: 'round' });
    if (bonus) {
      const h = GLANCE.square * k;
      g.rect(at.x - h, at.y - h, 2 * h, 2 * h).stroke({
        width: this.hair(0.9),
        color: INK,
        alpha,
      });
    }
  }

  /**
   * A shot of `side` bursting on the other side (mockup `hitV` 3): twelve ticks thrown out, every third
   * in ink, a bonus shot adds a square of its colour; the unit it cost drops away, hatched, and fades.
   */
  private burst(g: Graphics, side: Side, at: Point, q: number, bonus: boolean): void {
    if (q <= 0 || q >= 1) return;
    const color = this.colors[side];
    const k = this.scale;
    const alpha = 1 - q;
    const r = (BURST.from + BURST.grow * easeOut(q)) * k;
    for (const inked of [true, false]) {
      for (let j = 0; j < 12; j++) {
        if ((j % 3 === 0) !== inked) continue;
        const a = (j / 12) * Math.PI * 2;
        g.moveTo(at.x + Math.cos(a) * r * 0.6, at.y + Math.sin(a) * r * 0.6).lineTo(
          at.x + Math.cos(a) * r,
          at.y + Math.sin(a) * r,
        );
      }
      g.stroke({
        width: this.hair(inked ? BURST.ink : BURST.color),
        color: inked ? INK : color,
        alpha,
        cap: 'round',
      });
    }
    if (bonus) {
      g.rect(at.x - r / 2, at.y - r / 2, r, r).stroke({ width: this.hair(1), color, alpha });
    }
    // The unit lost: a small hatched helmet of the other side drops from the spot and fades.
    const victim: Side = side === 'own' ? 'enemy' : 'own';
    const drop = this.drop();
    if (drop === null) return;
    const own = victim === 'own';
    const fall = easeOutQuad(q);
    drop.set(helmetChipSpec('empty', !own, this.colors[victim]));
    const size = (BURST.drop / CHIP_HELMET_WIDTH) * k;
    drop.scale.set(own ? size : -size, size);
    drop.position.set(at.x + (own ? -8 : 8) * q * k, at.y + (6 + BURST.fall * fall) * k);
    drop.alpha = 1 - fall;
    drop.visible = true;
  }

  /**
   * A charge of `side` the terrain burned (DEC-45; mockup `burnFx`): it leaves the token and sinks
   * into the plains while three short amber ticks of the plains rise under it.
   */
  private burn(g: Graphics, side: Side, at: Point, place: FightPlace, q: number): void {
    if (q <= 0 || q >= 1) return;
    const k = this.scale;
    const color = this.colors[side];
    // A side standing in its city sinks below the ring; one on a road, below its token.
    const inCity = place.node !== null && Math.hypot(at.x - place.at.x, at.y - place.at.y) < 3;
    const y0 = at.y + (inCity ? place.ring + BURN.ring : BURN.below * k);
    const alpha = 1 - Math.min(1, Math.max(0, (q - 0.6) / 0.4));
    const d = (4 + BURN.sink * easeInOut(q)) * k;
    const s = BURN.size * (1 - q * 0.5) * k;
    const lozenge = (half: number): number[] => [
      at.x,
      y0 + d - half,
      at.x + half,
      y0 + d,
      at.x,
      y0 + d + half,
      at.x - half,
      y0 + d,
    ];
    // The square of the mockup, turned 45 degrees: half its diagonal is `s` times the root of two.
    g.poly(lozenge((s + 1 * k) * Math.SQRT2)).fill({ color: CASING, alpha });
    g.poly(lozenge(s * Math.SQRT2)).fill({ color, alpha });
    const h = BURN.rise * easeOut(q / 0.5) * k;
    for (const casing of [true, false]) {
      for (const j of [-1, 0, 1]) {
        const bx = at.x + j * BURN.ticks * k;
        const by = y0 + 18 * k;
        g.moveTo(bx, by).lineTo(bx + j * 1.6 * k, by - h);
      }
      g.stroke({
        width: casing ? BURN.casing * k : this.hair(BURN.hair),
        color: casing ? CASING : WARN,
        alpha,
        cap: 'round',
      });
    }
  }

  /** The octagram head of a bonus shot (#812): two baked squares turning against each other. */
  private octagram(side: Side, at: Point, age: number, pop: number): void {
    if (this.usedHeads >= MAX_HEADS) return;
    const slot = this.usedHeads++;
    const pair = this.head(slot);
    const enemy = side === 'enemy';
    const color = this.colors[side];
    pair.outer.set(octagramSpec('outer', enemy, color));
    pair.inner.set(octagramSpec('inner', enemy, color));
    const angles = octaAngles(age);
    // Baked at `OCTA_LOOK.bake` times its size: the inner square is `ETCH.octa` world units at 100 %.
    const size = (ETCH.octa * this.scale * pop) / OCTA_LOOK.inner;
    for (const [square, angle] of [
      [pair.outer, angles.outer],
      [pair.inner, angles.inner],
    ] as const) {
      square.position.set(at.x, at.y);
      square.rotation = angle;
      square.scale.set(size);
    }
    this.showHead(slot, true);
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

  private showHead(index: number, visible: boolean): void {
    const pair = this.heads[index];
    if (pair === undefined) return;
    pair.outer.visible = visible;
    pair.inner.visible = visible;
  }

  private drop(): BakedSprite | null {
    if (this.usedDrops >= MAX_DROPS) return null;
    let drop = this.drops[this.usedDrops];
    if (drop === undefined) {
      drop = this.headLayer.addChildAt(this.sprites.sprite(), 0);
      drop.label = 'parry-drop';
      this.drops.push(drop);
    }
    this.usedDrops++;
    return drop;
  }

  destroy(): void {
    this.layer.destroy({ children: true });
  }
}
