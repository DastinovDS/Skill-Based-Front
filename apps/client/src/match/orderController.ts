import type { HudState } from '../hud/hudState.svelte.ts';
import type { AttackTarget } from '../hud/hudData.ts';
import type { Command, MapFile, Mode, RulesetPublic, Stance } from '../protocol.gen.ts';
import {
  EMPTY_OVERLAY,
  type MapInteraction,
  type OverlayState,
  type PickHit,
} from '../render/interaction.ts';
import type { CommandResult, OrderBook } from './orderBook.ts';
import { OrderUiState, type RoadHint } from './orderUi.svelte.ts';
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
}

/** The parts of a keyboard event the controller needs (`code`: layout-independent key). */
export interface KeyInput {
  readonly type: 'keydown' | 'keyup';
  readonly code: string;
  readonly shiftKey: boolean;
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
 * recruit, stance, forfeit; a click on a road with a group selected upgrades the road. Each goes
 * out as an intent and comes back as `accepted` or `rejected` in `ui.current.notice`.
 *
 * Keys: Esc deselects, X cancels the order of the selected group,
 * 1 / 2 / 3 set the mode (attack / defense / build), R recruits in the selected city.
 */
export class OrderController implements MapInteraction {
  readonly ui = new OrderUiState();

  readonly #o: OrderControllerOptions;
  #shift = false;
  #hover: PickHit | null = null;
  #aimed: AttackTarget | null = null;
  #noticeId = 0;
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #overlay: OverlayState = EMPTY_OVERLAY;
  #overlayKey = '';
  #overlayGhosts: OverlayState['ghosts'] = [];

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
    const key = `${selection?.kind ?? '-'}:${String(selection?.id ?? '-')}|${String(from)}>${String(preview)}|${String(this.planned)}|${String(road)}`;
    if (key !== this.#overlayKey || ghosts !== this.#overlayGhosts) {
      this.#overlayKey = key;
      this.#overlayGhosts = ghosts;
      this.#overlay = {
        selection,
        ghosts,
        preview:
          from !== null && preview !== null ? { from, to: preview, planned: this.planned } : null,
        road,
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
    const group = this.#selectedGroup();
    if (hit.kind === 'edge') {
      // A road is for upgrading: with no group to do it, the click does nothing.
      if (group !== null) this.upgradeRoad(hit.id);
      return;
    }
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
    this.#refresh();
  }

  // --- Commands -----------------------------------------------------------------------------

  deselect(): void {
    this.#o.hud.select(null);
    this.#refresh();
  }

  /** Cancel the order of the selected group (the server accepts it for a planned order only). */
  cancelSelected(): void {
    const group = this.#selectedGroup();
    if (group === null) return;
    this.#sendCommand({ type: 'cancel_order', group: group.id }, null);
  }

  /** Switch the mode of the selected group (attack / defense / build). */
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

  /** Start building on `edge` with the selected group (it must stand at an end of the road). */
  upgradeRoad(edge: number): void {
    const group = this.#selectedGroup();
    if (group === null) return;
    this.#sendCommand({ type: 'upgrade_road', group: group.id, edge }, null);
  }

  setStance(stance: Stance): void {
    this.#sendCommand({ type: 'set_stance', stance }, null);
  }

  forfeit(): void {
    this.#sendCommand({ type: 'forfeit' }, null);
  }

  /** Returns true if the key was used (the caller then prevents the browser default). */
  key(input: KeyInput): boolean {
    const shiftChanged = this.#shift !== input.shiftKey;
    this.#shift = input.shiftKey;
    if (shiftChanged) this.#refresh();
    if (input.type !== 'keydown') return false;
    switch (input.code) {
      case 'Escape':
        this.deselect();
        return true;
      case 'KeyX':
        this.cancelSelected();
        return true;
      case 'Digit1':
        return this.#modeKey('attack');
      case 'Digit2':
        return this.#modeKey('defense');
      case 'Digit3':
        return this.#modeKey('build');
      case 'KeyR':
        this.recruit();
        return true;
      default:
        return false;
    }
  }

  // --- Internals ----------------------------------------------------------------------------

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
    if (road?.edge !== this.ui.current.road?.edge) this.ui.patch({ road });

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
      capacityCenti: road.capacityCenti,
      packetSpeedPct: road.packetSpeedPct,
      cost: this.#o.rules.cost.build,
    };
  }

  #onResult(result: CommandResult): void {
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
