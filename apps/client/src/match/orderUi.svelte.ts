import type { Command } from '../protocol.gen.ts';

/** Where the selected group can go, as the server answered `reach_query` (DEC-20, D5). */
export interface ReachInfo {
  readonly group: string;
  /** Travel ticks by node: the nodes a move of the group is accepted to now. */
  readonly ticks: ReadonlyMap<number, number>;
  /** The route by node (`ReachNode.path`): the nodes from the group's node to it, ends included. */
  readonly routes: ReadonlyMap<number, readonly number[]>;
  /**
   * Nodes only a smaller group reaches (`STACK_LIMIT`), each with the most units that get there
   * (`ReachSplit.units`, the server's number; 0: no smaller group either).
   */
  readonly split: ReadonlyMap<number, number>;
}

/** The answer to the last command, for the panel. */
type OrderNotice =
  | { readonly id: number; readonly kind: 'accepted'; readonly cmd: Command }
  | { readonly id: number; readonly kind: 'rejected'; readonly code: string; readonly cmd: Command }
  | { readonly id: number; readonly kind: 'lost'; readonly cmd: Command };

/**
 * The answer to a command, for whoever reacts to it besides the panel (the sound of package F:
 * a short tone for `accepted`, another for `rejected`). A move that was accepted is reported too.
 */
export type OrderFeedback =
  | { readonly kind: 'accepted'; readonly cmd: Command }
  | { readonly kind: 'rejected'; readonly code: string; readonly cmd: Command }
  | { readonly kind: 'lost'; readonly cmd: Command }
  /**
   * A group order went (DEC-48, item B3), but `count` of its groups were dropped with `code`
   * (`ack.members`): one feedback per code.
   */
  | {
      readonly kind: 'dropped';
      readonly code: string;
      readonly count: number;
      readonly cmd: Command;
    }
  /**
   * A group of a group order was too big for every road to the target (DEC-48, item B4, #913): the
   * server split it, `units` of its `of` went with the order and the rest stayed
   * (`ack.members[i].split_units`, `group_units`): one feedback per such group.
   */
  | {
      readonly kind: 'split';
      readonly units: number;
      readonly of: number;
      readonly cmd: Command;
    };

export interface OrderUiData {
  /** The "planned order" switch (E held + click also makes one order planned, DEC-48, item K2). */
  readonly planned: boolean;
  /**
   * The node the pointer rests on as a target of the selected group that the server says the group is
   * too big for (`reach.split`, STACK_LIMIT, DEC-20): the hint "split the group" shows for it before any
   * order is sent (#468). `null`: none.
   */
  readonly splitHover: number | null;
  /** The hovered `splitHover` target is closed to a planned order (E, #940): the tip says so. */
  readonly splitClosed: boolean;
  /**
   * The road pick of "Fortify road" (DEC-43, item D): the own node whose road is being picked, and the
   * road under the pointer; `null`: not picking.
   */
  readonly fortFrom: number | null;
  readonly fortHover: number | null;
  /** The terrain map mode is on (`T`, #429): patterns for the ground, a sight sign on the places you see. */
  readonly terrainMode: boolean;
  /**
   * A planned order is being made now: the switch is on or E is held (the plan bar shows its
   * bonus stepper prominently then, #762).
   */
  readonly planning: boolean;
  /**
   * The CP do not pay for the move a click would give now (the hovered target, the price of
   * `ruleset_public.cost`), or a move was just refused with `NOT_ENOUGH_CP`: the CP badge is
   * marked (#762). Display arithmetic only; the server decides.
   */
  readonly cpShort: boolean;
  /**
   * The CP price of the move a click would give now (hundredths, the ruleset's), while a target is
   * hovered or a move was just refused for its CP: the CP gauge draws it as a bracket under its
   * scale (ui-style 53a). `null`: nothing to price.
   */
  readonly cpPrice: number | null;
  readonly notice: OrderNotice | null;
  /** The answer to the last `reach_query` for the selected group; `null`: none yet. */
  readonly reach: ReachInfo | null;
  /**
   * The groups selected together (DEC-48, item K1: Shift+click, Shift+drag), in the order of the
   * selection (it decides the remainder of a planned bonus): two or more, else empty (a single
   * selected group is the ordinary selection).
   */
  readonly picks: readonly string[];
  /** The rally point pick (DEC-48, item K7): the own city whose point is being set; `null`: none. */
  readonly rallyFrom: number | null;
}

/**
 * The reactive side of ordering (CLI-06, #62): what the side panel shows. One field replaced as a
 * whole on a change (AGENTS.md 7.2); the map reads the plain `OrderController`, not this.
 */
export class OrderUiState {
  current = $state.raw<OrderUiData>({
    planned: false,
    splitHover: null,
    splitClosed: false,
    fortFrom: null,
    fortHover: null,
    terrainMode: false,
    planning: false,
    cpShort: false,
    cpPrice: null,
    notice: null,
    reach: null,
    picks: [],
    rallyFrom: null,
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
