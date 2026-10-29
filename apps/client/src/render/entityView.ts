import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import {
  EDGE_LENGTH,
  type RenderFrame,
  type RenderGroup,
  type RenderPacket,
} from '../net/interpolate.ts';
import type { MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { MapLayers } from './layers.ts';
import {
  buildGeometry,
  edgeEnds,
  edgePoint,
  nodePoint,
  roadPosition,
  packetFade,
  timeLeftLabel,
  type TokenSpot,
} from './layout.ts';
import { symbolScale, type Point } from './camera.ts';
import { iconPoint, stackGroups, stackKey, type CityIcon } from './cityStacks.ts';
import { nodeMarkerPoint } from './fogLayout.ts';
import { buildProgress } from './roadLayout.ts';
import { knownOfSeen } from './rangeLabel.ts';
import type { SpriteCache } from './bake.ts';
import { EntityKit, Token } from './shapes.ts';
import { FigureView } from './figureView.ts';
import {
  BUILD_PLATE,
  BUILD_TIME_FONT_SIZE,
  PACKET_TAIL,
  PACKET_TAIL_TRANSFER_EXTRA,
  PACKET_TRANSFER,
  ROAD_TAPE,
  roadSpan,
} from './style.ts';

function other(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

/** An object with a label that follows the zoom-dependent text resolution. */
interface Labelled {
  labels(): Text[];
}

interface GroupEntry extends Labelled {
  token: Token;
  stamp: number;
  view: Container;
  owner: PlayerId;
}

/** Where enemies stand on the map now (the effects of a fight go over them). */
export interface EnemyAnchors {
  /** The enemy marker of a city; `undefined` if none is drawn. */
  nodePoint(node: number): Point | undefined;
  /** The enemy figure on a road nearest to `to`; `undefined` if none is drawn there. */
  nearestOnEdge(edge: number, to: Point): Point | undefined;
}

interface PacketEntry extends Labelled {
  /** The squares behind the packet (`PACKET_TAIL`), nearest first. */
  tail: Graphics[];
  dot: Graphics;
  label: Text;
  transfer: boolean;
  stamp: number;
  view: Container;
}

/** The plate with the level change on a road being built, with the time left for an own build. */
interface BuildMark {
  view: Container;
  level: Text;
  time: Text;
}

/**
 * Everything the snapshot puts on top of the map (CLI-04, #60; units and packets: ui-style 9.5 and
 * 9.6): warehouse bars, own groups as inverted triangles (no trail: the arrow of their order is the intent view's), own packets gliding
 * along roads into and out of the city icons, what is known about enemies (a marker per city or
 * road, with numbers only where the snapshot has them), intents of both players as arrows, road
 * builds (DEC-28, item 7: a hazard tape under the lanes of the road with the part done, a plate
 * "1 to 2" in its middle, the time left for an own build). Fight, bounce and capture effects are `EffectsView`.
 *
 * Two kinds of input. `update(frame)` runs every frame: moving things (groups, packets, order
 * lines). Things that change only with a snapshot (bars, enemy markers, intent
 * arrows) are redrawn when `frame.base` is a different snapshot than last time.
 *
 * Nothing is computed here that the server did not send: paths come from orders, enemy numbers
 * from `Seen`. `destroy()` releases every object and context.
 */
export class EntityView implements EnemyAnchors {
  /** Shared with the fog layer (ghosts use the same tokens); released by `destroy()`. */
  readonly kit: EntityKit;
  private readonly enemy: PlayerId;
  private readonly enemyNodes: (Token | null)[];
  /** Enemy figures on the halves of roads in sight (DEC-33): EF2 "Pointer", #354. */
  private readonly figures: FigureView;
  private readonly enemyLayer = new Container({ label: 'enemy' });
  private readonly markLayer = new Container({ label: 'figure-marks' });
  private readonly packetLayer = new Container({ label: 'packets' });
  private readonly groupLayer = new Container({ label: 'own-groups' });
  private readonly buildTape = new Graphics();
  private readonly buildLayer = new Container({ label: 'builds' });
  private readonly buildMarks: BuildMark[] = [];
  private readonly timeStyle: TextStyle;
  private readonly levelStyle: TextStyle;
  private tickHz = 10;
  /** Ticks a road level takes to build (`ruleset_public.build.ticks_per_level`): the part done. */
  private buildTicks = 0;
  private cameraScale = 1;
  private readonly groups = new Map<string, GroupEntry>();
  private readonly packets = new Map<string, PacketEntry>();
  private base: SnapshotMsg | null = null;
  private stamp = 0;
  private spots: ReadonlyMap<string, TokenSpot> = new Map();
  private edgeSpots: ReadonlyMap<string, TokenSpot> = new Map();
  private icons: readonly CityIcon[] = [];
  /** The cities where an own icon stands in the middle. */
  private ownIcons: ReadonlySet<number> = new Set();
  /** Enemy city markers that swell now (a hit): put back to their size on the next call of `punch`. */
  private punched: Token[] = [];

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private labelResolution: number,
    /** Radius of a city now (by its capacity class, `CityView.radiusOf`). */
    private readonly radiusOf: (node: number) => number,
    /** The baked shapes of the tokens (`bake.ts`). */
    sprites: SpriteCache,
  ) {
    this.kit = new EntityKit(me, sprites);
    this.enemy = other(me);
    this.enemyNodes = map.nodes.map(() => null);
    this.figures = new FigureView(
      map,
      this.enemyLayer,
      this.markLayer,
      this.kit,
      this.enemy,
      labelResolution,
    );

    this.timeStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: BUILD_TIME_FONT_SIZE,
      fontWeight: '700',
      fill: 0xf0f6fc,
      stroke: { color: 0x0d1117, width: 3, join: 'round' },
    });
    this.levelStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: BUILD_PLATE.fontSize,
      fontWeight: '700',
      fill: 0xf0f6fc,
    });
    // The tape of a road build lies under the lanes: first in the layer of the roads.
    layers.layer.roads.addChildAt(this.buildTape, 0);
    layers.layer.groups.addChild(
      this.enemyLayer,
      this.markLayer,
      this.packetLayer,
      this.groupLayer,
    );
    layers.layer.intents.addChild(this.buildLayer);
  }

  setLabelResolution(resolution: number): void {
    this.labelResolution = resolution;
    const texts: Text[] = [];
    for (const token of this.enemyTokens()) texts.push(...token.labels());
    texts.push(...this.figures.labels());
    for (const entry of [...this.groups.values(), ...this.packets.values()]) {
      texts.push(...entry.labels());
    }
    for (const mark of this.buildMarks) texts.push(mark.level, mark.time);
    for (const text of texts) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
  }

  /** Ticks a road level takes to build (`ruleset_public.build.ticks_per_level`); 0: unknown, no part done. */
  setBuildTicks(ticks: number): void {
    if (ticks === this.buildTicks) return;
    this.buildTicks = ticks;
    if (this.base !== null) this.drawBuilds(this.base);
  }

  /** Ticks per second (`ruleset_public.tick_hz`), for the time left of own road builds. */
  setTickHz(tickHz: number): void {
    if (tickHz === this.tickHz) return;
    this.tickHz = tickHz;
    if (this.base !== null) this.drawBuilds(this.base);
  }

  /** Drawn centre, side and symbol scale of the own group tokens by id (hit testing, selection). */
  groupPoints(): ReadonlyMap<string, TokenSpot> {
    return this.spots;
  }

  /** The own groups on roads (each its own token), by id: hit testing. */
  roadGroupPoints(): ReadonlyMap<string, TokenSpot> {
    return this.edgeSpots;
  }

  /** The icons of the own units standing in cities: hit testing and the anchors of menus. */
  cityIcons(): readonly CityIcon[] {
    return this.icons;
  }

  /** The «Supply» map mode hides the road builds drawn on the road layer (DEC-28, item 8). */
  setSupplyMode(on: boolean): void {
    this.buildTape.visible = !on;
  }

  nodePoint(node: number): Point | undefined {
    const token = this.enemyNodes[node];
    return token?.view.visible === true ? { x: token.view.x, y: token.view.y } : undefined;
  }

  nearestOnEdge(edge: number, to: Point): Point | undefined {
    let best: Point | undefined;
    let bestDistance = Infinity;
    for (const spot of this.figures.spots()) {
      if (spot.edge !== edge) continue;
      const distance = Math.hypot(spot.at.x - to.x, spot.at.y - to.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = spot.at;
      }
    }
    return best;
  }

  /**
   * Tokens that swell for a moment (a hit, E3 «token pop»): the token standing at `at` is scaled by
   * `scale` on top of its size on screen. Runs after `update`, which sets the sizes every frame;
   * the markers of cities are set only on a change, so these are put back here.
   */
  punch(punches: readonly { readonly at: Point; readonly scale: number }[]): void {
    for (const token of this.punched) token.setScale(symbolScale(token.side, this.cameraScale));
    this.punched = [];
    for (const { at, scale } of punches) {
      const near = (view: Container): boolean =>
        view.visible && Math.abs(view.x - at.x) < 1.5 && Math.abs(view.y - at.y) < 1.5;
      for (const entry of this.groups.values()) {
        if (near(entry.view)) entry.view.scale.set(entry.view.scale.x * scale);
      }
      // A figure on a road: its container is rescaled every frame, so there is nothing to put back.
      for (const spot of this.figures.spots()) {
        if (near(spot.view)) spot.view.scale.set(spot.view.scale.x * scale);
      }
      for (const token of this.enemyTokens()) {
        if (!near(token.view)) continue;
        token.view.scale.set(symbolScale(token.side, this.cameraScale) * scale);
        this.punched.push(token);
      }
    }
  }

  /** Every token of enemies seen: in cities and on roads. */
  private enemyTokens(): Token[] {
    const tokens: Token[] = [];
    for (const token of this.enemyNodes) if (token !== null) tokens.push(token);
    return tokens;
  }

  /** Camera scale (CSS px per world unit): triangles never get smaller than 20 px on screen. */
  setCameraScale(scale: number): void {
    if (scale === this.cameraScale) return;
    this.cameraScale = scale;
    for (const token of this.enemyTokens()) token.setScale(symbolScale(token.side, scale));
    for (const mark of this.buildMarks) mark.view.scale.set(this.plateScale());
  }

  /** The plate of a build keeps the minimum size of a symbol on screen (ui-style 22). */
  private plateScale(): number {
    return symbolScale(BUILD_PLATE.height, this.cameraScale);
  }

  update(frame: RenderFrame): void {
    if (frame.base !== this.base) {
      this.base = frame.base;
      this.applyBase(frame.base);
    }
    this.stamp++;
    this.spots = this.updateGroups(frame.groups);
    this.placeEnemyNodes();
    this.figures.update(frame.enemies, frame.tick, this.tickHz, this.cameraScale, this.stamp);
    this.updatePackets(frame);
  }

  destroy(): void {
    // Containers and their children first: they reference the shared contexts, which Graphics
    // leaves alone. The two Graphics below own their contexts and are destroyed without options.
    this.buildTape.destroy();
    this.figures.destroy();
    for (const container of [
      this.buildLayer,
      this.enemyLayer,
      this.markLayer,
      this.packetLayer,
      this.groupLayer,
    ]) {
      container.destroy({ children: true });
    }
    this.kit.destroy();
    this.timeStyle.destroy();
    this.levelStyle.destroy();
  }

  // --- Snapshot-driven part -----------------------------------------------------------------

  private applyBase(base: SnapshotMsg): void {
    const { nodes } = base.view;
    nodes.forEach((node) => {
      this.setEnemyNode(node);
    });
    this.drawBuilds(base);
  }

  /**
   * Road builds (DEC-28, item 7: on the edge, paid with CP): a hazard tape along the whole road
   * (stripes on a dark band, a solid band over the part that is done) under its lanes, and a plate
   * "level to level+1" in the middle of the road. An own build (the server sends its `done_tick`)
   * also shows the time left and the part done; an enemy one in sight only the tape.
   */
  private drawBuilds(base: SnapshotMsg): void {
    const { edges } = base.view;
    const g = this.buildTape;
    g.clear();
    let used = 0;
    for (const road of edges) {
      const build = road.build;
      const edge = this.map.edges[road.id];
      if (build === null || edge === undefined) continue;
      const from = nodePoint(this.map, edge.a);
      const to = nodePoint(this.map, edge.b);
      if (from === undefined || to === undefined) continue;
      const progress =
        build.done_tick === null ? 0 : buildProgress(build.done_tick, base.tick, this.buildTicks);
      const geometry = buildGeometry(
        from,
        to,
        roadSpan(road.width) + ROAD_TAPE.extra,
        ROAD_TAPE.period,
        ROAD_TAPE.stripe,
        progress,
      );
      if (geometry === null) continue;
      g.poly(geometry.band.flatMap((p) => [p.x, p.y])).fill(ROAD_TAPE.base);
      for (const stripe of geometry.stripes) g.poly(stripe.flatMap((p) => [p.x, p.y]));
      g.fill(ROAD_TAPE.stripeColor);
      if (geometry.done !== null) {
        g.poly(geometry.done.flatMap((p) => [p.x, p.y])).fill(ROAD_TAPE.done);
      }

      const mark = this.buildMark(used++);
      mark.view.position.set(geometry.mid.x, geometry.mid.y);
      mark.view.visible = true;
      const change = `${String(road.width)}\u2192${String(road.width + 1)}`;
      if (mark.level.text !== change) mark.level.text = change;
      const time =
        build.done_tick === null ? '' : timeLeftLabel(build.done_tick - base.tick, this.tickHz);
      mark.time.visible = time !== '';
      if (mark.time.text !== time) mark.time.text = time;
    }
    for (let i = used; i < this.buildMarks.length; i++) {
      const mark = this.buildMarks[i];
      if (mark !== undefined) mark.view.visible = false;
    }
  }

  private buildMark(index: number): BuildMark {
    let mark = this.buildMarks[index];
    if (mark === undefined) {
      const view = this.buildLayer.addChild(new Container({ label: 'build' }));
      view.scale.set(this.plateScale());
      view.addChild(new Graphics(this.kit.buildPlate));
      const level = view.addChild(
        new Text({
          text: '',
          style: this.levelStyle,
          anchor: 0.5,
          resolution: this.labelResolution,
        }),
      );
      const time = view.addChild(
        new Text({
          text: '',
          style: this.timeStyle,
          anchor: { x: 0.5, y: 0 },
          resolution: this.labelResolution,
        }),
      );
      time.position.set(0, BUILD_PLATE.height / 2 + BUILD_PLATE.timeGap - 4);
      mark = { view, level, time };
      this.buildMarks.push(mark);
    }
    return mark;
  }

  /** The token for what the player knows about enemies in a place; `null`: nothing to show. */
  private enemyToken(
    current: Token | null,
    seen: NodeView['seen'],
    detail: NodeView['detail'],
    parent: Container,
    inside: boolean,
  ): Token | null {
    const shown =
      seen !== null && detail !== 'fog' && seen.level !== 'fog' && seen.enemy_modes.length > 0;
    if (!shown) {
      if (current !== null) current.view.visible = false;
      return current;
    }
    const token = current ?? new Token(this.kit, this.labelResolution);
    if (current === null) parent.addChild(token.view);
    const { counts, range } = knownOfSeen(seen);
    token.set({ owner: this.enemy, modes: seen.enemy_modes, counts, range, inside });
    token.setLabel(true);
    token.setScale(symbolScale(token.side, this.cameraScale));
    token.view.visible = true;
    return token;
  }

  /** What is seen of enemies in a city: a token like the own one, placed every frame (`placeEnemyNodes`). */
  private setEnemyNode(node: NodeView): void {
    this.enemyNodes[node.id] = this.enemyToken(
      this.enemyNodes[node.id] ?? null,
      node.seen,
      node.detail,
      this.enemyLayer,
      true,
    );
  }

  /**
   * Enemies seen in a city stand in the middle of it like own units (the number inside, or "?"
   * without numbers); beside it only where an own icon already holds the middle. Redone every
   * frame because own groups come and go between snapshots.
   */
  private placeEnemyNodes(): void {
    this.enemyNodes.forEach((token, id) => {
      if (token === null || !token.view.visible) return;
      const city = nodePoint(this.map, id);
      if (city === undefined) return;
      const marker = nodeMarkerPoint(this.map, id, token.side, this.radiusOf(id));
      const at = iconPoint(city, marker, false, this.ownIcons.has(id));
      token.view.position.set(at.x, at.y);
    });
  }

  // --- Frame-driven part --------------------------------------------------------------------

  /**
   * Returns the drawn spot of every group by id (the order lines, hit testing, the selection).
   * Groups standing in a city are one icon per side (`cityStacks`): the own one in the middle of
   * the city, the opponent's (a replay shows both sides) too, beside it only when an own icon is there; every group of a stack has the
   * spot of its icon. A group on a road is a token of its own.
   */
  private updateGroups(groups: readonly RenderGroup[]): Map<string, TokenSpot> {
    const spots = new Map<string, TokenSpot>();
    const edgeSpots = new Map<string, TokenSpot>();
    const icons: CityIcon[] = [];
    const stacks = stackGroups(groups, this.me);
    const mine = new Set(stacks.filter((stack) => stack.owner === this.me).map((s) => s.node));
    this.ownIcons = mine;
    for (const stack of stacks) {
      const entry = this.groupEntry(stackKey(stack.node, stack.owner), stack.owner);
      entry.stamp = this.stamp;
      entry.token.set({
        owner: stack.owner,
        modes: stack.modes,
        counts: { units: stack.units, charged: stack.charged },
        defense: stack.defense,
        inside: true,
      });
      const city = nodePoint(this.map, stack.node);
      const own = stack.owner === this.me;
      const marker =
        city === undefined
          ? undefined
          : nodeMarkerPoint(this.map, stack.node, entry.token.side, this.radiusOf(stack.node));
      const at =
        city === undefined ? undefined : iconPoint(city, marker, own, mine.has(stack.node));
      entry.view.visible = at !== undefined;
      if (at === undefined) continue;
      const scale = symbolScale(entry.token.side, this.cameraScale);
      entry.view.scale.set(scale);
      entry.view.position.set(at.x, at.y);
      entry.token.setLabel(true);
      const spot: TokenSpot = { x: at.x, y: at.y, side: entry.token.side, scale };
      for (const id of stack.ids) spots.set(id, spot);
      if (own) icons.push({ ...stack, spot });
    }
    for (const item of groups) {
      if (item.location.kind === 'node') continue;
      const owner = item.owner ?? this.me;
      const entry = this.groupEntry(item.group.id, owner);
      entry.stamp = this.stamp;
      entry.token.set({
        owner,
        modes: [item.group.mode],
        counts: { units: item.group.units, charged: item.group.charged },
      });
      const { location } = item;
      let at: Point | undefined;
      const ends = edgeEnds(this.map, location.edge);
      const edge = this.map.edges[location.edge];
      if (ends !== undefined && edge !== undefined) {
        const fromIsA = edge.a === location.from_node;
        at = roadPosition(ends.a, ends.b, fromIsA, location.progress);
      }
      entry.view.visible = at !== undefined;
      if (at === undefined) continue;
      const scale = symbolScale(entry.token.side, this.cameraScale);
      entry.view.scale.set(scale);
      entry.view.position.set(at.x, at.y);
      // One short number: always shown (the exact units and charged are the tooltip's).
      entry.token.setLabel(true);
      const spot: TokenSpot = { x: at.x, y: at.y, side: entry.token.side, scale };
      spots.set(item.group.id, spot);
      edgeSpots.set(item.group.id, spot);
    }
    sweep(this.groups, this.stamp);
    this.edgeSpots = edgeSpots;
    this.icons = icons;
    return spots;
  }

  private groupEntry(id: string, owner: PlayerId): GroupEntry {
    let entry = this.groups.get(id);
    if (entry === undefined) {
      const view = this.groupLayer.addChild(new Container({ label: `group-${id}` }));
      const token = new Token(this.kit, this.labelResolution);
      view.addChild(token.view);
      entry = {
        token,
        view,
        stamp: this.stamp,
        owner,
        labels: () => token.labels(),
      };
      this.groups.set(id, entry);
    }
    return entry;
  }

  private updatePackets(frame: RenderFrame): void {
    for (const item of frame.packets) {
      const entry = this.packetEntry(item);
      entry.stamp = this.stamp;
      const { packet } = item;
      const ends = edgeEnds(this.map, packet.edge);
      const edge = this.map.edges[packet.edge];
      const shown = ends !== undefined && edge !== undefined;
      entry.view.visible = shown;
      if (!shown) continue;
      const fromIsA = edge.a === packet.from_node;
      const at = edgePoint(ends.a, ends.b, fromIsA, item.progress);
      entry.view.position.set(at.x, at.y);
      // Near a city the packet shrinks and fades into its icon (or grows out of it): no jump
      // when it leaves the snapshot, and no packet sticking to the rim of the city.
      const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y);
      const travelled = (item.progress / EDGE_LENGTH) * length;
      const near = packetFade(travelled, this.radiusOf(packet.from_node));
      const far = packetFade(length - travelled, this.radiusOf(fromIsA ? edge.b : edge.a));
      entry.view.scale.set(Math.min(near.scale, far.scale));
      entry.view.alpha = Math.min(near.alpha, far.alpha);
      // The tail lies behind the packet, along the road against its way.
      const way = fromIsA ? 1 : -1;
      const ux = length > 0 ? (way * (ends.b.x - ends.a.x)) / length : 0;
      const uy = length > 0 ? (way * (ends.b.y - ends.a.y)) / length : 0;
      const extra = packet.transfer ? PACKET_TAIL_TRANSFER_EXTRA : 0;
      PACKET_TAIL.forEach((step, i) => {
        entry.tail[i]?.position.set(-ux * (step.distance + extra), -uy * (step.distance + extra));
      });
      // The number of charges matters only when it is more than the one square.
      const text = packet.charges > 1 ? `\u00d7${String(packet.charges)}` : '';
      if (entry.label.text !== text) entry.label.text = text;
    }
    sweep(this.packets, this.stamp);
  }

  private packetEntry(item: RenderPacket): PacketEntry {
    const { packet } = item;
    let entry = this.packets.get(packet.id);
    if (entry === undefined) {
      const view = this.packetLayer.addChild(new Container({ label: `packet-${packet.id}` }));
      const owner = item.owner ?? this.me;
      // The far square of the tail first, so that the packet lies on top.
      const tail = [...this.kit.packetTail[owner]]
        .reverse()
        .map((context) => view.addChild(new Graphics(context)))
        .reverse();
      const dot = view.addChild(
        new Graphics(packet.transfer ? this.kit.packetTransfer[owner] : this.kit.packet[owner]),
      );
      const label = view.addChild(
        new Text({
          text: '',
          style: this.kit.textStyle,
          anchor: { x: 0, y: 0.5 },
          resolution: this.labelResolution,
        }),
      );
      label.position.set(packet.transfer ? PACKET_TRANSFER.ring / 2 + 3 : 8, 0);
      entry = {
        tail,
        dot,
        label,
        transfer: packet.transfer,
        view,
        stamp: this.stamp,
        labels: () => [label],
      };
      this.packets.set(packet.id, entry);
    }
    return entry;
  }
}

/** Destroy entries not touched in the latest `update` (an entity that left the snapshot). */
function sweep<T extends { stamp: number; view: Container }>(
  pool: Map<string, T>,
  stamp: number,
): void {
  for (const [id, entry] of pool) {
    if (entry.stamp !== stamp) {
      entry.view.destroy({ children: true });
      pool.delete(id);
    }
  }
}
