/**
 * Where things of the map are on the screen, for HTML drawn over it (the radial menus of a city
 * and a group follow their object while the camera moves). Plain data read when needed, never
 * reactive state: the camera changes every frame.
 */

/** A point in client (page) pixels, and the radius of the circle there (a city, a group token). */
export interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface MapAnchors {
  /** The circle of a city; `null`: no such city, or the map is not up yet. */
  node(id: number): Anchor | null;
  /** The token of an own group; `null`: the group is gone or not drawn. */
  group(id: string): Anchor | null;
}

export const NO_ANCHORS: MapAnchors = {
  node: () => null,
  group: () => null,
};
