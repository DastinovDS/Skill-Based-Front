import type { HudState } from '../hud/hudState.svelte.ts';
import type { AttackTarget } from '../hud/hudData.ts';
import type { Command, MapFile, RulesetPublic } from '../protocol.gen.ts';
import {
  EMPTY_OVERLAY,
  type MapInteraction,
  type OverlayState,
  type PickHit,
} from '../render/interaction.ts';
import type { CommandResult, OrderBook } from './orderBook.ts';
import { OrderUiState } from './orderUi.svelte.ts';
import { moveCost } from './rejects.ts';

/** How long a rejection stays in the panel, ms. */
export const NOTICE_MS = 6000;

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
 * Keys: Esc deselects, P toggles the planned switch, X cancels the order of the selected group.
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
    const key = `${selection?.kind ?? '-'}:${String(selection?.id ?? '-')}|${String(from)}>${String(preview)}|${String(this.planned)}`;
    if (key !== this.#overlayKey || ghosts !== this.#overlayGhosts) {
      this.#overlayKey = key;
      this.#overlayGhosts = ghosts;
      this.#overlay = {
        selection,
        ghosts,
        preview:
          from !== null && preview !== null ? { from, to: preview, planned: this.planned } : null,
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
    if (hit.kind === 'node' && group !== null && this.#o.send !== null && group.node !== hit.id) {
      this.#clearNotice();
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
    if (group === null || this.#o.send === null) return;
    this.#clearNotice();
    this.#sendCommand({ type: 'cancel_order', group: group.id }, null);
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
      case 'KeyP':
        this.setPlanned(!this.ui.current.planned);
        return true;
      case 'KeyX':
        this.cancelSelected();
        return true;
      default:
        return false;
    }
  }

  // --- Internals ----------------------------------------------------------------------------

  #sendCommand(cmd: Command, from: number | null): void {
    const send = this.#o.send;
    if (send === null) return;
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

    // The combat estimate follows the pointer over enemy nodes.
    const isEnemy = (id: number): boolean =>
      this.#o.hud.current?.nodes.some((n) => n.id === id && n.owner === 'enemy') ?? false;
    const aim: AttackTarget | null = node !== null && isEnemy(node) ? { node, planned } : null;
    if (aimKey(aim) !== aimKey(this.#aimed)) {
      this.#aimed = aim;
      this.#o.hud.aim(aim);
    }
  }

  #onResult(result: CommandResult): void {
    if (result.kind === 'accepted') return;
    this.#noticeId += 1;
    this.ui.patch({
      notice:
        result.kind === 'rejected'
          ? { id: this.#noticeId, kind: 'rejected', code: result.code, cmd: result.cmd }
          : { id: this.#noticeId, kind: 'lost', cmd: result.cmd },
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
