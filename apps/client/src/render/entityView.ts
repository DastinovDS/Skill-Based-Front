import { Container, Graphics, Text, TextStyle } from 'pixi.js';
import {
  EDGE_LENGTH,
  type RenderFrame,
  type RenderGroup,
  type RenderPacket,
} from '../net/interpolate.ts';
import type { EdgeView, MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { MapLayers } from './layers.ts';
import {
  buildGeometry,
  edgeEnds,
  edgePoint,
  nodePoint,
  nodeSlots,
  roadPosition,
  packetFade,
  timeLeftLabel,
  type TokenSpot,
} from './layout.ts';
import { symbolScale, type Point } from './camera.ts';
import { NODE_SLOT_RADIUS } from './cityLayout.ts';
import { edgeMarkerPoint, nodeMarkerPoint } from './fogLayout.ts';
import { EntityKit, Token } from './shapes.ts';
import {
  BUILD_MARK_DISTANCE,
  BUILD_TIE,
  BUILD_TIE_CASING,
  BUILD_TIME_FONT_SIZE,
  roadThickness,
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

interface PacketEntry extends Labelled {
  dot: Graphics;
  label: Text;
  stamp: number;
  view: Container;
}

/** The hammer disc on a road a city builds, with the time left for an own build. */
interface BuildMark {
  view: Container;
  disc: Graphics;
  time: Text;
}

/**
 * Everything the snapshot puts on top of the map (CLI-04, #60; units and packets: ui-style 9.5 and
 * 9.6): warehouse bars, own groups as inverted triangles (no trail: the arrow of their order is the intent view's), own packets gliding
 * along roads into and out of the city icons, what is known about enemies (a marker per city or
 * road, with numbers only where the snapshot has them), intents of both players as arrows, road
 * builds of cities (DEC-16: bars across the road and a hammer disc, the time left for an own
 * build). Fight, bounce and capture effects are `EffectsView`.
 *
 * Two kinds of input. `update(frame)` runs every frame: moving things (groups, packets, order
 * lines). Things that change only with a snapshot (bars, enemy markers, intent
 * arrows) are redrawn when `frame.base` is a different snapshot than last time.
 *
 * Nothing is computed here that the server did not send: paths come from orders, enemy numbers
 * from `Seen`. `destroy()` releases every object and context.
 */
export class EntityView {
  /** Shared with the fog layer (ghosts use the same tokens); released by `destroy()`. */
  readonly kit: EntityKit;
  private readonly enemy: PlayerId;
  private readonly enemyNodes: (Token | null)[];
  private readonly enemyEdges: (Token | null)[];
  private readonly enemyLayer = new Container({ label: 'enemy' });
  private readonly packetLayer = new Container({ label: 'packets' });
  private readonly groupLayer = new Container({ label: 'own-groups' });
  private readonly buildTies = new Graphics();
  private readonly buildLayer = new Container({ label: 'builds' });
  private readonly buildMarks: BuildMark[] = [];
  private readonly timeStyle: TextStyle;
  private tickHz = 10;
  private cameraScale = 1;
  private readonly groups = new Map<string, GroupEntry>();
  private readonly packets = new Map<string, PacketEntry>();
  private base: SnapshotMsg | null = null;
  private stamp = 0;
  private spots: ReadonlyMap<string, TokenSpot> = new Map();

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private labelResolution: number,
    /** Radius of a city now (by its capacity class, `CityView.radiusOf`). */
    private readonly radiusOf: (node: number) => number,
  ) {
    this.kit = new EntityKit(me);
    this.enemy = other(me);
    this.enemyNodes = map.nodes.map(() => null);
    this.enemyEdges = map.edges.map(() => null);

    this.timeStyle = new TextStyle({
      fontFamily: 'system-ui, sans-serif',
      fontSize: BUILD_TIME_FONT_SIZE,
      fontWeight: '700',
      fill: 0xf0f6fc,
      stroke: { color: 0x0d1117, width: 3, join: 'round' },
    });
    // Road builds lie on the roads, under the groups.
    layers.layer.roads.addChild(this.buildTies);
    layers.layer.groups.addChild(this.enemyLayer, this.packetLayer, this.groupLayer);
    layers.layer.intents.addChild(this.buildLayer);
  }

  setLabelResolution(resolution: number): void {
    this.labelResolution = resolution;
    const texts: Text[] = [];
    for (const token of [...this.enemyNodes, ...this.enemyEdges]) {
      if (token !== null) texts.push(...token.labels());
    }
    for (const entry of [...this.groups.values(), ...this.packets.values()]) {
      texts.push(...entry.labels());
    }
    for (const mark of this.buildMarks) texts.push(mark.time);
    for (const text of texts) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
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

  /** Camera scale (CSS px per world unit): triangles never get smaller than 20 px on screen. */
  setCameraScale(scale: number): void {
    if (scale === this.cameraScale) return;
    this.cameraScale = scale;
    for (const token of [...this.enemyNodes, ...this.enemyEdges]) {
      if (token !== null) token.setScale(symbolScale(token.side, scale));
    }
  }

  update(frame: RenderFrame): void {
    if (frame.base !== this.base) {
      this.base = frame.base;
      this.applyBase(frame.base);
    }
    this.stamp++;
    this.spots = this.updateGroups(frame.groups);
    this.updatePackets(frame);
  }

  destroy(): void {
    // Containers and their children first: they reference the shared contexts, which Graphics
    // leaves alone. The two Graphics below own their contexts and are destroyed without options.
    this.buildTies.destroy();
    for (const container of [this.buildLayer, this.enemyLayer, this.packetLayer, this.groupLayer]) {
      container.destroy({ children: true });
    }
    this.kit.destroy();
    this.timeStyle.destroy();
  }

  // --- Snapshot-driven part -----------------------------------------------------------------

  private applyBase(base: SnapshotMsg): void {
    const { nodes, edges } = base.view;
    nodes.forEach((node) => {
      this.setEnemyNode(node);
    });
    edges.forEach((edge) => {
      this.setEnemyEdge(edge);
    });
    this.drawBuilds(base);
  }

  /**
   * Road builds of cities (DEC-16): bars across the road and a hammer disc of the owner near the
   * building city; an own build (the server sends its `done_tick`) also shows the time left.
   */
  private drawBuilds(base: SnapshotMsg): void {
    const { nodes, edges } = base.view;
    const g = this.buildTies;
    g.clear();
    let used = 0;
    for (const node of nodes) {
      const build = node.build;
      const owner = node.owner;
      const edge = build === null ? undefined : this.map.edges[build.edge];
      if (build === null || owner === null || edge === undefined) continue;
      const other = edge.a === node.id ? edge.b : edge.a;
      const from = nodePoint(this.map, node.id);
      const to = nodePoint(this.map, other);
      if (from === undefined || to === undefined) continue;
      const width = edges[build.edge]?.width ?? edge.base_width;
      const geometry = buildGeometry(
        from,
        to,
        this.radius(node.id),
        this.radius(other),
        (roadThickness(width) + BUILD_TIE.extra) / 2,
        BUILD_TIE.spacing,
        BUILD_MARK_DISTANCE,
      );
      if (geometry === null) continue;
      for (const [a, b] of geometry.ties) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke(BUILD_TIE_CASING);
      for (const [a, b] of geometry.ties) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke({ width: BUILD_TIE.width, color: BUILD_TIE.color });

      const mark = this.buildMark(used++);
      mark.disc.context = this.kit.iconDisc[owner];
      mark.view.position.set(geometry.mark.x, geometry.mark.y);
      mark.view.visible = true;
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
      const disc = view.addChild(new Graphics(this.kit.iconDisc[0]));
      view.addChild(new Graphics(this.kit.hammer));
      const time = view.addChild(
        new Text({
          text: '',
          style: this.timeStyle,
          anchor: { x: 0.5, y: 0 },
          resolution: this.labelResolution,
        }),
      );
      time.position.set(0, 11);
      mark = { view, disc, time };
      this.buildMarks.push(mark);
    }
    return mark;
  }

  private radius(node: number): number {
    return this.radiusOf(node);
  }

  /** The token for what the player knows about enemies in a place; `null`: nothing to show. */
  private enemyToken(
    current: Token | null,
    seen: NodeView['seen'],
    detail: NodeView['detail'],
    parent: Container,
  ): Token | null {
    const shown =
      seen !== null && detail !== 'fog' && seen.level !== 'fog' && seen.enemy_modes.length > 0;
    if (!shown) {
      if (current !== null) current.view.visible = false;
      return current;
    }
    const token = current ?? new Token(this.kit, this.labelResolution);
    if (current === null) parent.addChild(token.view);
    const exact =
      seen.level === 'exact' && seen.enemy_units !== null && seen.enemy_charged !== null;
    token.set({
      owner: this.enemy,
      modes: seen.enemy_modes,
      counts: exact ? { units: seen.enemy_units ?? 0, charged: seen.enemy_charged ?? 0 } : null,
    });
    token.setLabel(true);
    token.setScale(symbolScale(token.side, this.cameraScale));
    token.view.visible = true;
    return token;
  }

  private setEnemyNode(node: NodeView): void {
    const token = this.enemyToken(
      this.enemyNodes[node.id] ?? null,
      node.seen,
      node.detail,
      this.enemyLayer,
    );
    this.enemyNodes[node.id] = token;
    if (token === null) return;
    const at = nodeMarkerPoint(this.map, node.id, token.side, this.radiusOf(node.id));
    if (at !== undefined) token.view.position.set(at.x, at.y);
  }

  private setEnemyEdge(edge: EdgeView): void {
    const token = this.enemyToken(
      this.enemyEdges[edge.id] ?? null,
      edge.seen,
      edge.detail,
      this.enemyLayer,
    );
    this.enemyEdges[edge.id] = token;
    if (token === null) return;
    const at = edgeMarkerPoint(this.map, edge.id);
    if (at !== undefined) token.view.position.set(at.x, at.y);
  }

  // --- Frame-driven part --------------------------------------------------------------------

  /** Returns the drawn spot of every group by id (the order lines, hit testing, the selection). */
  private updateGroups(groups: readonly RenderGroup[]): Map<string, TokenSpot> {
    const spots = new Map<string, TokenSpot>();
    // Tokens standing in one city fan out under it.
    const perNode = new Map<number, RenderGroup[]>();
    for (const item of groups) {
      if (item.location.kind === 'node') {
        const list = perNode.get(item.location.node) ?? [];
        list.push(item);
        perNode.set(item.location.node, list);
      }
    }
    for (const item of groups) {
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
      if (location.kind === 'node') {
        const node = nodePoint(this.map, location.node);
        const list = perNode.get(location.node) ?? [];
        // Tokens stand under the rings and the warehouse bar of the city.
        const slot = nodeSlots(list.length, NODE_SLOT_RADIUS)[list.indexOf(item)];
        if (node !== undefined && slot !== undefined)
          at = { x: node.x + slot.x, y: node.y + slot.y };
      } else {
        const ends = edgeEnds(this.map, location.edge);
        const edge = this.map.edges[location.edge];
        if (ends !== undefined && edge !== undefined) {
          const fromIsA = edge.a === location.from_node;
          at = roadPosition(ends.a, ends.b, fromIsA, location.progress);
        }
      }
      entry.view.visible = at !== undefined;
      if (at === undefined) continue;
      const scale = symbolScale(entry.token.side, this.cameraScale);
      entry.view.scale.set(scale);
      entry.view.position.set(at.x, at.y);
      const id = item.group.id;
      // One short number: always shown (the exact units and charged are the tooltip's).
      entry.token.setLabel(true);
      spots.set(id, { x: at.x, y: at.y, side: entry.token.side, scale });
    }
    sweep(this.groups, this.stamp);
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
      // The number of charges matters only when it is more than the one dot.
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
      const dot = view.addChild(new Graphics(this.kit.packet[item.owner ?? this.me]));
      const label = view.addChild(
        new Text({
          text: '',
          style: this.kit.textStyle,
          anchor: { x: 0, y: 0.5 },
          resolution: this.labelResolution,
        }),
      );
      label.position.set(8, 0);
      entry = { dot, label, view, stamp: this.stamp, labels: () => [label] };
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
