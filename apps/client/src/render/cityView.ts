import { Container, Text, TextStyle } from 'pixi.js';
import type { MapFile, NodeView, PlayerId, SnapshotMsg } from '../protocol.gen.ts';
import type { CityDevelopment } from './source.ts';
import { cityRadius, lockedPlaces, vpBadgeAt, showsBarracks } from './cityLayout.ts';
import { columnKinds, columnSlots, markScale } from './defenseLayout.ts';
import {
  CAPITAL_RADIUS,
  CAPTURE,
  CROWN,
  ENEMY,
  NODE_RADIUS,
  PROVINCE,
  RECRUIT_PIPS,
  TOWER,
  VP,
  VP_LOZENGE,
  YOU,
  sideOf,
} from './style.ts';
import { reducedMotion } from './motion.ts';
import { EaseTween } from './tween.ts';
import { beaconPulse } from './alertLayout.ts';
import { alertAlpha, buildMark, markTops, type PlateKind } from './progressLayout.ts';
import {
  buildProgress,
  lozengeRow,
  lozengeRowY,
  recruitPip,
  towerPoint,
  towerRotation,
  towerScale,
  type TowerKind,
} from './pieceLayout.ts';
import type { MapLayers } from './layers.ts';
import type { Point } from './camera.ts';
import type { BakedSprite, SpriteCache } from './bake.ts';
import {
  buildMarkSpec,
  cityBodySpec,
  cityRingSpec,
  helmetBackSpec,
  helmetFrontSpec,
  helmetLevelSpec,
  provinceBodySpec,
  siteMarkSpec,
  stockColor,
  vpBadgeSpec,
  type CityKind,
} from './bakedShapes.ts';
import {
  crownSpec,
  pipAlertSpec,
  towerBackSpec,
  towerFillSpec,
  towerFrontSpec,
  towerHeadSpec,
  towerRingSpec,
  towerSpan,
  warehouseMarksSpec,
  type TowerLook,
} from './pieceShapes.ts';
import { helmet } from '../units/helmet.ts';
import { pieceFamily, usePieceFont } from './pieceFont.ts';

/** A build of a tower (barracks, factory) in an own city, as the snapshot gives it. */
interface TowerBuild {
  /** Charges still to pay (DEC-41, item 7; 0 under economy v1). */
  readonly owed: number;
  /** The charges it costs in all (`ruleset_public`); `null`: not known. */
  readonly price: number | null;
  /** The tick it ends; `null` while charges are owed. */
  readonly doneTick: number | null;
  /** Ticks of its build time (`city_upgrades.barracks_ticks`, `factory.build_ticks`). */
  readonly total: number;
}

/** What a tower on the ring of a city shows. */
interface TowerState {
  readonly built: boolean;
  readonly build: TowerBuild | null;
}

/** What a city looks like; the city is redrawn only when this changes. */
interface CityState {
  readonly owner: PlayerId | null;
  /** `null`: the capacity is not known yet (a map without a snapshot). */
  readonly capacity: number | null;
  /** Units of the viewing player standing in the city. */
  readonly garrison: number;
  /** Units of either side seen standing in the city: the body is the dark plate under their helmet. */
  readonly occupied: boolean;
  readonly warehouse: number | null;
  /** Own city: units in the recruit queue (DEC-25); `null` for the rest. */
  readonly queue: number | null;
  /** Ticks of production of the current unit. */
  readonly progress: number;
  /** Ticks per unit (`ruleset_public.recruit.unit_ticks`); `null`: no queue mark. */
  readonly unitTicks: number | null;
  /** The current unit is ready and waits for a place (DEC-25, item 7). */
  readonly waiting: boolean;
  /** A fight is going on in the city: production stands (DEC-25, item 9). */
  readonly paused: boolean;
  /** Slots of the queue a selected city shows (`recruit.queue_max`); 0: the city cannot recruit. */
  readonly queueMax: number;
  /** Places of the warehouse: the warehouse capacity (DEC-26), or the charges only. */
  readonly warehouseCap: number | null;
  /** Own city: faint places of the warehouse levels not built yet (DEC-26, C1); 0 for the rest. */
  readonly locked: number;
  /** Own city: a warehouse build (economy v1, DEC-26) and the share done, in percent; `null`: none. */
  readonly buildKind: 'warehouse' | null;
  readonly buildPct: number;
  /** Economy v2 (DEC-41, item 7): charges the warehouse build still waits for. */
  readonly buildOwed: number;
  /** The towers on the ring: the barracks (DEC-26) and the factory (DEC-41, item 2). */
  readonly towers: Readonly<Record<TowerKind, TowerState>>;
  /** Economy v2: a bunker, own or an enemy's next door: the bunker badge in the column. */
  readonly fort: boolean;
  /** Economy v2: an own bunker being built, its share done in percent and what it owes. */
  readonly sites: readonly SiteBuild[];
}

/** A bunker being built in an own node (economy v2, DEC-41, item 12). */
interface SiteBuild {
  readonly kind: 'fort';
  readonly pct: number;
  readonly owed: number;
}

function towerKey(t: TowerState): string {
  const b = t.build;
  return `${t.built ? 'B' : ''}${b === null ? '' : `${String(b.owed)}/${String(b.price)}/${String(b.doneTick)}/${String(b.total)}`}`;
}

function stateKey(s: CityState): string {
  return [
    s.owner,
    s.capacity,
    s.garrison,
    s.occupied,
    s.warehouse,
    s.queue,
    s.progress,
    s.unitTicks,
    s.waiting,
    s.paused,
    s.queueMax,
    s.warehouseCap,
    s.locked,
    s.buildKind,
    s.buildPct,
    s.buildOwed,
    towerKey(s.towers.barracks),
    towerKey(s.towers.factory),
    s.fort,
    s.sites.map((site) => `${site.kind}:${String(site.pct)}:${String(site.owed)}`).join(','),
  ]
    .map(String)
    .join('|');
}

const TOWER_KINDS: readonly TowerKind[] = ['barracks', 'factory'];

/** The sprites of one tower on the ring of a city, and its build. */
interface TowerSlot {
  readonly kind: TowerKind;
  /** The radius of its city now. */
  radius: number;
  /** At the tower's place on the ring, turned with its top away from the city, scaled by `towerScale`. */
  readonly root: Container;
  readonly back: BakedSprite;
  /** The fill of a build's time, shown from the bottom by a crop. */
  readonly fill: BakedSprite;
  /** The ink head line of the fill. */
  readonly head: BakedSprite;
  readonly front: BakedSprite;
  /** The Crown arc of a build, round the city centre. */
  readonly crown: BakedSprite;
  /** The ring that opens from a tower just built. */
  readonly ring: BakedSprite;
  /** The build under way (`null`: none), its colour and side. */
  build: TowerBuild | null;
  color: number;
  /** The fade of the arc and the opening of the ring once the build is done (`null`: none). */
  done: EaseTween | null;
}

/** A recruit of the queue: a small helmet on the ring after the barracks tower. */
interface PipSlot {
  readonly root: Container;
  readonly back: BakedSprite;
  readonly level: BakedSprite;
  readonly front: BakedSprite;
  /** The shown share of the unit in production: eases toward the snapshot's. */
  readonly fill: EaseTween;
}

/** How long the fill of a recruit takes to follow a new snapshot, ms (one snapshot apart). */
const PIP_EASE_MS = 120;

/**
 * The cities of the map (ui-style.md 9.4; Engraved, #847, part 2 of #829): a body whose size
 * follows the capacity class (the disc of the owner's colour on a dark cut, an ink ring, the
 * enemy's two inner rings, a neutral one hatched; the dark plate when units stand there), the
 * capital star, the capacity ring (a solid ink arc per own unit standing there, two hairlines per
 * free place), the warehouse as a row of lozenges under the ring (57u), the towers of the barracks
 * and the factory on the ring (Cut and ring towers, 53g; own, and an enemy's next to an own node,
 * DEC-31), a build in progress as the Crown arc (57k: the owed charges as lozenges, then the build
 * time filling the arc and the tower), the recruit queue as small helmets after the barracks tower
 * (55k Pips) and the gilt VP lozenge. The capacity is public and exact (DEC-22).
 *
 * A province (`kind = province`, DEC-23) is a small dot instead of a body, with the capacity ring.
 * A warehouse build (economy v1) and a bunker build keep their plates above the city (#439).
 *
 * Every shape is a baked sprite (`bakedShapes.ts`, `pieceShapes.ts`, `SpriteCache`), one texture per
 * look with a bounded key; the fill of a tower and of a recruit is a crop of one baked fill, so it
 * rises continuously without new textures. `destroy()` releases every object.
 */
/** How long a replaced city body takes to fade out, ms: the city flips at the start of a capture (#819). */
const BODY_FADE_MS = CAPTURE.cityMs;

export class CityView {
  private readonly cities: Container[];
  private readonly bodies: BakedSprite[];
  private readonly rings: BakedSprite[];
  private readonly bars: BakedSprite[];
  private readonly builds: BakedSprite[];
  private readonly alerts: BakedSprite[];
  /** The cities whose alert ring is on now (it pulses every frame). */
  private readonly alerting = new Set<number>();
  /** Economy v2: the bunker badge of each city, in the column on its left. */
  private readonly forts: BakedSprite[];
  /** Economy v2: the plate of a bunker build, over the city build plate. */
  private readonly siteBuilds: BakedSprite[][];
  private readonly towers: Record<TowerKind, TowerSlot>[];
  private readonly pips: PipSlot[][];
  private readonly pipLayers: Container[];
  private readonly badges: (Container | null)[];
  private readonly vpLabels: Text[] = [];
  private readonly keys: string[];
  /** The last state of every city: a change of the selection redraws from it. */
  private readonly states: (CityState | null)[];
  /** The selected city: it shows the free slots of its queue. */
  private selected: number | null = null;
  private readonly radii: number[];
  private readonly vpStyle: TextStyle;
  private supplyMode = false;
  /** Camera scale: the bunker mark never gets smaller than 16 px on screen (#349). */
  private cameraScale = 1;
  /** The scale of the towers and the recruits now (`towerScale`). */
  private towerZoom: number = TOWER.minScale;
  /** The render tick of the frame (fractional): the build time fills by it. */
  private tick = 0;
  /** The signs of "Defense" each city carries (the column of the bunker is shared with them). */
  private readonly defenses = new Map<number, number>();
  /** Set after the first snapshot: a body that changes after it (a capture) cross-fades. */
  private warm = false;
  /** The bodies that were just replaced, fading out over the new ones (#508). */
  private readonly fading: { sprite: BakedSprite; tween: EaseTween }[] = [];
  /** The towers whose build is running or whose done effect plays: stepped every frame. */
  private readonly moving = new Set<TowerSlot>();
  /** The recruits whose fill is still easing. */
  private readonly easing = new Set<PipSlot>();

  constructor(
    private readonly map: MapFile,
    layers: MapLayers,
    private readonly me: PlayerId,
    labelResolution: number,
    private readonly sprites: SpriteCache,
  ) {
    this.vpStyle = new TextStyle({
      fontFamily: pieceFamily(),
      fontSize: VP_LOZENGE.font,
      fontWeight: '700',
      fill: VP,
    });
    usePieceFont([this.vpStyle]);
    this.keys = map.nodes.map(() => '');
    this.states = map.nodes.map(() => null);
    this.radii = map.nodes.map((node) =>
      node.kind === 'province'
        ? PROVINCE.radius
        : node.capital_of === null
          ? NODE_RADIUS
          : CAPITAL_RADIUS,
    );
    this.cities = [];
    this.bodies = [];
    this.rings = [];
    this.bars = [];
    this.builds = [];
    this.alerts = [];
    this.forts = [];
    this.siteBuilds = [];
    this.towers = [];
    this.pips = [];
    this.pipLayers = [];
    this.badges = [];
    for (const node of map.nodes) {
      const city = new Container({ x: node.x, y: node.y, label: `node-${String(node.id)}` });
      this.bodies.push(city.addChild(sprites.sprite()));
      this.rings.push(city.addChild(sprites.sprite()));
      const bar = city.addChild(sprites.sprite());
      bar.label = 'warehouse';
      this.bars.push(bar);
      const slots = {} as Record<TowerKind, TowerSlot>;
      for (const kind of TOWER_KINDS) slots[kind] = this.towerSlot(city, kind);
      this.towers.push(slots);
      const pipLayer = city.addChild(new Container({ label: 'recruits' }));
      this.pipLayers.push(pipLayer);
      this.pips.push([]);
      const build = city.addChild(sprites.sprite());
      build.label = 'build';
      this.builds.push(build);
      const ring = city.addChild(sprites.sprite());
      ring.label = 'progress-alert';
      ring.visible = false;
      this.alerts.push(ring);
      const fort = city.addChild(sprites.sprite());
      fort.label = 'fort';
      fort.visible = false;
      this.forts.push(fort);
      const sites = [city.addChild(sprites.sprite())];
      for (const site of sites) {
        site.label = 'site-build';
        site.visible = false;
      }
      this.siteBuilds.push(sites);
      // A province carries no VP (DEC-23).
      if (node.vp > 0 && node.kind !== 'province') {
        const badge = city.addChild(new Container());
        badge.addChild(sprites.sprite(vpBadgeSpec()));
        const label = new Text({
          text: String(node.vp),
          style: this.vpStyle,
          anchor: 0.5,
          resolution: labelResolution,
        });
        label.position.set(0, 0.5);
        this.vpLabels.push(badge.addChild(label));
        this.badges.push(badge);
      } else {
        this.badges.push(null);
      }
      this.cities.push(layers.layer.nodes.addChild(city));
    }
    this.setOwners(map.nodes.map((node) => node.start_owner));
  }

  private towerSlot(city: Container, kind: TowerKind): TowerSlot {
    const crown = city.addChild(this.sprites.sprite());
    crown.label = `crown-${kind}`;
    crown.visible = false;
    const root = city.addChild(new Container({ label: `tower-${kind}`, visible: false }));
    const back = root.addChild(this.sprites.sprite());
    const fill = root.addChild(this.sprites.sprite());
    const head = root.addChild(this.sprites.sprite(towerHeadSpec(kind)));
    const front = root.addChild(this.sprites.sprite());
    fill.visible = false;
    head.visible = false;
    const ring = city.addChild(this.sprites.sprite(towerRingSpec(10)));
    ring.label = `tower-ring-${kind}`;
    ring.visible = false;
    return {
      kind,
      radius: NODE_RADIUS,
      root,
      back,
      fill,
      head,
      front,
      crown,
      ring,
      build: null,
      color: YOU,
      done: null,
    };
  }

  /** Radius of the city `id` now: by its capacity class, a default until the capacity is known. */
  radiusOf(id: number): number {
    return this.radii[id] ?? NODE_RADIUS;
  }

  /**
   * The centre of the lozenge `index` of the warehouse row of the city `id` in world units (where a
   * charge leaves for a gathering plan, #851); `null`: no row is drawn there.
   */
  warehouseSlot(id: number, index: number): Point | null {
    const state = this.states[id];
    const at = this.map.nodes[id];
    if (state === null || state === undefined || at === undefined) return null;
    if (state.capacity === null || state.warehouse === null) return null;
    const xs = lozengeRow((state.warehouseCap ?? state.warehouse) + state.locked);
    const x = xs[Math.min(xs.length - 1, Math.max(0, index))];
    if (x === undefined) return null;
    return { x: at.x + x, y: at.y + lozengeRowY(this.radiusOf(id)) };
  }

  /** The radii of all cities (kept in step with the snapshots; read by other views). */
  get radiusTable(): readonly number[] {
    return this.radii;
  }

  /** Owners before the first snapshot (the map's start owners); capacity is not known yet. */
  setOwners(owners: readonly (PlayerId | null)[]): void {
    const none: TowerState = { built: false, build: null };
    owners.forEach((owner, id) => {
      this.set(id, {
        owner,
        capacity: null,
        garrison: 0,
        occupied: false,
        warehouse: null,
        queue: null,
        progress: 0,
        unitTicks: null,
        waiting: false,
        paused: false,
        queueMax: 0,
        warehouseCap: null,
        locked: 0,
        buildKind: null,
        buildPct: 0,
        buildOwed: 0,
        towers: { barracks: none, factory: none },
        fort: false,
        sites: [],
      });
    });
  }

  /**
   * A new snapshot: owners, capacity classes, garrisons, warehouses, recruit queues and builds;
   * `unitTicks`: ticks per recruit (`null`: no queue marks); `queueMax`: the slots of a queue
   * (`null`: the selected city shows no free ones).
   */
  update(
    base: SnapshotMsg,
    unitTicks: number | null = null,
    cityUpgrades: CityDevelopment | null = null,
    queueMax: number | null = null,
    provinceWarehouse = 0,
  ): void {
    const garrison = new Map<number, number>();
    const occupied = new Set<number>();
    for (const group of base.view.groups) {
      if (group.location.kind === 'node') {
        garrison.set(group.location.node, (garrison.get(group.location.node) ?? 0) + group.units);
        occupied.add(group.location.node);
      }
    }
    // The opponent's units seen standing in a node (`seen`, as the map draws their helmet there).
    for (const node of base.view.nodes) {
      const seen = node.seen;
      if (
        seen !== null &&
        node.detail !== 'fog' &&
        seen.level !== 'fog' &&
        seen.enemy_modes.length > 0
      )
        occupied.add(node.id);
    }
    // A city with a fight in it: its production stands (DEC-25, item 9). Its units are drawn by the
    // fight, not as a helmet in the city, so the city keeps its owner's disc.
    const fighting = new Set<number>();
    for (const fight of base.view.fights) {
      if (fight.node !== null) {
        fighting.add(fight.node);
        occupied.delete(fight.node);
      }
    }
    if (this.tick < base.tick - 1) this.tick = base.tick;
    for (const node of base.view.nodes) {
      this.set(
        node.id,
        this.stateOf(
          node,
          {
            garrison: garrison.get(node.id) ?? 0,
            fighting: fighting.has(node.id),
            occupied: occupied.has(node.id),
          },
          { unitTicks, cityUpgrades, queueMax, provinceWarehouse },
          base.tick,
        ),
      );
    }
    this.warm = true;
  }

  /**
   * The selected city (`null`: none) shows the free slots of its recruit queue. The server decides
   * what the city can queue; this only draws the room that is left.
   */
  setSelected(node: number | null): void {
    if (node === this.selected) return;
    const before = this.selected;
    this.selected = node;
    for (const id of [before, node]) {
      const state = id === null ? undefined : this.states[id];
      if (id !== null && state !== undefined && state !== null) this.set(id, state);
    }
  }

  /** Every frame: the dashed rings that ask for a look pulse (steady with "less motion"). */
  pulse(nowMs: number): void {
    if (this.alerting.size === 0) return;
    const alpha = alertAlpha(beaconPulse(nowMs, false), reducedMotion());
    for (const id of this.alerting) {
      const ring = this.alerts[id];
      if (ring !== undefined) ring.alpha = alpha;
    }
  }

  /**
   * The «Supply» map mode (DEC-28, item 8) shows no garrison ring, warehouse, recruit queue, towers
   * or builds on the city: the layer of its own draws the warehouse.
   */
  setSupplyMode(on: boolean): void {
    if (on === this.supplyMode) return;
    this.supplyMode = on;
    for (const marks of [this.rings, this.bars, this.forts, this.builds, ...this.siteBuilds]) {
      for (const mark of marks) mark.visible = !on && mark.spec !== null;
    }
    for (const layer of this.pipLayers) layer.visible = !on;
    this.alerts.forEach((ring, id) => {
      ring.visible = !on && this.alerting.has(id);
    });
    this.states.forEach((state, id) => {
      if (state !== null) this.placeTowers(id, state);
    });
  }

  /** The camera scale (CSS px per world unit): the towers and the bunker mark keep their screen size. */
  setCameraScale(scale: number): void {
    const zoom = towerScale(scale);
    const marks = markScale(scale) !== markScale(this.cameraScale);
    this.cameraScale = scale;
    if (marks) this.placeAllColumns();
    if (zoom === this.towerZoom) return;
    this.towerZoom = zoom;
    this.states.forEach((state, id) => {
      if (state !== null) {
        this.placeTowers(id, state);
        this.drawRecruits(id, state, this.selected === id);
      }
    });
  }

  /** The render tick of the frame (fractional): a build's time fills by it, between two snapshots. */
  setTick(tick: number): void {
    this.tick = tick;
  }

  /**
   * How many signs of "Defense" stand in the column of each city (`defenseSigns`): the bunker mark
   * is the top of the same column, so it moves up when a sign comes under it.
   */
  setDefenseCounts(counts: ReadonlyMap<number, number>): void {
    let same = counts.size === this.defenses.size;
    if (same) {
      for (const [id, n] of counts) {
        if (this.defenses.get(id) !== n) {
          same = false;
          break;
        }
      }
    }
    if (same) return;
    this.defenses.clear();
    for (const [id, n] of counts) this.defenses.set(id, n);
    this.placeAllColumns();
  }

  /**
   * Whether the column on the left of city `id` starts with a mark (the bunker): the signs of
   * "Defense" go under it. The barracks is a tower on the ring since #847, not in the column.
   */
  hasBarracks(id: number): boolean {
    return this.states[id]?.fort === true;
  }

  private placeAllColumns(): void {
    this.states.forEach((state, id) => {
      if (state?.fort === true) this.placeColumn(id, state, this.radii[id] ?? NODE_RADIUS);
    });
  }

  /** The bunker mark of the left column of a city (economy v2), over the signs of "Defense". */
  private placeColumn(id: number, state: CityState, radius: number): void {
    const scale = markScale(this.cameraScale);
    const kinds = columnKinds(false, this.defenses.get(id) ?? 0, state.fort ? ['fort'] : []);
    const fort = this.forts[id];
    for (const slot of columnSlots(radius, kinds, scale)) {
      if (slot.kind !== 'fort' || fort === undefined) continue;
      fort.position.set(slot.x, slot.y);
      fort.scale.set(scale);
    }
  }

  setLabelResolution(resolution: number): void {
    for (const text of this.vpLabels) {
      if (text.resolution !== resolution) text.resolution = resolution;
    }
  }

  destroy(): void {
    for (const city of this.cities) city.destroy({ children: true });
    this.vpStyle.destroy();
  }

  // --- Drawing ------------------------------------------------------------------------------

  private stateOf(
    node: NodeView,
    city: { garrison: number; fighting: boolean; occupied: boolean },
    rules: {
      unitTicks: number | null;
      cityUpgrades: CityDevelopment | null;
      queueMax: number | null;
      provinceWarehouse: number;
    },
    tick: number,
  ): CityState {
    const { unitTicks, cityUpgrades, provinceWarehouse } = rules;
    // Economy v2 (DEC-41, item 13): an own province has a warehouse of `provinceWarehouse` places
    // (0 under v1: none). Any other province shows no stock.
    const province = this.map.nodes[node.id]?.kind === 'province';
    const provinceStock = province && node.owner === this.me && provinceWarehouse > 0;
    const building = node.building;
    let buildKind: 'warehouse' | null = null;
    let buildPct = 0;
    // A build that still owes charges (economy v2, DEC-41, item 7) has not started its time.
    const share = (total: number, done: number | null): number => {
      if (total <= 0) return 0;
      const left = done === null ? total : Math.max(0, done - tick);
      return Math.min(100, Math.max(0, Math.round((100 * (total - left)) / total)));
    };
    if (building !== null && building.kind === 'warehouse' && cityUpgrades !== null) {
      buildKind = 'warehouse';
      buildPct = share(cityUpgrades.warehouse, building.done_tick);
    }
    const own = node.owner === this.me;
    const barracksBuild: TowerBuild | null =
      own && building?.kind === 'barracks' && cityUpgrades !== null
        ? {
            owed: building.owed,
            price: cityUpgrades.barracksCharges ?? null,
            doneTick: building.done_tick,
            total: cityUpgrades.barracks,
          }
        : null;
    const factoryBuild: TowerBuild | null =
      own && node.factory_build !== null
        ? {
            owed: node.factory_build.owed,
            price: cityUpgrades?.factoryCharges ?? null,
            doneTick: node.factory_build.done_tick,
            total: cityUpgrades?.factory ?? 0,
          }
        : null;
    const sites: SiteBuild[] = [];
    if (own && node.fort_build !== null) {
      sites.push({
        kind: 'fort',
        pct: share(cityUpgrades?.fort ?? 0, node.fort_build.done_tick),
        owed: node.fort_build.owed,
      });
    }
    // Free slots are shown where a unit can be queued: an own city (the view carries its queue), with
    // the barracks when the city development is on (DEC-26, the same test as the city menu).
    const recruits =
      own && node.recruit_queue !== null && (cityUpgrades === null || node.has_barracks === true);
    return {
      owner: node.owner,
      capacity: node.capacity,
      garrison: own ? city.garrison : 0,
      occupied: city.occupied,
      // The server sends a warehouse only where it may be seen: an own node at any `detail`
      // (DEC-35, detail 3) or a node where an own group stands.
      warehouse: province && !provinceStock ? null : node.warehouse,
      queue: node.recruit_queue,
      progress: node.recruit_progress ?? 0,
      unitTicks,
      waiting: node.recruit_waiting === true,
      paused: city.fighting,
      queueMax: recruits ? (rules.queueMax ?? 0) : 0,
      // DEC-26: an own city knows its warehouse capacity; a foreign one shows only its charges
      // when the warehouse is apart from the capacity, else the capacity (DEC-22).
      warehouseCap: provinceStock
        ? provinceWarehouse
        : (node.warehouse_cap ?? (cityUpgrades === null ? node.capacity : null)),
      locked: lockedPlaces(node.warehouse_level, cityUpgrades),
      buildKind,
      buildPct,
      buildOwed: buildKind === null ? 0 : (building?.owed ?? 0),
      towers: {
        // The server sends these only where they may be seen (DEC-31: an enemy's next to an own node).
        barracks: {
          built: showsBarracks(node.has_barracks, cityUpgrades !== null),
          build: barracksBuild,
        },
        factory: { built: node.factory === true, build: factoryBuild },
      },
      fort: node.fort === true,
      sites,
    };
  }

  private kindOf(owner: PlayerId | null): CityKind {
    return owner === null ? 'neutral' : sideOf(this.me, owner);
  }

  /** The body of city `id`. */
  private drawBody(id: number, state: CityState): void {
    const node = this.map.nodes[id];
    const body = this.bodies[id];
    if (node === undefined || body === undefined) return;
    const kind = this.kindOf(state.owner);
    const spec =
      node.kind === 'province'
        ? provinceBodySpec(kind, state.occupied)
        : cityBodySpec(
            kind,
            this.radii[id] ?? NODE_RADIUS,
            node.capital_of !== null,
            state.occupied,
          );
    const old = body.spec;
    // A capture cross-fades the colour; units coming or going swap the plate at once.
    if (
      this.warm &&
      old !== null &&
      old.key !== spec.key &&
      !reducedMotion() &&
      ownerPart(old.key) !== ownerPart(spec.key)
    ) {
      this.crossFade(id, body, old);
    }
    body.set(spec);
  }

  /**
   * A captured city: its old body stays on top of the new one and fades out, so the colour flows
   * from one owner to the other instead of flipping (#508).
   */
  private crossFade(id: number, body: BakedSprite, old: NonNullable<BakedSprite['spec']>): void {
    const city = this.cities[id];
    if (city === undefined) return;
    const ghost = this.sprites.sprite(old);
    ghost.position.set(body.x, body.y);
    city.addChildAt(ghost, city.getChildIndex(body) + 1);
    const tween = new EaseTween(1, BODY_FADE_MS);
    tween.setTarget(0);
    this.fading.push({ sprite: ghost, tween });
  }

  /**
   * Once per frame, by `dtMs` of real time: fades the replaced bodies out, fills the towers whose
   * build runs by the render tick, plays the end of a build and eases the recruits' fill.
   */
  advance(dtMs: number): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const item = this.fading[i];
      if (item === undefined) continue;
      if (item.sprite.destroyed) {
        this.fading.splice(i, 1);
        continue;
      }
      item.sprite.alpha = item.tween.step(dtMs);
      if (!item.tween.active) {
        item.sprite.destroy();
        this.fading.splice(i, 1);
      }
    }
    for (const slot of this.moving) {
      if (slot.root.destroyed) {
        this.moving.delete(slot);
        continue;
      }
      if (slot.done !== null) {
        this.stepDone(slot, dtMs);
      } else if (slot.build !== null) {
        this.showBuild(slot, slot.build);
      } else {
        this.moving.delete(slot);
      }
    }
    for (const pip of this.easing) {
      if (pip.root.destroyed) {
        this.easing.delete(pip);
        continue;
      }
      pip.fill.step(dtMs);
      showPipFill(pip);
      if (!pip.fill.active) this.easing.delete(pip);
    }
  }

  private set(id: number, state: CityState): void {
    this.states[id] = state;
    const selected = this.selected === id;
    const key = `${stateKey(state)}|${String(selected)}`;
    if (this.keys[id] === key) return;
    this.keys[id] = key;
    const node = this.map.nodes[id];
    const ring = this.rings[id];
    const bar = this.bars[id];
    const fort = this.forts[id];
    if (node === undefined || ring === undefined || bar === undefined || fort === undefined) return;

    const capital = node.capital_of !== null;
    const province = node.kind === 'province';
    const radius = province
      ? PROVINCE.radius
      : state.capacity === null
        ? capital
          ? CAPITAL_RADIUS
          : NODE_RADIUS
        : cityRadius(state.capacity);
    this.radii[id] = radius;
    const kind = this.kindOf(state.owner);
    this.drawBody(id, state);

    this.drawPlates(id, state, radius);
    this.drawRecruits(id, state, selected);
    this.placeTowers(id, state);

    // Economy v2 (DEC-41): the bunker in the column on the left, the rim the owner's colour.
    const rim = kind === 'enemy' ? ENEMY : YOU;
    fort.set(state.fort ? siteMarkSpec('fort', rim) : null);
    fort.visible = state.fort && !this.supplyMode;
    this.placeColumn(id, state, radius);

    const { capacity, warehouse } = state;
    const ringOn = capacity !== null;
    ring.set(ringOn ? cityRingSpec(radius, capacity, kind === 'you' ? state.garrison : 0) : null);
    ring.visible = ringOn && !this.supplyMode;
    // A province has a warehouse only under economy v2 and only its owner sees it (DEC-41, item 13):
    // `stateOf` leaves `warehouse` null for every other province, so nothing is drawn there.
    const barOn = ringOn && warehouse !== null;
    bar.set(
      barOn
        ? warehouseMarksSpec(
            state.warehouseCap ?? warehouse,
            warehouse,
            stockColor(kind),
            state.locked,
          )
        : null,
    );
    if (barOn) bar.position.set(0, lozengeRowY(radius));
    bar.visible = barOn && !this.supplyMode;

    const badge = this.badges[id];
    if (badge !== null && badge !== undefined) {
      // On the capacity ring at its upper right (the mockup's gilt lozenge).
      const at = vpBadgeAt(radius);
      badge.position.set(at.x, at.y);
    }
  }

  /**
   * The towers of a city on its ring: the barracks and the factory, built (the owner's hatch) or
   * being built (a plan while charges are owed, then filling with the build time under the Crown arc).
   */
  private placeTowers(id: number, state: CityState): void {
    const slots = this.towers[id];
    if (slots === undefined) return;
    const radius = this.radii[id] ?? NODE_RADIUS;
    const kind = this.kindOf(state.owner);
    const enemy = kind === 'enemy';
    const color = enemy ? ENEMY : YOU;
    for (const tower of TOWER_KINDS) {
      const slot = slots[tower];
      const { built, build } = state.towers[tower];
      const wasBuilding = slot.build !== null;
      const shown = (built || build !== null) && kind !== 'neutral';
      slot.root.visible = shown && !this.supplyMode;
      slot.crown.visible = false;
      if (!shown) {
        slot.build = null;
        slot.done = null;
        slot.ring.visible = false;
        this.moving.delete(slot);
        continue;
      }
      const at = towerPoint(radius, tower);
      slot.root.position.set(at.x, at.y);
      slot.root.rotation = towerRotation(tower);
      slot.root.scale.set(this.towerZoom);
      slot.color = color;
      slot.radius = radius;
      if (build === null) {
        slot.build = null;
        slot.back.set(towerBackSpec(tower, 'built', color, enemy));
        slot.front.set(towerFrontSpec(tower, 'built'));
        slot.fill.visible = false;
        slot.head.visible = false;
        // A build that ends here: the arc fades and a ring opens from the tower (57k).
        if (wasBuilding && this.warm && !reducedMotion() && slot.crown.spec !== null) {
          slot.done = new EaseTween(0, CROWN.ring.ms);
          slot.done.setTarget(1);
          slot.ring.position.set(at.x, at.y);
          this.moving.add(slot);
          this.stepDone(slot, 0);
        } else if (slot.done === null) {
          this.moving.delete(slot);
        }
        continue;
      }
      slot.done = null;
      slot.ring.visible = false;
      slot.build = build;
      this.showBuild(slot, build);
      if (build.doneTick !== null && build.owed === 0) this.moving.add(slot);
      else this.moving.delete(slot);
    }
  }

  /** A tower being built at the render tick: the plan or the fill, and its Crown arc. */
  private showBuild(slot: TowerSlot, build: TowerBuild): void {
    const { kind, radius: r } = slot;
    const progress = buildProgress(build.owed, build.price, build.doneTick, build.total, this.tick);
    const look: TowerLook = progress.running ? 'rising' : 'plan';
    slot.back.set(towerBackSpec(kind, look, slot.color, false));
    slot.front.set(towerFrontSpec(kind, look));
    const { top, bottom } = towerSpan(kind);
    const height = bottom - top;
    slot.fill.set(towerFillSpec(kind, slot.color));
    const shown = progress.running ? progress.time : 0;
    slot.fill.visible = shown > 0;
    if (shown > 0) slot.fill.cropBottom(shown * height);
    slot.head.visible = shown > 0 && shown < 1;
    slot.head.position.set(0, bottom - shown * height);
    slot.crown.set(crownSpec(r, kind, progress, slot.color, this.towerZoom));
    slot.crown.alpha = 1;
    slot.crown.visible = !this.supplyMode;
  }

  /** The end of a build: the arc fades (`CROWN.fadeMs`) and a ring opens from the tower. */
  private stepDone(slot: TowerSlot, dtMs: number): void {
    const done = slot.done;
    if (done === null) return;
    const q = done.step(dtMs);
    slot.crown.visible = !this.supplyMode && q * CROWN.ring.ms < CROWN.fadeMs;
    slot.crown.alpha = Math.max(0, 1 - (q * CROWN.ring.ms) / CROWN.fadeMs);
    const { from, grow } = CROWN.ring;
    slot.ring.visible = !this.supplyMode && q < 1;
    slot.ring.scale.set(((from + grow * q) / 10) * (this.towerZoom / TOWER.minScale));
    slot.ring.alpha = 1 - q;
    if (!done.active) {
      slot.done = null;
      slot.crown.visible = false;
      slot.ring.visible = false;
      this.moving.delete(slot);
    }
  }

  /**
   * The recruit queue of an own city (55k Pips): a small helmet per unit on the ring after the
   * barracks tower, the first filling with its production, the others hatched; the selected city's
   * free slots beaded. A unit ready with no room, or the production stopped by a fight, gets the
   * dashed amber ring that pulses. All from the snapshot and the rules.
   */
  private drawRecruits(id: number, state: CityState, selected: boolean): void {
    const layer = this.pipLayers[id];
    const pips = this.pips[id];
    const alert = this.alerts[id];
    if (layer === undefined || pips === undefined || alert === undefined) return;
    const radius = this.radii[id] ?? NODE_RADIUS;
    const count = state.unitTicks === null ? 0 : Math.max(0, state.queue ?? 0);
    const slots = state.unitTicks === null ? 0 : Math.max(count, selected ? state.queueMax : 0);
    const width = RECRUIT_PIPS.width;
    const scale = this.towerZoom / TOWER.minScale;
    while (pips.length < slots) pips.push(this.pipSlot(layer));
    pips.forEach((pip, j) => {
      pip.root.visible = j < slots;
      if (j >= slots) return;
      const at = recruitPip(radius, j);
      pip.root.position.set(at.x, at.y);
      pip.root.rotation = at.angle + Math.PI / 2;
      pip.root.scale.set(scale);
      const free = j >= count;
      pip.back.set(helmetBackSpec('own', width, YOU, free ? 'dashed' : 'solid', false));
      pip.front.set(helmetFrontSpec('own', width, YOU, free ? 'dashed' : 'solid'));
      pip.level.set(free ? null : helmetLevelSpec('own', width, YOU));
      const unitTicks = state.unitTicks ?? 0;
      const share =
        free || j > 0
          ? 0
          : state.waiting
            ? 1
            : unitTicks > 0
              ? Math.min(1, Math.max(0, state.progress / unitTicks))
              : 0;
      // A new queue or "less motion" shows the level at once; a unit that went shows the next at once.
      if (!this.warm || reducedMotion() || share < pip.fill.value) pip.fill.snap(share);
      else pip.fill.setTarget(share);
      showPipFill(pip);
      if (pip.fill.active) this.easing.add(pip);
    });
    const ring = count > 0 && (state.waiting || state.paused) ? recruitPip(radius, 0) : null;
    alert.set(ring === null ? null : pipAlertSpec(8));
    if (ring !== null) {
      alert.position.set(ring.x, ring.y);
      alert.scale.set(scale);
    }
    alert.visible = ring !== null && !this.supplyMode;
    if (ring === null) this.alerting.delete(id);
    else this.alerting.add(id);
  }

  private pipSlot(layer: Container): PipSlot {
    const root = layer.addChild(new Container({ label: 'recruit' }));
    const back = root.addChild(this.sprites.sprite());
    const level = root.addChild(this.sprites.sprite());
    const front = root.addChild(this.sprites.sprite());
    level.visible = false;
    return { root, back, level, front, fill: new EaseTween(0, PIP_EASE_MS) };
  }

  /**
   * The plates kept from #439 above an own city: a warehouse build (economy v1, DEC-26) and a bunker
   * build (economy v2). The barracks and the factory are towers on the ring.
   */
  private drawPlates(id: number, state: CityState, radius: number): void {
    const build = this.builds[id];
    if (build === undefined) return;
    const built =
      state.buildKind === null
        ? null
        : buildMark(state.buildKind, state.buildPct / 100, state.buildOwed);
    const more = state.sites.map((site) =>
      buildMark(site.kind as PlateKind, site.pct / 100, site.owed),
    );
    const tops = markTops(radius, null, built, more);
    const siteSprites = this.siteBuilds[id] ?? [];
    siteSprites.forEach((sprite, i) => {
      const mark = more[i];
      const top = tops.more[i];
      sprite.set(mark === undefined ? null : buildMarkSpec(mark));
      if (mark !== undefined && top !== undefined) sprite.position.set(0, top);
      sprite.visible = mark !== undefined && !this.supplyMode;
    });
    build.set(built === null ? null : buildMarkSpec(built));
    if (built !== null && tops.build !== null) build.position.set(0, tops.build);
    build.visible = built !== null && !this.supplyMode;
  }
}

/** The part of a body's key that names its owner and look, without the plate of units standing there. */
function ownerPart(key: string): string {
  return key.replace(/:o$/, ':');
}

/** Puts a recruit's shown fill on its level sprite: the bottom of the dome up to the level. */
function showPipFill(pip: PipSlot): void {
  const shown = pip.fill.value;
  pip.level.visible = shown > 0 && pip.level.spec !== null;
  const h = helmet('own', RECRUIT_PIPS.width);
  if (shown > 0) pip.level.cropBottom(1 + shown * (h.domeBottom - h.domeTop));
}
