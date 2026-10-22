/**
 * What a round of a fight does on the map, E3 "Expressive" at strength "Stronger" (ui-style 27.3,
 * 29.1; #351): the wind-up before the round, the hit (a flash, a ring, sparks, shards of a unit that
 * died), two shots that cancel, a charge that stays silent, the ring of the contact, and where on the
 * map all this stands.
 *
 * Pure functions, no PixiJS objects and no DOM. Nothing decides what happened: every effect is a
 * function of the fields the server sent (`fight_round`: shots, virtual shots, losses;
 * `FightView`: the charged, the bonus stock, the silent charges, `next_round_tick`), and of the tick.
 * Every duration is a share of a round (`combat.round_ticks`), never fixed seconds; with the round
 * of 20 ticks at 10 Hz the shares are the seconds of ui-style 29.1: the wind-up 0.35 s before the
 * tick, the hit 0.6 s after it (0.3 s when two shots meet), the burst up to 1.0 s after the hit,
 * "-N" 1.0 s, all over at 1.6 s, and the next wind-up from 1.65 s.
 *
 * The shot itself (the tracer between the wind-up and the hit) is #352's: the hit lands after the
 * time its flight will take, so that the tracer fills the gap without a change here.
 */
import type { MapFile, PlayerId } from '../protocol.gen.ts';
import type { Point } from './camera.ts';
import type { FightPlace, RoundFx } from './fightFx.ts';
import { lighten, roundEffect } from './fightFx.ts';
import { edgeEnds } from './layout.ts';
import { burst, ray, type Emit } from './particles.ts';
import { FIGHT_FX_STRENGTH, FIGHT_GAP, FLASH_COLOR, PAPER, WARN } from './style.ts';

/** The two sides of a fight, as everywhere in the fight view: the viewing player and the opponent. */
export type Side = 'own' | 'enemy';

// --- Time ---------------------------------------------------------------------------------------------

/** The wind-up before the tick of a round: 0.35 s of a 2 s round. */
export const WIND_SHARE = 0.175;
/** A shot that hits lands this share of a round after the tick (0.6 s of 2 s; the flight of a tracer, #352). */
export const HIT_SHARE = 0.3;
/** Two shots that meet in the middle do it after half of that (0.3 s). */
export const CANCEL_SHARE = 0.15;
/** The burst of a hit (flash, ring, sparks, shards) lasts this share after the hit (1.0 s). */
export const IMPACT_SHARE = 0.5;
/** The "-N" over a group that lost units stays this share after the hit (1.0 s). */
export const NUMBER_SHARE = 0.5;
/** The dim ring of a silent charge: from the tick, this share of a round (0.9 s). */
export const SILENT_SHARE = 0.45;
/** The ring of a contact grows over this share of a round (0.6 s). */
export const CONTACT_SHARE = 0.3;
/** The caption "silent" of the first round stays this share of a round. */
export const CAPTION_SHARE = 0.45;
/** The effects of a round are all over this share after its tick (1.6 s of 2 s). */
export const ROUND_END_SHARE = HIT_SHARE + IMPACT_SHARE;
/** The wind-up of the next round starts this share after the tick (1.65 s of 2 s). */
export const NEXT_WIND_SHARE = 1 - WIND_SHARE;

// --- What a round did ---------------------------------------------------------------------------------

/** A hit that killed a unit, one that put a charge out, or two shots that met (nobody hit). */
export type ImpactKind = 'kill' | 'discharge' | 'cancel';

export interface Impact {
  readonly kind: ImpactKind;
  /** Who shot; `null` for two shots that cancel. */
  readonly shooter: Side | null;
  /** Who was hit; `null` for two shots that cancel. */
  readonly victim: Side | null;
  /** Only bonus (virtual) shots made it: drawn dashed and with hollow diamonds (ui-style 21). */
  readonly bonus: boolean;
  /** The same for the shot of each side (two shots that cancel can differ: a bonus one against a real one). */
  readonly bonusBy: Readonly<Record<Side, boolean>>;
  /** Units the victim lost in the round (`-N`). */
  readonly losses: number;
  /** When it lands, a share of a round after the tick. */
  readonly at: number;
}

/**
 * What a `fight_round` did, by its fields: both sides shot, the shots cancel (one impact in the
 * middle); one side shot, the other lost a unit (a kill) or a charge went out (a discharge). A
 * side counts as bonus when all its shots of the round were virtual (as the arrow of the arena).
 */
export function impactsOf(fx: RoundFx, me: PlayerId): Impact[] {
  const enemy: PlayerId = me === 0 ? 1 : 0;
  const shot = (player: PlayerId): boolean => fx.shots[player] > 0;
  const bonus = (player: PlayerId): boolean =>
    shot(player) && fx.virtual[player] >= fx.shots[player];
  if (shot(me) && shot(enemy)) {
    return [
      {
        kind: 'cancel',
        shooter: null,
        victim: null,
        bonus: bonus(me) && bonus(enemy),
        bonusBy: { own: bonus(me), enemy: bonus(enemy) },
        losses: 0,
        at: CANCEL_SHARE,
      },
    ];
  }
  const out: Impact[] = [];
  for (const [shooter, player] of [
    ['own', me],
    ['enemy', enemy],
  ] as const) {
    if (!shot(player)) continue;
    const victimPlayer = player === me ? enemy : me;
    const losses = fx.losses[victimPlayer];
    out.push({
      kind: losses > 0 ? 'kill' : 'discharge',
      shooter,
      victim: shooter === 'own' ? 'enemy' : 'own',
      bonus: bonus(player),
      bonusBy: {
        own: shooter === 'own' && bonus(player),
        enemy: shooter === 'enemy' && bonus(player),
      },
      losses,
      at: HIT_SHARE,
    });
  }
  return out;
}

/** Differs the bursts and the sparks of rounds and fights standing side by side; the same on every frame of a round. */
export function fxSeed(fx: RoundFx): number {
  return (fx.tick * 7 + (fx.place.node ?? 100 + (fx.place.edge ?? 0))) % 997;
}

/** Progress 0..1 of a share-long effect that starts `from` (a share of a round) after the tick `age` ticks ago. */
export function sinceShare(
  age: number,
  from: number,
  share: number,
  roundTicks: number,
): number | null {
  return roundEffect(age - from * Math.max(1, roundTicks), share, roundTicks);
}

/** Progress of the burst of an impact. */
export function burstProgress(age: number, impact: Impact, roundTicks: number): number | null {
  return sinceShare(age, impact.at, IMPACT_SHARE, roundTicks);
}

/** Progress of the "-N" of an impact (a kill only). */
export function numberProgress(age: number, impact: Impact, roundTicks: number): number | null {
  if (impact.kind !== 'kill') return null;
  return sinceShare(age, impact.at, NUMBER_SHARE, roundTicks);
}

/**
 * The wind-up before a round: 0..1 over the last `WIND_SHARE` of the round before `next_round_tick`.
 * `null` outside of it. The round is not known yet, so the wind-up shows who is armed, not who shoots.
 */
export function windProgress(
  nextRoundTick: number,
  tick: number,
  roundTicks: number,
): number | null {
  const length = Math.max(1, roundTicks) * WIND_SHARE;
  const left = nextRoundTick - tick;
  if (left < 0 || left > length || length <= 0) return null;
  return 1 - left / length;
}

/** A side can fire in the coming round: it has a charge that is not silent, or a bonus shot left (view fields). */
export function armed(side: {
  readonly charged: number;
  readonly mute: number;
  readonly bonus: number;
}): boolean {
  return side.charged - side.mute > 0 || side.bonus > 0;
}

/** Progress of the dim ring of a silent charge (DEC-24, F2), from the tick of a round. */
export function silentProgress(age: number, roundTicks: number): number | null {
  return roundEffect(age, SILENT_SHARE, roundTicks);
}

/** Progress of the ring of a contact, `age` ticks after the start of a fight. */
export function contactProgress(age: number, roundTicks: number): number | null {
  return roundEffect(age, CONTACT_SHARE, roundTicks);
}

/** Is `tick` in the first round of a fight that started at `startTick` (the caption "silent" is for it)? */
export function inFirstRound(startTick: number, tick: number, roundTicks: number): boolean {
  return tick - startTick <= Math.max(1, roundTicks);
}

// --- Where on the map ---------------------------------------------------------------------------------

/** Where the two sides of a fight stand on the map: the tokens of their groups. */
export interface Contacts {
  readonly own: Point;
  readonly enemy: Point;
}

/** Closer than this the two tokens would sit one on the other (the effects need two places). */
const MIN_APART = 16;

/**
 * The places of the two sides of a fight. The tokens drawn by the entity view tell it (`known`):
 * an own group's token and an enemy marker of the city or a figure on the road. What is not known is
 * the mirror of the one that is across the place of the fight, or, with none, two places
 * `FIGHT_GAP` apart along the road (a fight on a road) or across the city (a fight in a city).
 */
export function contactPoints(
  map: MapFile,
  place: FightPlace,
  known: { readonly own?: Point | undefined; readonly enemy?: Point | undefined },
  gap: number = FIGHT_GAP,
): Contacts {
  let axis: Point = { x: 1, y: 0 };
  if (place.edge !== null) {
    const ends = edgeEnds(map, place.edge);
    if (ends !== undefined) {
      const length = Math.hypot(ends.b.x - ends.a.x, ends.b.y - ends.a.y) || 1;
      axis = { x: (ends.b.x - ends.a.x) / length, y: (ends.b.y - ends.a.y) / length };
    }
  }
  const at = place.at;
  const mirror = (p: Point): Point => ({ x: 2 * at.x - p.x, y: 2 * at.y - p.y });
  const half: Point = { x: (axis.x * gap) / 2, y: (axis.y * gap) / 2 };
  let own = known.own;
  let enemy = known.enemy;
  if (own === undefined && enemy === undefined) {
    own = { x: at.x - half.x, y: at.y - half.y };
    enemy = { x: at.x + half.x, y: at.y + half.y };
  } else if (own === undefined && enemy !== undefined) {
    own =
      Math.hypot(enemy.x - at.x, enemy.y - at.y) < MIN_APART
        ? { x: at.x - half.x, y: at.y - half.y }
        : mirror(enemy);
  } else if (enemy === undefined && own !== undefined) {
    enemy =
      Math.hypot(own.x - at.x, own.y - at.y) < MIN_APART
        ? { x: at.x + half.x, y: at.y + half.y }
        : mirror(own);
  }
  if (own === undefined || enemy === undefined) throw new Error('both contacts are set');
  const apart = Math.hypot(enemy.x - own.x, enemy.y - own.y);
  if (apart < MIN_APART) {
    // Two tokens on one spot: push them along the axis so that the two sides can be told apart.
    return {
      own: { x: own.x - axis.x * (MIN_APART / 2), y: own.y - axis.y * (MIN_APART / 2) },
      enemy: { x: enemy.x + axis.x * (MIN_APART / 2), y: enemy.y + axis.y * (MIN_APART / 2) },
    };
  }
  return { own, enemy };
}

// --- The particles of an impact -------------------------------------------------------------------------

export interface ImpactLook {
  /** Where the victim stands, and the shooter; `mid` for a cancel. */
  readonly contacts: Contacts;
  readonly colors: { readonly own: number; readonly enemy: number };
  /** Size of everything on the map: 1 at 100%, more when the map is zoomed out (the effects keep their size on screen). */
  readonly scale: number;
  /** Strength of the effects (`FIGHT_FX_STRENGTH`). */
  readonly strength?: number;
  /** Differs the bursts of fights standing side by side. */
  readonly seed: number;
}

/** Number of particles an impact has at the start of its burst: the sparks and the shards (tests, the frame budget). */
export function particleBudget(impact: Impact, strength: number = FIGHT_FX_STRENGTH): number {
  const k = strength;
  switch (impact.kind) {
    case 'kill':
      // A flash and a ring, the sparks and the shards.
      return 2 + Math.round(5 * k) + Math.round(5 * k);
    case 'discharge':
      return 2 + Math.round(9 * k);
    case 'cancel':
      // A flash, a ring, the cross, eight rays and the sparks.
      return 3 + 8 + Math.round(6 * k);
  }
}

const ease = (p: number): number => 1 - (1 - p) * (1 - p);

/**
 * The particles of the burst of one impact at progress `u` (0..1 of `IMPACT_SHARE`): a ring (dashed,
 * if bonus), a flash, sparks (■, or hollow ◇ for a bonus shot) and, for a kill, shards ▽ in the
 * colour of the side that lost the unit; two shots that meet draw ✕, rays of both colours and sparks.
 */
export function impactParticles(emit: Emit, impact: Impact, u: number, look: ImpactLook): void {
  if (u < 0 || u >= 1) return;
  const k = look.strength ?? FIGHT_FX_STRENGTH;
  const s = look.scale;
  const { contacts, colors } = look;
  if (impact.kind === 'cancel') {
    const m = {
      x: (contacts.own.x + contacts.enemy.x) / 2,
      y: (contacts.own.y + contacts.enemy.y) / 2,
    };
    const sparkKind = impact.bonus ? 'diamond' : 'square';
    if (u < 0.5) {
      const p = u / 0.5;
      emit({
        kind: impact.bonus ? 'dashRing' : 'ring',
        x: m.x,
        y: m.y,
        size: 2 * (4 + (20 + 8 * k) * ease(p)) * s,
        color: FLASH_COLOR,
        alpha: 1 - p,
      });
      // Rays: one half in the colour of each side, so both are seen to go out.
      const r0 = 4 + 5 * ease(p);
      const r1 = 10 + 22 * k * ease(p);
      for (const [side, offset] of [
        ['own', 0],
        ['enemy', 1],
      ] as const) {
        for (let j = 0; j < 4; j++) {
          const angle = ((j * 2 + offset) * 2 * Math.PI) / 8 + 0.2;
          emit(ray(m, angle, r0 * s, r1 * s, 2.4 * s, colors[side], 1 - p));
        }
      }
    }
    if (u < 0.3) {
      const p = u / 0.3;
      emit({
        kind: 'glow',
        x: m.x,
        y: m.y,
        size: 2 * (8 + 8 * k) * 1.3 * s,
        color: FLASH_COLOR,
        alpha: 0.8 * (1 - p) * (1 - p),
        add: true,
      });
    }
    if (u > 0.05 && u < 0.75) {
      // The cross: two shots, nobody hit.
      emit({
        kind: 'cross',
        x: m.x,
        y: m.y,
        size: 15 * s,
        color: FLASH_COLOR,
        alpha: 0.8 * (1 - u / 0.75),
      });
    }
    burst(emit, {
      x: m.x,
      y: m.y,
      p: u / 0.6,
      count: Math.round(6 * k),
      speed: 30 * (0.6 + 0.4 * k) * s,
      colors: [FLASH_COLOR, colors.own, colors.enemy],
      size: (impact.bonus ? 9 : 6) * s,
      kind: sparkKind,
      add: true,
      seed: look.seed + 4,
    });
    return;
  }
  const victim = impact.victim ?? 'enemy';
  const shooter = impact.shooter ?? 'own';
  const at = contacts[victim];
  const from = contacts[shooter];
  const shotAngle = Math.atan2(at.y - from.y, at.x - from.x);
  const shooterColor = colors[shooter];
  const victimColor = colors[victim];
  if (u < 0.5) {
    const p = u / 0.5;
    emit({
      kind: impact.bonus ? 'dashRing' : 'ring',
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
      size: 2 * (8 + 8 * k) * 1.3 * s * (1 - 0.4 * p),
      color: FLASH_COLOR,
      alpha: (impact.bonus ? 0.55 : 0.8) * (1 - p) * (1 - p),
      add: true,
    });
  }
  burst(emit, {
    x: at.x,
    y: at.y,
    p: u / 0.8,
    count: impact.kind === 'kill' ? Math.round(5 * k) : Math.round(9 * k),
    speed: 50 * (0.6 + 0.4 * k) * s,
    cone: [shotAngle, 2.6],
    colors: [FLASH_COLOR, shooterColor],
    size: (impact.bonus ? 9.5 : 6.4) * s,
    kind: impact.bonus ? 'diamond' : 'square',
    add: true,
    seed: look.seed + 1,
  });
  if (impact.kind === 'kill') {
    burst(emit, {
      x: at.x,
      y: at.y,
      p: u / 0.95,
      count: Math.round(5 * k),
      speed: 48 * s,
      cone: [shotAngle, 3.4],
      fall: 36 * s,
      colors: [victimColor, lighten(victimColor, 0.35)],
      size: 13 * s,
      kind: 'triangle',
      spin: 6.6,
      seed: look.seed + 2,
    });
  }
}

/** The wind-up of a side that is armed: a glow growing on its group and a ring closing in on it. */
export function windParticles(
  emit: Emit,
  at: Point,
  color: number,
  w: number,
  scale: number,
  strength: number = FIGHT_FX_STRENGTH,
): void {
  emit({
    kind: 'glow',
    x: at.x,
    y: at.y,
    size: 2 * 1.4 * (9 + 9 * w * strength) * scale,
    color,
    alpha: 0.55 * w,
    add: true,
  });
  emit({ kind: 'ring', x: at.x, y: at.y, size: 2 * (25 - 10 * w) * scale, color, alpha: 0.7 * w });
}

/** The dim dashed ring of a silent charge at the tick of a round: no flash, no shot. */
export function silentParticle(emit: Emit, at: Point, q: number, scale: number): void {
  emit({
    kind: 'dashRing',
    x: at.x,
    y: at.y,
    size: 2 * (17 + 8 * q) * scale,
    color: WARN,
    alpha: 0.55 * (1 - q),
  });
}

/** The ring that marks the contact of two groups at the start of a fight. */
export function contactParticle(emit: Emit, at: Point, q: number, scale: number): void {
  emit({
    kind: 'ring',
    x: at.x,
    y: at.y,
    size: 2 * (10 + 30 * q) * scale,
    color: PAPER,
    alpha: 0.9 * (1 - q),
  });
}
