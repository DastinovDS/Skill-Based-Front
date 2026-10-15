import type { SupplyChoice } from '../hud/radial.ts';
import type { Priority } from '../protocol.gen.ts';

/** What the supply menu of an own city shows (DEC-18, item 7). */
export interface SupplyMenuData {
  readonly open: boolean;
  /** The city; `-1` while closed. */
  readonly node: number;
  /** Its priority now (from the snapshot). */
  readonly priority: Priority;
  /** Warehouse charges of the city, for the transfer sector; `null` if unknown. */
  readonly warehouse: number | null;
  /** The sector under the pointer; `null`: the dead zone, or nothing yet. */
  readonly hover: SupplyChoice | null;
}

const MENU_CLOSED: SupplyMenuData = {
  open: false,
  node: -1,
  priority: 'normal',
  warehouse: null,
  hover: null,
};

/** The reactive side of the supply menu: one field replaced as a whole (AGENTS.md 7.2). */
export class SupplyMenuState {
  current = $state.raw<SupplyMenuData>(MENU_CLOSED);

  open(node: number, priority: Priority, warehouse: number | null): void {
    this.current = { open: true, node, priority, warehouse, hover: null };
  }

  close(): void {
    if (this.current.open) this.current = MENU_CLOSED;
  }

  hover(choice: SupplyChoice | null): void {
    if (this.current.hover !== choice) this.current = { ...this.current, hover: choice };
  }
}

/** The amount dialog of a transfer A -> B (DEC-18, item 6). */
export interface TransferData {
  readonly open: boolean;
  readonly from: number;
  readonly to: number;
  /**
   * The most the slider offers: the charges in the warehouse of `from`, and no more than the free
   * room of the warehouse of `to`; 0: nothing can be sent (the confirm button is off).
   */
  readonly max: number;
  /** The warehouse of `to` has no free room (the reason of a zero `max` the dialog tells). */
  readonly full: boolean;
  /** The amount chosen. */
  readonly n: number;
}

const TRANSFER_CLOSED: TransferData = {
  open: false,
  from: -1,
  to: -1,
  max: 0,
  full: false,
  n: 0,
};

export class TransferState {
  current = $state.raw<TransferData>(TRANSFER_CLOSED);

  open(from: number, to: number, max: number, full = false): void {
    this.current = {
      open: true,
      from,
      to,
      max,
      full,
      n: Math.min(max, Math.max(1, Math.ceil(max / 2))),
    };
  }

  set(n: number): void {
    const { open, max } = this.current;
    if (!open) return;
    const clamped = Math.min(max, Math.max(1, Math.round(n)));
    if (clamped !== this.current.n) this.current = { ...this.current, n: clamped };
  }

  close(): void {
    if (this.current.open) this.current = TRANSFER_CLOSED;
  }
}
