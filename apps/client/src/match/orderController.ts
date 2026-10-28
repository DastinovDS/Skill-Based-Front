import type { HudState } from '../hud/hudState.svelte.ts';
import type { AlertState } from './alerts.svelte.ts';
import type { GroupChoice as GroupBrief, Selection } from '../hud/hudData.ts';
import type { Command, MapFile, Mode, ReachMsg, RulesetPublic, Stance } from '../protocol.gen.ts';
import {
  EMPTY_OVERLAY,
  type MapInteraction,
  type OverlayState,
  type PickHit,
  type SupplyOverlay,
} from '../render/interaction.ts';
import type { CommandResult, OrderBook } from './orderBook.ts';
import {
  frontOf,
  RADIAL,
  SECTORS,
  stanceRates,
  SUPPLY_SECTORS,
  type StanceRate,
  type SupplyChoice,
} from '../hud/radial.ts';
import { OrderUiState, type ReachInfo } from './orderUi.svelte.ts';
import { RadialState } from './radialState.svelte.ts';
import { SplitState } from './splitState.svelte.ts';
import { TargetMenuState } from './targetMenuState.svelte.ts';
import { SupplyMenuState, TransferState } from './supplyState.svelte.ts';

/** A sector of the menu of a city. */
export type CityChoice = 'recruit' | 'barracks' | 'warehouse';

/** A sector of the menu of a group. */
export type GroupChoice = 'split' | 'merge' | 'cancel' | 'defense';

/** How long an answer stays in the panel, ms. */
export const NOTICE_MS = 6000;

/** The protocol's ceiling for one `merge` (`MergeCmd.groups`). */
const MAX_MERGE = 16;

/**
 * A selected group asks the server again where it can go after this many ticks (ownership on the
 * way may change); a new group, node or size asks at once. Well under the message rate limit.
 */
export const REACH_REFRESH_TICKS = 10;

/** The selection follows a split-off group only for this many ticks after the split (2 s). */
export const FOLLOW_SPLIT_TICKS = 20;

export interface OrderControllerOptions {
  hud: HudState;
  map: MapFile;
  rules: RulesetPublic;
  book: OrderBook;
  /** Queues a command and returns its `seq`; `null`: there is no match to send to (selection only). */
  send: ((cmd: Command) => number) | null;
  /** Milliseconds, for telling a tap on Q from a hold (a test passes its own clock). */
  now?: () => number;
  /** The alerts of the match: `Space` takes the camera to the next one. */
  alerts?: Pick<AlertState, 'nextNode'>;
  /** Moves the camera to a city (the canvas). */
  focusNode?: (node: number) => void;
  /** Sends `reach_query` for a group (DEC-20); the answer comes back through `onReach`. */
  queryReach?: (group: string) => void;
}

/** The parts of a keyboard event the controller needs (`code`: layout-independent key). */
export interface KeyInput {
  readonly type: 'keydown' | 'keyup';
  readonly code: string;
  readonly shiftKey: boolean;
  /** The key is held and the browser repeats it (a repeat of Q must not reopen the menu). */
  readonly repeat?: boolean;
}

/**
 * Mouse and keyboard ordering on the map (CLI-06, #62). A click picks an own group or a node;
 * with a group selected, a click on a node orders it there (Shift or the switch: a planned order);
 * the order shows as a ghost arrow until the server answers. The controller only sends intents:
 * whether they are allowed, the path and the price charged are the server's call.
 *
 * The other commands (CLI-07, #63) are methods the panel and the keys call: modes, split, merge,
 * recruit, stance, forfeit. Each goes out as an intent and comes back as `accepted` or `rejected`
 * in `ui.current.notice`.
 *
 * Road upgrades are paid with CP (DEC-28, item 7; #311) and have a mode of their own (#315): `U`
 * turns the road mode on or off (so do `Esc` and a second `U`), on the ordinary map and in the
 * «Supply» mode alike. In it every own road that the server offers an upgrade for
 * (`EdgeView.upgrade_gain`) with no build going is lit, and a click on one sends
 * `upgrade_road(edge)` at once, no city involved; under the pointer such a road is described
 * (`ui.current.roadHover`: the gain, the price and the time from `ruleset_public`). Out of the
 * mode a click on a road is a click on the area of its city (an order of a selected group, a
 * selection), never an upgrade. In the mode the road has the click even with a group selected,
 * but not while a transfer picks its target. A refusal (CP, a build already going) is a toast.
 *
 * The «Supply» map mode (DEC-18, item 7; the map layer: DEC-28, item 8) is toggled by Tab (or F2).
 * In it a click on an own city opens its supply menu (a radial menu under the pointer: front
 * marker 1 (key 1) and 2 (key 2), a transfer from the city (key 3); a click or the key chooses,
 * Esc or a click outside closes it). A marker sector puts the marker on the city, moving it for
 * free from wherever it stood, or takes it off when it already stands there (`set_front`, DEC-28,
 * item 2). The rear minimum is `setRearMin` (the slider of the banner, `set_rear_min`, item 3).
 * "Transfer" starts the transfer pick: the own cities a click would pick are ringed; a click on
 * one opens the amount dialog, which sends `transfer`. A click anywhere else, or Esc, ends the
 * pick. The path and the arrival of a transfer come from the server (`ack`); the client computes
 * neither.
 *
 * Groups (DEC-20): a selected group standing in a node asks the server where it can go
 * (`reach_query`); the answer rings the nodes it reaches and, dashed, those it reaches only after a
 * split (the stack limit), and the hovered target shows its travel time as one small number on the
 * map (no window). The client computes neither. S opens the split menu (a slider for the new group; Enter or a click
 * splits, S, Esc or a click outside close it), G merges the groups standing with the selected one,
 * X cancels any order of the selected group (on a road it turns back, free).
 *
 * UI round 2: there is no selection card. A click on an own city opens its radial menu (recruit
 * `R`, with DEC-26 the barracks and the warehouse) centred on the city circle; a second click on an own group (the first selects
 * it) opens a small radial menu on the group (split `S`, merge `G`, cancel `X`, defense `D`). The
 * menus only front the keys: a key does the same without the menu. Recruiting (R) and cancelling
 * a recruit (X) keep the city menu open, to queue several units in a row. A click on the same object
 * again, any click elsewhere and Esc close the menu (a click on another node still orders the
 * selected group).
 *
 * Keys: Esc deselects, X cancels the order of
 * the selected group, 1 / 2 set the mode (attack / defense), D toggles defense, R recruits in the
 * selected city, Q the stance menu (hold and release over a sector, or
 * tap and click; 1 / 2 / 3 choose while it is open), S the split menu, G merge, Space the camera
 * to the next alert, Tab or F2 the «Supply» mode (it also lets a selected city go with its menu),
 * U the road mode.
 * At most one radial menu is open: whoever opens one closes the others (`#closeMenus`).
 */
export class OrderController implements MapInteraction {
  readonly ui = new OrderUiState();
  /** The stance menu on Q (ui-style 11). */
  readonly radial = new RadialState();
  /** The supply menu of an own city in the «Supply» map mode (DEC-18). */
  readonly supplyMenu = new SupplyMenuState();
  /** The amount dialog of a transfer (DEC-18). */
  readonly transfer = new TransferState();
  /** The split menu on S (DEC-20). */
  readonly splitMenu = new SplitState();
  /** The radial menu of the selected own city: recruit, roads (UI round 2). */
  readonly cityMenu = new TargetMenuState<number, CityChoice>();
  /** The small radial menu of the selected own group: split, merge, cancel, defense. */
  readonly groupMenu = new TargetMenuState<string, GroupChoice>();
  /** The list of the own groups standing in one city (the click on their one icon): a group each. */
  readonly stackMenu = new TargetMenuState<number, string>();

  readonly #o: OrderControllerOptions;
  #shift = false;
  #hover: PickHit | null = null;
  /** The last step of the rear minimum by key: where it started and where it was sent to. */
  #rearStep: { readonly from: number; readonly to: number } | null = null;
  #noticeId = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #overlay: OverlayState = EMPTY_OVERLAY;
  #overlayKey = '';
  #overlayGhosts: OverlayState['ghosts'] = [];
  #supplyOverlay: SupplyOverlay | null = null;
  /** When Q went down (ms) while the menu is held open; `null`: Q is up. */
  #qDownAt: number | null = null;
  /** The group, node and size the last `reach_query` was sent for, and the tick it was sent. */
  #reachKey = '';
  #reachTick = 0;
  /**
   * A split the server accepted: the selected `from` group is followed by the new group `to` as
   * soon as a snapshot shows it (`#followSplit`); `tick`: the snapshot tick it was noted at.
   */
  #follow: { readonly from: string; readonly to: string; readonly tick: number } | null = null;

  constructor(options: OrderControllerOptions) {
    this.#o = options;
    options.book.onResult = (result) => {
      this.#onResult(result);
    };
    options.book.onSplit = (from, to) => {
      this.#onSplit(from, to);
    };
  }

  destroy(): void {
    clearTimeout(this.#noticeTimer);
    this.#o.book.onResult = null;
    this.#o.book.onSplit = null;
  }

  /** Planned order: the switch, or Shift held. */
  get planned(): boolean {
    return this.ui.current.planned || this.#shift;
  }

  /** Price of cancelling a planned order, hundredths of CP (ruleset of `welcome`). */
  get cancelCost(): number {
    return this.#o.rules.cost.cancel;
  }

  /** Ticks a second (`ruleset_public.tick_hz`): travel times are shown in seconds. */
  get tickHz(): number {
    return this.#o.rules.tick_hz;
  }

  /** Price of recruiting, hundredths of CP. */
  get recruitCost(): number {
    return this.#o.rules.cost.recruit;
  }

  /** Units in the recruit queue of one city at most (`ruleset_public.recruit`, DEC-25). */
  get recruitQueueMax(): number {
    return this.#o.rules.recruit.queue_max;
  }

  /** Own CP now, hundredths, from the latest snapshot; `null`: not known yet. */
  get cpNow(): number | null {
    return this.#o.hud.current?.cp.value ?? null;
  }

  /** Price of switching a group to `mode`, hundredths of CP. */
  modeCost(mode: Mode): number {
    return mode === 'attack' ? this.#o.rules.cost.attack : this.#o.rules.cost.defense;
  }

  /** Ticks for one point of the "Defense" bonus (`ruleset_public.orders.defense_ticks_per_bonus`, DEC-30). */
  get defenseTicksPerBonus(): number {
    return this.#o.rules.orders.defense_ticks_per_bonus;
  }

  /** Price of a stance change, hundredths of CP. */
  get stanceCost(): number {
    return this.#o.rules.cost.stance;
  }

  setPlanned(planned: boolean): void {
    this.ui.patch({ planned });
  }

  // --- MapInteraction -----------------------------------------------------------------------

  overlay(): OverlayState {
    this.#followSplit();
    this.#syncRoadHover();
    this.#syncReach();
    this.#syncTargetMenus();
    const reach = this.#reach();
    const selection = this.#o.hud.selection;
    const ghosts = this.#o.book.ghosts();
    const preview = this.#previewTarget();
    const from = this.#selectedGroup()?.node ?? null;
    const candidates = this.#candidates();
    const beacon = this.#o.hud.beacon;
    const supply = this.#supplyOverlayNow();
    const reachNodes = reach === null ? [] : [...reach.ticks.keys()];
    const splitNodes = reach === null ? [] : [...reach.split];
    const eta = this.#eta(reach, preview);
    const key = `${selection?.kind ?? '-'}:${String(selection?.id ?? '-')}|${String(from)}>${String(preview)}|${String(this.planned)}|${candidates.join(',')}|${String(beacon)}|${String(eta?.ticks ?? '-')}|${reachNodes.join(',')}/${splitNodes.join(',')}`;
    if (
      key !== this.#overlayKey ||
      ghosts !== this.#overlayGhosts ||
      supply !== this.#overlay.supply
    ) {
      this.#overlayKey = key;
      this.#overlayGhosts = ghosts;
      this.#overlay = {
        selection,
        ghosts,
        preview:
          from !== null && preview !== null ? { from, to: preview, planned: this.planned } : null,
        candidates,
        beacon,
        supply,
        reach: reachNodes,
        split: splitNodes,
        eta:
          eta === null || preview === null || from === null
            ? null
            : { from, node: preview, ticks: eta.ticks },
      };
    }
    return this.#overlay;
  }

  click(picked: PickHit | null, shift: boolean): void {
    this.#shift = shift;
    // In the road mode a click on an own road that can be raised raises it, on the ordinary map and
    // in the «Supply» mode alike (DEC-28, item 7; #315). Out of the mode a road is its city's area.
    const road = this.#roadTarget(picked);
    if (road !== null) {
      this.#closeMenus();
      this.upgradeRoad(road);
      return;
    }
    if (this.#supplyClick(picked)) return;
    if (picked === null) {
      this.deselect();
      return;
    }
    let hit: PickHit = picked;
    if (hit.kind === 'edge') {
      // A road that is not raised by this click is a click on the area of the city it lies in.
      if (hit.cell === undefined) return;
      hit = { kind: 'node', id: hit.cell };
    }
    const group = this.#selectedGroup();
    // A click on the node the selected group stands in only lets the group go: no city menu, no
    // city selection (a click on another node stays an order).
    if (hit.kind === 'node' && group !== null && group.node === hit.id) {
      this.deselect();
      return;
    }
    // The icon of own units in a city is the city for an order of a group selected elsewhere.
    const iconNode = hit.kind === 'stack' ? hit.node : hit.kind === 'group' ? hit.node : undefined;
    if (iconNode !== undefined && group !== null && group.node !== iconNode) {
      hit = { kind: 'node', id: iconNode };
    }
    if (hit.kind === 'node' && group !== null && this.#o.send !== null && group.node !== hit.id) {
      this.#closeTargetMenus();
      this.#sendCommand(
        { type: 'move', group: group.id, dest: hit.id, planned: this.planned },
        group.node,
      );
      // The order is given: the group is let go (the ghost of the order is drawn without it).
      this.deselect();
      return;
    }
    if (hit.kind === 'stack') {
      this.#clickStack(hit.node, hit.ids);
      return;
    }
    // A province is only a destination (DEC-23): it is never selected, lit or given a menu, so a
    // click on one that is not an order is a click on nothing.
    if (hit.kind === 'node' && this.#isProvince(hit.id)) {
      this.deselect();
      return;
    }
    // A city opens its menu on the click that selects it, a second click on it closes the menu.
    // A group opens its menu on a click on the group that is already selected (a second click
    // toggles it): the first click only selects, so ordering a move never has a ring in the way.
    const target: Selection = hit.kind === 'group' ? { kind: 'group', id: hit.id } : hit;
    const selected = this.#o.hud.selection;
    const again = selected?.kind === target.kind && selected.id === target.id;
    const cityReclick =
      target.kind === 'node' &&
      this.cityMenu.current.open &&
      this.cityMenu.current.target === target.id;
    const groupWasOpen =
      target.kind === 'group' &&
      this.groupMenu.current.open &&
      this.groupMenu.current.target === target.id;
    if (cityReclick) {
      // The second click closes the menu and lets the city go with it (#426).
      this.deselect();
      return;
    }
    this.#closeMenus();
    this.#o.hud.select(target);
    this.#hover = hit;
    if (this.#o.send !== null) {
      if (target.kind === 'group' && again && !groupWasOpen) this.groupMenu.open(target.id);
      else if (target.kind === 'node' && this.#isOwnNode(target.id)) {
        this.cityMenu.open(target.id);
      }
    }
  }

  /**
   * A click on the one icon of several own groups in a city: the city is selected (unless one of
   * those groups already is) and the list of the groups opens; a second click closes it.
   */
  #clickStack(node: number, ids: readonly string[]): void {
    const wasOpen = this.stackMenu.current.open && this.stackMenu.current.target === node;
    this.#closeMenus();
    const selected = this.#o.hud.selection;
    if (this.#isProvince(node)) {
      // The list opens, but the province itself is not selected (DEC-23).
      if (!(selected?.kind === 'group' && ids.includes(selected.id))) this.#o.hud.select(null);
    } else if (!(selected?.kind === 'group' && ids.includes(selected.id))) {
      this.#o.hud.select({ kind: 'node', id: node });
    }
    this.#hover = { kind: 'node', id: node };
    if (this.#o.send !== null && !wasOpen) this.stackMenu.open(node);
  }

  /** The own groups standing in the city of the open list menu, in the order the menu shows them. */
  stackGroups(): GroupBrief[] {
    const node = this.stackMenu.current.target;
    return node === null ? [] : (this.#o.hud.current?.groups ?? []).filter((g) => g.node === node);
  }

  /**
   * A sector of the list menu: the group is selected; a group that already is selected opens its
   * own menu (split, merge, cancel, defense), so a stacked group has a menu too.
   */
  chooseStackGroup(id: string): void {
    this.#closeMenus();
    const selected = this.#o.hud.selection;
    this.#o.hud.select({ kind: 'group', id });
    if (selected?.kind === 'group' && selected.id === id && this.#o.send !== null) {
      this.groupMenu.open(id);
    }
  }

  hover(hit: PickHit | null): void {
    this.#hover = hit;
    this.#syncRoadHover();
    this.#o.hud.hoverGroup(
      hit?.kind === 'group' ? hit.id : hit?.kind === 'stack' ? { node: hit.node } : null,
    );
  }

  /**
   * Nothing to drop: no selection, no pick, no open menu or dialog. An `Esc` now has nothing to
   * do, so two of them in a row ask whether to leave the match (`hud/hudKeys.ts`).
   */
  isIdle(): boolean {
    return (
      this.#o.hud.selection === null &&
      !this.ui.current.roadMode &&
      this.ui.current.transferFrom === null &&
      !this.cityMenu.current.open &&
      !this.groupMenu.current.open &&
      !this.stackMenu.current.open &&
      !this.radial.current.open &&
      !this.supplyMenu.current.open &&
      !this.splitMenu.current.open &&
      !this.transfer.current.open
    );
  }

  // --- Commands -----------------------------------------------------------------------------

  deselect(): void {
    this.#closeMenus();
    this.#o.hud.select(null);
  }

  /**
   * Cancel the order of the selected group: a planned order while it waits, a move on a road
   * (the group turns back to the start of that road), or «Defense» (DEC-20). Free; whether there
   * is anything to cancel is the server's call (`NOTHING_TO_CANCEL`).
   */
  cancelSelected(): void {
    const group = this.#selectedGroup();
    if (group === null) return;
    this.groupMenu.close();
    this.#sendCommand({ type: 'cancel_order', group: group.id }, null);
    if (this.#o.send !== null) this.deselect();
  }

  /** Switch the mode of the selected group (attack / defense). */
  setMode(mode: Mode): void {
    const group = this.#selectedGroup();
    if (group === null) return;
    this.groupMenu.close();
    this.#sendCommand({ type: 'set_mode', group: group.id, mode }, null);
  }

  /** D: «Defense» on, or back to «Attack» when the selected group already holds it. */
  toggleDefense(): void {
    const group = this.#selectedGroup();
    if (group === null) return;
    this.setMode(group.mode === 'defense' ? 'attack' : 'defense');
  }

  /** Split `n` units off the selected group into a new group. */
  split(n: number): void {
    const group = this.#selectedGroup();
    if (group === null || !Number.isInteger(n)) return;
    this.#sendCommand({ type: 'split', group: group.id, n }, null);
  }

  /** S: open the split menu for the selected group standing in a node, or close it. */
  toggleSplit(): void {
    if (this.splitMenu.current.open) {
      this.splitMenu.close();
      return;
    }
    const group = this.#selectedGroup();
    if (group === null || group.node === null || this.#o.send === null) return;
    this.#closeMenus();
    this.splitMenu.open(group.id, group.units, group.charged);
  }

  /** The split menu's button or Enter: split the chosen amount off and close the menu. */
  confirmSplit(): void {
    const { open, group, n } = this.splitMenu.current;
    this.splitMenu.close();
    if (!open || this.#o.send === null) return;
    this.#sendCommand({ type: 'split', group, n }, null);
  }

  closeSplit(): void {
    this.splitMenu.close();
  }

  /**
   * The server's answer to `reach_query` (DEC-20, D5). Kept only while it is about the selected
   * group: a late answer for a group selected before is dropped.
   */
  onReach(msg: ReachMsg): void {
    if (msg.group !== this.#selectedGroup()?.id) return;
    const info: ReachInfo = {
      group: msg.group,
      ticks: new Map(msg.nodes.map((n) => [n.node, n.ticks])),
      split: new Set(msg.split),
    };
    this.ui.patch({ reach: info });
  }

  /**
   * Own groups that can be merged in one node: the node of the selected group, or the selected
   * node itself (the selected group first). A group with a planned order waits to depart and the
   * server refuses the whole `merge` because of it (`GROUP_BUSY`), so it is left out (#212).
   */
  mergeCandidates(): string[] {
    const data = this.#o.hud.current;
    if (data === null) return [];
    const group = data.group;
    if (group?.planned === true) return [];
    const node = group?.node ?? (group === null ? (data.node?.id ?? null) : null);
    if (node === null) return [];
    const here = data.groups.filter((g) => g.node === node && !g.planned);
    const ids = here.map((g) => g.id);
    const first = group !== null && ids.includes(group.id) ? [group.id] : [];
    return [...first, ...ids.filter((id) => id !== group?.id)].slice(0, MAX_MERGE);
  }

  /** Merge every own group standing in the selected node or with the selected group; needs two. */
  merge(): void {
    const [first, second, ...rest] = this.mergeCandidates();
    this.groupMenu.close();
    if (first === undefined || second === undefined) return;
    this.#sendCommand({ type: 'merge', groups: [first, second, ...rest] }, null);
  }

  /**
   * The server made the new group `to` of a split of `from` (the `group_split` event, matched to
   * the split this player sent): the split-off group is the one to hold next, so the selection
   * moves to it once a snapshot shows it (before that the id names nothing on screen). A player
   * who has selected something else meanwhile keeps their selection.
   */
  #onSplit(from: string, to: string): void {
    const selection = this.#o.hud.selection;
    if (selection?.kind !== 'group' || selection.id !== from) return;
    this.#follow = { from, to, tick: this.#o.hud.current?.tick ?? 0 };
    this.#followSplit();
  }

  /** Cheap, runs every frame: moves the selection to the split-off group once it is on screen. */
  #followSplit(): void {
    const follow = this.#follow;
    if (follow === null) return;
    const data = this.#o.hud.current;
    const selection = this.#o.hud.selection;
    const stale = data !== null && data.tick - follow.tick > FOLLOW_SPLIT_TICKS;
    if (stale || selection?.kind !== 'group' || selection.id !== follow.from) {
      this.#follow = null;
      return;
    }
    if (data?.groups.some((g) => g.id === follow.to) !== true) return;
    this.#follow = null;
    this.#closeMenus();
    this.#o.hud.select({ kind: 'group', id: follow.to });
  }

  /**
   * Closes the menu of a city (a key, a click outside, the barracks or the warehouse) and lets the
   * city go with it, so its selection highlight does not stay on after the menu (#426). Recruiting
   * and cancelling a recruit do not close it (#450).
   */
  closeCityMenu(): void {
    const { open, target } = this.cityMenu.current;
    this.cityMenu.close();
    const selection = this.#o.hud.selection;
    if (open && selection?.kind === 'node' && selection.id === target) this.#o.hud.select(null);
  }

  /** A sector of the menu of a city: the same as its key. */
  chooseCity(choice: CityChoice): void {
    if (choice === 'recruit') this.recruit();
    else if (choice === 'barracks') this.cityBuild('build_barracks');
    else this.cityBuild('upgrade_warehouse');
  }

  /** A sector of the menu of a group: the same as its key. */
  chooseGroup(choice: GroupChoice): void {
    this.groupMenu.close();
    switch (choice) {
      case 'split':
        this.toggleSplit();
        return;
      case 'merge':
        this.merge();
        return;
      case 'cancel':
        this.cancelSelected();
        return;
      case 'defense':
        this.toggleDefense();
        return;
    }
  }

  /** The city to recruit in: the selected node, or the node the selected group stands in. */
  recruitNode(): number | null {
    const selection = this.#o.hud.selection;
    if (selection?.kind === 'node') return selection.id;
    return this.#selectedGroup()?.node ?? null;
  }

  /**
   * Queues a unit in the selected city. The menu stays open and the city stays selected, so the
   * next click on the sector or the next R queues another one (#450); the sector is dimmed by the
   * CP price and the queue length, the server rejects the rest.
   */
  recruit(): void {
    const node = this.recruitNode();
    if (node === null) return;
    this.#sendCommand({ type: 'recruit', node }, null);
  }

  /** The barracks or a warehouse level of the selected own city (DEC-26). */
  cityBuild(type: 'build_barracks' | 'upgrade_warehouse'): void {
    const node = this.recruitNode();
    this.closeCityMenu();
    if (node === null) return;
    this.#sendCommand({ type, node }, null);
  }

  /** The city development of DEC-26 is in these rules (`ruleset_public.city_upgrades`). */
  get cityUpgrades(): RulesetPublic['city_upgrades'] {
    return this.#o.rules.city_upgrades;
  }

  /** Prices of a unit, the barracks and a warehouse level, hundredths of CP. */
  get cityCosts(): {
    readonly recruit: number;
    readonly barracks: number;
    readonly warehouse: number;
  } {
    const { cost } = this.#o.rules;
    return {
      recruit: cost.recruit,
      barracks: cost.barracks,
      warehouse: cost.warehouse,
    };
  }

  /** Take the last unit off the recruit queue of the selected city (DEC-25); free. Keeps the menu open like `recruit`. */
  cancelRecruit(): void {
    const node = this.recruitNode();
    if (node === null) return;
    this.#sendCommand({ type: 'cancel_recruit', node }, null);
  }

  /** The selected node, or the node the selected group stands in, if it is the player's. */
  selectedOwnCity(): number | null {
    const node = this.#o.hud.current?.node ?? null;
    return node?.owner === 'mine' ? node.id : null;
  }

  /** Own roads the server offers an upgrade for that have no build going now (the latest snapshot). */
  upgradableRoads(): number[] {
    return (this.#o.hud.current?.roads ?? [])
      .filter((road) => road.gain !== null && !road.building)
      .map((road) => road.id);
  }

  get roadMode(): boolean {
    return this.ui.current.roadMode;
  }

  /**
   * `U`: the road mode on or off (#315). Turning it on closes every open menu and the amount
   * dialog and ends a transfer pick (a road click must not be taken for its target); the
   * selection stays.
   */
  toggleRoadMode(): void {
    const on = !this.ui.current.roadMode;
    if (on) {
      this.#closeMenus();
      this.transfer.close();
    }
    this.ui.patch(on ? { roadMode: true, transferFrom: null } : { roadMode: false });
  }

  /**
   * Raise the own road `edge` by one level (DEC-28, item 7): `upgrade_road(edge)`, paid with CP at
   * once, no city involved. The price and the build time come from `ruleset_public`
   * (`roadCost`, `roadBuildTicks`); whether the road may be built (CP, a build already going) is
   * the server's call, and a refusal is a toast like any other.
   */
  upgradeRoad(edge: number): void {
    if (this.#o.send === null) return;
    this.#sendCommand({ type: 'upgrade_road', edge }, null);
  }

  /** Price of one road level, hundredths of CP (`ruleset_public.cost.build`). */
  get roadCost(): number {
    return this.#o.rules.cost.build;
  }

  /** Ticks one road level takes to build (`ruleset_public.build.ticks_per_level`). */
  get roadBuildTicks(): number {
    return this.#o.rules.build.ticks_per_level;
  }

  setStance(stance: Stance): void {
    this.#sendCommand({ type: 'set_stance', stance }, null);
  }

  /** The numbers of the stance menu, from the ruleset of `welcome`. */
  get stanceRates(): StanceRate[] {
    return stanceRates(this.#o.rules);
  }

  /** The menu opens only in a match, where a stance can be sent. */
  openRadial(sticky: boolean): boolean {
    if (this.#o.send === null) return false;
    this.#closeMenus();
    this.radial.open(sticky);
    return true;
  }

  closeRadial(): void {
    this.#qDownAt = null;
    this.radial.close();
  }

  /** A sector was chosen: close the menu and send the stance unless it is the current one. */
  chooseStance(stance: Stance): void {
    this.closeRadial();
    if (this.#o.hud.current?.stance !== stance) this.setStance(stance);
  }

  forfeit(): void {
    this.#sendCommand({ type: 'forfeit' }, null);
  }

  // --- The «Supply» map mode (DEC-18) ----------------------------------------------------------

  get supplyMode(): boolean {
    return this.ui.current.supplyMode;
  }

  /**
   * Tab / F2: the «Supply» map mode on or off. Either way every open menu and the
   * amount dialog close and a selected city is let go (its menu goes with it); a selected group
   * stays.
   */
  toggleSupplyMode(): void {
    const on = !this.ui.current.supplyMode;
    this.#closeMenus();
    this.transfer.close();
    if (this.#o.hud.selection?.kind === 'node') this.#o.hud.select(null);
    this.ui.patch({ supplyMode: on, transferFrom: null });
  }

  /** Opens the supply menu of the own city `node` (a click on it in the «Supply» mode). */
  openSupplyMenu(node: number): boolean {
    const city = this.#ownCity(node);
    if (city === null || this.#o.send === null) return false;
    this.#closeMenus();
    this.supplyMenu.open(node, city.warehouse, this.#o.hud.current?.fronts ?? []);
    return true;
  }

  closeSupplyMenu(): void {
    this.supplyMenu.close();
  }

  /**
   * A sector of the supply menu: a marker sector puts that front marker on the city or takes it
   * off (DEC-28, item 2), "transfer" starts the transfer pick (DEC-18, item 6).
   */
  chooseSupply(choice: SupplyChoice = 'transfer'): void {
    const { open, node } = this.supplyMenu.current;
    this.supplyMenu.close();
    if (!open) return;
    const marker = frontOf(choice);
    if (marker === null) this.ui.patch({ transferFrom: node });
    else this.toggleFront(marker, node);
  }

  /** The own rear minimum now, from the latest snapshot; `null`: not known yet (DEC-28, item 3). */
  get rearMin(): number | null {
    return this.#o.hud.current?.rearMin ?? null;
  }

  /** The top of the rear minimum slider (`ruleset_public.supply.rear_min_max`). */
  get rearMinMax(): number {
    return this.#o.rules.supply.rear_min_max;
  }

  /** The number of front markers the player has (`ruleset_public.supply.front_markers`, DEC-28, item 2). */
  get frontMarkers(): number {
    return this.#o.rules.supply.front_markers;
  }

  /** The price of putting a front marker, hundredths of CP (`ruleset_public.cost.front`; 0 in DEC-28). */
  get frontCost(): number {
    return this.#o.rules.cost.front;
  }

  /**
   * Front marker `marker` on the own city `node`, wherever it stood (moving it is free); off the
   * map (`node = null`) when it already stands there. A city holds one marker at most, so a city
   * with the other marker sends nothing. Whether the city is ours is the server's call.
   */
  toggleFront(marker: number, node: number): void {
    const fronts = this.#o.hud.current?.fronts ?? [];
    if (!Number.isInteger(marker) || marker < 0 || marker >= this.frontMarkers) return;
    if (fronts.some((at, i) => i !== marker && at === node)) return;
    this.#sendCommand(
      { type: 'set_front', marker, node: (fronts[marker] ?? null) === node ? null : node },
      null,
    );
  }

  /** The global rear minimum (DEC-28, item 3): clamped to `0..supply.rear_min_max`, sent only on a change. */
  setRearMin(n: number): void {
    if (!Number.isFinite(n)) return;
    const value = Math.min(this.#o.rules.supply.rear_min_max, Math.max(0, Math.round(n)));
    if (value === this.#o.hud.current?.rearMin) return;
    this.#sendCommand({ type: 'set_rear_min', n: value }, null);
  }

  /**
   * One step of the rear minimum up (`delta` 1) or down (-1) from where it stands (`[` and `]` on
   * the «Supply» layer), kept within `0..supply.rear_min_max`. The snapshot that confirms a step
   * comes a moment later: presses before it add up from the step already sent, not from the old
   * value, so two quick presses are two steps.
   */
  stepRearMin(delta: number): void {
    const now = this.rearMin;
    if (now === null) return;
    const sent = this.#rearStep !== null && this.#rearStep.from === now ? this.#rearStep.to : now;
    const to = Math.min(this.#o.rules.supply.rear_min_max, Math.max(0, sent + delta));
    if (to === sent) return;
    this.#rearStep = { from: now, to };
    this.setRearMin(to);
  }

  /** Ends the transfer pick without a transfer. */
  cancelTransferPick(): void {
    if (this.ui.current.transferFrom !== null) this.ui.patch({ transferFrom: null });
  }

  /** The amount chosen in the transfer dialog. */
  setTransferAmount(n: number): void {
    this.transfer.set(n);
  }

  /** Sends the transfer of the dialog (the server checks the path and the warehouse). */
  confirmTransfer(): void {
    const { open, from, to, n } = this.transfer.current;
    this.transfer.close();
    if (!open || n < 1) return;
    this.#sendCommand({ type: 'transfer', from_node: from, to_node: to, n }, null);
  }

  closeTransfer(): void {
    this.transfer.close();
  }

  /** Returns true if the key was used (the caller then prevents the browser default). */
  key(input: KeyInput): boolean {
    this.#shift = input.shiftKey;
    if (input.type !== 'keydown') return this.#keyUp(input);
    if (input.code === 'Tab' || input.code === 'F2') {
      if (input.repeat !== true) this.toggleSupplyMode();
      return true;
    }
    if (input.code === 'KeyU') {
      if (input.repeat !== true) this.toggleRoadMode();
      return true;
    }
    if (input.code === 'KeyQ') return this.#qDown(input);
    if (this.splitMenu.current.open) {
      // The split menu: arrows change the amount, Enter splits, S (the key that opened it) or Esc
      // close it; the other keys stay with the menu so a stray key does not order the group.
      switch (input.code) {
        case 'ArrowLeft':
        case 'ArrowDown':
          this.splitMenu.set(this.splitMenu.current.n - 1);
          return true;
        case 'ArrowRight':
        case 'ArrowUp':
          this.splitMenu.set(this.splitMenu.current.n + 1);
          return true;
        case 'Enter':
        case 'NumpadEnter':
          this.confirmSplit();
          return true;
        case 'KeyS':
        case 'Escape':
          this.closeSplit();
          return true;
        default:
          return false;
      }
    }
    if (this.transfer.current.open) {
      // The amount dialog: Esc closes it (Enter and the slider are the dialog's own).
      if (input.code === 'Escape') {
        this.closeTransfer();
        return true;
      }
    }
    if (this.supplyMenu.current.open) {
      // The supply menu: 1, 2, 3 choose (not the modes), Esc closes it.
      const sector = SUPPLY_SECTORS.find((s) => `Digit${s.key}` === input.code);
      if (sector !== undefined) {
        // A marker the player does not have (a ruleset with one) is no sector: the key is dead.
        const marker = frontOf(sector.choice);
        if (marker === null || marker < this.frontMarkers) this.chooseSupply(sector.choice);
        return true;
      }
      if (input.code === 'Escape') {
        this.closeSupplyMenu();
        return true;
      }
    }
    if (input.code === 'Escape' && this.ui.current.transferFrom !== null) {
      this.cancelTransferPick();
      return true;
    }
    if (this.stackMenu.current.open) {
      // The list of groups: 1..9 choose the group (not the modes), Esc closes it.
      const number = /^Digit([1-9])$/.exec(input.code)?.[1];
      const group = number === undefined ? undefined : this.stackGroups()[Number(number) - 1];
      if (group !== undefined) {
        this.chooseStackGroup(group.id);
        return true;
      }
    }
    if (this.radial.current.open) {
      // The menu is open: 1 / 2 / 3 choose a stance (not the modes), Esc closes it.
      const sector = SECTORS.find((s) => `Digit${s.key}` === input.code);
      if (sector !== undefined) {
        this.chooseStance(sector.stance);
        return true;
      }
      if (input.code === 'Escape') {
        this.closeRadial();
        return true;
      }
    }
    if (
      (input.code === 'BracketLeft' || input.code === 'BracketRight') &&
      this.ui.current.supplyMode &&
      !this.transfer.current.open
    ) {
      // On the «Supply» layer `[` and `]` lower and raise the rear minimum, one step a press.
      if (input.repeat !== true) this.stepRearMin(input.code === 'BracketRight' ? 1 : -1);
      return true;
    }
    switch (input.code) {
      case 'Escape':
        // The menus above took their own Esc; the road mode is left before anything is dropped.
        if (this.ui.current.roadMode) this.ui.patch({ roadMode: false });
        else this.deselect();
        return true;
      case 'KeyX':
        // A selected own city: its last recruit goes; otherwise the order of the selected group.
        if (this.#o.hud.selection?.kind === 'node') {
          if (this.selectedOwnCity() !== null) this.cancelRecruit();
        } else this.cancelSelected();
        return true;
      case 'KeyD':
        this.toggleDefense();
        return true;
      case 'Digit1':
        return this.#modeKey('attack');
      case 'Digit2':
        return this.#modeKey('defense');
      case 'KeyR':
        this.recruit();
        return true;
      case 'KeyS':
        this.toggleSplit();
        return true;
      case 'KeyG':
        this.merge();
        return true;
      case 'Space':
        return this.#jumpToAlert();
      default:
        return false;
    }
  }

  // --- Internals ----------------------------------------------------------------------------

  #closeTargetMenus(): void {
    this.cityMenu.close();
    this.groupMenu.close();
    this.stackMenu.close();
  }

  /**
   * Closes every radial menu (stance, supply, split, city, group, stack list): at most one is open
   * at a time, so whoever opens one calls this first.
   */
  #closeMenus(): void {
    this.closeRadial();
    this.supplyMenu.close();
    this.splitMenu.close();
    this.#closeTargetMenus();
  }

  /** The node `id` is a province (`kind = province`, DEC-23): not selectable, has no city menus. */
  #isProvince(id: number): boolean {
    return this.#o.map.nodes[id]?.kind === 'province';
  }

  /** The node `id` is one of the player's own cities in the snapshot on screen. */
  #isOwnNode(id: number): boolean {
    return this.#o.hud.current?.nodes.some((n) => n.id === id && n.owner === 'mine') ?? false;
  }

  /**
   * The menus of a city and of a group belong to the selection: when it moves on (the group is
   * gone, the city was captured, another thing got selected) the menu goes. Cheap, runs every frame.
   */
  #syncTargetMenus(): void {
    const city = this.cityMenu.current;
    if (city.open) {
      const selection = this.#o.hud.selection;
      if (
        selection?.kind !== 'node' ||
        selection.id !== city.target ||
        !this.#isOwnNode(city.target)
      ) {
        this.cityMenu.close();
      }
    }
    const group = this.groupMenu.current;
    if (group.open) {
      const selection = this.#o.hud.selection;
      if (selection?.kind !== 'group' || selection.id !== group.target) this.groupMenu.close();
    }
    const stack = this.stackMenu.current;
    if (stack.open) {
      // The list belongs to its city while it is selected (or a group in it is) and has a choice.
      const node = this.#o.hud.selection?.kind === 'node' ? this.#o.hud.selection.id : null;
      // A province is never selected: its list stays open with nothing selected (DEC-23).
      const at =
        node ??
        this.#selectedGroup()?.node ??
        (this.#o.hud.selection === null && this.#isProvince(stack.target ?? -1)
          ? stack.target
          : null);
      if (at !== stack.target || this.stackGroups().length < 2) this.stackMenu.close();
    }
  }

  /** An own city of the snapshot (warehouse and its capacity: only own cities have one), or `null`. */
  #ownCity(node: number): {
    warehouse: number | null;
    warehouseCap: number | null;
  } | null {
    const choice = this.#o.hud.current?.nodes.find((n) => n.id === node);
    return choice?.owner === 'mine' && choice.warehouseCap !== null && !this.#isProvince(node)
      ? choice
      : null;
  }

  /**
   * A click in the «Supply» mode: picks the destination of a transfer, or opens the supply menu
   * of an own city. Returns false when the click is an ordinary one (selection, orders).
   */
  #supplyClick(hit: PickHit | null): boolean {
    if (!this.ui.current.supplyMode) return false;
    const from = this.ui.current.transferFrom;
    const node = hit === null ? null : this.#cityOf(hit);
    if (from !== null) {
      this.cancelTransferPick();
      if (node !== null && node !== from && this.#ownCity(node) !== null) {
        const target = this.#ownCity(node);
        // Display arithmetic only (the server clamps too): no more than the source holds and
        // than the free room of the target warehouse (capacity minus stock; unknown: no limit).
        const stock = this.#ownCity(from)?.warehouse ?? 0;
        const room =
          target?.warehouseCap == null
            ? null
            : Math.max(0, target.warehouseCap - (target.warehouse ?? 0));
        this.transfer.open(from, node, room === null ? stock : Math.min(stock, room), room === 0);
      }
      return true;
    }
    return node !== null && this.openSupplyMenu(node);
  }

  /** The city a hit belongs to: itself, its area, or the icon of own units standing in it. */
  #cityOf(hit: PickHit): number | null {
    switch (hit.kind) {
      case 'node':
        return hit.id;
      case 'stack':
        return hit.node;
      case 'group':
        return hit.node ?? null;
      case 'edge':
        return hit.cell ?? null;
    }
  }

  /** The supply part of the overlay; the same object while nothing changed. */
  #supplyOverlayNow(): SupplyOverlay | null {
    if (!this.ui.current.supplyMode) {
      this.#supplyOverlay = null;
      return null;
    }
    const source = this.ui.current.transferFrom;
    const targets =
      source === null
        ? []
        : (this.#o.hud.current?.nodes ?? [])
            .filter((n) => n.owner === 'mine' && n.warehouseCap !== null && n.id !== source)
            .map((n) => n.id);
    const prev = this.#supplyOverlay;
    if (
      prev?.source !== source ||
      prev.targets.length !== targets.length ||
      prev.targets.some((t, i) => t !== targets[i])
    ) {
      this.#supplyOverlay = { source, targets };
    }
    return this.#supplyOverlay;
  }

  /** `Space`: the camera goes to the city the next alert is about; taken only if there is one. */
  #jumpToAlert(): boolean {
    const node = this.#o.alerts?.nextNode() ?? null;
    if (node === null) return false;
    this.#o.focusNode?.(node);
    return true;
  }

  #now(): number {
    return this.#o.now?.() ?? performance.now();
  }

  /** Q down: a held key opens the menu under the pointer; Q again closes a menu left open. */
  #qDown(input: KeyInput): boolean {
    if (input.repeat === true) return true;
    if (this.radial.current.open) {
      this.closeRadial();
      return true;
    }
    this.#qDownAt = this.openRadial(false) ? this.#now() : null;
    return true;
  }

  /**
   * Q up: a short press leaves the menu open for a click or 1 / 2 / 3; after a hold the sector
   * under the pointer is chosen, and the dead zone cancels. A lost focus cancels a hold.
   */
  #keyUp(input: KeyInput): boolean {
    if (input.code === '' && this.#qDownAt !== null) {
      this.closeRadial();
      return false;
    }
    if (input.code !== 'KeyQ' || this.#qDownAt === null) return false;
    const held = this.#now() - this.#qDownAt;
    this.#qDownAt = null;
    const { hover } = this.radial.current;
    if (held < RADIAL.tapMs) {
      this.radial.keep();
    } else if (hover === null) {
      this.closeRadial();
    } else {
      this.chooseStance(hover);
    }
    return true;
  }

  #modeKey(mode: Mode): boolean {
    this.setMode(mode);
    return true;
  }

  /** Sends an intent and starts waiting for its `ack`; a new command clears the old notice. */
  #sendCommand(cmd: Command, from: number | null): void {
    const send = this.#o.send;
    if (send === null) return;
    this.#clearNotice();
    this.#o.book.track(send(cmd), cmd, from);
  }

  #selectedGroup() {
    return this.#o.hud.current?.group ?? null;
  }

  /** The reach answer, if it is about the selected group as it stands now. */
  #reach(): ReachInfo | null {
    const reach = this.ui.current.reach;
    const group = this.#selectedGroup();
    return reach !== null && group !== null && group.node !== null && reach.group === group.id
      ? reach
      : null;
  }

  /**
   * Asks the server where the selected group can go: at once for a new group, node or size, then
   * every `REACH_REFRESH_TICKS`. Without a standing group the old answer is dropped.
   */
  #syncReach(): void {
    const query = this.#o.queryReach;
    const group = this.#selectedGroup();
    if (query === undefined || group === null || group.node === null) {
      this.#reachKey = '';
      if (this.ui.current.reach !== null) this.ui.patch({ reach: null });
      return;
    }
    const key = `${group.id}:${String(group.node)}:${String(group.units)}`;
    const tick = this.#o.hud.current?.tick ?? 0;
    if (key === this.#reachKey && tick - this.#reachTick < REACH_REFRESH_TICKS) return;
    if (key !== this.#reachKey && this.ui.current.reach !== null) this.ui.patch({ reach: null });
    this.#reachKey = key;
    this.#reachTick = tick;
    query(group.id);
  }

  /**
   * The road a click on `hit` raises now: in the road mode, an own road the server offers an
   * upgrade for (`EdgeView.upgrade_gain`: own internal, below the top level) with no build going
   * on it. While a transfer picks its target a road is only the area of its city. `null`: the
   * click does something else.
   */
  #roadTarget(hit: PickHit | null): number | null {
    if (hit?.kind !== 'edge' || this.#o.send === null) return null;
    if (!this.ui.current.roadMode || this.ui.current.transferFrom !== null) return null;
    const road = this.#o.hud.current?.roads[hit.id];
    return road !== undefined && road.id === hit.id && road.gain !== null && !road.building
      ? road.id
      : null;
  }

  /** The road under the pointer that a click would raise, mirrored to `ui.current.roadHover`. */
  #syncRoadHover(): void {
    const road = this.#roadTarget(this.#hover);
    if (road !== this.ui.current.roadHover) this.ui.patch({ roadHover: road });
  }

  /** In the road mode, every own road a click would raise now: lit up (dashed band) on the map. */
  #candidates(): number[] {
    return this.ui.current.roadMode && this.#o.send !== null ? this.upgradableRoads() : [];
  }

  /**
   * The time to the hovered node for the one small number there: the server's travel time of the
   * whole path (`reach`), and for a planned order the delay before the group sets off, from
   * `ruleset_public` (display arithmetic only; the client computes no path). `null`: no number.
   */
  #eta(reach: ReachInfo | null, preview: number | null): { ticks: number } | null {
    if (reach === null || preview === null) return null;
    const ticks = reach.ticks.get(preview);
    if (ticks === undefined) return null;
    return { ticks: this.planned ? ticks + this.#o.rules.orders.planned_delay_ticks : ticks };
  }

  /** The node a click would send the selected group to, if it would. */
  #previewTarget(): number | null {
    const group = this.#selectedGroup();
    if (group === null || group.node === null || this.#o.send === null) return null;
    const city = this.#hoverCity();
    return city !== null && city !== group.node ? city : null;
  }

  /** The city under the pointer: its circle or area, or the icon of own units standing in it. */
  #hoverCity(): number | null {
    return this.#hover === null ? null : this.#cityOf(this.#hover);
  }

  #onResult(result: CommandResult): void {
    this.ui.emit(
      result.kind === 'rejected'
        ? { kind: 'rejected', code: result.code, cmd: result.cmd }
        : result.kind === 'accepted'
          ? { kind: 'accepted', cmd: result.cmd, arriveTick: result.arriveTick ?? null }
          : { kind: result.kind, cmd: result.cmd },
    );
    // A move shows itself on the map (ghost, then the order line): no message for its success.
    if (result.kind === 'accepted' && result.cmd.type === 'move') return;
    this.#noticeId += 1;
    const id = this.#noticeId;
    this.ui.patch({
      notice:
        result.kind === 'rejected'
          ? { id, kind: 'rejected', code: result.code, cmd: result.cmd }
          : { id, kind: result.kind, cmd: result.cmd },
    });
    clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => {
      this.#clearNotice();
    }, NOTICE_MS);
  }

  #clearNotice(): void {
    clearTimeout(this.#noticeTimer);
    if (this.ui.current.notice !== null) this.ui.patch({ notice: null });
  }
}
