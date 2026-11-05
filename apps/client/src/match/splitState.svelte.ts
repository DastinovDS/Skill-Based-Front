/** What the split menu shows (DEC-20): key S on a standing group, a slider for the new group. */
export interface SplitData {
  readonly open: boolean;
  /** The group that splits; `''` while closed. */
  readonly group: string;
  readonly units: number;
  readonly charged: number;
  /** Units that leave as the new group, `1 .. units - 1`. */
  readonly n: number;
  /** The confirm button is under the pointer (the menu highlights it). */
  readonly hover: boolean;
  /**
   * The most units the new group may take: `units - 1`, or less when the split part is sent on to
   * `dest` (the size the server says fits there, `reach.split`, #762).
   */
  readonly max: number;
  /** The split part is ordered to this node once the server has made it (#762); `null`: only a split. */
  readonly dest: number | null;
}

const CLOSED: SplitData = {
  open: false,
  group: '',
  units: 0,
  charged: 0,
  n: 0,
  hover: false,
  max: 0,
  dest: null,
};

/** A split that sends its part on (#762): the size that fits and where it goes. */
export interface SplitSend {
  readonly n: number;
  readonly dest: number;
}

/** Units of the new group of `Split` that are charged: the charged go first (DEC-20, B1). */
export function chargedOfSplit(n: number, charged: number): number {
  return Math.min(n, charged);
}

/** The reactive side of the split menu: one field replaced as a whole (AGENTS.md 7.2). */
export class SplitState {
  current = $state.raw<SplitData>(CLOSED);

  /**
   * Opens for a group of at least two units; the slider starts at half. With `send` the slider
   * starts at the size that fits and goes no higher, and the part goes on to `send.dest`.
   */
  open(group: string, units: number, charged: number, send: SplitSend | null = null): boolean {
    if (units < 2) return false;
    const max = send === null ? units - 1 : Math.min(units - 1, Math.max(1, send.n));
    this.current = {
      open: true,
      group,
      units,
      charged,
      n: send === null ? Math.floor(units / 2) : max,
      hover: false,
      max,
      dest: send?.dest ?? null,
    };
    return true;
  }

  close(): void {
    if (this.current.open) this.current = CLOSED;
  }

  /** Sets the amount, kept within `1 .. max`. */
  set(n: number): void {
    const { open, max } = this.current;
    if (!open || !Number.isFinite(n)) return;
    const next = Math.min(max, Math.max(1, Math.round(n)));
    if (next !== this.current.n) this.current = { ...this.current, n: next };
  }

  hover(on: boolean): void {
    if (this.current.open && this.current.hover !== on)
      this.current = { ...this.current, hover: on };
  }
}
