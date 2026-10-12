import type { HudState } from '../hud/hudState.svelte.ts';
import type { AlertState } from './alerts.svelte.ts';
import { roadCandidates, type AttackTarget } from '../hud/hudData.ts';
import type { Command, MapFile, Mode, RulesetPublic, Stance } from '../protocol.gen.ts';
import {
  EMPTY_OVERLAY,
  type MapInteraction,
  type OverlayState,
  type PickHit,
} from '../render/interaction.ts';
import type { CommandResult, OrderBook } from './orderBook.ts';
import { passivePerMinute, RADIAL, SECTORS, stanceRates, type StanceRate } from '../hud/radial.ts';
import { OrderUiState, type RoadHint } from './orderUi.svelte.ts';
import { RadialState } from './radialState.svelte.ts';
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
    : `${String(hint.edge)}:${String(hint.width)}:${String(hint.charges)}:${String(hint.pickable)}`;
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
 * one sends `upgrade_road` and ends the pick. Esc, U again, or a click elsewhere ends it too.
 * Whether the city may build (supply, a build already going, charges) is the server's call.
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

  readonly #o: OrderControllerOptions;
  #shift = false;
  #hover: PickHit | null = null;
  #aimed: AttackTarget | null = null;
  #noticeId = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #overlay: OverlayState = EMPTY_OVERLAY;
  #overlayKey = '';
  #overlayGhosts: OverlayState['ghosts'] = [];
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
    const key = `${selection?.kind ?? '-'}:${String(selection?.id ?? '-')}|${String(from)}>${String(preview)}|${String(this.planned)}|${String(road)}|${candidates.join(',')}|${String(beacon)}`;
    if (key !== this.#overlayKey || ghosts !== this.#overlayGhosts) {
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
      };
    }
    return this.#overlay;
  }

  click(hit: PickHit | null, shift: boolean): void {
    this.#shift = shift;
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

  /** The city of the road pick (or the selected own city) raises `edge` by one level (DEC-16). */
  upgradeRoad(edge: number): void {
    const node = this.#pick ?? this.roadCity();
    if (node === null) return;
    this.stopRoadPick();
    this.#sendCommand({ type: 'upgrade_road', node, edge }, null);
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

  /** Returns true if the key was used (the caller then prevents the browser default). */
  key(input: KeyInput): boolean {
    const shiftChanged = this.#shift !== input.shiftKey;
    this.#shift = input.shiftKey;
    if (shiftChanged) this.#refresh();
    if (input.type !== 'keydown') return this.#keyUp(input);
    if (input.code === 'KeyQ') return this.#qDown(input);
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
    if (road === undefined || road.capacityCenti === null) return null;
    return {
      edge,
      width: road.width + 1,
      capacityCenti: road.capacityCenti,
      packetSpeedPct: road.packetSpeedPct ?? 0,
      charges: road.charges,
      pickable: this.#candidates().includes(edge),
    };
  }

  #onResult(result: CommandResult): void {
    this.ui.emit(
      result.kind === 'rejected'
        ? { kind: 'rejected', code: result.code, cmd: result.cmd }
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
