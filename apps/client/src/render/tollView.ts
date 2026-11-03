import { Container, Graphics, GraphicsContext, Text, TextStyle } from 'pixi.js';
import type { EventMsg, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { EnemyAnchors } from './entityView.ts';
import { borderPoint } from './fogLayout.ts';
import type { LineMark } from './fortView.ts';
import type { Punch } from './hitView.ts';
import type { TokenSpot } from './layout.ts';
import { ParticleLayer } from './particles.ts';
import { reducedMotion } from './motion.ts';
import { BG, NUMBERS_RISE, PAPER, PLATE_FILL, WARN, ownerColor } from './style.ts';
import {
  TOLL_MS,
  tollMs,
  tollNumber,
  tollInfo,
  tollParticles,
  tollPop,
  tollSeed,
  type TollInfo,
} from './tollLayout.ts';
import type { MapFile } from '../protocol.gen.ts';

/** Most tolls drawn at once (a long road of lines taxes a group several times a second at most). */
const MAX_TOLLS = 8;
/** The plate of the number sits this far above the group (world units at 100%). */
const PLATE_LIFT = 24;
/** The dashed amber ring round a group that paid, and how far it reaches. */
const WARN_RING = 17;

interface Plate {
  readonly view: Container;
  readonly frame: Graphics;
  readonly text: Text;
  mine: boolean;
}

/**
 * The toll of road fortifications on the map (K6 "Beam", ui-style 42): per toll the beam, the ring,
 * the flash, the sparks and the flung charges go to a `ParticleLayer` of its own, and the number
 * "-N" is a pooled plate drawn here, both in the layer `tolls`, which the «Supply» mode does not hide. When the viewing player paid, the plate has a down
 * triangle and an amber frame and a dashed amber ring turns round the group, so the loss is told by
 * more than the hue; when the own line took it, the plate is plain. Every effect is a function of
 * the render tick, so a paused scene shows a toll in the state of its tick. With "less motion" only
 * the plate stays, still. `destroy()` frees the pool.
 */
export class TollView {
  private readonly layer = new Container({ label: 'tolls' });
  private readonly plates: Plate[] = [];
  private readonly frames: { mine: GraphicsContext; enemy: GraphicsContext };
  private readonly style: TextStyle;
  private readonly colors: { own: number; enemy: number };
  private readonly particles: ParticleLayer;
  private tolls: readonly TollInfo[] = [];
  private eventsSeen: readonly EventMsg[] | null = null;
  private eventCount = -1;

  constructor(
    parent: Container,
    private readonly map: MapFile,
    me: PlayerId,
    private resolution: number,
    /** Where the toll of the line of `node` on `edge` leaves it (`FortView.lineAt`). */
    private readonly lineAt: (node: number, edge: number) => LineMark | undefined,
  ) {
    const enemy: PlayerId = me === 0 ? 1 : 0;
    this.colors = { own: ownerColor(me, me), enemy: ownerColor(me, enemy) };
    this.particles = new ParticleLayer(parent, this.colors);
    const plate = (mine: boolean): GraphicsContext => {
      const ctx = new GraphicsContext()
        .roundRect(-19, -8.5, 38, 17, 4)
        .fill({ color: PLATE_FILL, alpha: 0.94 })
        .stroke(mine ? { width: 1.6, color: WARN } : { width: 1, color: PAPER, alpha: 0.7 });
      // A down triangle: the own loss, in a shape as well as in the amber.
      if (mine) ctx.poly([-14, -3, -6, -3, -10, 4]).fill(WARN);
      return ctx;
    };
    this.frames = { mine: plate(true), enemy: plate(false) };
    this.style = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: 12,
      fontWeight: '700',
      fill: PAPER,
      stroke: { color: BG, width: 2, join: 'round' },
    });
    parent.addChild(this.layer);
  }

  setScreenResolution(resolution: number): void {
    this.resolution = resolution;
    for (const plate of this.plates) plate.text.resolution = resolution;
  }

  /**
   * Draws the tolls of the frame: particles into `emit`, plates here; returns the tokens that swell.
   * `scale`: the size of everything on the map (more when zoomed out).
   */
  update(
    events: readonly EventMsg[],
    tick: number,
    spots: ReadonlyMap<string, TokenSpot>,
    enemies: EnemyAnchors | null,
    tickHz: number,
    scale: number,
  ): Punch[] {
    this.readEvents(events);
    const reduced = reducedMotion();
    const punches: Punch[] = [];
    const emit = (particle: Parameters<ParticleLayer['put']>[0]): void => {
      this.particles.put(particle);
    };
    this.particles.begin();
    let used = 0;
    for (const toll of this.tolls) {
      const ms = tollMs(tick - toll.tick, tickHz);
      if (ms === null || used >= MAX_TOLLS) continue;
      const road = this.map.edges[toll.edge];
      if (road === undefined) continue;
      const mark = this.lineAt(toll.node, toll.edge);
      const border: Point = borderPoint(this.map, toll.edge) ?? { x: 0, y: 0 };
      const from: Point = mark ?? border;
      const at = this.victimAt(toll, from, spots, enemies);
      const victim = toll.paid ? 'own' : 'enemy';
      if (!reduced) {
        tollParticles(emit, ms, {
          from,
          at,
          colors: this.colors,
          victim,
          charges: toll.charges,
          scale,
          seed: tollSeed(toll),
        });
        const pop = tollPop(ms);
        if (pop !== 1) punches.push({ at, scale: pop });
        if (toll.paid) {
          // The dashed amber ring of the group that paid: it turns and fades with the number.
          const p = ms / TOLL_MS;
          emit({
            kind: 'dashRing',
            x: at.x,
            y: at.y,
            size: 2 * WARN_RING * scale,
            color: WARN,
            alpha: 0.95 * (1 - p * p),
            rotation: p * 2.2,
          });
        }
      } else if (toll.paid) {
        emit({
          kind: 'dashRing',
          x: at.x,
          y: at.y,
          size: 2 * WARN_RING * scale,
          color: WARN,
          alpha: 0.95,
        });
      }
      const number = tollNumber(ms, reduced, NUMBERS_RISE);
      if (number === null) continue;
      const plate = this.plate(used++, toll.paid);
      const lift = (PLATE_LIFT + number.lift) * scale;
      plate.view.position.set(at.x, at.y - lift);
      plate.view.scale.set(scale);
      plate.view.alpha = number.alpha;
      const label = `-${String(toll.charges)}`;
      if (plate.text.text !== label) plate.text.text = label;
      plate.text.position.set(toll.paid ? 6 : 0, 0.5);
      plate.view.visible = true;
    }
    this.particles.end();
    for (let i = used; i < this.plates.length; i++) {
      const plate = this.plates[i];
      if (plate !== undefined) plate.view.visible = false;
    }
    return punches;
  }

  /** The tolls among the events, read again only when the list has grown. */
  private readEvents(events: readonly EventMsg[]): void {
    if (events === this.eventsSeen && events.length === this.eventCount) return;
    this.eventsSeen = events;
    this.eventCount = events.length;
    this.tolls = events.flatMap((event) => tollInfo(event) ?? []);
  }

  /** The group that lost the charges: the own token, or the enemy figure on the road nearest the line. */
  private victimAt(
    toll: TollInfo,
    from: Point,
    spots: ReadonlyMap<string, TokenSpot>,
    enemies: EnemyAnchors | null,
  ): Point {
    if (toll.group !== null) {
      const spot = spots.get(toll.group);
      if (spot !== undefined) return { x: spot.x, y: spot.y };
      return from;
    }
    return enemies?.nearestOnEdge(toll.edge, from) ?? from;
  }

  private plate(index: number, mine: boolean): Plate {
    let plate = this.plates[index];
    if (plate === undefined) {
      const view = this.layer.addChild(new Container({ label: 'toll-plate', visible: false }));
      const frame = view.addChild(new Graphics(this.frames.enemy));
      const text = view.addChild(
        new Text({ text: '', style: this.style, anchor: 0.5, resolution: this.resolution }),
      );
      plate = { view, frame, text, mine: false };
      this.plates.push(plate);
    }
    if (plate.mine !== mine) {
      plate.frame.context = mine ? this.frames.mine : this.frames.enemy;
      plate.mine = mine;
    }
    return plate;
  }

  destroy(): void {
    this.particles.destroy();
    this.layer.destroy({ children: true });
    this.frames.mine.destroy();
    this.frames.enemy.destroy();
    this.style.destroy();
  }
}
