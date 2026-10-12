import type { Stance } from '../protocol.gen.ts';

/** What the stance menu shows (ui-style 11). */
export interface RadialData {
  readonly open: boolean;
  /** Opened by a short press or a click: stays until a choice, Esc or a click outside. */
  readonly sticky: boolean;
  /** The sector under the pointer; `null`: the dead zone, or nothing yet. */
  readonly hover: Stance | null;
}

const CLOSED: RadialData = { open: false, sticky: false, hover: null };

/** The reactive side of the stance menu: one field replaced as a whole (AGENTS.md 7.2). */
export class RadialState {
  current = $state.raw<RadialData>(CLOSED);

  open(sticky: boolean): void {
    this.current = { open: true, sticky, hover: null };
  }

  keep(): void {
    this.current = { ...this.current, sticky: true };
  }

  close(): void {
    if (this.current.open) this.current = CLOSED;
  }

  hover(stance: Stance | null): void {
    if (this.current.hover !== stance) this.current = { ...this.current, hover: stance };
  }
}
