import type { Command } from '../protocol.gen.ts';

/** Where a click would send the selected group, with the price (hundredths of CP, from the ruleset). */
export interface MovePricing {
  readonly node: number;
  readonly planned: boolean;
  readonly cost: number;
}

/** The answer to the last command, for the panel. */
export type OrderNotice =
  | { readonly id: number; readonly kind: 'rejected'; readonly code: string; readonly cmd: Command }
  | { readonly id: number; readonly kind: 'lost'; readonly cmd: Command };

export interface OrderUiData {
  /** The "planned order" switch (Shift+click also makes one order planned). */
  readonly planned: boolean;
  readonly preview: MovePricing | null;
  readonly notice: OrderNotice | null;
}

/**
 * The reactive side of ordering (CLI-06, #62): what the side panel shows. One field replaced as a
 * whole on a change (AGENTS.md 7.2); the map reads the plain `OrderController`, not this.
 */
export class OrderUiState {
  current = $state.raw<OrderUiData>({ planned: false, preview: null, notice: null });

  patch(change: Partial<OrderUiData>): void {
    this.current = { ...this.current, ...change };
  }
}
