import type { HudState } from '../hud/hudState.svelte.ts';
import type { AlertState } from './alerts.svelte.ts';
import type { GroupChoice as GroupBrief, GroupInfo, Selection } from '../hud/hudData.ts';
import type {
  AckMember,
  Command,
  GroupOrderPublic,
  MapFile,
  ReachMsg,
  RulesetPublic,
  Stance,
} from '../protocol.gen.ts';

import {
  type BonusMark,
  EMPTY_OVERLAY,
  type FortPick,
  type GroupPreview,
  type HoverMark,
  type MapInteraction,
  type OverlayState,
  type PickHit,
  type UndoMark,
  type WheelInput,
} from '../render/interaction.ts';
import { WheelSteps } from './wheelSteps.ts';
import type { CommandResult, OrderBook } from './orderBook.ts';
import { undoCommand, type UndoEntry } from './undoList.ts';
import { RADIAL, SECTORS, stanceRates, type StanceRate } from '../hud/radial.ts';
import { getLocale, tf } from '../i18n/index.ts';
import { formatCentis } from '../hud/format.ts';
import { OrderUiState, type ReachInfo } from './orderUi.svelte.ts';
import { GHOST_CP, UNDO_CUE } from '../render/style.ts';
import { RadialState } from './radialState.svelte.ts';
import { chargedOfSplit, SplitState } from './splitState.svelte.ts';
import { TargetMenuState } from './targetMenuState.svelte.ts';

/**
 * A sector of the menu of a city (`fortify`: a road fortification, DEC-43, item D, which then asks
 * for the road; `rally`: the recruit rally point, DEC-48, item K7, which then asks for the node, or
 * clears the point the city has).
 */
export type CityChoice = 'recruit' | 'barracks' | 'factory' | 'fortify' | 'rally';

/** A sector of the menu of a group (`release`: a gathering plan departs now). */
export type GroupChoice = 'split' | 'merge' | 'cancel' | 'release';

/** The requested bonus of a planned order: the wheel's range (the server caps it too). */
export const PLAN_BONUS = { min: 1, max: 9 } as const;

/** How long an answer stays in the panel, ms. */
export const NOTICE_MS = 6000;

/** The protocol's ceiling for one `merge` (`MergeCmd.groups`). */
const MAX_MERGE = 16;

/** No groups selected together: one array, so the overlay and the HUD see no change. */
const NO_PICKS: readonly string[] = [];

/**
 * The price of a rally of `n` groups (DEC-48, item A2), hundredths of CP: `rally_pct` of a move per
 * group, rounded up to a whole CP. The arithmetic of `ruleset_public` the DEC names for the price
 * shown before the click; the server charges its own.
 */
export function rallyPrice(n: number, move: number, rallyPct: number): number {
  return Math.ceil((n * move * rallyPct) / 10000) * 100;
}

/**
 * A selected group asks the server again where it can go after this many ticks (ownership on the
 * way may change); a new group, node or size asks at once. Well under the message rate limit.
 */
export const REACH_REFRESH_TICKS = 10;

/** The selection follows a split-off group only for this many ticks after the split (2 s). */
export const FOLLOW_SPLIT_TICKS = 20;

/** How long the CP badge stays marked after a move was refused for its CP, ms (#762). */
export const CP_SHORT_FLASH_MS = GHOST_CP.rejectMs;

/**
 * The largest bonus a planned order of a group with `charged` charged units can ask for in the
 * UI: `PLAN_BONUS.max`, but no more than its charged units (the simulation gathers no more,
 * DEC-41, item 10), and never below `PLAN_BONUS.min` (a planned order asks for at least 1).
 */
export function planBonusCap(charged: number | null): number {
  if (charged === null) return PLAN_BONUS.max;
  return Math.max(PLAN_BONUS.min, Math.min(PLAN_BONUS.max, charged));
}

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
 * with a group selected, a click on a node orders it there (`E` held or the switch: a planned
 * order, DEC-48, item K2); the order shows as a ghost arrow until the server answers. The
 * controller only sends intents: whether they are allowed, the path and the price charged are the
 * server's call.
 *
 * The group order (DEC-48, item K, under `ruleset_public.group_order`): Shift+click adds an own
 * group to the selection or takes it out, Shift+drag a box adds the own groups inside it; with two
 * or more selected a click on a node sends one `group_move` (an own node: a rally, any other: an
 * arrival together), the per-group answers of its `ack` come back as toasts (a group too big for
 * the road gets the split offer of #762). The recruit rally point (item K7): the city menu or `P`,
 * then a click on the node.
 *
 * The other commands (CLI-07, #63) are methods the panel and the keys call: modes, split, merge,
 * recruit, stance, forfeit. Each goes out as an intent and comes back as `accepted` or `rejected`
 * in `ui.current.notice`.
 *
 * The «Supply» map mode (DEC-43) is toggled by Tab (or F2): the map layer of the supply flow, with
 * the leaf shift control (`-` and `=` step it). A click in it opens no menu and selects nothing.
 *
 * Groups (DEC-20): a selected group standing in a node asks the server where it can go
 * (`reach_query`); the answer rings the nodes it reaches and, dashed, those it reaches only after a
 * split (the stack limit), and the hovered target shows its travel time as one small number on the
 * map (no window). The client computes neither. S opens the split menu (a slider for the new group; Enter or a click
 * splits, S, Esc or a click outside close it), G merges the groups standing with the selected one,
 * X cancels any order of the selected group (on a road it turns back, free).
 *
 * UI round 2: there is no selection card. A click on an own city opens its radial menu (recruit
 * `R`, the barracks, the factory, a road fortification) centred on the city circle; a second click on an own group (the first selects
 * it) opens a small radial menu on the group (split `S`, merge `G`, cancel `X`, release `F`; no
 * release under the group order, DEC-48, item K6). The
 * menus only front the keys: a key does the same without the menu. Recruiting (R) and cancelling
 * a recruit (X) keep the city menu open, to queue several units in a row. A click on the same object
 * again, any click elsewhere and Esc close the menu (a click on another node still orders the
 * selected group).
 *
 * X with nothing selected undoes the last action (#764): the newest accepted move, planned order
 * or recruit (`UndoList`), through the same `cancel_order` and `cancel_recruit`; each press one step
 * further back. One press is one real undo: an entry the server has nothing to cancel for is
 * dropped quietly and the next one is asked. Entries of a group in a fight are skipped (a cancel
 * there is a withdrawal under fire, DEC-24, item E). What went shows on the map at its place
 * (`overlay().undo`), never in a toast.
 *
 * Keys: Esc deselects, X cancels the order of
 * the selected group, R recruits in the selected city, Q the stance menu (hold and release over a
 * sector, or tap and click; 1 / 2 / 3 choose while it is open), S the split menu, G merge, F lets a
 * gathering plan go, B fortifies a road, Space the camera to the next alert, Tab or F2 the «Supply»
 * mode (it also lets a selected city go), T the terrain mode (patterns and sight signs; not
 * together with «Supply»).
 * At most one radial menu is open: whoever opens one closes the others (`#closeMenus`).
 */
export class OrderController implements MapInteraction {
  readonly ui = new OrderUiState();
  /** The stance menu on Q (ui-style 11). */
  readonly radial = new RadialState();
  /** The split menu on S (DEC-20). */
  readonly splitMenu = new SplitState();
  /** The radial menu of the selected own city: recruit, build, fortify a road (UI round 2). */
  readonly cityMenu = new TargetMenuState<number, CityChoice>();
  /** The small radial menu of the selected own group: split, merge, cancel, release. */
  readonly groupMenu = new TargetMenuState<string, GroupChoice>();
  /** The list of the own groups standing in one city (the click on their one icon): a group each. */
  readonly stackMenu = new TargetMenuState<number, string>();

  readonly #o: OrderControllerOptions;
  /**
   * `E` (`KeyE`) is held: a click gives a planned order (DEC-48, item K2). Its `keyup`, a lost
   * focus (`blur`, the `keyup` with an empty code) and any keyboard event without it held let it go.
   */
  #eHeld = false;
  /** The groups selected together (DEC-48, item K1): two or more, in the order of the selection. */
  #picks: readonly string[] = NO_PICKS;
  /**
   * A group dropped from a group order with `STACK_LIMIT` (DEC-48, item B4): it is selected alone,
   * and once the server's `reach` says how many of it get to `dest` the split menu of #762 opens.
   */
  #splitOffer: { readonly group: string; readonly dest: number; readonly planned: boolean } | null =
    null;
  #hover: PickHit | null = null;
  /** E + wheel: notches and trackpad pixels turned into steps of the plan bonus (#793). */
  readonly #wheelSteps = new WheelSteps();
  /**
   * The bonus the wheel chose for one E hover (#797): the selection (a group id, or the ids of the
   * groups selected together), the target under the pointer and the value. E up, another target or
   * another selection drops it, so every new hover starts at `PLAN_BONUS.min` (there is no
   * remembered value); `null`: none chosen.
   */
  #bonusPick: { readonly group: string; readonly node: number; readonly value: number } | null =
    null;
  /** The last step of the leaf shift by key: where it started and where it was sent to (`stepLeafShift`). */
  #shiftStep: { readonly from: number; readonly to: number } | null = null;
  #noticeId = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #overlay: OverlayState = EMPTY_OVERLAY;
  #overlayKey = '';
  #overlayGhosts: OverlayState['ghosts'] = [];
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
  /**
   * The order a split menu opened by a click at a `reach.split` target gives its part (#762): the
   * kind of order as it was at the click (E may be up by the time the split is confirmed).
   */
  #sendPlan: { readonly group: string; readonly planned: boolean; readonly bonus: number } | null =
    null;
  /** A split sent whose part goes on to `dest` as soon as the server names it (`group_split`). */
  #pendingSend: {
    readonly from: string;
    readonly node: number | null;
    readonly dest: number;
    readonly planned: boolean;
    readonly bonus: number;
  } | null = null;
  /** Until when (`now()`, ms) the CP badge stays marked after a refusal for CP (#762). */
  #cpFlashUntil = 0;
  #hoverMark: HoverMark | null = null;
  /** Presses of `X` not served yet: one real undo each (#764). */
  #undoWanted = 0;
  /** The undo on its way to the server and the cue it shows if accepted; one at a time. */
  #undoSent: { readonly seq: number; readonly mark: Omit<UndoMark, 'at'> } | null = null;
  /** The cues still on screen; the same array until they change. */
  #undoMarks: readonly UndoMark[] = [];
  #overlayUndo: readonly UndoMark[] = [];

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

  /** Planned order: the switch, or `E` held (DEC-48, item K2). */
  get planned(): boolean {
    return this.ui.current.planned || this.#eHeld;
  }

  /** The group order of the rules (DEC-48, `ruleset_public.group_order`); `null`: not in them. */
  get groupOrder(): GroupOrderPublic | null {
    return this.#o.rules.group_order;
  }

  /** The recruit rally point is in the rules (DEC-48, item H, `ruleset_public.recruit.rally_point`). */
  get rallyPoints(): boolean {
    return this.#o.rules.recruit.rally_point;
  }

  /** What a recruit pays when it leaves for the rally point, hundredths of CP (`recruit.rally_cost`). */
  get rallyCost(): number {
    return this.#o.rules.recruit.rally_cost;
  }

  /** `ReleasePlan` is a control of these rules: not under the group order (DEC-48, items A7, K6). */
  get canRelease(): boolean {
    return this.groupOrder === null;
  }

  /** The groups selected together (DEC-48, item K1), in their order; empty without such a selection. */
  get picks(): readonly string[] {
    return this.#picks;
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

  /** Price of a stance change, hundredths of CP. */
  get stanceCost(): number {
    return this.#o.rules.cost.stance;
  }

  setPlanned(planned: boolean): void {
    this.ui.patch({ planned, planning: planned || this.#eHeld });
  }

  /** Mirrors "a planned order is being made" (the switch or E) to `ui.current.planning`. */
  #syncPlanning(): void {
    const planning = this.planned;
    if (planning !== this.ui.current.planning) this.ui.patch({ planning });
  }

  /** The price of one road fortification, hundredths of CP (`ruleset_public.fort.cost`). */
  get fortCost(): number {
    return this.#o.rules.fort.cost;
  }

  /** The own leaf shift in force (`View.me.leaf_shift`); `null` before a snapshot. */
  get leafShift(): number | null {
    return this.#o.hud.current?.leafShift ?? null;
  }

  /** The largest shift now (`View.me.leaf_shift_max`); `null` like `leafShift`. */
  get leafShiftMax(): number | null {
    return this.#o.hud.current?.leafShiftMax ?? null;
  }

  /**
   * One step of the leaf shift (`set_leaf_shift`, free): `delta` +1 raises the shift (the level
   * moves one road back from the front, the control's `−`), -1 lowers it (the control's `+`). Kept within `0..leaf_shift_max` as the server's own
   * numbers; presses before the snapshot that confirms one add up from the step already sent.
   */
  stepLeafShift(delta: number): void {
    const now = this.leafShift;
    const max = this.leafShiftMax;
    if (now === null || max === null) return;
    const sent =
      this.#shiftStep !== null && this.#shiftStep.from === now ? this.#shiftStep.to : now;
    const to = Math.min(max, Math.max(0, sent + delta));
    if (to === sent) return;
    this.#shiftStep = { from: now, to };
    this.#sendCommand({ type: 'set_leaf_shift', shift: to }, null);
  }

  /**
   * The bonus a planned order to the target under the pointer asks for: what the wheel
   * chose in this E hover (#797), `PLAN_BONUS.min` until it turns, no more than the charged
   * units of the selected group allow (`planBonusMax`).
   */
  get planBonus(): number {
    return this.#bonusFor(this.#previewTarget());
  }

  /**
   * The top of the bonus now: `PLAN_BONUS.max`, capped by the selected group's charged units; for
   * groups selected together the sum of their charged units (DEC-48, item F1: the server caps it
   * at the sum of the accepted ones).
   */
  get planBonusMax(): number {
    if (this.#picks.length > 0) {
      const groups = this.#o.hud.current?.groups ?? [];
      const charged = groups
        .filter((g) => this.#picks.includes(g.id))
        .reduce((sum, g) => sum + g.charged, 0);
      return Math.max(PLAN_BONUS.min, charged);
    }
    return planBonusCap(this.#selectedGroup()?.charged ?? null);
  }

  /** What the bonus of the wheel belongs to: the selected group, or the groups selected together. */
  #selectionKey(): string | null {
    if (this.#picks.length > 0) return this.#picks.join(',');
    return this.#selectedGroup()?.id ?? null;
  }

  /** The bonus of a planned order of the selection to `node`: the wheel's pick there, else 1. */
  #bonusFor(node: number | null): number {
    const pick = this.#bonusPick;
    const key = this.#selectionKey();
    const value =
      pick !== null && key !== null && pick.group === key && pick.node === node
        ? pick.value
        : PLAN_BONUS.min;
    return Math.min(value, this.planBonusMax);
  }

  /**
   * One step of the bonus over the target under the pointer up (`delta` 1) or down (-1), within
   * `PLAN_BONUS` and the cap (#793). Nothing without a target: the bonus belongs to its hover.
   */
  #stepPlanBonus(delta: number): void {
    const key = this.#selectionKey();
    const node = this.#previewTarget();
    if (key === null || node === null) return;
    const value = Math.min(
      this.planBonusMax,
      Math.max(PLAN_BONUS.min, this.#bonusFor(node) + delta),
    );
    this.#bonusPick = { group: key, node, value };
  }

  /** Drops the wheel's pick once its hover is over: E up, another target, another selection (#797). */
  #syncBonusPick(): void {
    const pick = this.#bonusPick;
    if (pick === null) return;
    if (
      !this.#eHeld ||
      pick.group !== this.#selectionKey() ||
      pick.node !== this.#previewTarget()
    ) {
      this.#bonusPick = null;
    }
  }

  /** Ticks per point of a gathering plan (`ruleset_public.orders.plan_ticks_per_bonus`, DEC-41). */
  get planTicksPerBonus(): number {
    return this.#o.rules.orders.plan_ticks_per_bonus;
  }

  /** Costs of the buildings, in charges (`ruleset_public`, DEC-41, item 7). */
  get chargeCosts(): { readonly barracks: number; readonly factory: number } {
    const { city_upgrades: city, factory } = this.#o.rules;
    return { barracks: city.barracks_charges, factory: factory.cost };
  }

  /** At most this many factories a player has, the capital included (`ruleset_public.factory.max`). */
  get factoryMax(): number {
    return this.#o.rules.factory.max;
  }

  /**
   * The own factories are at `factory.max` (builds under way counted, `HudData.factories`): the
   * menu does not offer another one (#762). The server still checks it (`FACTORY_LIMIT`).
   */
  get factoriesFull(): boolean {
    const factories = this.#o.hud.current?.factories ?? null;
    return factories !== null && factories.count >= factories.max;
  }

  /** The own node has a road a fortification could still be asked for (#762); display only. */
  fortifiable(node: number): boolean {
    return this.#fortRoads(node).length > 0;
  }

  // --- MapInteraction -----------------------------------------------------------------------

  overlay(): OverlayState {
    this.#followSplit();
    this.#syncPicks();
    this.#syncRally();
    this.#syncReach();
    this.#syncTargetMenus();
    const reach = this.#reach();
    const selection = this.#o.hud.selection;
    const ghosts = this.#o.book.ghosts();
    const preview = this.#previewTarget();
    const from = this.#selectedGroup()?.node ?? null;
    this.#syncFort();
    const fortPick = this.#fortPick();
    const beacon = this.#o.hud.beacon;
    const supply = this.ui.current.supplyMode;
    const reachNodes = reach === null ? [] : [...reach.ticks.keys()];
    const splitNodes = reach === null ? [] : [...reach.split.keys()];
    const eta = this.#eta(reach, preview);
    this.#syncSplitHover(reach, preview);
    this.#syncCaptureHover(preview);
    this.#syncCpShort(preview);
    this.#syncPlanning();
    this.#syncBonusPick();
    const hover = this.#hoverMarkNow();
    const undo = this.#undoMarksNow();
    const group = this.#groupPreview(preview);
    const bonus =
      group === null
        ? this.#bonusMark(from, eta === null ? null : preview)
        : this.#bonusMark(preview, group.planned ? preview : null);
    const picks = this.#picks;
    const groupKey =
      group === null
        ? '-'
        : `${group.from.join(',')}>${String(group.to)}:${group.kind}:${String(group.planned)}:${group.price}`;
    const key = `${bonus === null ? '-' : `${String(bonus.bonus)}/${String(bonus.max)}`}|${selection?.kind ?? '-'}:${String(selection?.id ?? '-')}|${String(from)}>${String(preview)}|${String(this.planned)}|${String(beacon)}|${String(eta?.ticks ?? '-')}:${eta?.path.join('>') ?? '-'}|${reachNodes.join(',')}/${splitNodes.join(',')}|${fortPick === null ? '-' : `${String(fortPick.node)}:${fortPick.edges.join(',')}:${String(fortPick.hover)}`}|${String(hover?.node ?? '-')}:${hover?.group ?? '-'}|${picks.join(',')}|${groupKey}`;
    if (
      key !== this.#overlayKey ||
      ghosts !== this.#overlayGhosts ||
      undo !== this.#overlayUndo ||
      supply !== this.#overlay.supply ||
      this.ui.current.terrainMode !== this.#overlay.terrain ||
      this.ui.current.rallyFrom !== (this.#overlay.rallyFrom ?? null)
    ) {
      this.#overlayKey = key;
      this.#overlayGhosts = ghosts;
      this.#overlayUndo = undo;
      this.#overlay = {
        selection,
        ghosts,
        // The ghost of the order goes only where the server's `reach` says it gets (#793).
        preview:
          from !== null && preview !== null && eta !== null
            ? {
                from,
                to: preview,
                planned: this.planned,
                path: eta.path,
              }
            : null,
        beacon,
        supply,
        terrain: this.ui.current.terrainMode,
        reach: reachNodes,
        split: splitNodes,
        fortPick,
        eta:
          eta === null || preview === null || from === null
            ? null
            : { from, node: preview, ticks: eta.ticks, path: eta.path },
        hover,
        undo,
        bonus,
        picks,
        box: null,
        group,
        rallyFrom: this.ui.current.rallyFrom,
      };
    }
    return this.#overlay;
  }

  /**
   * The group order a click on `target` would give the groups selected together (DEC-48, item
   * K4): rally to an own node (by the owner on screen; the server decides at application, item
   * B2), an arrival together anywhere else, planned with `E` held (never a planned rally, item G1);
   * the price is the `ruleset_public` arithmetic of item A2. `null` without such a selection.
   */
  #groupPreview(target: number | null): GroupPreview | null {
    if (this.#picks.length === 0 || target === null) return null;
    const groups = this.#o.hud.current?.groups ?? [];
    const from = this.#picks
      .map((id) => groups.find((g) => g.id === id)?.node ?? null)
      .filter((node): node is number => node !== null && node !== target);
    const kind = this.#isOwnNode(target) ? 'rally' : 'attack';
    return {
      from,
      to: target,
      planned: kind === 'attack' && this.planned,
      kind,
      price: formatCentis(this.#groupPrice(target), getLocale()),
    };
  }

  /** The price of the group order to `target` now, hundredths of CP (`ruleset_public`, item A2). */
  #groupPrice(target: number): number {
    const n = this.#picks.length;
    const { cost } = this.#o.rules;
    const rally = this.groupOrder;
    if (this.#isOwnNode(target) && rally !== null) {
      return rallyPrice(n, cost.move, rally.rally_pct);
    }
    return n * (this.planned ? cost.planned_move : cost.move);
  }

  /**
   * The bonus counter over the target of a planned order (#793): a planned order (E
   * or the switch), the target reachable (`reach`). The value is `planBonus`, 1 until the wheel turns; the
   * gathering time is display arithmetic from `ruleset_public` (one point per
   * `orders.plan_ticks_per_bonus` while the warehouse has charges, DEC-41, item 10).
   */
  #bonusMark(from: number | null, target: number | null): BonusMark | null {
    if (!this.planned || from === null || target === null) return null;
    const bonus = this.planBonus;
    const per = this.planTicksPerBonus;
    return {
      node: target,
      bonus,
      max: this.planBonusMax,
      ticks: per > 0 ? bonus * per : null,
    };
  }

  /**
   * What a click under the pointer would pick or aim at, lit lightly on the map (#762): the area of
   * a city or province (a selection, a menu, the target of the selected group), or an own group.
   * The same reading of the hit as `click`; `null` where a click does nothing, and while a pick of
   * its own runs (a road to fortify). The same object while unchanged.
   */
  #hoverMarkNow(): HoverMark | null {
    const mark = this.#hoverTarget();
    const prev = this.#hoverMark;
    if (mark?.node !== prev?.node || mark?.group !== prev?.group) this.#hoverMark = mark;
    return this.#hoverMark;
  }

  #hoverTarget(): HoverMark | null {
    const hit = this.#hover;
    const ui = this.ui.current;
    if (hit === null || this.#o.send === null) return null;
    // The «Supply» layer takes no click, and the road pick of a fortification has its own.
    if (ui.fortFrom !== null || ui.supplyMode) return null;
    // The rally point pick (DEC-48, item K7): any other node is a point.
    if (ui.rallyFrom !== null) {
      const node = this.#cityOf(hit);
      return node === null || node === ui.rallyFrom ? null : { node, group: null };
    }
    // Groups selected together: a click on a place orders them there, one on a road picks it.
    if (this.#picks.length > 0) {
      if (hit.kind === 'group' && hit.node === undefined) return { node: null, group: hit.id };
      const node = this.#cityOf(hit);
      return node === null ? null : { node, group: null };
    }
    const group = this.#selectedGroup();
    if (
      hit.kind === 'group' &&
      (group === null || hit.node === undefined || hit.node === group.node)
    ) {
      return { node: null, group: hit.id };
    }
    const node = this.#cityOf(hit);
    if (node === null) return null;
    // The selected group: a click on another place orders it there; on its own place lets it go.
    if (group !== null) return node === group.node ? null : { node, group: null };
    if (hit.kind === 'stack') return { node, group: null };
    return this.#isUnselectable(node) ? null : { node, group: null };
  }

  /**
   * The CP price of the move a click would give now (`ruleset_public.cost`), hundredths; of the
   * group order to the hovered target for groups selected together (DEC-48, item A2).
   */
  #movePrice(): number {
    const target = this.#previewTarget();
    if (this.#picks.length > 0 && target !== null) return this.#groupPrice(target);
    const cost = this.#o.rules.cost;
    return this.planned ? cost.planned_move : cost.move;
  }

  /**
   * The CP badge is marked while the CP do not pay for the move to the hovered target, and for
   * `CP_SHORT_FLASH_MS` after a move was refused with `NOT_ENOUGH_CP` (#762). Display arithmetic:
   * the price is the ruleset's, the refusal the server's.
   */
  #syncCpShort(preview: number | null): void {
    const cp = this.cpNow;
    const hovered = preview !== null && cp !== null && cp < this.#movePrice();
    const flash = this.#now() < this.#cpFlashUntil;
    const short = hovered || flash;
    const price = preview !== null || flash ? this.#movePrice() : null;
    if (short !== this.ui.current.cpShort || price !== this.ui.current.cpPrice)
      this.ui.patch({ cpShort: short, cpPrice: price });
  }

  /**
   * A click on the map; `shift`: Shift was held, which adds the own group under the pointer to the
   * selection or takes it out (DEC-48, item K1; under `ruleset_public.group_order` only).
   */
  click(picked: PickHit | null, shift: boolean): void {
    this.#syncPlanning();
    // The road pick of "Fortify road" takes the click first: a road gets the line, anything else cancels.
    if (this.ui.current.fortFrom !== null) {
      this.#fortClick(picked);
      return;
    }
    // The rally point pick (DEC-48, item K7): a node gets the point, anything else cancels.
    if (this.ui.current.rallyFrom !== null) {
      this.#rallyClick(picked);
      return;
    }
    if (this.#supplyClick(picked)) return;
    if (picked === null) {
      this.deselect();
      return;
    }
    if (shift && this.#shiftClick(picked)) return;
    let hit: PickHit = picked;
    if (hit.kind === 'edge') {
      // A road is a click on the area of the city it lies in.
      if (hit.cell === undefined) return;
      hit = { kind: 'node', id: hit.cell };
    }
    if (this.#picks.length > 0) {
      // Groups selected together: a place gets the group order, a group on a road is picked alone.
      const node = hit.kind === 'group' && hit.node === undefined ? null : this.#cityOf(hit);
      if (node !== null) {
        this.#sendGroupOrder(node);
        return;
      }
      this.#setPicks([]);
    }
    const group = this.#selectedGroup();
    // A group in a fight cannot leave it under `combat.retreat = "none"` (DEC-40): a click on a
    // place is no order for it, the server would answer `IN_FIGHT`. The rest of the click stays.
    const held = group !== null && this.isHeldInFight(group);
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
    if (
      hit.kind === 'node' &&
      group !== null &&
      !held &&
      this.#o.send !== null &&
      group.node !== hit.id
    ) {
      // A planned order asks for its bonus (DEC-41, item 10), the wheel's pick over this target or
      // 1 (#797); otherwise 0.
      const bonus = this.planned ? this.#bonusFor(hit.id) : 0;
      this.#bonusPick = null;
      // The server says only a smaller group gets there (`reach.split`, the stack limit, DEC-20):
      // the split menu opens with the size that fits, and its part goes there on confirm (#762).
      const fit = this.splitFit(hit.id);
      if (fit >= 1 && group.node !== null) {
        this.#closeMenus();
        if (this.splitMenu.open(group.id, group.units, group.charged, { n: fit, dest: hit.id })) {
          this.#sendPlan = { group: group.id, planned: this.planned, bonus };
        }
        return;
      }
      this.#closeTargetMenus();
      this.#sendCommand(
        { type: 'move', group: group.id, dest: hit.id, planned: this.planned, bonus },
        group.node,
        // The ghost follows the route the server gave for this target (`ReachNode.path`) until the
        // `ack` brings the order's own (#851): the client finds no path.
        this.#reach()?.routes.get(hit.id) ?? null,
      );
      // The order is given: the group is let go (the ghost of the order is drawn without it).
      this.deselect();
      return;
    }
    if (hit.kind === 'stack') {
      this.#clickStack(hit.node, hit.ids);
      return;
    }
    // A province is only a destination (DEC-23) and an enemy city is only a target (#535): neither
    // is selected, lit or given a menu, so a click on one that is not an order is a click on nothing.
    if (hit.kind === 'node' && this.#isUnselectable(hit.id)) {
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
    // A selection starts the bonus of its planned orders afresh (#797).
    this.#bonusPick = null;
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
    if (this.#isUnselectable(node)) {
      // The list opens, but the province or the enemy city itself is not selected (DEC-23, #535).
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
   * own menu (split, merge, cancel, release), so a stacked group has a menu too.
   */
  chooseStackGroup(id: string): void {
    this.#closeMenus();
    const selected = this.#o.hud.selection;
    this.#o.hud.select({ kind: 'group', id });
    if (selected?.kind === 'group' && selected.id === id && this.#o.send !== null) {
      this.groupMenu.open(id);
    }
  }

  /**
   * E + wheel (#793, DEC-48, item K2): with an own group in a node selected, or groups selected
   * together, one notch steps the bonus a planned order to the target under the pointer asks for
   * (for several groups the requested total, item F1); it starts at 1 for every new hover (#797).
   * `false` otherwise: the wheel zooms the map.
   */
  wheel(input: WheelInput): boolean {
    this.#syncPlanning();
    this.#syncBonusPick();
    if (!this.#eHeld || !this.#planBonusShown()) {
      this.#wheelSteps.reset();
      return false;
    }
    const step = this.#wheelSteps.push(input, this.#now());
    if (step !== 0) this.#stepPlanBonus(step);
    return true;
  }

  /** A planned order can be given: an own group in a node or groups selected together, the normal map. */
  #planBonusShown(): boolean {
    const ui = this.ui.current;
    return (
      this.#o.send !== null &&
      (this.#selectedGroup()?.node != null || this.#picks.length > 0) &&
      !ui.supplyMode &&
      !ui.terrainMode &&
      ui.fortFrom === null &&
      ui.rallyFrom === null
    );
  }

  // --- The group order (DEC-48, item K) ------------------------------------------------------------

  /**
   * Shift+click (item K1): the own group under the pointer (the groups of a city's one icon, all of
   * them) joins the selection, or leaves it when it is in it already. `false`: Shift does nothing
   * here (no group order in the rules, or the hit is no own group): the click goes on as a plain one.
   */
  #shiftClick(hit: PickHit): boolean {
    if (this.groupOrder === null || this.ui.current.supplyMode) return false;
    const ids = hit.kind === 'group' ? [hit.id] : hit.kind === 'stack' ? hit.ids : [];
    const own = ids.filter((id) => this.#isOwnGroup(id));
    if (own.length === 0) return false;
    const base = this.#selection();
    const next = own.every((id) => base.includes(id))
      ? base.filter((id) => !own.includes(id))
      : [...base, ...own.filter((id) => !base.includes(id))];
    this.#setPicks(next);
    this.#hover = hit;
    return true;
  }

  /**
   * The groups inside a Shift+drag box (item K1): the own ones join the selection, in the order
   * given (the scene finds them left to right). Nothing without the group order in the rules.
   */
  selectBox(ids: readonly string[]): void {
    if (this.groupOrder === null || this.ui.current.supplyMode) return;
    const own = ids.filter((id) => this.#isOwnGroup(id));
    if (own.length === 0) return;
    const base = this.#selection();
    this.#setPicks([...base, ...own.filter((id) => !base.includes(id))]);
  }

  /** The own groups selected now, in order: those selected together, or the one selected group. */
  #selection(): readonly string[] {
    if (this.#picks.length > 0) return this.#picks;
    const selection = this.#o.hud.selection;
    return selection?.kind === 'group' && this.#isOwnGroup(selection.id) ? [selection.id] : [];
  }

  /**
   * The selection becomes `ids` (at most `group_order.max_groups`): two or more are selected
   * together (the HUD selection is let go), one is the ordinary selection, none clears it.
   */
  #setPicks(ids: readonly string[]): void {
    const max = this.groupOrder?.max_groups ?? MAX_MERGE;
    const next = ids.slice(0, max);
    this.#closeMenus();
    this.#bonusPick = null;
    this.#picks = next.length >= 2 ? next : NO_PICKS;
    const single = next.length === 1 ? next[0] : undefined;
    const selection = this.#o.hud.selection;
    if (single !== undefined) this.#o.hud.select({ kind: 'group', id: single });
    else if (selection !== null) this.#o.hud.select(null);
    if (this.ui.current.picks !== this.#picks) this.ui.patch({ picks: this.#picks });
  }

  /** Groups selected together that are gone (merged, dead) leave the selection; cheap, every frame. */
  #syncPicks(): void {
    if (this.#picks.length === 0) return;
    const live = this.#picks.filter((id) => this.#isOwnGroup(id));
    if (live.length !== this.#picks.length) this.#setPicks(live);
  }

  /** `id` is an own group of the snapshot on screen. */
  #isOwnGroup(id: string): boolean {
    return this.#o.hud.current?.groups.some((g) => g.id === id) ?? false;
  }

  /**
   * One `group_move` of the groups selected together to `dest` (items B1, K5): planned with `E`
   * held unless the target is own (no planned rally, item G1), the requested total bonus of the
   * wheel. Each group standing in a node shows a ghost until the `ack` says what went.
   */
  #sendGroupOrder(dest: number): void {
    const [first, ...rest] = this.#picks;
    if (first === undefined || this.#o.send === null) return;
    const planned = this.planned && !this.#isOwnNode(dest);
    const bonus = planned ? this.#bonusFor(dest) : 0;
    const groups = this.#o.hud.current?.groups ?? [];
    const from = this.#picks.map((id) => groups.find((g) => g.id === id)?.node ?? null);
    this.#closeTargetMenus();
    this.#sendCommand(
      { type: 'group_move', groups: [first, ...rest], dest, planned, bonus },
      null,
      null,
      from,
    );
    this.deselect();
  }

  hover(hit: PickHit | null): void {
    this.#hover = hit;
    this.#syncBonusPick();
    this.#syncFortHover();
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
      this.#picks.length === 0 &&
      this.ui.current.fortFrom === null &&
      this.ui.current.rallyFrom === null &&
      !this.cityMenu.current.open &&
      !this.groupMenu.current.open &&
      !this.stackMenu.current.open &&
      !this.radial.current.open &&
      !this.splitMenu.current.open
    );
  }

  // --- Commands -----------------------------------------------------------------------------

  deselect(): void {
    this.#closeMenus();
    this.#o.hud.select(null);
    this.#bonusPick = null;
    if (this.#picks.length > 0) {
      this.#picks = NO_PICKS;
      this.ui.patch({ picks: NO_PICKS });
    }
  }

  /**
   * Cancel the order of the selected group: a planned order while it waits, or a move on a road
   * (the group turns back to the start of that road, DEC-20). Free; whether there
   * is anything to cancel is the server's call (`NOTHING_TO_CANCEL`).
   */
  cancelSelected(): void {
    if (this.#picks.length > 0) {
      this.#cancelPicks();
      return;
    }
    const group = this.#selectedGroup();
    if (group === null) return;
    this.groupMenu.close();
    // Under `combat.retreat = "none"` a cancel would be a retreat from a fight: not sent (DEC-40).
    if (this.isHeldInFight(group) && !this.canCancel(group)) return;
    this.#sendCommand({ type: 'cancel_order', group: group.id }, null);
    if (this.#o.send !== null) this.deselect();
  }

  /**
   * `X` with groups selected together: one `cancel_order` for each of them that has an order (a
   * whole group order is cancelled this way, DEC-48, item B7; they apply in one tick), not for a
   * group a fight holds under `combat.retreat = "none"` unless its plan waits (DEC-40).
   */
  #cancelPicks(): void {
    for (const id of this.#picks) {
      const view = this.#o.hud.ownGroup(id);
      if (view?.order == null) continue;
      const waits = view.order.planned && view.location.kind === 'node';
      if (this.noRetreat && this.#o.hud.inFight(id) && !waits) continue;
      this.#sendCommand({ type: 'cancel_order', group: id }, null);
    }
    this.deselect();
  }

  /**
   * `combat.retreat = "none"` (DEC-40): a group in a fight stays until the fight ends. The server
   * rejects its `Move` and its `CancelOrder` with `IN_FIGHT`; the client does not offer them or
   * send them (it decides nothing: the rule is the ruleset's, and the answer is the server's).
   */
  get noRetreat(): boolean {
    return this.#o.rules.combat.retreat === 'none';
  }

  /**
   * The group is in a fight it cannot leave under `combat.retreat = "none"`: no order, no cancel.
   * A plan waiting in the fight node is the one thing `CancelOrder` still cancels (DEC-40, item 4):
   * the group stays in the fight, the plan goes.
   */
  isHeldInFight(group: GroupInfo): boolean {
    return this.noRetreat && this.#o.hud.inFight(group.id);
  }

  /** `cancel_order` of this group would be sent: not a retreat from a fight under `"none"`. */
  canCancel(group: GroupInfo): boolean {
    if (group.destination === null) return false;
    if (!this.isHeldInFight(group)) return true;
    return group.planned && group.node !== null;
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

  /**
   * The most units that get to `node` from the selected group's node, as the server's `reach`
   * says for a `STACK_LIMIT` target (#762); 0: none, or not such a target.
   */
  splitFit(node: number): number {
    return this.#reach()?.split.get(node) ?? 0;
  }

  /**
   * The split menu's button or Enter: split the chosen amount off and close the menu. A menu
   * opened by a click at a too small target (#762) also orders the new group there once the
   * server names it (`#onSplit`), as the order was at the click.
   */
  confirmSplit(): void {
    const { open, group, n, charged, dest } = this.splitMenu.current;
    const plan = this.#sendPlan;
    this.#sendPlan = null;
    this.splitMenu.close();
    if (!open || this.#o.send === null) return;
    this.#sendCommand({ type: 'split', group, n }, null);
    if (dest !== null && plan?.group === group) {
      this.#pendingSend = {
        from: group,
        node: this.#selectedGroup()?.id === group ? (this.#selectedGroup()?.node ?? null) : null,
        dest,
        planned: plan.planned,
        // The part asks for no more than its own charged units (`planBonusCap`).
        bonus:
          plan.bonus === 0 ? 0 : Math.min(plan.bonus, planBonusCap(chargedOfSplit(n, charged))),
      };
    }
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
      routes: new Map(msg.nodes.map((n) => [n.node, n.path])),
      split: new Map(msg.split.map((s) => [s.node, s.units])),
    };
    this.ui.patch({ reach: info });
    // A group dropped from a group order for its size (DEC-48, item B4): the split of #762 opens
    // with the size the server says gets to the target, its part goes there on confirm.
    const offer = this.#splitOffer;
    if (offer?.group !== msg.group) return;
    this.#splitOffer = null;
    const group = this.#selectedGroup();
    const fit = info.split.get(offer.dest) ?? 0;
    if (group === null || group.id !== offer.group || group.node === null || fit < 1) return;
    this.#closeMenus();
    if (this.splitMenu.open(group.id, group.units, group.charged, { n: fit, dest: offer.dest })) {
      const bonus = offer.planned ? PLAN_BONUS.min : 0;
      this.#sendPlan = { group: group.id, planned: offer.planned, bonus };
    }
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
    const send = this.#pendingSend;
    if (send?.from === from) {
      // The part of a split for a too small target (#762) goes there at once; the order is given,
      // so the group is let go as after any order.
      this.#pendingSend = null;
      this.#sendCommand(
        { type: 'move', group: to, dest: send.dest, planned: send.planned, bonus: send.bonus },
        send.node,
      );
      const picked = this.#o.hud.selection;
      if (picked?.kind === 'group' && picked.id === from) this.deselect();
      return;
    }
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
   * Closes the menu of a city (a key, a click outside, a building) and lets the
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
    switch (choice) {
      case 'recruit':
        this.recruit();
        return;
      case 'barracks':
        this.cityBuild('build_barracks');
        return;
      case 'factory':
        this.cityBuild('build_factory');
        return;
      case 'fortify':
        this.startFortify();
        return;
      case 'rally':
        this.startRally();
        return;
    }
  }

  /**
   * "Fortify road" (DEC-43, item D; #707): the menu of the own city or province closes and the map
   * asks for the road (P1 "Ghosts": a faint ghost of the line on each road that has none of this
   * node yet, the hovered one bright with the price). A click on a ghost sends `fortify_road`; Esc or
   * a click anywhere else cancels. The price and the rejects are the server's call.
   */
  startFortify(): void {
    const node = this.recruitNode();
    if (node === null || this.#o.send === null) return;
    // Every road of the node has a line already (built or being built): there is nothing to pick.
    if (!this.fortifiable(node)) return;
    this.closeCityMenu();
    this.ui.patch({ fortFrom: node, fortHover: null });
  }

  /** Leaves the road pick of a fortification without sending anything. */
  cancelFortify(): void {
    if (this.ui.current.fortFrom !== null) this.ui.patch({ fortFrom: null, fortHover: null });
  }

  /** The roads of `node` a fortification could be asked for: those it has no line on yet. */
  #fortRoads(node: number): number[] {
    const roads = this.#o.hud.current?.roads ?? [];
    return this.#o.map.edges
      .filter((edge) => edge.a === node || edge.b === node)
      .filter((edge) => roads[edge.id]?.fortNodes.includes(node) !== true)
      .map((edge) => edge.id);
  }

  /** The pick of the overlay; ends itself when the node is no longer the player's. */
  #fortPick(): FortPick | null {
    const node = this.ui.current.fortFrom;
    if (node === null) return null;
    return {
      node,
      edges: this.#fortRoads(node),
      hover: this.ui.current.fortHover,
      cost: tf('city.cost', { cost: formatCentis(this.fortCost, getLocale()) }),
      amount: formatCentis(this.fortCost, getLocale()),
    };
  }

  #syncFort(): void {
    const node = this.ui.current.fortFrom;
    if (node !== null && !this.#isOwnNode(node)) this.cancelFortify();
  }

  /** The road under the pointer that a click would fortify. */
  #syncFortHover(): void {
    const node = this.ui.current.fortFrom;
    if (node === null) return;
    const hit = this.#hover;
    const edge = hit?.kind === 'edge' && this.#fortRoads(node).includes(hit.id) ? hit.id : null;
    if (edge !== this.ui.current.fortHover) this.ui.patch({ fortHover: edge });
  }

  #fortClick(hit: PickHit | null): void {
    const node = this.ui.current.fortFrom;
    if (node === null) return;
    const edge = hit?.kind === 'edge' && this.#fortRoads(node).includes(hit.id) ? hit.id : null;
    this.cancelFortify();
    if (edge === null || this.#o.send === null) return;
    this.#sendCommand({ type: 'fortify_road', node, edge }, null);
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
      case 'release':
        this.releasePlan();
        return;
    }
  }

  /**
   * The selected group with a gathering plan departs now (DEC-41, item 10) with the
   * bonus gathered so far (`release_plan`, free). Whether it has one is the server's call.
   */
  releasePlan(): void {
    const group = this.#selectedGroup();
    // Under the group order there is no release (DEC-48, item A7): the server would refuse it.
    if (group === null || !this.canRelease) return;
    this.groupMenu.close();
    this.#sendCommand({ type: 'release_plan', group: group.id }, null);
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

  /** The barracks or a factory of the selected own node (DEC-26, DEC-41). */
  cityBuild(type: 'build_barracks' | 'build_factory'): void {
    const node = this.recruitNode();
    this.closeCityMenu();
    if (node === null) return;
    this.#sendCommand({ type, node }, null);
  }

  /** The city development is in these rules (`ruleset_public.city_upgrades`). */
  get cityUpgrades(): RulesetPublic['city_upgrades'] {
    return this.#o.rules.city_upgrades;
  }

  /** Prices of a unit and the barracks, hundredths of CP. */
  get cityCosts(): { readonly recruit: number; readonly barracks: number } {
    const { cost } = this.#o.rules;
    return { recruit: cost.recruit, barracks: cost.barracks };
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

  setStance(stance: Stance): void {
    this.#sendCommand({ type: 'set_stance', stance }, null);
  }

  /** Every own factory follows the stance like the capital (`stances.factories_follow`, DEC-47). */
  get factoriesFollow(): boolean {
    return this.#o.rules.stances.factories_follow;
  }

  /** The numbers of the stance menu, from the ruleset of `welcome` and the own working factories (DEC-47). */
  get stanceRates(): StanceRate[] {
    return stanceRates(this.#o.rules, this.#o.hud.current?.workingFactories);
  }

  /** The menu opens only in a match, where a stance can be sent (DEC-44). */
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
   * Tab / F2: the «Supply» map mode on or off. Either way every open menu closes and a selected
   * city is let go (its menu goes with it); a selected group stays.
   */
  toggleSupplyMode(): void {
    const on = !this.ui.current.supplyMode;
    this.#closeMenus();
    if (this.#o.hud.selection?.kind === 'node') this.#o.hud.select(null);
    this.ui.patch({ supplyMode: on, ...(on ? { terrainMode: false } : {}) });
  }

  // --- The terrain map mode (#429) ---------------------------------------------------------------

  get terrainMode(): boolean {
    return this.ui.current.terrainMode;
  }

  /**
   * `T`: the terrain map mode on or off. It only changes the picture, so nothing else closes; it
   * does not go with the «Supply» mode (turning one on turns the other off).
   */
  toggleTerrainMode(): void {
    const on = !this.ui.current.terrainMode;
    if (on) {
      this.#closeMenus();
      if (this.ui.current.supplyMode) this.ui.patch({ supplyMode: false });
    }
    this.ui.patch({ terrainMode: on });
  }

  /** The vision table of the rules (`ruleset_public.vision`, DEC-21, item 2): shown, never computed with. */
  get visionTable(): RulesetPublic['vision']['by_terrain'] {
    return this.#o.rules.vision.by_terrain;
  }

  /** Returns true if the key was used (the caller then prevents the browser default). */
  key(input: KeyInput): boolean {
    // `E` held is a planned order (DEC-48, item K2); its keyup or a lost focus (`code` empty) lets
    // it go, so a later click never becomes a planned order by accident.
    if (input.code === 'KeyE' || (input.type === 'keyup' && input.code === '')) {
      this.#eHeld = input.type === 'keydown';
    }
    this.#syncPlanning();
    this.#syncBonusPick();
    if (!this.#eHeld) this.#wheelSteps.reset();
    if (input.code === 'KeyE') return true;
    if (input.type !== 'keydown') return this.#keyUp(input);
    if (input.code === 'Tab' || input.code === 'F2') {
      if (input.repeat !== true) this.toggleSupplyMode();
      return true;
    }
    if (input.code === 'KeyT') {
      if (input.repeat !== true) this.toggleTerrainMode();
      return true;
    }
    if (input.code === 'KeyQ') return this.#qDown(input);
    if (this.leafShift !== null) {
      // The leaf shift (DEC-43): `-` moves the level one road back from the front (the control
      // reads "−1", "−2"), `=` / `+` moves it forward again.
      if (input.code === 'Minus' || input.code === 'NumpadSubtract') {
        if (input.repeat !== true) this.stepLeafShift(1);
        return true;
      }
      if (input.code === 'Equal' || input.code === 'NumpadAdd') {
        if (input.repeat !== true) this.stepLeafShift(-1);
        return true;
      }
    }
    if (input.code === 'Escape' && this.ui.current.fortFrom !== null) {
      // The road pick of a fortification: Esc drops it.
      this.cancelFortify();
      return true;
    }
    if (input.code === 'Escape' && this.ui.current.rallyFrom !== null) {
      // The rally point pick (DEC-48, item K7): Esc drops it.
      this.cancelRally();
      return true;
    }
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
    switch (input.code) {
      case 'Escape':
        // The menus above took their own Esc.
        this.deselect();
        return true;
      case 'KeyX':
        // Nothing selected on the ordinary map: the last action goes, step by step (#764). A held
        // key does not repeat it, and the «Supply» layer shows no groups for the cue to mark.
        if (this.isIdle() && !this.ui.current.supplyMode) {
          if (input.repeat !== true) this.#undoPress();
          return true;
        }
        // A selected own city: its last recruit goes; otherwise the order of the selected group.
        if (this.#o.hud.selection?.kind === 'node') {
          if (this.selectedOwnCity() !== null) this.cancelRecruit();
        } else this.cancelSelected();
        return true;
      case 'KeyF':
        // The gathering plan of the selected group departs now; no release under the group order.
        if (!this.canRelease) return false;
        this.releasePlan();
        return true;
      case 'KeyP':
        // The recruit rally point of the selected own city (DEC-48, item K7): set it, or clear it.
        if (!this.rallyPoints || this.selectedOwnCity() === null) return false;
        if (input.repeat !== true) this.startRally();
        return true;
      case 'KeyR':
        this.recruit();
        return true;
      case 'KeyB':
        // "Fortify road" of the selected own city or province (DEC-43, item D): the road is picked next.
        if (this.selectedOwnCity() === null) return false;
        this.startFortify();
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
   * Closes every radial menu (stance, split, city, group, stack list): at most one is open
   * at a time, so whoever opens one calls this first.
   */
  #closeMenus(): void {
    this.cancelFortify();
    this.cancelRally();
    this.closeRadial();
    this.splitMenu.close();
    this.#closeTargetMenus();
  }

  /** The node `id` is a province (`kind = province`, DEC-23). */
  isProvince(id: number): boolean {
    return this.#isProvince(id);
  }

  /** The node `id` is a province (`kind = province`, DEC-23): not selectable, has no city menus. */
  #isProvince(id: number): boolean {
    return this.#o.map.nodes[id]?.kind === 'province';
  }

  /** The node `id` is a city the enemy holds in the snapshot on screen (a target, never selected, #535). */
  #isEnemyNode(id: number): boolean {
    return this.#o.hud.current?.nodes.some((n) => n.id === id && n.owner === 'enemy') ?? false;
  }

  /**
   * A province or an enemy city: it is only a destination, so it gets no selection and no highlight.
   * An own province is selected and has a menu: it can fortify a road (DEC-43, item D).
   */
  #isUnselectable(id: number): boolean {
    if (this.#isProvince(id) && this.#isOwnNode(id)) return false;
    return this.#isProvince(id) || this.#isEnemyNode(id);
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
    // A selected city the enemy has captured meanwhile loses the highlight with its menu (#535).
    const picked = this.#o.hud.selection;
    if (picked?.kind === 'node' && this.#isEnemyNode(picked.id)) this.deselect();
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
      // A province or an enemy city is never selected: its list stays open with nothing selected.
      const at =
        node ??
        this.#selectedGroup()?.node ??
        (this.#o.hud.selection === null && this.#isUnselectable(stack.target ?? -1)
          ? stack.target
          : null);
      if (at !== stack.target || this.stackGroups().length < 2) this.stackMenu.close();
    }
  }

  /**
   * A click in the «Supply» mode. The layer is not the ordinary map (ui-style.md, section 19): a
   * click on anything is a click on nothing, never a selection or a city or group menu (#678). A
   * click on empty ground still drops the selection. Returns false for an ordinary click.
   */
  #supplyClick(hit: PickHit | null): boolean {
    if (!this.ui.current.supplyMode || hit === null) return false;
    this.#closeMenus();
    return true;
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

  /** Sends an intent and starts waiting for its `ack`; a new command clears the old notice. */
  #sendCommand(
    cmd: Command,
    from: number | null,
    route: readonly number[] | null = null,
    members: readonly (number | null)[] = [],
  ): number | null {
    const send = this.#o.send;
    if (send === null) return null;
    this.#clearNotice();
    const seq = send(cmd);
    this.#o.book.track(seq, cmd, from, route, members);
    return seq;
  }

  /** `X` with nothing selected: one more step back (#764). */
  #undoPress(): void {
    if (this.#o.send === null) return;
    this.#undoWanted += 1;
    this.#undoNext();
  }

  /**
   * Sends the next undo a press waits for: one at a time, and not before the answer to a move or
   * a recruit still on its way, which may be the newest action. The list run out: the neutral cue.
   */
  #undoNext(): void {
    const { book, hud } = this.#o;
    if (this.#undoWanted === 0 || this.#undoSent !== null || book.undoAwaited) return;
    const entry = book.undo.take((e) => e.kind === 'order' && hud.inFight(e.group));
    if (entry === null) {
      this.#undoWanted = 0;
      this.#addUndoMark({ group: null, node: null, path: [] });
      return;
    }
    const mark = this.#undoMarkOf(entry);
    const seq = this.#sendCommand(undoCommand(entry), null);
    if (seq !== null) this.#undoSent = { seq, mark };
  }

  /** Where the cue of `entry` goes: read now, while the snapshot still shows the order. */
  #undoMarkOf(entry: UndoEntry): Omit<UndoMark, 'at'> {
    if (entry.kind === 'recruit') return { group: null, node: entry.node, path: [] };
    const group = this.#o.hud.ownGroup(entry.group);
    const location = group?.location;
    return {
      group: entry.group,
      node: location?.kind === 'node' ? location.node : null,
      path: group?.order?.path ?? [],
    };
  }

  /**
   * The answer to a command, for the undo list; `true`: an undo the server refused, which stays
   * silent (no toast, no notice): the entry is dropped and the next one is asked.
   */
  #undoAnswer(result: CommandResult): boolean {
    const sent = this.#undoSent;
    if (sent?.seq !== result.seq) {
      if (result.kind === 'accepted') this.#o.book.undo.onAccepted(result.cmd);
      return false;
    }
    this.#undoSent = null;
    if (result.kind === 'rejected') return true;
    this.#undoWanted = result.kind === 'accepted' ? this.#undoWanted - 1 : 0;
    if (result.kind === 'accepted') this.#addUndoMark(sent.mark);
    return false;
  }

  #addUndoMark(mark: Omit<UndoMark, 'at'>): void {
    this.#undoMarks = [...this.#undoMarks, { ...mark, at: this.#now() }].slice(-UNDO_CUE.max);
  }

  /** The cues of `X` still on screen; the same array until one ends. */
  #undoMarksNow(): readonly UndoMark[] {
    const now = this.#now();
    if (this.#undoMarks.some((m) => now - m.at >= UNDO_CUE.ms)) {
      this.#undoMarks = this.#undoMarks.filter((m) => now - m.at < UNDO_CUE.ms);
    }
    return this.#undoMarks;
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
   * The hovered target the server's `reach` answer lists under `split` (the selected group is bigger
   * than a node on the way, DEC-20), mirrored to `ui.current.splitHover` for the hint. Only what the
   * server sent: nothing about the stack limit is worked out here (AGENTS.md 7.1).
   */
  #syncSplitHover(reach: ReachInfo | null, preview: number | null): void {
    const node = reach !== null && preview !== null && reach.split.has(preview) ? preview : null;
    if (node !== this.ui.current.splitHover) this.ui.patch({ splitHover: node });
  }

  /**
   * The hovered target the player does not own (public ownership) while a capture costs charges
   * (DEC-38), mirrored to `ui.current.captureHover` for the rule tip. Not while the split hint shows
   * there. The rule only: whether the group can pay is not worked out here (AGENTS.md 7.1).
   */
  #syncCaptureHover(preview: number | null): void {
    const node =
      preview !== null &&
      this.#o.rules.capture.charge_cost > 0 &&
      preview !== this.ui.current.splitHover &&
      !this.#isOwnNode(preview)
        ? preview
        : null;
    if (node !== this.ui.current.captureHover) this.ui.patch({ captureHover: node });
  }

  /**
   * The time to the hovered node for the one small number there: the server's travel time of the
   * whole path (`reach`), and for a planned order the delay before the group sets off, from
   * `ruleset_public` (display arithmetic only; the client computes no path), with the route the
   * server gave that time for (`ReachNode.path`). `null`: no number.
   */
  #eta(
    reach: ReachInfo | null,
    preview: number | null,
  ): { ticks: number; path: readonly number[] } | null {
    if (reach === null || preview === null) return null;
    const ticks = reach.ticks.get(preview);
    const path = reach.routes.get(preview);
    if (ticks === undefined || path === undefined) return null;
    return {
      // A plan waits until its bonus is gathered, an unknown time: the travel time only.
      ticks,
      path,
    };
  }

  /** The node a click would send the selected group to, if it would. */
  #previewTarget(): number | null {
    // Groups selected together (DEC-48): any place under the pointer is a target (a group on a
    // road is a pick, not a place).
    if (this.#picks.length > 0) {
      const ui = this.ui.current;
      const hit = this.#hover;
      if (this.#o.send === null || ui.supplyMode || ui.rallyFrom !== null) return null;
      if (hit?.kind === 'group' && hit.node === undefined) return null;
      return this.#hoverCity();
    }
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
    const quiet = this.#undoAnswer(result);
    this.#undoNext();
    if (quiet) return;
    const { cmd } = result;
    // A split that was to send its part on and did not happen sends nothing (#762).
    if (
      cmd.type === 'split' &&
      result.kind !== 'accepted' &&
      this.#pendingSend?.from === cmd.group
    ) {
      this.#pendingSend = null;
    }
    const moving = cmd.type === 'move' || cmd.type === 'group_move';
    // A group order short of CP is refused as a whole and nothing waits (DEC-48, owner decision
    // (7)): the CP badge is marked like a move's, the ghosts cross out, the toast tells it.
    if (result.kind === 'rejected' && moving && result.code === 'NOT_ENOUGH_CP') {
      this.#cpFlashUntil = this.#now() + CP_SHORT_FLASH_MS;
      const price = cmd.type === 'group_move' ? this.#commandPrice(cmd) : this.#movePrice();
      if (!this.ui.current.cpShort || this.ui.current.cpPrice !== price) {
        this.ui.patch({ cpShort: true, cpPrice: price });
      }
    }
    this.ui.emit(
      result.kind === 'rejected'
        ? { kind: 'rejected', code: result.code, cmd: result.cmd }
        : result.kind === 'accepted'
          ? { kind: 'accepted', cmd: result.cmd }
          : { kind: result.kind, cmd: result.cmd },
    );
    if (result.kind === 'accepted' && cmd.type === 'group_move') {
      this.#dropped(cmd, result.members ?? []);
    }
    // A move shows itself on the map (ghost, then the order line): no message for its success.
    if (result.kind === 'accepted' && moving) return;
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

  /**
   * The groups an accepted group order dropped (DEC-48, item B3, `ack.members`): a toast per code
   * with the count. The first one too big for the road (`STACK_LIMIT`) gets the split offer of #762
   * (item B4): it is selected alone, and the server's `reach` for it opens the split menu.
   */
  #dropped(cmd: Command & { type: 'group_move' }, members: readonly AckMember[]): void {
    const counts = new Map<string, number>();
    let tooBig: string | null = null;
    for (const [i, member] of members.entries()) {
      const code = member.reject_code;
      if (code === null) continue;
      counts.set(code, (counts.get(code) ?? 0) + 1);
      if (code === 'STACK_LIMIT') tooBig ??= cmd.groups[i] ?? null;
    }
    for (const [code, count] of counts) this.ui.emit({ kind: 'dropped', code, count, cmd });
    if (tooBig === null || this.#o.send === null) return;
    // The player may have selected something else meanwhile: the offer waits for no one.
    if (this.#o.hud.selection !== null || this.#picks.length > 0) return;
    this.#splitOffer = { group: tooBig, dest: cmd.dest, planned: cmd.planned };
    this.#o.hud.select({ kind: 'group', id: tooBig });
  }

  /** The price of a sent group order (`ruleset_public`, item A2), for the CP badge of a refusal. */
  #commandPrice(cmd: Command & { type: 'group_move' }): number {
    const { cost } = this.#o.rules;
    const n = cmd.groups.length;
    const rally = this.groupOrder;
    if (this.#isOwnNode(cmd.dest) && rally !== null) {
      return rallyPrice(n, cost.move, rally.rally_pct);
    }
    return n * (cmd.planned ? cost.planned_move : cost.move);
  }

  // --- The recruit rally point (DEC-48, items H, K7) -------------------------------------------------

  /**
   * "Rally point" of the selected own city (the menu sector or `P`): a city with a point clears it
   * (free, item H3); one without it asks for the node next (`ui.current.rallyFrom`): a click on a
   * node sends `set_rally_point`, Esc or a click on nothing cancels. The server checks the rest.
   */
  startRally(): void {
    const node = this.selectedOwnCity();
    if (node === null || this.#isProvince(node) || !this.rallyPoints || this.#o.send === null) {
      return;
    }
    const point = this.#o.hud.current?.node?.rallyPoint ?? null;
    this.closeCityMenu();
    if (point !== null) {
      this.#sendCommand({ type: 'set_rally_point', node, target: null }, null);
      return;
    }
    this.ui.patch({ rallyFrom: node });
  }

  /** Leaves the rally point pick without sending anything. */
  cancelRally(): void {
    if (this.ui.current.rallyFrom !== null) this.ui.patch({ rallyFrom: null });
  }

  #rallyClick(hit: PickHit | null): void {
    const from = this.ui.current.rallyFrom;
    this.cancelRally();
    if (from === null || hit === null || this.#o.send === null) return;
    const node = hit.kind === 'edge' ? (hit.cell ?? null) : this.#cityOf(hit);
    if (node === null || node === from) return;
    this.#sendCommand({ type: 'set_rally_point', node: from, target: node }, null);
  }

  /** The pick ends itself when the city is no longer the player's. */
  #syncRally(): void {
    const node = this.ui.current.rallyFrom;
    if (node !== null && !this.#isOwnNode(node)) this.cancelRally();
  }
}
