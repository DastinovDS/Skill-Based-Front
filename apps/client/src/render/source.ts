import type { EventMsg } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';

/**
 * What the renderer draws, asked every frame. The match controller (CLI-06) serves it from a
 * `SnapshotBuffer` and the event stream; the dev screen serves fixtures.
 */
export interface RenderSource {
  /** The frame to draw now; `null` until the first snapshot. */
  frame(): RenderFrame | null;
  /**
   * Events received so far (fight marks use the recent ones). Return the same array while
   * nothing new arrived: the renderer rebuilds its marks when the array or its length changes.
   */
  events(): readonly EventMsg[];
}
