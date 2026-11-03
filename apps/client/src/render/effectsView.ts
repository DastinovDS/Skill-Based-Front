import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { EventMsg, MapFile, PlayerId } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import { contactPoints, type Contacts } from './fightImpact.ts';
import { fightPlace, placeKey, type FightPlace } from './fightFx.ts';
import { HitView, type Punch } from './hitView.ts';
import { ParticleLayer } from './particles.ts';
import { ShotView } from './shotView.ts';
import type { EnemyAnchors } from './entityView.ts';
import type { Point } from './camera.ts';
import {
  bounceArrow,
  bounceInfo,
  captureInfo,
  FLAG_MS,
  effectProgress,
  flagLook,
  scaledPolygon,
  waveLook,
  type BounceInfo,
  type CaptureInfo,
} from './effectsLayout.ts';
import type { Rect } from './arenaLayout.ts';
import type { SpriteCache } from './bake.ts';
import { FightView } from './fightView.ts';
import type { MapLayers } from './layers.ts';
import { dashSegments, edgeEnds, nodePoint, type TokenSpot } from './layout.ts';
import { reducedMotion } from './motion.ts';
import {
  BG,
  BOUNCE_LENGTH,
  BOUNCE_MS,
  FIGHT_FX_STRENGTH,
  FLASH_COLOR,
  ORDER_GHOST_DASH,
  ORDER_GHOST_GAP,
  WAVE_FILL_ALPHA,
  WAVE_MS,
  WAVE_STROKE,
  PAPER,
  ownerColor,
} from './style.ts';

/** Ticks between rounds when the source does not say (`rulesets/mvp-0.toml`, DEC-32). */
const DEFAULT_ROUND_TICKS = 20;
const MAX_WAVES = 4;
/** A token this close to the place of a fight (world units) is a group of that fight: the token of a city, a marker beside it, a figure on its road. */
const CONTACT_REACH = 80;
const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= CONTACT_REACH;
/** Places of fights whose contacts are remembered (a long match has many roads): past it the memory starts over. */
const MAX_REMEMBERED_PLACES = 64;
/** Where a bounced group goes back to, found once when its own token is on the road. */
type BounceArrow = NonNullable<ReturnType<typeof bounceArrow>> | null;

/**
 * Effects of events on the map (ui-style 9.9, U8): the animation of fights (`FightView`: arena,
 * shots, losses, result), the short dashed arrow of an own group bounced back along its road, and
 * the wave of the new owner over the cell of a captured city. With "less motion" the shots, the
 * wave and the arrow are left out and the numbers do not rise. Events come from the server
 * (`fight_round`, `fight_ended`, `fight_group`, `node_captured`); nothing is guessed: the enemy's
 * bounces are not sent, so none is drawn.
 *
 * `update` runs every frame with the render tick; the effects are a function of the tick, so a
 * paused or frozen scene shows them in the state of that tick. `destroy()` releases everything.
 */
export class EffectsView {
  private readonly layer = new Container({ label: 'effects' });
  private readonly fightView: FightView;
  private readonly particles: ParticleLayer;
  private readonly hits: HitView;
  private readonly shots: ShotView;
  /** Where the two sides of each fight stood the last time they were seen (the tokens): ended fights keep it. */
  private readonly contacts = new Map<string, Contacts>();
  private cameraScale = 1;
  private readonly waves: Graphics[] = [];
  private readonly arrows = new Graphics();
  /** The flag over a captured city, one drawing per owner, pooled. */
  private readonly flags: Graphics[] = [];
  private readonly flagContext: readonly [GraphicsContext, GraphicsContext];
  private captures: CaptureInfo[] = [];
  private bounces: BounceInfo[] = [];
  private readonly arrowAt = new Map<string, BounceArrow>();
  private eventsSeen: readonly EventMsg[] | null = null;
  private eventCount = -1;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    labelResolution: number,
    /** The Voronoi cells of the cities (`MapView.cells`). */
    private readonly cells: readonly (readonly Point[])[],
    /** Radius of a city now (`CityView.radiusOf`). */
    private readonly radiusOf: (node: number) => number,
    /** The baked shapes drawn in screen px (the plate and chips of the arenas). */
    sprites: SpriteCache,
  ) {
    this.layer.addChild(this.arrows);
    const flag = (owner: PlayerId): GraphicsContext =>
      new GraphicsContext()
        .moveTo(0, 14)
        .lineTo(0, -6)
        .stroke({ width: 2, color: PAPER, cap: 'round' })
        .poly([0, -6, 14, -1, 0, 4])
        .fill(ownerColor(me, owner))
        .stroke({ width: 1.4, color: PAPER, join: 'round' });
    this.flagContext = [flag(0), flag(1)];
    layers.layer.effects.addChild(this.layer);
    // The tails of the tracers (shot style 1) lie under the particles (their heads, glows and sparks), which lie
    // under the arenas: a spark over a city does not hide the plate that floats above it.
    this.shots = new ShotView(layers.layer.effects, me);
    const enemy: PlayerId = me === 0 ? 1 : 0;
    this.particles = new ParticleLayer(layers.layer.effects, {
      own: ownerColor(me, me),
      enemy: ownerColor(me, enemy),
    });
    this.hits = new HitView(layers.layer.effects, map, me, labelResolution, radiusOf);
    this.fightView = new FightView(map, layers, me, labelResolution, radiusOf, sprites);
    this.fightView.setContacts((place) => this.contactsAt(place));
  }

  /** Camera scale (CSS px per world unit): the arenas of fights keep their size on screen. */
  setCameraScale(scale: number): void {
    if (scale > 0) this.cameraScale = scale;
    this.fightView.setCameraScale(scale);
  }

  /** The canvas in scaled-world px: the arenas of fights keep inside it (#360). */
  setViewport(rect: Rect | null): void {
    this.fightView.setViewport(rect);
  }

  /** Text resolution for what is drawn at one unit a CSS px (the arenas of fights). */
  setScreenResolution(resolution: number): void {
    this.fightView.setScreenResolution(resolution);
    this.hits.setScreenResolution(resolution);
  }

  update(
    frame: RenderFrame,
    events: readonly EventMsg[],
    spots: ReadonlyMap<string, TokenSpot>,
    tickHz: number,
    roundTicks: number = DEFAULT_ROUND_TICKS,
    enemies: EnemyAnchors | null = null,
  ): readonly Punch[] {
    this.readEvents(events);
    const reduced = reducedMotion();
    this.trackContacts(frame, spots, enemies);
    this.fightView.update(frame, events, roundTicks, reduced);
    // Effects keep their size on the screen when the map is zoomed out; zoomed in they grow with it.
    const scale = Math.max(1, 1 / this.cameraScale);
    this.particles.begin();
    const punches = this.hits.update(
      (particle) => {
        this.particles.put(particle);
      },
      frame,
      this.fightView.rounds(),
      roundTicks,
      (place) => this.contactsAt(place),
      scale,
    );
    this.shots.update(
      (particle) => {
        this.particles.put(particle);
      },
      frame.tick,
      this.fightView.rounds(),
      roundTicks,
      (place) => this.contactsAt(place),
      scale,
    );
    this.captureRings(frame.tick, tickHz, scale);
    this.particles.end();
    this.drawWaves(frame.tick, tickHz, reduced);
    this.drawFlags(frame.tick, tickHz, scale);
    this.drawBounces(frame, spots, tickHz, reduced);
    return punches;
  }

  /** How many particles the last frame drew (tests, the dev tools). */
  particleCount(): { normal: number; additive: number } {
    return this.particles.count();
  }

  /**
   * Where the two sides of every fight in sight stand: the own token of a group in the fight, the
   * enemy marker of the city or the figure nearest to the meeting point on the road. Remembered by place
   * for the rounds of a fight that has just ended.
   */
  private trackContacts(
    frame: RenderFrame,
    spots: ReadonlyMap<string, TokenSpot>,
    enemies: EnemyAnchors | null,
  ): void {
    for (const fight of frame.base.view.fights) {
      const place = fightPlace(this.map, fight.node, fight.edge, fight.point, this.radiusOf);
      if (place === undefined) continue;
      let own: Point | undefined;
      for (const id of fight.groups) {
        const spot = spots.get(id);
        if (spot !== undefined && near(spot, place.at)) {
          own = { x: spot.x, y: spot.y };
          break;
        }
      }
      let enemy: Point | undefined;
      if (enemies !== null) {
        enemy =
          place.node !== null
            ? enemies.nodePoint(place.node)
            : place.edge === null
              ? undefined
              : enemies.nearestOnEdge(place.edge, place.at);
        if (enemy !== undefined && !near(enemy, place.at)) enemy = undefined;
      }
      if (this.contacts.size > MAX_REMEMBERED_PLACES) this.contacts.clear();
      this.contacts.set(placeKey(place), contactPoints(this.map, place, { own, enemy }));
    }
  }

  private contactsAt(place: FightPlace): Contacts {
    return this.contacts.get(placeKey(place)) ?? contactPoints(this.map, place, {});
  }

  destroy(): void {
    this.fightView.destroy();
    this.hits.destroy();
    this.shots.destroy();
    this.particles.destroy();
    this.arrows.destroy();
    this.layer.destroy({ children: true });
    for (const context of this.flagContext) context.destroy();
  }

  private readEvents(events: readonly EventMsg[]): void {
    if (events === this.eventsSeen && events.length === this.eventCount) return;
    this.eventsSeen = events;
    this.eventCount = events.length;
    this.captures = [];
    this.bounces = [];
    for (const event of events) {
      const capture = captureInfo(event, this.map);
      if (capture !== null) this.captures.push(capture);
      const bounce = bounceInfo(event);
      if (bounce !== null) this.bounces.push(bounce);
    }
    // Forget arrows of bounces that left the event list.
    const live = new Set(this.bounces.map(bounceKey));
    for (const key of this.arrowAt.keys()) {
      if (!live.has(key)) this.arrowAt.delete(key);
    }
  }

  // --- Capture: the ring and the flag over the city (E3) ---------------------------------------

  /** A white ring leaves the captured city with the wave over its cell: as far as the strength of the effects. */
  private captureRings(tick: number, tickHz: number, scale: number): void {
    let used = 0;
    for (const capture of this.captures) {
      const t = effectProgress(tick - capture.tick, WAVE_MS, tickHz);
      if (t === null || used >= MAX_WAVES) continue;
      used++;
      const ease = t * (2 - t);
      this.particles.put({
        kind: 'ring',
        x: capture.at.x,
        y: capture.at.y,
        size: 2 * (8 + 28 * FIGHT_FX_STRENGTH * ease) * scale,
        color: FLASH_COLOR,
        alpha: 0.8 * (1 - t),
      });
    }
  }

  private drawFlags(tick: number, tickHz: number, scale: number): void {
    let used = 0;
    for (const capture of this.captures) {
      const t = effectProgress(tick - capture.tick, FLAG_MS, tickHz);
      if (t === null || used >= MAX_WAVES) continue;
      const flag = this.flag(used++);
      const radius = this.radiusOf(capture.node);
      flag.context = this.flagContext[capture.player];
      flag.position.set(capture.at.x + (radius + 6) * scale, capture.at.y - (radius + 14) * scale);
      flag.scale.set(scale);
      flag.alpha = flagLook(t).alpha;
      flag.visible = true;
    }
    for (let i = used; i < this.flags.length; i++) {
      const flag = this.flags[i];
      if (flag !== undefined) flag.visible = false;
    }
  }

  private flag(index: number): Graphics {
    let flag = this.flags[index];
    if (flag === undefined) {
      flag = this.layer.addChild(new Graphics(this.flagContext[0]));
      flag.label = 'capture-flag';
      this.flags.push(flag);
    }
    return flag;
  }

  // --- Capture: the wave over the cell -------------------------------------------------------

  private drawWaves(tick: number, tickHz: number, reduced: boolean): void {
    let used = 0;
    if (!reduced) {
      for (const capture of this.captures) {
        const t = effectProgress(tick - capture.tick, WAVE_MS, tickHz);
        const cell = this.cells[capture.node];
        if (t === null || cell === undefined || used >= MAX_WAVES) continue;
        const g = this.wave(used++);
        const look = waveLook(t);
        const color = ownerColor(this.me, capture.player);
        const polygon = scaledPolygon(cell, capture.at, look.scale);
        g.clear();
        g.poly(polygon).fill({ color, alpha: WAVE_FILL_ALPHA * look.alpha });
        g.poly(polygon).stroke({ ...WAVE_STROKE, color, alpha: WAVE_STROKE.alpha * look.alpha });
        g.visible = true;
      }
    }
    for (let i = used; i < this.waves.length; i++) {
      const g = this.waves[i];
      if (g !== undefined) g.visible = false;
    }
  }

  private wave(index: number): Graphics {
    let g = this.waves[index];
    if (g === undefined) {
      g = this.layer.addChildAt(new Graphics(), 0);
      this.waves.push(g);
    }
    return g;
  }

  // --- Bounce: an arrow back along the road ---------------------------------------------------

  private drawBounces(
    frame: RenderFrame,
    spots: ReadonlyMap<string, TokenSpot>,
    tickHz: number,
    reduced: boolean,
  ): void {
    const g = this.arrows;
    g.clear();
    if (reduced) return;
    for (const bounce of this.bounces) {
      const t = effectProgress(frame.tick - bounce.tick, BOUNCE_MS, tickHz);
      if (t === null) continue;
      const key = bounceKey(bounce);
      if (!this.arrowAt.has(key)) {
        // Found once, on the first frame the group is on a road: the arrow stays where it began.
        const arrow = this.findArrow(bounce, frame, spots);
        if (arrow === undefined) continue;
        this.arrowAt.set(key, arrow);
      }
      const arrow = this.arrowAt.get(key);
      if (arrow === null || arrow === undefined) continue;
      const color = ownerColor(this.me, this.me);
      const alpha = 1 - t;
      for (const [a, b] of dashSegments(arrow.from, arrow.end, ORDER_GHOST_DASH, ORDER_GHOST_GAP)) {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ width: 5.5, color: BG, alpha: 0.6 * alpha, cap: 'round' });
      for (const [a, b] of dashSegments(arrow.from, arrow.end, ORDER_GHOST_DASH, ORDER_GHOST_GAP)) {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      }
      g.stroke({ width: 3, color, alpha, cap: 'round' });
      const [tip, left, right] = arrow.head;
      g.poly([tip.x, tip.y, left.x, left.y, right.x, right.y])
        .fill({ color, alpha })
        .stroke({ width: 1.5, color: BG, alpha });
    }
  }

  /** `undefined`: the group is not on a road (yet); `null`: no arrow can be made. */
  private findArrow(
    bounce: BounceInfo,
    frame: RenderFrame,
    spots: ReadonlyMap<string, TokenSpot>,
  ): BounceArrow | undefined {
    const item = frame.groups.find((entry) => entry.group.id === bounce.group);
    const spot = spots.get(bounce.group);
    const location = item?.location;
    if (location?.kind !== 'edge' || spot === undefined) return undefined;
    // The bounce goes back to the node the group left from.
    const home = nodePoint(this.map, location.from_node);
    if (home === undefined || edgeEnds(this.map, location.edge) === undefined) return null;
    return bounceArrow(spot, home, BOUNCE_LENGTH, 10);
  }
}

function bounceKey(bounce: BounceInfo): string {
  return `${String(bounce.tick)}:${bounce.group}`;
}
