import type { Command, RoadKind } from '../protocol.gen.ts';

/** Where a click would send the selected group, with the price (hundredths of CP, from the ruleset). */
export interface MovePricing {
  readonly node: number;
  readonly planned: boolean;
  readonly cost: number;
}

/** The road under the pointer and what its next level costs (DEC-16, DEC-22). */
export interface RoadHint {
  readonly edge: number;
  /** The level the road would get. */
  readonly width: number;
  /** Its type now: `none` before the first upgrade, which chooses one (DEC-22). */
  readonly kind: RoadKind;
  /** Warehouse charges of the building city; `null` if the ruleset lists no price. */
  readonly charges: number | null;
  /** A click on it now sends the upgrade (road pick of the selected city). */
  readonly pickable: boolean;
}

/** The answer to the last command, for the panel. */
export type OrderNotice =
  | { readonly id: number; readonly kind: 'accepted'; readonly cmd: Command }
  | { readonly id: number; readonly kind: 'rejected'; readonly code: string; readonly cmd: Command }
  | { readonly id: number; readonly kind: 'lost'; readonly cmd: Command };

/**
 * The answer to a command, for whoever reacts to it besides the panel (the sound of package F:
 * a short tone for `accepted`, another for `rejected`). A move that was accepted is reported too.
 */
export type OrderFeedback =
  | {
      readonly kind: 'accepted';
      readonly cmd: Command;
      /** When an accepted transfer arrives (`ack.arrive_tick`, DEC-18); `null` otherwise. */
      readonly arriveTick?: number | null;
    }
  | { readonly kind: 'rejected'; readonly code: string; readonly cmd: Command }
  | { readonly kind: 'lost'; readonly cmd: Command };

export interface OrderUiData {
  /** The "planned order" switch (Shift+click also makes one order planned). */
  readonly planned: boolean;
  readonly preview: MovePricing | null;
  /** The upgrade hint of the road under the pointer; `null` if it has none. */
  readonly road: RoadHint | null;
  /** Road pick (key U, DEC-16): the own city whose road a click upgrades; `null`: off. */
  readonly roadPick: number | null;
  /** The «Supply» map mode is on (Tab or F2, DEC-18). */
  readonly supplyMode: boolean;
  /** Transfer pick: the own city the charges leave; a click on another own city picks `to`. */
  readonly transferFrom: number | null;
  readonly notice: OrderNotice | null;
}

/**
 * The reactive side of ordering (CLI-06, #62): what the side panel shows. One field replaced as a
 * whole on a change (AGENTS.md 7.2); the map reads the plain `OrderController`, not this.
 */
export class OrderUiState {
  current = $state.raw<OrderUiData>({
    planned: false,
    preview: null,
    road: null,
    roadPick: null,
    supplyMode: false,
    transferFrom: null,
    notice: null,
  });

  #listeners: readonly ((feedback: OrderFeedback) => void)[] = [];

  patch(change: Partial<OrderUiData>): void {
    this.current = { ...this.current, ...change };
  }

  /** Calls `listener` for every answered command; returns the function that stops it. */
  onFeedback(listener: (feedback: OrderFeedback) => void): () => void {
    this.#listeners = [...this.#listeners, listener];
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  emit(feedback: OrderFeedback): void {
    for (const listener of this.#listeners) listener(feedback);
  }
}
