/**
 * Geometry and numbers of the overcrowding warning (a pulsing amber ring and a small countdown
 * badge, UI round 2) and of the ring around the own capital at the start (ui-style 12 and U4). Pure: `alertView.ts` only draws them. The countdown itself comes from the
 * server (`NodeView.attrition_in`, `grace_left`); nothing is decided here.
 */

/** The countdown badge of an overcrowded city: this tall, with this much room round its text. */
export const BADGE = { height: 17, radius: 8.5, padX: 7, markRadius: 6, gap: 3 } as const;

/**
 * The ring that warns of overcrowding: this far outside the capacity ring, pulsing to `grow` times
 * its radius (as the beacon does); the grace after a capture is a calm, thin ring.
 */
export const OVERFLOW_RING = {
  gap: 9,
  width: 3,
  outerWidth: 1.5,
  grow: 0.1,
  graceWidth: 2,
} as const;

/** The badge counter-scales with the camera so it stays readable zoomed out, within these bounds. */
export const BADGE_SCALE = { min: 0.7, max: 2.2 } as const;

/** The ring around the capital pulses between 1 and `grow` times its base radius. */
export const BEACON = { gap: 12, width: 3, grow: 0.18, periodMs: 800, outerWidth: 1.5 } as const;

/** The scale of a badge at camera scale `camera`: constant on screen within the bounds. */
export function badgeScale(camera: number): number {
  const wanted = camera > 0 ? 1 / camera : BADGE_SCALE.max;
  return Math.min(BADGE_SCALE.max, Math.max(BADGE_SCALE.min, wanted));
}

/** The pulse of the beacon ring at `nowMs`: 0..1 (a constant 0 for "less motion"). */
export function beaconPulse(nowMs: number, reduced: boolean): number {
  if (reduced) return 0;
  const phase = (nowMs % BEACON.periodMs) / BEACON.periodMs;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);
}
