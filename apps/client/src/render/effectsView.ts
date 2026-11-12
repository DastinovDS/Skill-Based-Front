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
import { ParryView } from './parryView.ts';
import { floodDelayMs, type Walk } from './walkLayout.ts';
import type { EnemyAnchors } from './entityView.ts';
import type { Point } from './camera.ts';
import {
  bounceInfo,
  homeChevronShape,
  homeChevrons,
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
import { nodePoint, type TokenSpot } from './layout.ts';
import { ringRadius } from './cityLayout.ts';
import { reducedMotion } from './motion.ts';
import { DEFAULT_ROUND_TICKS } from './source.ts';
import {
  BOUNCE_HOME,
  CAPTURE,
  CASING,
  INK,
  WARN,
  ownerColor,
  sideColours,
  type PlayerColours,
} from './style.ts';

/** Flags of captures drawn at once. */
const MAX_FLAGS = 4;
/** A token this close to the place of a fight (world units) is a group of that fight: the token of a city, a marker beside it, a figure on its road. */
const CONTACT_REACH = 80;
const near = (a: Point, b: Point): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= CONTACT_REACH;
/** Places of fights whose contacts are remembered (a long match has many roads): past it the memory starts over. */
const MAX_REMEMBERED_PLACES = 64;

/**
 * Effects of events on the map (ui-style 9.9, U8): the animation of fights (`FightView`: arena,
 * losses, result; `ParryView`: the shots, #856), the amber chevrons running ahead of an own group
 * bounced home (Chevrons home, #851), and the ring and the flag of a captured city (#819; the new owner's
 * band floods the area in `MapView`), Engraved: no glow, every coloured line on a dark casing. With
 * "less motion" the shots and the ring are left out, the chevrons stand and the numbers do not rise. Events come from the server
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
  private readonly shots: ParryView;
  /** The ring leaving a captured city (#819, Engraved #856). */
  private readonly rings = new Graphics({ label: 'capture-rings' });
  /** The walks of the captures (#856): the flag of a capture waits for its walker. */
  private walks: readonly Walk[] = [];
  private ringsDrawn = false;
  private resolution = 1;
  /** Where the two sides of each fight stood the last time they were seen (the tokens): ended fights keep it. */
  private readonly contacts = new Map<string, PlaceMemory & { readonly contacts: Contacts }>();
  /** The faded helmets of sides that left a fight while its last shots are in the air (#811). */
  private readonly leaverLayer = new Container({ label: 'fight-leavers', eventMode: 'none' });
  private readonly leavers: BakedSprite[] = [];
  private cameraScale = 1;
  /** The chevrons of bounces going home (Chevrons home, #851). */
  private readonly arrows = new Graphics({ label: 'bounce-home' });
  /** The flag over a captured city, one drawing per owner, pooled. */
  private readonly flags: Graphics[] = [];
  private readonly flagContext: readonly [GraphicsContext, GraphicsContext];
  private captures: CaptureInfo[] = [];
  private bounces: BounceInfo[] = [];
  /** Where each bounced group goes home to (the node it left), found on its first frame on the road. */
  private readonly homeOf = new Map<string, number>();
  /** Bounces whose group got home (or was lost): their chevrons are over. */
  private readonly homeDone = new Set<string>();
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
    /** The colours of the players by id (DEC-49); today's look by default. */
    private readonly colours: PlayerColours = sideColours(me),
  ) {
    this.layer.addChild(this.rings, this.arrows, this.leaverLayer);
    this.flagContext = [
      flagContext(ownerColor(this.colours, 0)),
      flagContext(ownerColor(this.colours, 1)),
    ];
    layers.layer.effects.addChild(this.layer);
    // The shots lie under the arenas: a shot over a city does not hide the plate that floats above it.
    this.shots = new ParryView(layers.layer.effects, me, sprites, colours);
    const enemy: PlayerId = me === 0 ? 1 : 0;
    this.particles = new ParticleLayer(layers.layer.effects, {
      own: ownerColor(this.colours, me),
      enemy: ownerColor(this.colours, enemy),
    });
    this.hits = new HitView(layers.layer.effects, map, me, labelResolution, radiusOf);
    this.fightView = new FightView(map, layers, me, labelResolution, radiusOf, sprites, colours);
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
    if (resolution > 0) this.resolution = resolution;
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
      frame.tick,
      this.fightView.rounds(),
      roundTicks,
      (place) => this.contactsAt(place),
      scale,
      1 / Math.max(1e-6, this.cameraScale * this.resolution),
      reduced,
    );
    this.drawLeavers(frame.tick, roundTicks, live, spots, enemies);
    this.particles.end();
    this.captureRings(floods, scale);
    this.drawFlags(frame.tick, tickHz, scale);
    this.drawBounces(frame, spots, tickHz, reduced);
    return punches;
  }

  /** The walks of the captures (`captureWalks`): a flag waits for its walker to reach the city. */
  setWalks(walks: readonly Walk[]): void {
    this.walks = walks;
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
        helmetChipSpec(
          'charged',
          !own,
          ownerColor(this.colours, own ? this.me : this.me === 0 ? 1 : 0),
        ),
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
    // Forget the homes of bounces that left the event list.
    const live = new Set(this.bounces.map(bounceKey));
    for (const key of this.homeOf.keys()) {
      if (!live.has(key)) this.homeOf.delete(key);
    }
    for (const key of this.homeDone) {
      if (!live.has(key)) this.homeDone.delete(key);
    }
  }

  // --- Capture: the light at the city and the flag over it (#819, ui-style 49) ------------------

  /**
   * The ring that leaves a captured city (#819; Engraved, #856, mockup `captureRing`): a line of the
   * new owner's colour on a dark casing, growing out from the ring of the city and fading; half as
   * strong for the opponent's capture. It runs on the flood's own clock, so it starts with the flood.
   */
  private captureRings(floods: readonly Flood[], scale: number): void {
    // Redrawn only while a ring leaves a city; an idle frame does not touch the Graphics.
    if (floods.length === 0 && !this.ringsDrawn) return;
    const g = this.rings.clear();
    this.ringsDrawn = false;
    for (const flood of floods) {
      if (flood.to === null) continue;
      const light = cityLight(flood.ms, flood.calm, flood.reduced);
      if (light === null) continue;
      const r = ringRadius(this.radiusOf(flood.node)) + light.ringRadius * scale;
      g.circle(flood.at.x, flood.at.y, r)
        .stroke({ width: CAPTURE.ring.casing * scale, color: CASING, alpha: light.ring })
        .stroke({
          width: CAPTURE.ring.line * scale,
          color: ownerColor(this.colours, flood.to),
          alpha: light.ring,
        });
      this.ringsDrawn = true;
    }
  }

  private drawFlags(tick: number, tickHz: number, scale: number): void {
    let used = 0;
    for (const capture of this.captures) {
      // A captured city whose winner walks in gets its flag with the flood, as the walker crosses the ring.
      const walk = this.walks.find((w) => w.node === capture.node && w.end === capture.tick);
      const wait = walk === undefined ? 0 : (floodDelayMs(walk, tickHz) * tickHz) / 1000;
      const t = effectProgress(tick - capture.tick - wait, FLAG_MS, tickHz);
      if (t === null || used >= MAX_FLAGS) continue;
      const flag = this.flag(used++);
      // The foot of the pole just outside the ring, upper right (mockup `flagMark`, mirrored: the
      // left of a city may hold its buildings).
      const ring = ringRadius(this.radiusOf(capture.node));
      flag.context = this.flagContext[capture.player];
      flag.position.set(capture.at.x + (ring + 4) * scale, capture.at.y - (ring - 4) * scale);
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

  // --- Bounce: Chevrons home (#851, ui-style 54m) ------------------------------------------------

  /**
   * Three amber chevrons run ahead of an own bounced group to the node it came from, while it walks
   * the road home (the server puts it back on its edge going to `from_node`, DEC-38 item 4). They
   * end when it stands in a node again, is gone, or after `BOUNCE_HOME.maxMs`.
   */
  private drawBounces(
    frame: RenderFrame,
    spots: ReadonlyMap<string, TokenSpot>,
    tickHz: number,
    reduced: boolean,
  ): void {
    const g = this.arrows;
    g.clear();
    if (tickHz <= 0) return;
    const seconds = reduced ? 0 : frame.tick / tickHz;
    for (const bounce of this.bounces) {
      const key = bounceKey(bounce);
      const ageMs = ((frame.tick - bounce.tick) * 1000) / tickHz;
      if (ageMs < 0 || ageMs > BOUNCE_HOME.maxMs || this.homeDone.has(key)) continue;
      const item = frame.groups.find((entry) => entry.group.id === bounce.group);
      const spot = spots.get(bounce.group);
      if (item === undefined || spot === undefined) {
        if (this.homeOf.has(key)) this.homeDone.add(key);
        continue;
      }
      const location = item.location;
      if (location.kind !== 'edge') {
        // Home (or not yet on the road in the frames behind the event).
        if (this.homeOf.has(key)) this.homeDone.add(key);
        continue;
      }
      let home = this.homeOf.get(key);
      if (home === undefined) {
        home = location.from_node;
        this.homeOf.set(key, home);
      }
      const centre = nodePoint(this.map, home);
      if (centre === undefined) continue;
      // The way ends at the home ring.
      const far = Math.hypot(centre.x - spot.x, centre.y - spot.y);
      if (far === 0) continue;
      const rim = Math.min(far, ringRadius(this.radiusOf(home)) + BOUNCE_HOME.endGap);
      const end = {
        x: centre.x - ((centre.x - spot.x) / far) * rim,
        y: centre.y - ((centre.y - spot.y) / far) * rim,
      };
      const width = spot.width * spot.scale;
      for (const chevron of homeChevrons(spot, end, width, seconds, ageMs, spot.scale)) {
        if (chevron.alpha <= 0) continue;
        g.poly(homeChevronShape(chevron, spot.scale))
          .stroke({
            width: BOUNCE_HOME.casing * spot.scale,
            color: CASING,
            alpha: chevron.alpha,
            join: 'round',
          })
          .fill({ color: WARN, alpha: chevron.alpha });
      }
    }
  }
}

function bounceKey(bounce: BounceInfo): string {
  return `${String(bounce.tick)}:${bounce.group}`;
}

/**
 * The flag over a captured city, Engraved (#856; mockup `flagMark`): a pole in ink on a dark casing, the
 * pennant on its casing hatched in the owner's colour (the owner's horizontal lines) with an ink edge.
 * The origin is the foot of the pole.
 */
function flagContext(color: number): GraphicsContext {
  const g = new GraphicsContext();
  const pennant = [0, -16, 11, -12.5, 0, -9];
  g.moveTo(0, 0).lineTo(0, -16).stroke({ width: 4, color: CASING, cap: 'round' });
  g.poly(pennant).fill(CASING).stroke({ width: 4, color: CASING, join: 'round' });
  // The hatch: horizontal lines of the owner's colour across the pennant, 1.8 apart.
  for (let y = -15.2; y < -9.4; y += 1.8) {
    // The pennant narrows from the pole (11 wide at -12.5) to its two tips.
    const half = y < -12.5 ? (y + 16) / 3.5 : (-9 - y) / 3.5;
    g.moveTo(0.8, y).lineTo(Math.max(0.8, 11 * half), y);
  }
  g.stroke({ width: 0.9, color });
  g.poly(pennant).stroke({ width: 0.8, color: INK, join: 'round' });
  g.moveTo(0, 0).lineTo(0, -16).stroke({ width: 1.5, color: INK, cap: 'round' });
  return g;
}
