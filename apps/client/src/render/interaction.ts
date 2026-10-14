/**
 * What the map shows of the player's input and what it reports back (CLI-06, #62). The match UI
 * (`match/orderController.ts`) implements it; the scene polls `overlay()` every frame like a
 * `RenderSource` and forwards pointer events to `click` and `hover`. The scene draws, it decides
 * nothing.
 */

/** What is under the pointer: an own group (by id) or a node or a road (by id). */
export type PickHit =
  | { readonly kind: 'group'; readonly id: string }
  | { readonly kind: 'node'; readonly id: number }
  | { readonly kind: 'edge'; readonly id: number };

/** What can be selected: a group or a node (a road is only hovered, and clicked in road pick). */
export type SelectionHit = Exclude<PickHit, { readonly kind: 'edge' }>;

/** The life of a ghost: sent (dashed), accepted by the server (solid), rejected (shakes and fades). */
export type GhostStatus = 'pending' | 'accepted' | 'rejected';

/** An order sent and not yet shown by a snapshot: a dashed arrow on the map. */
export interface GhostArrow {
  /** The node the group stood in when the order was sent. */
  readonly from: number;
  readonly dest: number;
  readonly planned: boolean;
  /**
   * The server's path from `ack`, once it arrived (the client never computes it); `null` while
   * the order is unanswered: the arrow is a straight line to `dest`.
   */
  readonly path: readonly number[] | null;
  /** Default `pending`. */
  readonly status?: GhostStatus;
  /** When the server rejected it (`performance.now()` ms), for the shake and the fade. */
  readonly rejectedAt?: number | null;
}

/** Where a click would send the selected group. */
export interface MovePreview {
  readonly from: number;
  readonly to: number;
  readonly planned: boolean;
}

/**
 * The «Supply» map mode (DEC-18, item 7; Tab or F2): priorities of the own cities, own packets
 * with their paths and transfers. `source`: the city a transfer starts from while the player
 * picks its destination; `targets`: the own cities a click would pick then.
 */
export interface SupplyOverlay {
  readonly source: number | null;
  readonly targets: readonly number[];
}

export interface OverlayState {
  readonly selection: SelectionHit | null;
  readonly ghosts: readonly GhostArrow[];
  readonly preview: MovePreview | null;
  /** The road under the pointer, lit up. */
  readonly road: number | null;
  /** Road pick (key U, DEC-16): the roads of the selected city a click would upgrade. */
  readonly candidates: readonly number[];
  /** The city ringed in the first seconds of a match ("your capital is here"); `null`: none. */
  readonly beacon: number | null;
  /** The «Supply» map mode; `null`: the normal map. */
  readonly supply: SupplyOverlay | null;
  /**
   * Where the selected group can be ordered to, as the server answered `reach_query` (DEC-20):
   * `reach` gets a solid ring, `split` (too small for the group: split it first) a dashed one.
   */
  readonly reach: readonly number[];
  readonly split: readonly number[];
  /**
   * The time to the hovered reachable node, drawn as one small number there: the server's travel
   * time of the whole path, plus the delay of a planned order (Shift held). `null`: no number.
   */
  readonly eta: EtaMark | null;
}

export interface EtaMark {
  readonly node: number;
  readonly ticks: number;
}

export const EMPTY_OVERLAY: OverlayState = {
  selection: null,
  ghosts: [],
  preview: null,
  road: null,
  candidates: [],
  beacon: null,
  supply: null,
  reach: [],
  split: [],
  eta: null,
};

export interface MapInteraction {
  /** Returns the same object while nothing changed: the scene redraws when it differs. */
  overlay(): OverlayState;
  /** Primary click (not a drag); `null`: empty map. */
  click(hit: PickHit | null, shift: boolean): void;
  /** The pointer moved over `hit`, or left the map (`null`). */
  hover(hit: PickHit | null): void;
}
