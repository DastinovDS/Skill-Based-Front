import { Container, Graphics } from 'pixi.js';
import type { EventMsg, MapFile, PlayerId } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { Point } from './camera.ts';
import {
  bounceArrow,
  bounceInfo,
  captureInfo,
  effectProgress,
  scaledPolygon,
  waveLook,
  type BounceInfo,
  type CaptureInfo,
} from './effectsLayout.ts';
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
  WAVE_FILL_ALPHA,
  WAVE_MS,
  WAVE_STROKE,
  ownerColor,
} from './style.ts';

/** Ticks between rounds when the source does not say (`rulesets/mvp-0.toml`). */
const DEFAULT_ROUND_TICKS = 10;
const MAX_WAVES = 4;
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
  private readonly waves: Graphics[] = [];
  private readonly arrows = new Graphics();
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
    radiusOf: (node: number) => number,
  ) {
    this.layer.addChild(this.arrows);
    layers.layer.effects.addChild(this.layer);
    this.fightView = new FightView(map, layers, me, labelResolution, radiusOf);
  }

  setLabelResolution(resolution: number): void {
    this.fightView.setLabelResolution(resolution);
  }

  update(
    frame: RenderFrame,
    events: readonly EventMsg[],
    spots: ReadonlyMap<string, TokenSpot>,
    tickHz: number,
    roundTicks: number = DEFAULT_ROUND_TICKS,
  ): void {
    this.readEvents(events);
    const reduced = reducedMotion();
    this.fightView.update(frame, events, tickHz, roundTicks, reduced);
    this.drawWaves(frame.tick, tickHz, reduced);
    this.drawBounces(frame, spots, tickHz, reduced);
  }

  destroy(): void {
    this.fightView.destroy();
    this.arrows.destroy();
    this.layer.destroy({ children: true });
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
