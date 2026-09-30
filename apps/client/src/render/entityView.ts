import { Container, Graphics, Text } from 'pixi.js';
import type { RenderFrame, RenderGroup } from '../net/interpolate.ts';
import type {
  EdgeView,
  EventMsg,
  IntentView,
  MapFile,
  Mode,
  NodeView,
  PlayerId,
  SnapshotMsg,
} from '../protocol.gen.ts';
import type { MapLayers } from './layers.ts';
import {
  BAR,
  TOKEN_COMPACT,
  TOKEN_FULL,
  arrowGeometry,
  dashSegments,
  edgeEnds,
  edgePoint,
  fightInfo,
  fightMarkAlpha,
  nodePoint,
  nodeSlots,
  roadPosition,
  sideways,
  warehouseBar,
  type FightInfo,
} from './layout.ts';
import type { Point } from './camera.ts';
import { edgeMarkerPoint, nodeMarkerPoint } from './fogLayout.ts';
import { EntityKit, Token } from './shapes.ts';
import {
  ARROW_DASH,
  ARROW_GAP,
  ARROW_HEAD,
  ARROW_OUTLINE,
  ARROW_WIDTH,
  CAPITAL_RADIUS,
  HEADING_DISTANCE,
  INTENT_ICON_ANGLE,
  INTENT_ICON_DISTANCE,
  NODE_RADIUS,
  ORDER_LINE_ALPHA,
  PACKET_SCALE,
  PLAYER_COLOR,
  PLATE_FILL,
} from './style.ts';

const MAX_FIGHT_MARKS = 8;

function other(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function around(distance: number, degrees: number): Point {
  const rad = (degrees * Math.PI) / 180;
  return { x: distance * Math.cos(rad), y: distance * Math.sin(rad) };
}

/** An object with a label that follows the zoom-dependent text resolution. */
interface Labelled {
  labels(): Text[];
}

interface GroupEntry extends Labelled {
  token: Token;
  heading: Graphics;
  stamp: number;
  view: Container;
}

interface PacketEntry extends Labelled {
  dot: Graphics;
  label: Text;
  stamp: number;
  view: Container;
}

interface FightMark extends Labelled {
  view: Container;
  chips: [Chip, Chip];
  shown: FightInfo | null;
}

interface Chip {
  plate: Graphics;
  text: Text;
}

/**
 * Everything the snapshot puts on top of the map (CLI-04, #60): warehouse bars, own groups with
 * charge pips, own packets moving along roads, what is known about enemies (a marker per city or
 * road, with numbers only where the snapshot has them), intents of both players as arrows, and
 * fight marks from events.
 *
 * Two kinds of input. `update(frame)` runs every frame: moving things (groups, packets, order
 * lines, fight marks). Things that change only with a snapshot (bars, enemy markers, intent
 * arrows) are redrawn when `frame.base` is a different snapshot than last time.
 *
 * Nothing is computed here that the server did not send: paths come from orders, enemy numbers
 * from `Seen`, losses from `fight` events. `destroy()` releases every object and context.
 */
export class EntityView {
  /** Shared with the fog layer (ghosts use the same tokens); released by `destroy()`. */
  readonly kit = new EntityKit();
  private readonly enemy: PlayerId;
  private readonly bars: Container[];
  private readonly enemyNodes: (Token | null)[];
  private readonly enemyEdges: (Token | null)[];
  private readonly enemyLayer = new Container({ label: 'enemy' });
  private readonly packetLayer = new Container({ label: 'packets' });
  private readonly groupLayer = new Container({ label: 'own-groups' });
  private readonly orders = new Graphics();
  private readonly arrows = new Graphics();
  private readonly icons = new Container({ label: 'intent-icons' });
  private readonly iconPool: Container[] = [];
  private readonly fightLayer = new Container({ label: 'fights' });
  private readonly fightMarks: FightMark[] = [];
  private readonly groups = new Map<string, GroupEntry>();
  private readonly packets = new Map<string, PacketEntry>();
  private fights: FightInfo[] = [];
  private eventsSeen: readonly EventMsg[] | null = null;
  private eventCount = -1;
  private base: SnapshotMsg | null = null;
  private stamp = 0;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private labelResolution: number,
  ) {
    this.enemy = other(me);
    this.bars = map.nodes.map((node) => {
      const bar = new Container({ label: `bar-${String(node.id)}`, visible: false });
      const radius = node.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS;
      bar.position.set(node.x - BAR.width / 2, node.y - radius - 10 - BAR.height);
      bar.addChild(new Graphics(this.kit.barFrame));
      bar.addChild(new Graphics(this.kit.barFill[0]));
      bar.addChild(new Graphics(this.kit.barMarks(2)));
      return layers.layer.nodes.addChild(bar);
    });
    this.enemyNodes = map.nodes.map(() => null);
    this.enemyEdges = map.edges.map(() => null);

    // Order lines go under the tokens of the groups they belong to; arrows of intents on top.
    layers.layer.groups.addChild(this.orders, this.enemyLayer, this.packetLayer, this.groupLayer);
    layers.layer.intents.addChild(this.arrows, this.icons);
    layers.layer.effects.addChild(this.fightLayer);
  }

  setLabelResolution(resolution: number): void {
    this.labelResolution = resolution;
    const texts: Text[] = [];
    for (const token of [...this.enemyNodes, ...this.enemyEdges]) {
      if (token !== null) texts.push(token.text);
    }
    for (const entry of [...this.groups.values(), ...this.packets.values(), ...this.fightMarks]) {
      texts.push(...entry.labels());
    }
    for (const text of texts) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
  }

  update(frame: RenderFrame, events: readonly EventMsg[]): void {
    if (frame.base !== this.base) {
      this.base = frame.base;
      this.applyBase(frame.base);
    }
    this.updateEvents(events);
    this.stamp++;
    const points = this.updateGroups(frame.groups);
    this.updatePackets(frame);
    this.drawOrders(frame.groups, points);
    this.updateFights(frame.tick);
  }

  destroy(): void {
    // Containers and their children first: they reference the shared contexts, which Graphics
    // leaves alone. The two Graphics below own their contexts and are destroyed without options.
    this.arrows.destroy();
    this.orders.destroy();
    for (const container of [
      ...this.bars,
      this.enemyLayer,
      this.packetLayer,
      this.groupLayer,
      this.icons,
      this.fightLayer,
    ]) {
      container.destroy({ children: true });
    }
    this.kit.destroy();
  }

  // --- Snapshot-driven part -----------------------------------------------------------------

  private applyBase(base: SnapshotMsg): void {
    const { nodes, edges, intents } = base.view;
    nodes.forEach((node) => {
      this.setBar(node);
      this.setEnemyNode(node);
    });
    edges.forEach((edge) => {
      this.setEnemyEdge(edge);
    });
    this.drawIntents(intents);
  }

  private setBar(node: NodeView): void {
    const bar = this.bars[node.id];
    if (bar === undefined) return;
    const shown = node.detail === 'exact' && node.warehouse !== null;
    bar.visible = shown;
    if (!shown || node.warehouse === null) return;
    const { ratio } = warehouseBar(node.warehouse, node.capacity);
    const [, fill, marks] = bar.children as [Graphics, Graphics, Graphics];
    fill.context = this.kit.barFill[node.owner ?? this.me];
    fill.scale.x = ratio * BAR.width;
    marks.context = this.kit.barMarks(node.capacity);
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
    const size = node.seen?.level === 'exact' ? TOKEN_FULL : TOKEN_COMPACT;
    const at = nodeMarkerPoint(this.map, node.id, size.width);
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

  private drawIntents(intents: readonly IntentView[]): void {
    const g = this.arrows;
    g.clear();
    let icons = 0;
    for (const intent of intents) {
      const from = nodePoint(this.map, intent.origin);
      if (from === undefined) continue;
      const to = intent.target === null ? undefined : nodePoint(this.map, intent.target);
      if (intent.kind === 'planned_move' && to !== undefined) {
        this.drawArrow(g, intent, from, to);
      } else if (intent.kind !== 'planned_move') {
        this.placeIcon(icons++, intent, from);
      }
    }
    // Hide the icons left over from the previous snapshot.
    for (let i = icons; i < this.iconPool.length; i++) {
      const icon = this.iconPool[i];
      if (icon !== undefined) icon.visible = false;
    }
  }

  private drawArrow(g: Graphics, intent: IntentView, from: Point, to: Point): void {
    const color = PLAYER_COLOR[intent.owner];
    // Both players' arrows on one road run side by side instead of on top of each other.
    const lane = intent.owner === 0 ? 5 : -5;
    const start = sideways(from, to, from, lane);
    const end = sideways(from, to, to, lane);
    const arrow = arrowGeometry(
      start,
      end,
      NODE_RADIUS + 6,
      NODE_RADIUS + 6,
      ARROW_HEAD.length,
      ARROW_HEAD.width,
    );
    if (arrow === null) return;
    const dashes = dashSegments(arrow.start, arrow.end, ARROW_DASH, ARROW_GAP);
    for (const [a, b] of dashes) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    g.stroke(ARROW_OUTLINE);
    for (const [a, b] of dashes) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    g.stroke({ width: ARROW_WIDTH, color });
    const [tip, left, right] = arrow.head;
    g.poly([tip.x, tip.y, left.x, left.y, right.x, right.y])
      .fill(color)
      .stroke({ width: 1.5, color: PLATE_FILL });
    // The tail tells the owner without colour: a dot for player 0, a hollow diamond for player 1.
    const { x, y } = arrow.start;
    if (intent.owner === 0) {
      g.circle(x, y, 4).fill(color).stroke({ width: 1.5, color: PLATE_FILL });
    } else {
      g.poly([x, y - 5.5, x + 5.5, y, x, y + 5.5, x - 5.5, y])
        .fill(PLATE_FILL)
        .stroke({ width: 2, color });
    }
  }

  private placeIcon(index: number, intent: IntentView, at: Point): void {
    let icon = this.iconPool[index];
    if (icon === undefined) {
      icon = this.icons.addChild(new Container());
      icon.addChild(new Graphics(this.kit.iconDisc[0]));
      icon.addChild(new Graphics(this.kit.glyph.defense));
      this.iconPool.push(icon);
    }
    const [disc, glyph] = icon.children as [Graphics, Graphics];
    const mode: Mode = intent.kind === 'build' ? 'build' : 'defense';
    disc.context = this.kit.iconDisc[intent.owner];
    glyph.context = this.kit.glyph[mode];
    const node = this.map.nodes[intent.origin];
    const radius = node?.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS;
    const offset = around(radius + INTENT_ICON_DISTANCE, INTENT_ICON_ANGLE);
    icon.position.set(at.x + offset.x, at.y + offset.y);
    icon.visible = true;
  }

  // --- Frame-driven part --------------------------------------------------------------------

  /** Returns the drawn position of every group by id, for the order lines. */
  private updateGroups(groups: readonly RenderGroup[]): Map<string, Point> {
    const points = new Map<string, Point>();
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
      const entry = this.groupEntry(item.group.id);
      entry.stamp = this.stamp;
      entry.token.set({
        owner: this.me,
        modes: [item.group.mode],
        counts: { units: item.group.units, charged: item.group.charged },
      });
      const { location } = item;
      let at: Point | undefined;
      entry.heading.visible = false;
      if (location.kind === 'node') {
        const node = nodePoint(this.map, location.node);
        const list = perNode.get(location.node) ?? [];
        const radius =
          this.map.nodes[location.node]?.capital_of === null ? NODE_RADIUS : CAPITAL_RADIUS;
        const slot = nodeSlots(list.length, radius)[list.indexOf(item)];
        if (node !== undefined && slot !== undefined)
          at = { x: node.x + slot.x, y: node.y + slot.y };
      } else {
        const ends = edgeEnds(this.map, location.edge);
        const edge = this.map.edges[location.edge];
        if (ends !== undefined && edge !== undefined) {
          const fromIsA = edge.a === location.from_node;
          at = roadPosition(ends.a, ends.b, fromIsA, location.progress);
          const from = fromIsA ? ends.a : ends.b;
          const to = fromIsA ? ends.b : ends.a;
          const angle = Math.atan2(to.y - from.y, to.x - from.x);
          entry.heading.visible = true;
          entry.heading.rotation = angle;
          entry.heading.position.set(
            Math.cos(angle) * HEADING_DISTANCE,
            Math.sin(angle) * HEADING_DISTANCE,
          );
        }
      }
      entry.view.visible = at !== undefined;
      if (at !== undefined) {
        entry.view.position.set(at.x, at.y);
        points.set(item.group.id, at);
      }
    }
    sweep(this.groups, this.stamp);
    return points;
  }

  private groupEntry(id: string): GroupEntry {
    let entry = this.groups.get(id);
    if (entry === undefined) {
      const view = this.groupLayer.addChild(new Container({ label: `group-${id}` }));
      const token = new Token(this.kit, this.labelResolution);
      const heading = new Graphics(this.kit.heading);
      view.addChild(token.view, heading);
      entry = { token, heading, view, stamp: this.stamp, labels: () => [token.text] };
      this.groups.set(id, entry);
    }
    return entry;
  }

  private updatePackets(frame: RenderFrame): void {
    for (const item of frame.packets) {
      const { packet } = item;
      const ends = edgeEnds(this.map, packet.edge);
      const edge = this.map.edges[packet.edge];
      let entry = this.packets.get(packet.id);
      if (entry === undefined) {
        const view = this.packetLayer.addChild(new Container({ label: `packet-${packet.id}` }));
        const dot = view.addChild(new Graphics(this.kit.pipFilled[this.me]));
        dot.scale.set(PACKET_SCALE);
        const label = view.addChild(
          new Text({
            text: '',
            style: this.kit.textStyle,
            anchor: { x: 0, y: 0.5 },
            resolution: this.labelResolution,
          }),
        );
        label.position.set(9, 0);
        entry = { dot, label, view, stamp: this.stamp, labels: () => [label] };
        this.packets.set(packet.id, entry);
      }
      entry.stamp = this.stamp;
      const shown = ends !== undefined && edge !== undefined;
      entry.view.visible = shown;
      if (!shown) continue;
      const at = edgePoint(ends.a, ends.b, edge.a === packet.from_node, item.progress);
      entry.view.position.set(at.x, at.y);
      // The number of charges matters only when it is more than the one dot.
      const text = packet.charges > 1 ? String(packet.charges) : '';
      if (entry.label.text !== text) entry.label.text = text;
    }
    sweep(this.packets, this.stamp);
  }

  private drawOrders(groups: readonly RenderGroup[], points: Map<string, Point>): void {
    const g = this.orders;
    g.clear();
    const color = PLAYER_COLOR[this.me];
    for (const { group } of groups) {
      const from = points.get(group.id);
      if (group.order === null || from === undefined) continue;
      g.moveTo(from.x, from.y);
      for (const id of group.order.path) {
        const step = nodePoint(this.map, id);
        if (step !== undefined) g.lineTo(step.x, step.y);
      }
      g.stroke({ width: 2, color, alpha: ORDER_LINE_ALPHA });
      const dest = nodePoint(this.map, group.order.dest);
      if (dest !== undefined)
        g.circle(dest.x, dest.y, NODE_RADIUS + 5).stroke({
          width: 2,
          color,
          alpha: ORDER_LINE_ALPHA,
        });
    }
  }

  private updateEvents(events: readonly EventMsg[]): void {
    if (events === this.eventsSeen && events.length === this.eventCount) return;
    this.eventsSeen = events;
    this.eventCount = events.length;
    this.fights = [];
    for (const event of events) {
      const info = fightInfo(event, this.map);
      if (info !== null) this.fights.push(info);
    }
  }

  private updateFights(tick: number): void {
    let used = 0;
    for (const fight of this.fights) {
      const alpha = fightMarkAlpha(fight.event.tick, tick);
      if (alpha === null || used >= MAX_FIGHT_MARKS) continue;
      const mark = this.fightMark(used++);
      if (mark.shown !== fight) {
        mark.shown = fight;
        mark.view.position.set(fight.at.x, fight.at.y);
        mark.chips.forEach((chip, player) => {
          chip.text.text = `-${String(fight.losses[player] ?? 0)}`;
        });
      }
      mark.view.alpha = alpha;
      mark.view.visible = true;
    }
    for (let i = used; i < this.fightMarks.length; i++) {
      const mark = this.fightMarks[i];
      if (mark !== undefined) {
        mark.view.visible = false;
        mark.shown = null;
      }
    }
  }

  private fightMark(index: number): FightMark {
    let mark = this.fightMarks[index];
    if (mark === undefined) {
      const view = this.fightLayer.addChild(new Container({ label: 'fight' }));
      view.addChild(new Graphics(this.kit.swords));
      const chip = (player: PlayerId): Chip => {
        const plate = view.addChild(new Graphics(this.kit.plateCompact[player]));
        plate.position.set(player === 0 ? -22 : 22, 22);
        const text = view.addChild(
          new Text({
            text: '',
            style: this.kit.textStyle,
            anchor: 0.5,
            resolution: this.labelResolution,
          }),
        );
        text.position.copyFrom(plate.position);
        // Player 0's chip sits on the left, player 1's on the right.
        return { plate, text };
      };
      const chips: [Chip, Chip] = [chip(0), chip(1)];
      mark = { view, chips, shown: null, labels: () => [chips[0].text, chips[1].text] };
      this.fightMarks.push(mark);
    }
    return mark;
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
