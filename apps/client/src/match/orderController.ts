import type { HudState } from '../hud/hudState.svelte.ts';
import type { AlertState } from './alerts.svelte.ts';
import { roadCandidates, type AttackTarget } from '../hud/hudData.ts';
import type { Command, MapFile, Mode, Priority, RulesetPublic, Stance } from '../protocol.gen.ts';
import {
  EMPTY_OVERLAY,
  type MapInteraction,
  type OverlayState,
  type PickHit,
  type SupplyOverlay,
} from '../render/interaction.ts';
import type { CommandResult, OrderBook } from './orderBook.ts';
import {
  passivePerMinute,
  RADIAL,
  ROAD_SECTORS,
  SECTORS,
  stanceRates,
  SUPPLY_SECTORS,
  type RoadType,
  type StanceRate,
  type SupplyChoice,
} from '../hud/radial.ts';
import { OrderUiState, type RoadHint } from './orderUi.svelte.ts';
import { RadialState } from './radialState.svelte.ts';
import { RoadTypeState } from './roadTypeState.svelte.ts';
import { SupplyMenuState, TransferState } from './supplyState.svelte.ts';
import { moveCost } from './rejects.ts';

/** How long an answer stays in the panel, ms. */
export const NOTICE_MS = 6000;

/** The protocol's ceiling for one `merge` (`MergeCmd.groups`). */
const MAX_MERGE = 16;

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
}

/** The parts of a keyboard event the controller needs (`code`: layout-independent key). */
export interface KeyInput {
  readonly type: 'keydown' | 'keyup';
  readonly code: string;
  readonly shiftKey: boolean;
  /** The key is held and the browser repeats it (a repeat of Q must not reopen the menu). */
  readonly repeat?: boolean;
}

function hintKey(hint: RoadHint | null): string {
  return hint === null
    ? '-'
    : `${String(hint.edge)}:${String(hint.width)}:${hint.kind}:${String(hint.charges)}:${String(hint.pickable)}`;
}

function aimKey(aim: AttackTarget | null): string {
  return aim === null ? '-' : `${String(aim.node)}:${String(aim.planned)}`;
}

/**
 * Mouse and keyboard ordering on the map (CLI-06, #62). A click picks an own group or a node;
 * with a group selected, a click on a node orders it there (Shift or the switch: a planned order);
 * the order shows as a ghost arrow until the server answers. The controller only sends intents:
 * whether they are allowed, the path and the price charged are the server's call. The price shown
 * in the preview is read from the ruleset of `welcome`.
 *
 * The other commands (CLI-07, #63) are methods the panel and the keys call: modes, split, merge,
 * recruit, stance, forfeit. Each goes out as an intent and comes back as `accepted` or `rejected`
 * in `ui.current.notice`.
 *
 * Road upgrades are a city's job (DEC-16): with an own city selected (or a group standing in
 * one), U starts the road pick. The roads of that city with an upgrade hint light up; a click on
 * one ends the pick. A road of level 1 has no type yet: the click opens the road type menu
 * (DEC-22: fast or freight, a radial menu under the pointer; a click or 1 / 2 chooses, U, Esc or a
 * click outside closes it), and the choice sends `upgrade_road` with that type. A typed road keeps
 * its type: the click sends `upgrade_road` at once. Esc, U again, or a click elsewhere ends the
 * pick too. Whether the city may build (supply, a build already going, charges) is the server's
 * call.
 *
 * The «Supply» map mode (DEC-18, item 7) is toggled by Tab (or F2). In it a click on an own city
 * opens its supply menu (a radial menu under the pointer: high, normal, low priority, or a
 * transfer from it; a click or 1..4 chooses, Esc or a click outside closes it). "Transfer" starts
 * the transfer pick: the own cities a click would pick are ringed; a click on one opens the amount
 * dialog, which sends `transfer`. A click anywhere else, or Esc, ends the pick. The path and the
 * arrival of a transfer come from the server (`ack`); the client computes neither.
 *
 * Keys: Esc ends the road pick or deselects, X cancels the order of
 * the selected group, 1 / 2 set the mode (attack / defense), R recruits in the selected city,
 * U toggles the road pick, Q the stance menu (hold and release over a sector, or tap and click;
 * 1 / 2 / 3 choose while it is open), Space the camera to the next alert.
 */
export class OrderController implements MapInteraction {
  readonly ui = new OrderUiState();
  /** The stance menu on Q (ui-style 11). */
  readonly radial = new RadialState();
  /** The road type menu of a first road upgrade (DEC-22). */
  readonly roadType = new RoadTypeState();
  /** The supply menu of an own city in the «Supply» map mode (DEC-18). */
  readonly supplyMenu = new SupplyMenuState();
  /** The amount dialog of a transfer (DEC-18). */
  readonly transfer = new TransferState();

  readonly #o: OrderControllerOptions;
  #shift = false;
  #hover: PickHit | null = null;
  #aimed: AttackTarget | null = null;
  #noticeId = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #overlay: OverlayState = EMPTY_OVERLAY;
  #overlayKey = '';
  #overlayGhosts: OverlayState['ghosts'] = [];
  #supplyOverlay: SupplyOverlay | null = null;
  /** The city of the road pick, or `null`. Mirrored to `ui.current.roadPick` for the panel. */
  #pick: number | null = null;
  /** When Q went down (ms) while the menu is held open; `null`: Q is up. */
  #qDownAt: number | null = null;

  constructor(options: OrderControllerOptions) {
    this.#o = options;
    options.book.onResult = (result) => {
      this.#onResult(result);
    };
  }

  destroy(): void {
    clearTimeout(this.#noticeTimer);
    this.#o.book.onResult = null;
  }

  /** Planned order: the switch, or Shift held. */
  get planned(): boolean {
    return this.ui.current.planned || this.#shift;
  }

  /** Price of cancelling a planned order, hundredths of CP (ruleset of `welcome`). */
  get cancelCost(): number {
    return this.#o.rules.cost.cancel;
  }

  /** Price of recruiting, hundredths of CP. */
  get recruitCost(): number {
    return this.#o.rules.cost.recruit;
  }

  /** Price of a move order, hundredths of CP: ordinary or planned (ruleset of `welcome`). */
  moveCostFor(planned: boolean): number {
    return moveCost(this.#o.rules, planned);
  }

  /** Price of switching a group to `mode`, hundredths of CP. */
  modeCost(mode: Mode): number {
    return mode === 'attack' ? this.#o.rules.cost.attack : this.#o.rules.cost.defense;
  }

  /** Price of a stance change, hundredths of CP. */
  get stanceCost(): number {
    return this.#o.rules.cost.stance;
  }

  setPlanned(planned: boolean): void {
    this.ui.patch({ planned });
    this.#refresh();
  }

  // --- MapInteraction -----------------------------------------------------------------------

  overlay(): OverlayState {
    const selection = this.#o.hud.selection;
    const ghosts = this.#o.book.ghosts();
    const preview = this.#previewTarget();
    const from = this.#selectedGroup()?.node ?? null;
    const road = this.#hover?.kind === 'edge' ? this.#hover.id : null;
    const candidates = this.#candidates();
    const beacon = this.#o.hud.beacon;
    const supply = this.#supplyOverlayNow();
    const key = `${selection?.kind ?? '-'}:${String(selection?.id ?? '-')}|${String(from)}>${String(preview)}|${String(this.planned)}|${String(road)}|${candidates.join(',')}|${String(beacon)}`;
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
        road,
        candidates,
        beacon,
        supply,
      };
    }
    return this.#overlay;
  }

  click(hit: PickHit | null, shift: boolean): void {
    this.#shift = shift;
    if (this.#supplyClick(hit)) return;
    if (hit === null) {
      this.deselect();
      return;
    }
    if (hit.kind === 'intent') return; // an arrow is only hovered
    if (hit.kind === 'edge') {
      // A road is clicked only to upgrade it, in the road pick of a city; elsewhere it does nothing.
      if (this.#candidates().includes(hit.id)) this.upgradeRoad(hit.id);
      return;
    }
    this.stopRoadPick();
    const group = this.#selectedGroup();
    if (hit.kind === 'node' && group !== null && this.#o.send !== null && group.node !== hit.id) {
      this.#sendCommand(
        { type: 'move', group: group.id, dest: hit.id, planned: this.planned },
        group.node,
      );
      return;
    }
    this.#o.hud.select(hit);
    this.#hover = hit;
    this.#refresh();
  }

  hover(hit: PickHit | null): void {
    this.#hover = hit;
    this.#o.hud.hover(hit);
    this.#refresh();
  }

  // --- Commands -----------------------------------------------------------------------------

  deselect(): void {
    this.stopRoadPick();
    this.roadType.close();
    this.#o.hud.select(null);
    this.#refresh();
  }

  /** Cancel the order of the selected group (the server accepts it for a planned order only). */
  cancelSelected(): void {
    const group = this.#selectedGroup();
    if (group === null) return;
    this.#sendCommand({ type: 'cancel_order', group: group.id }, null);
  }

  /** Switch the mode of the selected group (attack / defense). */
  setMode(mode: Mode): void {
    const group = this.#selectedGroup();
    if (group === null) return;
    this.#sendCommand({ type: 'set_mode', group: group.id, mode }, null);
  }

  /** Split `n` units off the selected group into a new group. */
  split(n: number): void {
    const group = this.#selectedGroup();
    if (group === null || !Number.isInteger(n)) return;
    this.#sendCommand({ type: 'split', group: group.id, n }, null);
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
    if (first === undefined || second === undefined) return;
    this.#sendCommand({ type: 'merge', groups: [first, second, ...rest] }, null);
  }

  /** The city to recruit in: the selected node, or the node the selected group stands in. */
  recruitNode(): number | null {
    const selection = this.#o.hud.selection;
    if (selection?.kind === 'node') return selection.id;
    return this.#selectedGroup()?.node ?? null;
  }

  recruit(): void {
    const node = this.recruitNode();
    if (node === null) return;
    this.#sendCommand({ type: 'recruit', node }, null);
  }

  /**
   * The own city that would build a road: the selected node, or the node the selected group
   * stands in, if it is the player's; `null` otherwise.
   */
  roadCity(): number | null {
    const node = this.#o.hud.current?.node ?? null;
    return node?.owner === 'mine' ? node.id : null;
  }

  /**
   * Start the road pick of the selected own city (key U); a second call ends it. A city that
   * already builds a road does not start one: the panel says how long its build takes.
   */
  toggleRoadPick(): void {
    if (this.#pick !== null) {
      this.stopRoadPick();
      return;
    }
    const city = this.roadCity();
    if (city === null || this.#o.hud.current?.node?.build != null) return;
    this.#pick = city;
    this.ui.patch({ roadPick: city });
    this.#refresh();
  }

  stopRoadPick(): void {
    if (this.#pick === null) return;
    this.#pick = null;
    this.ui.patch({ roadPick: null });
    this.#refresh();
  }

  /**
   * The city of the road pick (or the selected own city) raises `edge` by one level (DEC-16).
   * A road without a type opens the road type menu instead (DEC-22); `kind` sends that choice.
   */
  upgradeRoad(edge: number, kind?: RoadType): void {
    const node = this.#pick ?? this.roadCity();
    if (node === null) return;
    this.stopRoadPick();
    const road = this.#o.hud.current?.roads[edge];
    if (this.#o.send === null) return;
    if (kind === undefined && road?.kind === 'none' && road.gain !== null) {
      this.radial.close();
      this.roadType.open({
        node,
        edge,
        level: road.width + 1,
        fast: road.gain.fast,
        freight: road.gain.freight,
        charges: road.charges,
      });
      return;
    }
    this.#sendCommand({ type: 'upgrade_road', node, edge, kind: kind ?? null }, null);
  }

  /** A sector of the road type menu was chosen: close it and send the upgrade with that type. */
  chooseRoadType(kind: RoadType): void {
    const { open, node, edge } = this.roadType.current;
    this.roadType.close();
    if (!open || this.#o.send === null) return;
    this.#sendCommand({ type: 'upgrade_road', node, edge, kind }, null);
  }

  closeRoadType(): void {
    this.roadType.close();
  }

  setStance(stance: Stance): void {
    this.#sendCommand({ type: 'set_stance', stance }, null);
  }

  /** The numbers of the stance menu, from the ruleset of `welcome`. */
  get stanceRates(): StanceRate[] {
    return stanceRates(this.#o.rules);
  }

  /** Charges a minute the capital makes in any stance (the caption of the menu). */
  get passivePerMinute(): number {
    return passivePerMinute(this.#o.rules);
  }

  /** The menu opens only in a match, where a stance can be sent. */
  openRadial(sticky: boolean): boolean {
    if (this.#o.send === null) return false;
    this.stopRoadPick();
    this.roadType.close();
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

  /** Tab / F2: the «Supply» map mode on or off; leaving it closes its menu, pick and dialog. */
  toggleSupplyMode(): void {
    const on = !this.ui.current.supplyMode;
    this.supplyMenu.close();
    this.transfer.close();
    if (on) {
      this.stopRoadPick();
      this.roadType.close();
      this.closeRadial();
    }
    this.ui.patch({ supplyMode: on, transferFrom: null });
  }

  /** Opens the supply menu of the own city `node` (a click on it in the «Supply» mode). */
  openSupplyMenu(node: number): boolean {
    const city = this.#ownCity(node);
    if (city === null || city.priority === null || this.#o.send === null) return false;
    this.radial.close();
    this.roadType.close();
    this.supplyMenu.open(node, city.priority, city.warehouse);
    return true;
  }

  closeSupplyMenu(): void {
    this.supplyMenu.close();
  }

  /** A sector of the supply menu: a new priority is sent, "transfer" starts the transfer pick. */
  chooseSupply(choice: SupplyChoice): void {
    const { open, node, priority } = this.supplyMenu.current;
    this.supplyMenu.close();
    if (!open) return;
    if (choice === 'transfer') {
      this.ui.patch({ transferFrom: node });
      return;
    }
    if (choice !== priority) this.setPriority(node, choice);
  }

  setPriority(node: number, level: Priority): void {
    this.#sendCommand({ type: 'set_priority', node, level }, null);
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
    const shiftChanged = this.#shift !== input.shiftKey;
    this.#shift = input.shiftKey;
    if (shiftChanged) this.#refresh();
    if (input.type !== 'keydown') return this.#keyUp(input);
    if (input.code === 'Tab' || input.code === 'F2') {
      if (input.repeat !== true) this.toggleSupplyMode();
      return true;
    }
    if (input.code === 'KeyQ') return this.#qDown(input);
    if (this.transfer.current.open) {
      // The amount dialog: Esc closes it (Enter and the slider are the dialog's own).
      if (input.code === 'Escape') {
        this.closeTransfer();
        return true;
      }
    }
    if (this.supplyMenu.current.open) {
      // The supply menu: 1..4 choose (not the modes), Esc closes it.
      const sector = SUPPLY_SECTORS.find((s) => `Digit${s.key}` === input.code);
      if (sector !== undefined) {
        this.chooseSupply(sector.choice);
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
    if (this.roadType.current.open) {
      // The road type menu: 1 / 2 choose (not the modes); U, the key that opened it, or Esc close.
      const sector = ROAD_SECTORS.find((s) => `Digit${s.key}` === input.code);
      if (sector !== undefined) {
        this.chooseRoadType(sector.type);
        return true;
      }
      if (input.code === 'Escape' || input.code === 'KeyU') {
        this.closeRoadType();
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
    switch (input.code) {
      case 'Escape':
        if (this.#pick !== null) this.stopRoadPick();
        else this.deselect();
        return true;
      case 'KeyX':
        this.cancelSelected();
        return true;
      case 'Digit1':
        return this.#modeKey('attack');
      case 'Digit2':
        return this.#modeKey('defense');
      case 'KeyR':
        this.recruit();
        return true;
      case 'KeyU':
        this.toggleRoadPick();
        return true;
      case 'Space':
        return this.#jumpToAlert();
      default:
        return false;
    }
  }

  // --- Internals ----------------------------------------------------------------------------

  /** An own city of the snapshot (priority and warehouse), or `null`. */
  #ownCity(node: number): { priority: Priority | null; warehouse: number | null } | null {
    const choice = this.#o.hud.current?.nodes.find((n) => n.id === node);
    return choice?.owner === 'mine' && choice.priority !== null ? choice : null;
  }

  /**
   * A click in the «Supply» mode: picks the destination of a transfer, or opens the supply menu
   * of an own city. Returns false when the click is an ordinary one (selection, orders).
   */
  #supplyClick(hit: PickHit | null): boolean {
    if (!this.ui.current.supplyMode) return false;
    const from = this.ui.current.transferFrom;
    const node = hit?.kind === 'node' ? hit.id : null;
    if (from !== null) {
      this.cancelTransferPick();
      if (node !== null && node !== from && this.#ownCity(node) !== null) {
        this.transfer.open(from, node, this.#ownCity(from)?.warehouse ?? 0);
      }
      return true;
    }
    return node !== null && this.openSupplyMenu(node);
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
            .filter((n) => n.owner === 'mine' && n.priority !== null && n.id !== source)
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

  /** Roads lit up by the road pick: the city's roads with an upgrade hint (none without a pick). */
  #candidates(): number[] {
    const roads = this.#o.hud.current?.roads;
    if (this.#pick === null || roads === undefined) return [];
    return roadCandidates(roads, this.#pick).map((r) => r.id);
  }

  /** The node a click would send the selected group to, if it would. */
  #previewTarget(): number | null {
    const group = this.#selectedGroup();
    if (group === null || group.node === null || this.#o.send === null) return null;
    return this.#hover?.kind === 'node' && this.#hover.id !== group.node ? this.#hover.id : null;
  }

  /** Preview price for the panel and the combat estimate aim, after a hover/switch/key change. */
  #refresh(): void {
    const node = this.#previewTarget();
    const planned = this.planned;
    const previous = this.ui.current.preview;
    if (node === null) {
      if (previous !== null) this.ui.patch({ preview: null });
    } else if (previous?.node !== node || previous.planned !== planned) {
      this.ui.patch({ preview: { node, planned, cost: moveCost(this.#o.rules, planned) } });
    }

    // The upgrade hint follows the pointer over a road that has one.
    const hover = this.#hover;
    const road = hover?.kind === 'edge' ? this.#roadHint(hover.id) : null;
    if (hintKey(road) !== hintKey(this.ui.current.road)) this.ui.patch({ road });

    // The combat estimate follows the pointer over enemy nodes.
    const isEnemy = (id: number): boolean =>
      this.#o.hud.current?.nodes.some((n) => n.id === id && n.owner === 'enemy') ?? false;
    const aim: AttackTarget | null = node !== null && isEnemy(node) ? { node, planned } : null;
    if (aimKey(aim) !== aimKey(this.#aimed)) {
      this.#aimed = aim;
      this.#o.hud.aim(aim);
    }
  }

  #roadHint(edge: number): RoadHint | null {
    const road = this.#o.hud.current?.roads[edge];
    if (road === undefined || road.gain === null) return null;
    return {
      edge,
      width: road.width + 1,
      kind: road.kind,
      charges: road.charges,
      pickable: this.#candidates().includes(edge),
    };
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
