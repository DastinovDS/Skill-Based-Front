import { Container, Graphics, Text } from 'pixi.js';
import {
  EDGE_LENGTH,
  type RenderFrame,
  type RenderGroup,
  type RenderPacket,
} from '../net/interpolate.ts';
import type { MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { MapLayers } from './layers.ts';
import {
  edgeEnds,
  edgePoint,
  nodePoint,
  roadPosition,
  sideways,
  packetFade,
  type TokenSpot,
} from './layout.ts';
import { symbolScale, type Point } from './camera.ts';
import { iconPoint, stackGroups, stackKey, type CityIcon } from './cityStacks.ts';
import { nodeMarkerPoint } from './fogLayout.ts';
import { ringRadius } from './cityLayout.ts';
import { reducedMotion } from './motion.ts';
import {
  WALK,
  arrivalRoad,
  gatePoint,
  walkPoint,
  walkShare,
  walking,
  type Walk,
} from './walkLayout.ts';
import { spreadApart, type SpreadItem } from './spread.ts';
import { knownOfSeen } from './rangeLabel.ts';
import { terrainBadges } from './badgeLayout.ts';
import type { SpriteCache } from './bake.ts';
import { EntityKit, Token } from './shapes.ts';
import { FigureView } from './figureView.ts';
import { UNIT_LABEL, sideColours, type PlayerColours } from './style.ts';

const ORIGIN: Point = { x: 0, y: 0 };

/** Radius of a token on a road for spreading, as a share of its size step (the helmet plus a margin). */
const SPREAD_RADIUS = 0.55;

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
  dot: Graphics;
  label: Text;
  stamp: number;
  view: Container;
}

/**
 * Everything the snapshot puts on top of the map (CLI-04, #60; units and packets: ui-style 9.5 and
 * 9.6): warehouse bars, own groups as helmets (no trail: the arrow of their order is the intent view's), own packets gliding
 * along roads into and out of the city icons, what is known about enemies (a marker per city or
 * road, with numbers only where the snapshot has them), intents of both players as arrows, road
 * Fight, bounce and capture effects are `EffectsView`.
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
  /** Set after the first frame: what appears later fades in. */
  private warm = false;
  private tickHz = 10;
  private cameraScale = 1;
  private readonly groups = new Map<string, GroupEntry>();
  private readonly packets = new Map<string, PacketEntry>();
  private base: SnapshotMsg | null = null;
  /**
   * The terrain mark of each node and its owner, by node id (`NodeView.terrain_mark`, #791): the
   * server says which defender carries one; the icon of that owner in the city shows it.
   */
  private marks: { owner: PlayerId | null; mark: number | null }[] = [];
  private stamp = 0;
  private spots: ReadonlyMap<string, TokenSpot> = new Map();
  private edgeSpots: ReadonlyMap<string, TokenSpot> = new Map();
  private icons: readonly CityIcon[] = [];
  /** The cities where an own icon stands in the middle. */
  private ownIcons: ReadonlySet<number> = new Set();
  /** Enemy city markers that swell now (a hit): put back to their size on the next call of `punch`. */
  private punched: Token[] = [];
  /**
   * Walk in (#856): the road each side was last seen walking into each node by (`node:owner`), the
   * attacker of each node fight of the snapshot, the owners of the nodes, the walks of the captures
   * and the render tick.
   */
  private readonly arrivals = new Map<string, number>();
  private attackers = new Map<number, PlayerId | null>();
  private owners: (PlayerId | null)[] = [];
  private walks: readonly Walk[] = [];
  private tick = 0;

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    private labelResolution: number,
    /** Radius of a city now (by its capacity class, `CityView.radiusOf`). */
    private readonly radiusOf: (node: number) => number,
    /** The baked shapes of the tokens (`bake.ts`). */
    sprites: SpriteCache,
    /** The colours of the players by id (DEC-49); today's look by default. */
    colours: PlayerColours = sideColours(me),
  ) {
    this.kit = new EntityKit(me, sprites, layers.badges, colours);
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

    layers.layer.groups.addChild(
      this.enemyLayer,
      this.markLayer,
      this.packetLayer,
      this.groupLayer,
    );
  }

  setLabelResolution(resolution: number): void {
    this.labelResolution = resolution;
    const texts: Text[] = [];
    for (const token of this.enemyTokens()) texts.push(...token.labels());
    texts.push(...this.figures.labels());
    for (const entry of [...this.groups.values(), ...this.packets.values()]) {
      texts.push(...entry.labels());
    }
    for (const text of texts) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
  }

  /** Ticks per second (`ruleset_public.tick_hz`), for the fading of the enemy figures. */
  setTickHz(tickHz: number): void {
    this.tickHz = tickHz;
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

  /** Camera scale (CSS px per world unit): unit tokens never get smaller than 20 px on screen. */
  setCameraScale(scale: number): void {
    if (scale === this.cameraScale) return;
    this.cameraScale = scale;
    for (const token of this.enemyTokens()) this.scaleEnemy(token);
  }

  /** An enemy token at its size on screen; its badges keep their own floor (ui-style 32). */
  private scaleEnemy(token: Token): void {
    const scale = symbolScale(token.side, this.cameraScale);
    token.setScale(scale);
    token.setBadgeFloor(this.cameraScale * scale);
  }

  /** The badges of the icon of `owner` in `node`: its terrain mark if it holds the node (#791). */
  private badgesAt(node: number, owner: PlayerId): ReturnType<typeof terrainBadges> {
    const known = this.marks[node];
    if (known === undefined || known.owner !== owner) return [];
    return terrainBadges(known.mark);
  }

  /** The walks of the captures (`captureWalks`): the winner walks from the gate into the city. */
  setWalks(walks: readonly Walk[]): void {
    this.walks = walks;
  }

  update(frame: RenderFrame): void {
    this.updateFrame(frame);
    this.warm = true;
  }

  private updateFrame(frame: RenderFrame): void {
    if (frame.base !== this.base) {
      this.base = frame.base;
      this.applyBase(frame.base);
    }
    this.stamp++;
    this.tick = frame.tick;
    this.noteArrivals(frame);
    this.spots = this.updateGroups(frame.groups);
    this.placeEnemyNodes();
    this.figures.update(frame.enemies, frame.tick, this.tickHz, this.cameraScale, this.stamp);
    this.updatePackets(frame);
  }

  /** Eases the charge fills of the tokens by `dtMs` of real time (#508); once per frame, after `update`. */
  advance(dtMs: number): void {
    this.kit.advance(dtMs);
  }

  destroy(): void {
    // Containers and their children first: they reference the shared contexts, which Graphics
    // leaves alone. The two Graphics below own their contexts and are destroyed without options.
    this.figures.destroy();
    for (const container of [this.enemyLayer, this.markLayer, this.packetLayer, this.groupLayer]) {
      container.destroy({ children: true });
    }
    this.kit.destroy();
  }

  // --- Snapshot-driven part -----------------------------------------------------------------

  private applyBase(base: SnapshotMsg): void {
    const { nodes } = base.view;
    this.owners = nodes.map((node) => node.owner);
    this.attackers = new Map(
      base.view.fights.flatMap((fight) =>
        fight.node === null ? [] : [[fight.node, fight.attacker]],
      ),
    );
    this.marks = [];
    for (const node of nodes) {
      this.marks[node.id] = { owner: node.owner, mark: node.terrain_mark };
    }
    nodes.forEach((node) => {
      this.setEnemyNode(node);
    });
  }

  /** The token for what the player knows about enemies in a place; `null`: nothing to show. */
  private enemyToken(
    current: Token | null,
    seen: NodeView['seen'],
    detail: NodeView['detail'],
    parent: Container,
    inside: boolean,
    badges: ReturnType<typeof terrainBadges> = [],
  ): Token | null {
    const shown =
      seen !== null && detail !== 'fog' && seen.level !== 'fog' && seen.enemy_modes.length > 0;
    if (!shown) {
      if (current !== null) current.view.visible = false;
      return current;
    }
    const token = current ?? new Token(this.kit, this.labelResolution);
    if (current === null) parent.addChild(token.view);
    // Seen again after a gap (or for the first time): fade in; the very first frame is as it is.
    if ((current === null || !current.view.visible) && this.warm) token.enter();
    const { counts, range } = knownOfSeen(seen);
    token.set({ owner: this.enemy, counts, range, inside, badges });
    token.setLabel(true);
    this.scaleEnemy(token);
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
      this.badgesAt(node.id, this.enemy),
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
      const half = (token.side * symbolScale(token.side, this.cameraScale)) / 2;
      const at =
        this.standAt(id, this.enemy, half, city, marker) ??
        iconPoint(city, marker, false, this.ownIcons.has(id));
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
    // An own icon holds the middle of its city unless it stands at a gate or walks in (#856).
    const mine = new Set(
      stacks
        .filter((stack) => stack.owner === this.me && !this.offCentre(stack.node, this.me))
        .map((s) => s.node),
    );
    this.ownIcons = mine;
    for (const stack of stacks) {
      const entry = this.groupEntry(stackKey(stack.node, stack.owner), stack.owner);
      entry.stamp = this.stamp;
      entry.token.set({
        owner: stack.owner,
        counts: { units: stack.units, charged: stack.charged },
        inside: true,
        badges: this.badgesAt(stack.node, stack.owner),
      });
      const city = nodePoint(this.map, stack.node);
      const own = stack.owner === this.me;
      const marker =
        city === undefined
          ? undefined
          : nodeMarkerPoint(this.map, stack.node, entry.token.side, this.radiusOf(stack.node));
      const scale = symbolScale(entry.token.side, this.cameraScale);
      const at =
        city === undefined
          ? undefined
          : (this.standAt(stack.node, stack.owner, (entry.token.side * scale) / 2, city, marker) ??
            iconPoint(city, marker, own, mine.has(stack.node)));
      entry.view.visible = at !== undefined;
      if (at === undefined) continue;
      entry.view.scale.set(scale);
      entry.view.position.set(at.x, at.y);
      entry.token.setLabel(true);
      entry.token.setBadgeFloor(this.cameraScale * scale);
      const spot: TokenSpot = {
        x: at.x,
        y: at.y,
        side: entry.token.side,
        scale,
        enemy: !own,
        inside: true,
      };
      for (const id of stack.ids) spots.set(id, spot);
      if (own) icons.push({ ...stack, spot });
    }
    // Groups on roads: all places first, then tokens that would sit on top of each other are moved
    // apart sideways (#547): auto-merge is only in a city, so two groups can share a place on a road.
    const onRoad: { id: string; entry: GroupEntry; at: Point; item: SpreadItem }[] = [];
    for (const item of groups) {
      if (item.location.kind === 'node') continue;
      const owner = item.owner ?? this.me;
      const entry = this.groupEntry(item.group.id, owner);
      entry.stamp = this.stamp;
      entry.token.set({
        owner,
        counts: { units: item.group.units, charged: item.group.charged },
      });
      const { location } = item;
      const ends = edgeEnds(this.map, location.edge);
      const edge = this.map.edges[location.edge];
      if (ends === undefined || edge === undefined) {
        entry.view.visible = false;
        continue;
      }
      const fromIsA = edge.a === location.from_node;
      const at = roadPosition(ends.a, ends.b, fromIsA, location.progress);
      const normal = fromIsA
        ? sideways(ends.a, ends.b, ORIGIN, 1)
        : sideways(ends.b, ends.a, ORIGIN, 1);
      // The helmet and the pill under it.
      const radius =
        (entry.token.side * SPREAD_RADIUS + (UNIT_LABEL.height + UNIT_LABEL.gap) / 2) *
        symbolScale(entry.token.side, this.cameraScale);
      onRoad.push({ id: item.group.id, entry, at, item: { at, normal, radius } });
    }
    const places = spreadApart(onRoad.map((road) => road.item));
    onRoad.forEach(({ id, entry }, i) => {
      const at = places[i];
      if (at === undefined) return;
      entry.view.visible = true;
      const scale = symbolScale(entry.token.side, this.cameraScale);
      entry.view.scale.set(scale);
      entry.view.position.set(at.x, at.y);
      // One short number: always shown (the exact units and charged are the tooltip's).
      entry.token.setLabel(true);
      const spot: TokenSpot = {
        x: at.x,
        y: at.y,
        side: entry.token.side,
        scale,
        enemy: entry.owner !== this.me,
      };
      spots.set(id, spot);
      edgeSpots.set(id, spot);
    });
    this.sweepGroups();
    this.edgeSpots = edgeSpots;
    this.icons = icons;
    return spots;
  }

  // --- Walk in (#856) -----------------------------------------------------------------------

  /** The road each side walks into each node by, as last seen: own groups and enemy figures on roads. */
  private noteArrivals(frame: RenderFrame): void {
    const into = (edge: number, towardB: boolean): number | undefined => {
      const road = this.map.edges[edge];
      return road === undefined ? undefined : towardB ? road.b : road.a;
    };
    for (const item of frame.groups) {
      const location = item.location;
      if (location.kind !== 'edge') continue;
      const road = this.map.edges[location.edge];
      const node = into(location.edge, road?.a === location.from_node);
      if (node !== undefined)
        this.arrivals.set(`${String(node)}:${String(item.owner ?? this.me)}`, location.edge);
    }
    for (const figure of frame.enemies) {
      const node = into(figure.edge, figure.figure.toward_b);
      if (node !== undefined)
        this.arrivals.set(`${String(node)}:${String(this.enemy)}`, figure.edge);
    }
  }

  /** The walk of a capture of `node` by `owner` under way (or waiting at the gate) now. */
  private walkAt(node: number, owner: PlayerId): Walk | undefined {
    return this.walks.find((w) => w.node === node && w.owner === owner && walking(w, this.tick));
  }

  /** Does the icon of `owner` stand off the middle of `node`: the attacker at its gate, or walking in? */
  private offCentre(node: number, owner: PlayerId): boolean {
    return this.attackers.get(node) === owner || this.walkAt(node, owner) !== undefined;
  }

  /**
   * Where the icon of `owner` stands in `node` when it is not the usual place (#856): the attacker of a
   * node fight at the gate of the road it came by, and the winner of a capture on its walk from that
   * gate into the middle (`walkLayout.ts`); `null`: the usual place (`iconPoint`). `half`: half the
   * token on screen, `marker`: the old side slot, the gate when no road is known.
   */
  private standAt(
    node: number,
    owner: PlayerId,
    half: number,
    city: Point,
    marker: Point | undefined,
  ): Point | null {
    const walk = this.walkAt(node, owner);
    if (this.attackers.get(node) !== owner && walk === undefined) return null;
    const road = arrivalRoad(
      this.map,
      node,
      owner,
      this.arrivals.get(`${String(node)}:${String(owner)}`),
      this.owners,
    );
    const gate =
      (road === null
        ? null
        : gatePoint(this.map, node, road, ringRadius(this.radiusOf(node)), half)) ??
      marker ??
      city;
    if (walk === undefined) return gate;
    // With less motion the winner is in the city as the flood starts.
    const q = reducedMotion()
      ? this.tick >= walk.start + WALK.cross * walk.ticks
        ? 1
        : 0
      : walkShare(walk, this.tick);
    return walkPoint(gate, city, q);
  }

  /**
   * A group token that left the snapshot fades out where it stood (an arrival into a city icon, a
   * kill) instead of vanishing, and is destroyed once faded (#508).
   */
  private sweepGroups(): void {
    for (const [id, entry] of this.groups) {
      if (entry.stamp === this.stamp) {
        entry.token.revive();
        continue;
      }
      entry.token.leave();
      if (entry.token.gone) {
        entry.view.destroy({ children: true });
        this.groups.delete(id);
      }
    }
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
      // The first frame shows the scene as it is; later arrivals fade in.
      if (this.warm) token.enter();
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
      // The square is turned along its road (#858).
      const way = fromIsA ? 1 : -1;
      entry.dot.rotation = Math.atan2(way * (ends.b.y - ends.a.y), way * (ends.b.x - ends.a.x));
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
      const dot = view.addChild(new Graphics(this.kit.packet[owner]));
      const label = view.addChild(
        new Text({
          text: '',
          style: this.kit.textStyle,
          anchor: { x: 0, y: 0.5 },
          resolution: this.labelResolution,
        }),
      );
      label.position.set(8, 0);
      entry = {
        dot,
        label,
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
