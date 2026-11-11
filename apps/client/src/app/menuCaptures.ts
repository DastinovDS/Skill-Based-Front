/**
 * The captures behind the screens before a match (#866): a loop of captures of cities and
 * provinces on the menu map, drawn as the match draws a capture (#856, #857: the winner at the
 * gate, a short Parry fight, the walk in, the engraved front revealing the new owner's Border band,
 * the ring of the owner's colour and the flag). Decoration on a fixed script: nothing here is the
 * game.
 *
 * The script is cyclic: every node a capture takes is taken back later in the loop, so the owners
 * at the end of a period are the owners at its start (`MenuWorld.owners`). Each capture runs on
 * its own clock, `(g - at) mod period`, so the loop has no seam: a capture never restarts and the
 * territory never jumps.
 *
 * Pure functions of the clock, like the rest of the motion (`menuMotion.ts`).
 */
import { cityLight, floodLook, type CityLight, type FloodLook } from '../render/captureLayout.ts';
import { FLAG_MS, flagLook } from '../render/effectsLayout.ts';
import { WALK } from '../render/walkLayout.ts';
import { DURATION, easeTravel } from '../theme/tokens.ts';

/** `by` takes `node`; its group walks in from the neighbour `from`, which `by` holds then. */
interface Capture {
  readonly node: number;
  readonly from: number;
  readonly by: 0 | 1;
  /** Seconds into the loop when the group sets out. */
  readonly at: number;
}

export interface CaptureScript {
  /** The length of the loop, seconds. */
  readonly period: number;
  readonly captures: readonly Capture[];
}

/**
 * The timeline of one capture, seconds after it sets out: the group walks to the gate of the city
 * (`approach`), the garrison shows meanwhile (`guard`); two rounds of `round` (the first two shots
 * glance off each other, the second lands); the winner walks in `WALK.after` after the last shot
 * landed, in `DURATION.captureWalk`; the flood starts as it crosses the ring (`WALK.cross`), the
 * owner changes then; the winner stands in the city, then goes in (`settle`).
 */
export const CAPTURE_TIMES = {
  approach: 2.2,
  guard: [1.1, 1.7],
  round: 1.2,
  /** In a round, when the shot leaves and when it lands. */
  shot: [0.35, 0.95],
  /** The beaten garrison fades out over this after the hit. */
  fall: 0.45,
  settle: [6, 6.8],
} as const;

/** The fight: two rounds after the approach. */
const FIGHT_START = CAPTURE_TIMES.approach;
/** The last shot lands. */
export const LAST_SHOT = FIGHT_START + CAPTURE_TIMES.round + CAPTURE_TIMES.shot[1];
/** The winner leaves the gate. */
export const WALK_START = LAST_SHOT + WALK.after;
const WALK_LENGTH = DURATION.captureWalk / 1000;
/** The flood starts and the node changes hands (the winner crosses the ring). */
export const FLIP = WALK_START + WALK.cross * WALK_LENGTH;
/** The whole capture, from setting out to the last trace of it. */
export const CAPTURE_LENGTH = Math.max(CAPTURE_TIMES.settle[1], FLIP + FLAG_MS / 1000);

const mod = (v: number, m: number): number => ((v % m) + m) % m;

let frozenAt: number | null = null;

/**
 * The dev scenes freeze the picture at `seconds` of its clock (`/?menu=<id>&bt=<s>`: the frames of
 * a capture, the seam of the loop); `null` lets it run.
 */
export function freezeBackdrop(seconds: number | null): void {
  frozenAt = seconds;
}

/** The moment the picture is frozen at, or null. */
export function backdropFrozenAt(): number | null {
  return frozenAt;
}

/** The owners at `g` seconds of the loop: `base` with the captures that have flipped by then. */
export function ownersAt(
  base: readonly (0 | 1 | null)[],
  script: CaptureScript,
  g: number,
): (0 | 1 | null)[] {
  const now = mod(g, script.period);
  const owners = [...base];
  // Per node the latest flip at or before now, else the latest of the loop (it wraps round).
  const latest = new Map<number, { readonly at: number; readonly by: 0 | 1 }>();
  const last = new Map<number, { readonly at: number; readonly by: 0 | 1 }>();
  for (const capture of script.captures) {
    const at = mod(capture.at + FLIP, script.period);
    const flip = { at, by: capture.by };
    const seen = latest.get(capture.node);
    if (at <= now && (seen === undefined || at > seen.at)) latest.set(capture.node, flip);
    const wrap = last.get(capture.node);
    if (wrap === undefined || at > wrap.at) last.set(capture.node, flip);
  }
  for (const [node, flip] of last) owners[node] = (latest.get(node) ?? flip).by;
  return owners;
}

/** Every node a capture of `script` takes: their owner changes, the supply and the drills keep off. */
export function capturedNodes(script: CaptureScript): number[] {
  return [...new Set(script.captures.map((c) => c.node))].sort((a, b) => a - b);
}

/** A capture under way: `u` seconds since it set out. */
export interface CaptureMoment {
  readonly capture: Capture;
  readonly u: number;
}

/** The captures under way at `g`, by their place in the script. */
export function capturesAt(script: CaptureScript, g: number): CaptureMoment[] {
  const out: CaptureMoment[] = [];
  for (const capture of script.captures) {
    const u = mod(g - capture.at, script.period);
    if (u < CAPTURE_LENGTH) out.push({ capture, u });
  }
  return out;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** What a capture shows at `u` seconds: each part `null` when it is not on. */
export interface CaptureLook {
  /** The attacker on its way from `from` to the gate (0..1, eased), its alpha. */
  readonly approach: { readonly share: number; readonly alpha: number } | null;
  /** The garrison in the city: its alpha and how much of it is charged. */
  readonly guard: { readonly alpha: number; readonly share: number } | null;
  /** The fight: the round (0, 1) and the seconds into it. */
  readonly round: { readonly index: number; readonly u: number } | null;
  /** The winner from the gate (0) to the middle (1), its alpha. */
  readonly walk: { readonly share: number; readonly alpha: number } | null;
  /** The flood of the area (`floodLook` of the match), from the moment the owner changes. */
  readonly flood: FloodLook | null;
  /** The ring leaving the city (`cityLight` of the match). */
  readonly ring: CityLight | null;
  /** The flag over the city: its alpha. */
  readonly flag: number | null;
}

/** The look of a capture `u` seconds after it set out; `calm`: the opponent's (half strength). */
export function captureLook(u: number, calm: boolean, reduced = false): CaptureLook {
  const T = CAPTURE_TIMES;
  const flipMs = (u - FLIP) * 1000;
  const approach =
    u < T.approach ? { share: easeTravel(u / T.approach), alpha: clamp01(u / 0.35) } : null;
  const fallFrom = LAST_SHOT;
  const guard =
    u >= T.guard[0] && u < fallFrom + T.fall
      ? {
          alpha:
            clamp01((u - T.guard[0]) / (T.guard[1] - T.guard[0])) *
            (u < fallFrom ? 1 : 1 - clamp01((u - fallFrom) / T.fall)),
          share: u < fallFrom ? 1 : 0,
        }
      : null;
  const fightU = u - FIGHT_START;
  const round =
    fightU >= 0 && u < WALK_START
      ? {
          index: Math.min(1, Math.floor(fightU / T.round)),
          u: fightU - Math.min(1, Math.floor(fightU / T.round)) * T.round,
        }
      : null;
  const walk =
    u >= T.approach && u < T.settle[1]
      ? {
          share: easeTravel((u - WALK_START) / WALK_LENGTH),
          alpha: 1 - clamp01((u - T.settle[0]) / (T.settle[1] - T.settle[0])),
        }
      : null;
  const look = floodLook(flipMs, calm, reduced);
  const flood = flipMs >= 0 && !look.done ? look : null;
  const ring = cityLight(flipMs, calm, reduced);
  const flagT = flipMs / FLAG_MS;
  const flag = flipMs >= 0 && flagT < 1 && !reduced ? flagLook(flagT).alpha : null;
  return { approach, guard, round, walk, flood, ring, flag };
}
