/**
 * The softness of the Engraved lines of the map (#865): the owner found the light hairlines on the
 * dark ground too sharp. One place for the knobs every line of the map reads:
 *
 * - `ink`: the ivory of the ink lines of the pieces and marks (helmets, walls, arrows, rings, the
 *   edge of sight): darker and warmer than the token `ENGRAVED.ink` of the interface text;
 * - `line`: a factor of the alpha of the light lines of the map (the border rules and beads, the
 *   cut and the faint area line, the lanes of the roads, the edge of sight);
 * - `hatch`: a factor of the alpha of the hatches (the Border band, the rules of the fog veil, the
 *   hatched arrows and ribbons);
 * - `weight`: the thinnest stroke in device pixels (1 before #865): a little thicker and fainter, a
 *   line shimmers less when the map pans or zooms.
 *
 * The values are "medium" of the four levels compared in #865 (the owner's pick, 2026-11-09). The
 * look of #829 as first merged is `{ ink: ENGRAVED.ink, line: 1, hatch: 1, weight: 1 }`; slight was
 * `0xdcd2bc, 0.86, 0.82, 1.15`, strong `0xbaad92, 0.62, 0.52, 1.5`.
 */

export interface Softness {
  readonly ink: number;
  readonly line: number;
  readonly hatch: number;
  readonly weight: number;
}

/** The softness the map draws with. */
export const SOFT: Softness = { ink: 0xccc0a6, line: 0.74, hatch: 0.66, weight: 1.3 };
