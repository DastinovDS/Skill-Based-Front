/**
 * What the map shows of the player's input and what it reports back (CLI-06, #62). The match UI
 * (`match/orderController.ts`) implements it; the scene polls `overlay()` every frame like a
 * `RenderSource` and forwards pointer events to `click` and `hover`. The scene draws, it decides
 * nothing.
 */

/**
 * What is under the pointer: an own group (by id), the icon of several own groups standing in a
 * city (`stack`), a node, or a road (by id).
 *
 * `group.node`: the group is the only one in that city and the hit is its icon there. `edge.cell`:
 * the city whose area (Voronoi cell) holds the point; a click on a road is a click on that city.
 */
export type PickHit =
  | { readonly kind: 'group'; readonly id: string; readonly node?: number }
  | { readonly kind: 'stack'; readonly node: number; readonly ids: readonly string[] }
  | { readonly kind: 'node'; readonly id: number }
  | { readonly kind: 'edge'; readonly id: number; readonly cell?: number };

/** What can be selected: a group or a node (a road is only hovered, and clicked to raise it). */
type SelectionHit =
  { readonly kind: 'group'; readonly id: string } | { readonly kind: 'node'; readonly id: number };

/** The life of a ghost: sent (dashed), accepted by the server (solid), rejected (shakes and fades). */
export type GhostStatus = 'pending' | 'accepted' | 'rejected';

/** An order sent and not yet shown by a snapshot: a dashed arrow on the map. */
export interface GhostArrow {
  /** The node the group stood in when the order was sent. */
  readonly from: number;
  readonly dest: number;
  readonly planned: boolean;
  /**
   * The server's path (the client never computes it): the route of the `reach` answer the order
   * was given on until the `ack` arrives, then the `ack`'s; `null` when neither is known: the arrow
   * is a straight line to `dest`.
   */
  readonly path: readonly number[] | null;
  /** Default `pending`. */
  readonly status?: GhostStatus;
  /** When the server rejected it (`performance.now()` ms), for the shake and the fade. */
  readonly rejectedAt?: number | null;
  /**
   * The `reject_code` of the refusal; `NOT_ENOUGH_CP` draws the cut-off arrow of a move the CP did
   * not pay for, bolder and longer (#762).
   */
  readonly rejectCode?: string | null;
}

/**
 * The cue of `X` on the map (#764): what was undone, at its place, for a moment. `group` and `node`
 * both `null`: there was nothing to undo, a neutral sign at the pointer.
 */
export interface UndoMark {
  /** When it was undone, `performance.now()` ms, for the rollback and the fade. */
  readonly at: number;
  /** The own group whose order went; `node` is its node then, if it stands in one. */
  readonly group: string | null;
  /** The city that lost its last recruit, or the node of `group`. */
  readonly node: number | null;
  /** The nodes the cancelled order still had ahead (`OrderView.path`), rolled back to the group. */
  readonly path: readonly number[];
}

/**
 * What a click under the pointer would pick or aim at (#762): the area of a node (`node`) or an own
 * group (`group`), lit lightly. One of the two is set.
 */
export interface HoverMark {
  readonly node: number | null;
  readonly group: string | null;
}

/** Where a click would send the selected group. */
interface MovePreview {
  readonly from: number;
  readonly to: number;
  readonly planned: boolean;
  /** The nodes the group goes through, ends included (the server's route when it gave one). */
  readonly path: readonly number[];
}

/**
 * The road pick of "Fortify road" (DEC-43, item D; #707; P1 "Ghosts"): the own node whose road is
 * being picked, the roads a click would fortify (a faint ghost of the line lies on each), and the one
 * under the pointer (brighter, with the price).
 */
export interface FortPick {
  readonly node: number;
  readonly edges: readonly number[];
  readonly hover: number | null;
  /** The price as the player reads it ("1.5 CP"). */
  readonly cost: string;
  /** The number of the price alone ("1.5"), drawn beside the CP mark (#858). */
  readonly amount?: string;
}

export interface OverlayState {
  readonly selection: SelectionHit | null;
  readonly ghosts: readonly GhostArrow[];
  readonly preview: MovePreview | null;
  /** The city ringed in the first seconds of a match ("your capital is here"); `null`: none. */
  readonly beacon: number | null;
  /** The terrain map mode (#429): patterns for the ground and a sight sign on the places you see. */
  readonly terrain: boolean;
  /**
   * Where the selected group can be ordered to, as the server answered `reach_query` (DEC-20):
   * `reach` gets a solid ring, `split` (too small for the group: split it first) a dashed one.
   */
  readonly reach: readonly number[];
  readonly split: readonly number[];
  /**
   * The time to the hovered reachable node, drawn as a small label in the middle of the route to
   * it (#432), and the route itself, lit up (#448): the server's travel time of the whole path,
   * plus the delay of a planned order (Shift held). `null`: no label.
   */
  readonly eta: EtaMark | null;
  /** The road pick of a fortification; `null`: not picking. */
  readonly fortPick?: FortPick | null;
  /** What a click under the pointer would pick or aim at (#762); `null`: nothing. */
  readonly hover?: HoverMark | null;
  /** The cues of `X` still on screen (#764), oldest first. */
  readonly undo?: readonly UndoMark[];
  /** The bonus counter over the target of a planned order (#793); `null`: none. */
  readonly bonus?: BonusMark | null;
  /**
   * The own groups selected together (DEC-48, item K1), in the order of the selection: each gets
   * the selection frame and a seal with its place (A1, A2). Empty: no such selection.
   */
  readonly picks?: readonly string[];
  /** A selection box to draw (world units); the scene draws the one being dragged itself. */
  readonly box?: WorldRect | null;
  /** The group order a click would give the selected groups now (DEC-48); `null`: none. */
  readonly group?: GroupPreview | null;
  /** The own city whose rally point is being picked (DEC-48, item K7); `null`: no pick. */
  readonly rallyFrom?: number | null;
}

/** A rectangle of the map in world units: the Shift+drag selection box (DEC-48, item K1). */
export interface WorldRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/**
 * The group order a click on `to` would give (DEC-48, item K4): a preview line from each member's
 * node (no path: the server gives it with the `ack`), one seal over the target (B1) with the price
 * of `ruleset_public` beside it; with `E` held (`planned`) a hatched planned ribbon each (D2).
 */
export interface GroupPreview {
  /** The node each member stands in (a member on a road has no line). */
  readonly from: readonly number[];
  readonly to: number;
  readonly planned: boolean;
  /** As the owner of the target reads now (the server decides at application, item B2). */
  readonly kind: 'rally' | 'attack';
  /** The price as the number of the CP mark ("2"). */
  readonly price: string;
}

/**
 * The bonus a planned order to `node` would ask for (DEC-41, item 10; #793), drawn over
 * the target while Shift is held: the value of the banner and its cap.
 */
export interface BonusMark {
  readonly node: number;
  readonly bonus: number;
  /** The largest bonus now (`PLAN_BONUS.max`, capped by the group's charged units). */
  readonly max: number;
}

export interface EtaMark {
  /** The node the group stands in: the route starts there. */
  readonly from: number;
  readonly node: number;
  readonly ticks: number;
  /** The route the time is for, `ReachNode.path`: the nodes from `from` to `node`, ends included. */
  readonly path: readonly number[];
}

export const EMPTY_OVERLAY: OverlayState = {
  selection: null,
  ghosts: [],
  preview: null,
  beacon: null,
  terrain: false,
  reach: [],
  split: [],
  eta: null,
  fortPick: null,
  hover: null,
  undo: [],
  bonus: null,
  picks: [],
  box: null,
  group: null,
  rallyFrom: null,
};

export interface MapInteraction {
  /** Returns the same object while nothing changed: the scene redraws when it differs. */
  overlay(): OverlayState;
  /** Primary click (not a drag); `null`: empty map. */
  click(hit: PickHit | null, shift: boolean): void;
  /** The pointer moved over `hit`, or left the map (`null`). */
  hover(hit: PickHit | null): void;
  /**
   * A wheel event over the map, before the camera sees it (#793). `true`: it was used (the map
   * does not zoom); absent or `false`: the wheel zooms.
   */
  wheel?(input: WheelInput): boolean;
  /**
   * The groups inside a finished Shift+drag box (DEC-48, item K1), own and the opponent's alike in
   * the order the scene found them (left to right); absent: the map draws no box.
   */
  selectBox?(ids: readonly string[]): void;
}

/** The parts of a `WheelEvent` the map input needs (#793). */
export interface WheelInput {
  readonly deltaX: number;
  readonly deltaY: number;
  /** `WheelEvent.deltaMode`: 0 pixels, 1 lines, 2 pages. */
  readonly deltaMode: number;
  readonly shiftKey: boolean;
}
