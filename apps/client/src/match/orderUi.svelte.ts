import type { Command } from '../protocol.gen.ts';

/** Where the selected group can go, as the server answered `reach_query` (DEC-20, D5). */
export interface ReachInfo {
  readonly group: string;
  /** Travel ticks by node: the nodes a move of the group is accepted to now. */
  readonly ticks: ReadonlyMap<number, number>;
  /** The route by node (`ReachNode.path`): the nodes from the group's node to it, ends included. */
  readonly routes: ReadonlyMap<number, readonly number[]>;
  /** Nodes only a smaller group reaches (`STACK_LIMIT`). */
  readonly split: ReadonlySet<number>;
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
  /** The road mode is on (`U`): own roads that can be raised are lit and a click on one raises it. */
  readonly roadMode: boolean;
  /** The own road under the pointer that a click would raise (DEC-28, item 7); `null`: none. */
  readonly roadHover: number | null;
  /**
   * The node the pointer rests on as a target of the selected group that the server says the group is
   * too big for (`reach.split`, STACK_LIMIT, DEC-20): the hint "split the group" shows for it before any
   * order is sent (#468). `null`: none.
   */
  readonly splitHover: number | null;
  /** The «Supply» map mode is on (Tab or F2, DEC-18). */
  readonly supplyMode: boolean;
  /** Transfer pick: the own city the charges leave; a click on another own city picks `to`. */
  readonly transferFrom: number | null;
  readonly notice: OrderNotice | null;
  /** The answer to the last `reach_query` for the selected group; `null`: none yet. */
  readonly reach: ReachInfo | null;
}

/**
 * The reactive side of ordering (CLI-06, #62): what the side panel shows. One field replaced as a
 * whole on a change (AGENTS.md 7.2); the map reads the plain `OrderController`, not this.
 */
export class OrderUiState {
  current = $state.raw<OrderUiData>({
    planned: false,
    roadMode: false,
    roadHover: null,
    splitHover: null,
    supplyMode: false,
    transferFrom: null,
    notice: null,
    reach: null,
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
