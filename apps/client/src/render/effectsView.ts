import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { EventMsg, MapFile, PlayerId } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import { contactPoints, type Contacts } from './fightImpact.ts';
import { fightPlace, placeKey, type FightPlace } from './fightFx.ts';
import { LEAVER_STILL, leaversOf, type PlaceMemory } from './leaverLayout.ts';
import { HitView, type Punch } from './hitView.ts';
import { ParticleLayer } from './particles.ts';
import { cityLight } from './captureLayout.ts';
import type { Flood } from './mapView.ts';
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
  type BounceInfo,
  type CaptureInfo,
} from './effectsLayout.ts';
import type { Rect } from './arenaLayout.ts';
import type { BakedSprite, SpriteCache } from './bake.ts';
import { helmetChipSpec } from './bakedShapes.ts';
import { FightView } from './fightView.ts';
import type { MapLayers } from './layers.ts';
import { dashSegments, edgeEnds, nodePoint, type TokenSpot } from './layout.ts';
import { reducedMotion } from './motion.ts';
import {
  BG,
  BOUNCE_LENGTH,
  BOUNCE_MS,
  ORDER_GHOST_DASH,
  ORDER_GHOST_GAP,
  CAPTURE,
  PAPER,
  ownerColor,
} from './style.ts';

/** Ticks between rounds when the source does not say (`rulesets/mvp-0.toml`, DEC-32). */
const DEFAULT_ROUND_TICKS = 20;
/** Flags of captures drawn at once. */
const MAX_FLAGS = 4;
/** The radius of the ring of the particle atlas, a share of its size (`particles.ts`: 26 of 64). */
const RING_RADIUS_SHARE = 26 / 64;
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
 * the light and the flag of a captured city (#819; its colour floods the area in `MapView`). With
 * "less motion" the shots, the light and the arrow are left out and the numbers do not rise. Events come from the server
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
  private readonly contacts = new Map<string, PlaceMemory & { readonly contacts: Contacts }>();
  /** The faded helmets of sides that left a fight while its last shots are in the air (#811). */
  private readonly leaverLayer = new Container({ label: 'fight-leavers', eventMode: 'none' });
  private readonly leavers: BakedSprite[] = [];
  private cameraScale = 1;
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
    /** Radius of a city now (`CityView.radiusOf`). */
    private readonly radiusOf: (node: number) => number,
    /** The baked shapes drawn in screen px (the plate and chips of the arenas). */
    private readonly sprites: SpriteCache,
  ) {
    this.layer.addChild(this.arrows, this.leaverLayer);
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
    this.shots = new ShotView(layers.layer.effects, me, sprites);
    const enemy: PlayerId = me === 0 ? 1 : 0;
    this.particles = new ParticleLayer(layers.layer.effects, {
      own: ownerColor(me, me),
      enemy: ownerColor(me, enemy),
    });
    this.shots.raiseHeads(layers.layer.effects);
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
    /** The captures under way (`MapView.captures`): their light at the city. */
    floods: readonly Flood[] = [],
  ): readonly Punch[] {
    this.readEvents(events);
    const reduced = reducedMotion();
    const live = this.trackContacts(frame, spots, enemies);
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
    this.drawLeavers(frame.tick, roundTicks, live, spots, enemies);
    this.captureLights(floods, scale);
    this.particles.end();
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
  ): Set<string> {
    const live = new Set<string>();
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
      const points = contactPoints(this.map, place, { own, enemy });
      this.contacts.set(placeKey(place), {
        contacts: points,
        points,
        seen: { own: own !== undefined, enemy: enemy !== undefined },
      });
      live.add(placeKey(place));
    }
    return live;
  }

  private contactsAt(place: FightPlace): Contacts {
    return this.contacts.get(placeKey(place))?.contacts ?? contactPoints(this.map, place, {});
  }

  /**
   * A side whose fight is over and whose token is gone (it died or it retreated) still has the last
   * shots of its fight flying at it: its place keeps a faded helmet until they have landed (#811).
   */
  private drawLeavers(
    tick: number,
    roundTicks: number,
    live: ReadonlySet<string>,
    spots: ReadonlyMap<string, TokenSpot>,
    enemies: EnemyAnchors | null,
  ): void {
    const standing = (side: 'own' | 'enemy', place: FightPlace, at: Point): boolean => {
      const still = (p: Point | undefined): boolean =>
        p !== undefined && Math.hypot(p.x - at.x, p.y - at.y) <= LEAVER_STILL;
      if (side === 'own') {
        for (const spot of spots.values()) if (still(spot)) return true;
        return false;
      }
      // No anchors of the enemy: nothing says it left, so no ghost.
      if (enemies === null) return true;
      return still(
        place.node !== null
          ? enemies.nodePoint(place.node)
          : place.edge === null
            ? undefined
            : enemies.nearestOnEdge(place.edge, at),
      );
    };
    const ghosts = leaversOf(
      this.fightView.rounds(),
      tick,
      roundTicks,
      live,
      (key) => this.contacts.get(key),
      standing,
    );
    const k = 1.5 / this.cameraScale;
    ghosts.forEach((ghost, i) => {
      let sprite = this.leavers[i];
      if (sprite === undefined) {
        sprite = this.leaverLayer.addChild(this.sprites.sprite());
        this.leavers.push(sprite);
      }
      const own = ghost.side === 'own';
      sprite.set(
        helmetChipSpec('charged', !own, ownerColor(this.me, own ? this.me : this.me === 0 ? 1 : 0)),
      );
      sprite.position.set(ghost.at.x, ghost.at.y);
      sprite.scale.set(own ? k : -k, k);
      sprite.alpha = ghost.alpha;
      sprite.visible = true;
    });
    for (let i = ghosts.length; i < this.leavers.length; i++) {
      const sprite = this.leavers[i];
      if (sprite !== undefined) sprite.visible = false;
    }
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

  // --- Capture: the light at the city and the flag over it (#819, ui-style 49) ------------------

  /**
   * The light of a capture at its city: one flash (not when the enemy captured) and a ring of the new
   * owner's colour leaving it. The colour itself floods the area in `MapView`; both run on the
   * flood's own clock, so the flash starts with the flood.
   */
  private captureLights(floods: readonly Flood[], scale: number): void {
    for (const flood of floods) {
      if (flood.to === null) continue;
      const light = cityLight(flood.ms, flood.calm, flood.reduced);
      if (light === null) continue;
      const radius = this.radiusOf(flood.node) * scale;
      if (light.flash > 0) {
        this.particles.put({
          kind: 'glow',
          x: flood.at.x,
          y: flood.at.y,
          // The glow of the atlas reaches half its size.
          size: 2 * CAPTURE.flash.reach * radius,
          color: PAPER,
          alpha: light.flash,
          add: true,
        });
      }
      this.particles.put({
        kind: 'ring',
        x: flood.at.x,
        y: flood.at.y,
        size: (light.ringRadius * radius) / RING_RADIUS_SHARE,
        color: ownerColor(this.me, flood.to),
        alpha: light.ring,
        add: true,
      });
    }
  }

  private drawFlags(tick: number, tickHz: number, scale: number): void {
    let used = 0;
    for (const capture of this.captures) {
      const t = effectProgress(tick - capture.tick, FLAG_MS, tickHz);
      if (t === null || used >= MAX_FLAGS) continue;
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
