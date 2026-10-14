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
}

const CLOSED: SplitData = { open: false, group: '', units: 0, charged: 0, n: 0, hover: false };

/** Units of the new group of `Split` that are charged: the charged go first (DEC-20, B1). */
export function chargedOfSplit(n: number, charged: number): number {
  return Math.min(n, charged);
}

/** The reactive side of the split menu: one field replaced as a whole (AGENTS.md 7.2). */
export class SplitState {
  current = $state.raw<SplitData>(CLOSED);

  /** Opens for a group of at least two units; the slider starts at half. */
  open(group: string, units: number, charged: number): boolean {
    if (units < 2) return false;
    this.current = {
      open: true,
      group,
      units,
      charged,
      n: Math.floor(units / 2),
      hover: false,
    };
    return true;
  }

  close(): void {
    if (this.current.open) this.current = CLOSED;
  }

  /** Sets the amount, kept within `1 .. units - 1`. */
  set(n: number): void {
    const { open, units } = this.current;
    if (!open || !Number.isFinite(n)) return;
    const next = Math.min(units - 1, Math.max(1, Math.round(n)));
    if (next !== this.current.n) this.current = { ...this.current, n: next };
  }

  hover(on: boolean): void {
    if (this.current.open && this.current.hover !== on)
      this.current = { ...this.current, hover: on };
  }
}
