/**
 * The toll of a road fortification as an effect (DEC-43, item D; #707; ui-style 42; K6 "Beam"):
 * an instant bright beam from the ticks of the line to the group, the combat hit on the group (a
 * ring in the lightened colour of the shooter, a white additive flash, square sparks in a cone
 * away from the shooter, the lost charges flung off, the token pops), and "-N" rising. All of it is
 * over `TOLL_MS` after the event; with "less motion" only the number stays, still.
 *
 * Pure functions, no PixiJS and no DOM. Everything is a function of the age of the event in ticks,
 * so a paused or frozen scene shows a toll in the state of its tick (like the fights, `fightImpact.ts`).
 * Nothing here decides anything: the numbers and the places come from the events and the snapshot.
 */
import type { EventMsg, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import { lighten } from './fightFx.ts';
import { burst, ray, type Emit } from './particles.ts';
import { FIGHT_FX_STRENGTH, FLASH_COLOR } from './style.ts';

/** Everything of one toll is over this long after its event, ms. */
export const TOLL_MS = 800;
/** The beam lives this long; the hit lands as it goes. */
export const BEAM_MS = 140;
export const HIT_AT_MS = 100;

/** What the player is told of a toll: which side lost the charges. */
export interface TollInfo {
  readonly tick: number;
  /** The fortified node, the road, and the charges taken. */
  readonly node: number;
  readonly edge: number;
  readonly charges: number;
  /** Own group that paid (`toll_paid`); `null` for a toll the own line took (`toll_taken`). */
  readonly group: string | null;
  /** The viewing player lost the charges (`toll_paid`). */
  readonly paid: boolean;
}

/** A toll event as an effect, or `null` for any other event or a malformed one. */
export function tollInfo(event: EventMsg): TollInfo | null {
  if (event.kind !== 'toll_paid' && event.kind !== 'toll_taken') return null;
  const { node, edge, charges, group } = event.data;
  if (typeof node !== 'number' || typeof edge !== 'number' || typeof charges !== 'number') {
    return null;
  }
  if (charges <= 0) return null;
  const paid = event.kind === 'toll_paid';
  return {
    tick: event.tick,
    node,
    edge,
    charges,
    group: paid && typeof group === 'string' ? group : null,
    paid,
  };
}

const ease = (p: number): number => 1 - (1 - p) * (1 - p);

/** Milliseconds since the event: the age in ticks at `tickHz`; `null` before it and after `TOLL_MS`. */
export function tollMs(age: number, tickHz: number): number | null {
  if (age < 0 || tickHz <= 0) return null;
  const ms = (age * 1000) / tickHz;
  return ms >= TOLL_MS ? null : ms;
}

export interface TollLook {
  /** The line the beam leaves, and the group it hits. */
  readonly from: Point;
  readonly at: Point;
  readonly colors: { readonly own: number; readonly enemy: number };
  /** Who lost the charges: the viewing player (`own`) or the enemy. */
  readonly victim: 'own' | 'enemy';
  readonly charges: number;
  /** The size of everything on the map (more when the map is zoomed out). */
  readonly scale: number;
  readonly seed: number;
  readonly strength?: number;
}

/**
 * The particles of a toll at `ms` since its event: the beam, then the ring, the flash, the sparks
 * and the flung charges at the group.
 */
export function tollParticles(emit: Emit, ms: number, look: TollLook): void {
  const k = look.strength ?? FIGHT_FX_STRENGTH;
  const s = look.scale;
  const shooter = look.victim === 'own' ? 'enemy' : 'own';
  const shooterColor = look.colors[shooter];
  const victimColor = look.colors[look.victim];
  const { from, at } = look;
  const angle = Math.atan2(at.y - from.y, at.x - from.x);
  const length = Math.hypot(at.x - from.x, at.y - from.y);
  if (ms < BEAM_MS && length > 0) {
    // An instant beam: the coloured body and a thin white core, thinning out as it goes.
    const q = ms / BEAM_MS;
    emit({
      ...ray(
        from,
        angle,
        0,
        length,
        4.2 * (1 - 0.6 * q) * s,
        lighten(shooterColor, 0.35),
        0.95 * (1 - q * q),
      ),
    });
    emit({
      ...ray(from, angle, 0, length, 1.5 * (1 - 0.5 * q) * s, FLASH_COLOR, 1 - q * q),
      add: true,
    });
    // A small flash where it leaves the line.
    emit({
      kind: 'glow',
      x: from.x,
      y: from.y,
      size: 2 * 9 * s,
      color: FLASH_COLOR,
      alpha: 0.7 * (1 - q),
      add: true,
    });
  }
  const u = (ms - HIT_AT_MS) / (TOLL_MS - HIT_AT_MS);
  if (u < 0) return;
  if (u < 0.5) {
    const p = u / 0.5;
    emit({
      kind: 'ring',
      x: at.x,
      y: at.y,
      size: 2 * (5 + (20 + 8 * k) * ease(p)) * s,
      color: lighten(shooterColor, 0.5),
      alpha: 1 - p,
    });
  }
  if (u < 0.3) {
    const p = u / 0.3;
    emit({
      kind: 'glow',
      x: at.x,
      y: at.y,
      size: 2 * (8 + 8 * k) * 1.5 * s * (1 - 0.4 * p),
      color: FLASH_COLOR,
      alpha: 0.9 * (1 - p) * (1 - p),
      add: true,
    });
  }
  // Square sparks in a cone away from the shooter.
  burst(emit, {
    x: at.x,
    y: at.y,
    p: u / 0.8,
    count: Math.round(6.5 * k),
    speed: 50 * (0.6 + 0.4 * k) * s,
    cone: [angle, 2.6],
    colors: [FLASH_COLOR, shooterColor],
    size: 6.4 * s,
    kind: 'square',
    add: true,
    seed: look.seed + 1,
  });
  // One square per lost charge flung off in the colour of the loser: no fall, a straight flight.
  burst(emit, {
    x: at.x,
    y: at.y,
    p: u / 0.9,
    count: Math.min(look.charges, 8),
    speed: 44 * s,
    cone: [angle, 1.8],
    colors: [victimColor, lighten(victimColor, 0.35)],
    size: 9 * s,
    kind: 'square',
    spin: 4,
    seed: look.seed + 2,
  });
}

/** How a token swells when the toll hits it: 1 outside, up to `1 + amplitude` at the middle of the pop. */
export function tollPop(ms: number, strength: number = FIGHT_FX_STRENGTH): number {
  const from = HIT_AT_MS;
  const span = 260;
  if (ms < from || ms >= from + span) return 1;
  return 1 + 0.25 * strength * Math.sin((Math.PI * (ms - from)) / span);
}

/** The number "-N": still, then fading over the last third; it rises unless motion is reduced. */
export function tollNumber(
  ms: number,
  reduced: boolean,
  rise: number,
): { alpha: number; lift: number } | null {
  if (ms < HIT_AT_MS) return reduced ? { alpha: 1, lift: 0 } : null;
  const t = (ms - HIT_AT_MS) / (TOLL_MS - HIT_AT_MS);
  const fade = 0.7;
  return {
    alpha: t <= fade ? 1 : Math.max(0, 1 - (t - fade) / (1 - fade)),
    lift: reduced ? 0 : rise * ease(Math.min(1, t * 1.6)),
  };
}

/** A different burst for tolls on different roads. */
export function tollSeed(info: TollInfo): number {
  return (info.edge * 31 + info.node * 7 + info.tick) % 997;
}

/** Whose toll is it: the player that lost the charges. */
export function victimOf(info: TollInfo, me: PlayerId): PlayerId {
  return info.paid ? me : me === 0 ? 1 : 0;
}
