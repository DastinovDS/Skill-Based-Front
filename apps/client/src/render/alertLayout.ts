/**
 * Geometry and numbers of the overcrowding pill and of the ring around the own capital at the start
 * (ui-style 12 and U4). Pure: `alertView.ts` only draws them. The countdown itself comes from the
 * server (`NodeView.attrition_in`, `grace_left`); nothing is decided here.
 */

/** The pill is as wide as this many world units at camera scale 1, and this tall. */
export const PILL = {
  width: 76,
  height: 20,
  radius: 10,
  gap: 6,
  arcRadius: 7,
  arcWidth: 3,
} as const;

/** The pill counter-scales with the camera so it stays readable zoomed out, within these bounds. */
export const PILL_SCALE = { min: 0.7, max: 2.2 } as const;

/** The ring around the capital pulses between 1 and `grow` times its base radius. */
export const BEACON = { gap: 12, width: 3, grow: 0.18, periodMs: 800, outerWidth: 1.5 } as const;

/** How full the countdown arc is, 0..1: it fills as the unit's turn comes (`left` of `total` ticks). */
export function arcFill(left: number, total: number): number {
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - left / total));
}

/** The scale of a pill at camera scale `camera`: constant on screen within the bounds. */
export function pillScale(camera: number): number {
  const wanted = camera > 0 ? 1 / camera : PILL_SCALE.max;
  return Math.min(PILL_SCALE.max, Math.max(PILL_SCALE.min, wanted));
}

/** The pulse of the beacon ring at `nowMs`: 0..1 (a constant 0 for "less motion"). */
export function beaconPulse(nowMs: number, reduced: boolean): number {
  if (reduced) return 0;
  const phase = (nowMs % BEACON.periodMs) / BEACON.periodMs;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
}
