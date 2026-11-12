import type { EventMsg, PlayerId } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { RenderRules } from './renderRules.ts';

/**
 * What the renderer draws, asked every frame. The match controller (CLI-06) serves it from a
 * `SnapshotBuffer` and the event stream; the dev screen serves fixtures; the replay its file.
 */
export interface RenderSource {
  /**
   * The rule numbers the map draws with (ARC-C02): `renderRules(ruleset_public)` for a match and
   * the dev screen, the file header for a replay; `NO_RENDER_RULES` before they are known.
   */
  readonly rules: RenderRules;
  /**
   * Dev scenes only (#819): the owners of the nodes just before the first snapshot, so that a frozen
   * scene shows the capture of the nodes whose owner differs as under way.
   */
  readonly floodFrom?: readonly (PlayerId | null)[];
  /** Dev scenes only: the captures under way stay this old (ms), to be looked at frame by frame. */
  readonly floodHoldMs?: number;
  /** The frame to draw now; `null` until the first snapshot. */
  frame(): RenderFrame | null;
  /**
   * Events received so far (fight marks use the recent ones). Return the same array while
   * nothing new arrived: the renderer rebuilds its marks when the array or its length changes.
   */
  events(): readonly EventMsg[];
}
