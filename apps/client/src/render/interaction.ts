/**
 * What the map shows of the player's input and what it reports back (CLI-06, #62). The match UI
 * (`match/orderController.ts`) implements it; the scene polls `overlay()` every frame like a
 * `RenderSource` and forwards pointer events to `click` and `hover`. The scene draws, it decides
 * nothing.
 */

/** What is under the pointer: an own group (by id), a node or a road (by id). */
export type PickHit =
  | { readonly kind: 'group'; readonly id: string }
  | { readonly kind: 'node'; readonly id: number }
  | { readonly kind: 'edge'; readonly id: number };

/** What can be selected: a group or a node (a road is only hovered and clicked to upgrade it). */
export type SelectionHit = Exclude<PickHit, { readonly kind: 'edge' }>;

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
}

/** Where a click would send the selected group. */
export interface MovePreview {
  readonly from: number;
  readonly to: number;
  readonly planned: boolean;
}

export interface OverlayState {
  readonly selection: SelectionHit | null;
  readonly ghosts: readonly GhostArrow[];
  readonly preview: MovePreview | null;
  /** The road under the pointer, lit up (a click upgrades it with a group selected). */
  readonly road: number | null;
}

export const EMPTY_OVERLAY: OverlayState = {
  selection: null,
  ghosts: [],
  preview: null,
  road: null,
};

export interface MapInteraction {
  /** Returns the same object while nothing changed: the scene redraws when it differs. */
  overlay(): OverlayState;
  /** Primary click (not a drag); `null`: empty map. */
  click(hit: PickHit | null, shift: boolean): void;
  /** The pointer moved over `hit`, or left the map (`null`). */
  hover(hit: PickHit | null): void;
}
