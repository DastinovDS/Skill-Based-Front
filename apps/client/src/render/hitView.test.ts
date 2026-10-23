import { Container, Graphics, Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { interpolateFrame } from '../net/interpolate.ts';
import type { FightView as WireFight, SnapshotMsg } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { fightPlace, type RoundFx } from './fightFx.ts';
import { HitView } from './hitView.ts';
import { contactPoints } from './fightImpact.ts';
import type { ParticleSpec } from './particles.ts';

const map = DEFAULT_MAP;
const radiusOf = (): number => 14;
const ROUND = DEV_RULES.combat.round_ticks;
const city = map.nodes[1]?.id ?? 1;
const place = (): NonNullable<ReturnType<typeof fightPlace>> => {
  const result = fightPlace(map, city, null, null, radiusOf);
  if (result === undefined) throw new Error('no place');
  return result;
};

const fightAt = (patch: Partial<WireFight> = {}): WireFight => ({
  id: 'f',
  node: city,
  edge: null,
  point: null,
  attacker: 1,
  start_tick: 100,
  next_round_tick: 160,
  groups: ['g'],
  enemy_units: 3,
  enemy_charged: 2,
  shots: [0, 0],
  losses: [0, 0],
  virtual_left: [0, 0],
  mute: [0, 0],
  last_round: null,
  ...patch,
});

function frameOf(tick: number, fights: WireFight[]) {
  const base = devSnapshot(map, DEV_RULES, tick);
  const snap: SnapshotMsg = {
    ...base,
    view: {
      ...base.view,
      fights,
      groups: [
        {
          id: 'g',
          units: 4,
          charged: 3,
          mode: 'attack',
          location: { kind: 'node', node: city },
          order: null,
          defense_bonus: null,
          defense_cap: null,
        },
      ],
    },
  };
  return interpolateFrame(snap, null, tick);
}

const round = (
  tick: number,
  shots: [number, number],
  losses: [number, number] = [0, 0],
  virtual: [number, number] = [0, 0],
): RoundFx => ({ kind: 'round', tick, place: place(), shots, virtual, losses });

function setup() {
  const parent = new Container();
  const view = new HitView(parent, map, 0, 1, radiusOf);
  const contacts = contactPoints(map, place(), {});
  const run = (tick: number, fights: WireFight[], rounds: RoundFx[]) => {
    const out: ParticleSpec[] = [];
    const punches = view.update(
      (particle) => out.push(particle),
      frameOf(tick, fights),
      rounds,
      ROUND,
      () => contacts,
      1,
    );
    return { out, punches };
  };
  const visible = <T extends Container>(kind: new (...args: never[]) => T): T[] => {
    const found: T[] = [];
    const walk = (node: Container): void => {
      if (node instanceof kind && node.visible) found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(parent);
    return found;
  };
  return { view, contacts, run, visible };
}

beforeEach(() => {
  setLocale('en');
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('HitView', () => {
  it('draws nothing without a fight or a round', () => {
    const { run, view } = setup();
    expect(run(150, [], []).out).toEqual([]);
    view.destroy();
  });

  it('draws the hit only from its landing: nothing before, a burst at it, nothing at the end', () => {
    const { run, view } = setup();
    const fx = [round(150, [1, 0], [0, 1])];
    // The tick of the round and just before the hit (0.3 of a round): the shot is in the air (#352).
    expect(run(150, [], fx).out).toEqual([]);
    expect(run(150 + 0.3 * ROUND - 0.5, [], fx).out).toEqual([]);
    expect(run(150 + 0.3 * ROUND + 1, [], fx).out.length).toBeGreaterThan(6);
    expect(run(150 + 0.8 * ROUND, [], fx).out).toEqual([]);
    view.destroy();
  });

  it('swells the token that was hit, once, and not a token that was not', () => {
    const { run, contacts, view } = setup();
    const fx = [round(150, [1, 0], [0, 1])];
    const mid = run(150 + 0.3 * ROUND + 0.0625 * ROUND, [], fx).punches;
    expect(mid).toHaveLength(1);
    expect(mid[0]?.at).toEqual(contacts.enemy);
    expect(mid[0]?.scale).toBeGreaterThan(1);
    expect(run(150 + 0.3 * ROUND + 0.2 * ROUND, [], fx).punches).toEqual([]);
    // Two shots that meet hit nobody.
    expect(run(150 + 0.15 * ROUND + 0.06 * ROUND, [], [round(150, [1, 1])]).punches).toEqual([]);
    view.destroy();
  });

  it('winds up for the sides that can fire, in the last 0.175 of the round', () => {
    const { run, view } = setup();
    const fight = fightAt({ next_round_tick: 160, mute: [0, 0], virtual_left: [0, 0] });
    expect(run(160 - 0.175 * ROUND - 1, [fight], []).out.filter((p) => p.kind === 'glow')).toEqual(
      [],
    );
    const wind = run(160 - 1, [fight], []).out.filter((p) => p.kind === 'glow');
    // The own group has charges; the enemy has charged units too (3 units, 2 charged).
    expect(wind).toHaveLength(2);
    // A side with nothing to fire (no charges, no bonus) does not wind up.
    const dry = fightAt({ next_round_tick: 160, enemy_charged: 0 });
    expect(run(160 - 1, [dry], []).out.filter((p) => p.kind === 'glow')).toHaveLength(1);
    view.destroy();
  });

  it('shows a silent charge: a sign on the group while mute > 0, a dim dashed ring at the round, no flash', () => {
    const { run, visible, view } = setup();
    const quiet = fightAt({ mute: [0, 1], next_round_tick: 175 });
    run(152, [quiet], [round(150, [1, 0])]);
    expect(visible(Graphics).filter((g) => g.label === 'silent-sign')).toHaveLength(1);
    const { out } = run(150 + 0.2 * ROUND, [quiet], [round(150, [0, 0], [0, 0])]);
    expect(out.filter((p) => p.kind === 'dashRing')).toHaveLength(1);
    expect(out.filter((p) => p.kind === 'glow')).toEqual([]);
    // Nobody mute: no sign, no dim ring.
    const loud = fightAt({ mute: [0, 0], next_round_tick: 175 });
    const loudRun = run(150 + 0.2 * ROUND, [loud], [round(150, [0, 0])]);
    expect(loudRun.out.filter((p) => p.kind === 'dashRing')).toEqual([]);
    expect(visible(Graphics).filter((g) => g.label === 'silent-sign')).toHaveLength(0);
    view.destroy();
  });

  it('says "silent" in the first round only', () => {
    const { run, visible, view } = setup();
    const quiet = fightAt({ mute: [0, 1], start_tick: 130, next_round_tick: 170 });
    run(152, [quiet], [round(150, [0, 0])]);
    expect(visible(Text).map((t) => t.text)).toEqual(['silent']);
    // A later round: the sign explains itself already.
    const later = fightAt({ mute: [0, 1], start_tick: 100, next_round_tick: 190 });
    run(152, [later], [round(150, [0, 0])]);
    expect(visible(Text)).toEqual([]);
    view.destroy();
  });

  it('rings the contact of a new fight', () => {
    const { run, view } = setup();
    const fresh = fightAt({ start_tick: 150, next_round_tick: 170 });
    expect(run(151, [fresh], []).out.filter((p) => p.kind === 'ring')).toHaveLength(1);
    expect(run(150 + 0.3 * ROUND, [fresh], []).out.filter((p) => p.kind === 'ring')).toHaveLength(
      0,
    );
    view.destroy();
  });

  it('reuses its objects: the pools do not grow frame after frame', () => {
    const { run, view } = setup();
    const quiet = fightAt({ mute: [0, 1], next_round_tick: 175 });
    const count = (node: Container): number =>
      1 + node.children.reduce((sum, child) => sum + count(child), 0);
    run(152, [quiet], [round(150, [0, 0])]);
    const parent = (view as unknown as { layer: Container }).layer;
    const warm = count(parent);
    for (let tick = 150; tick < 180; tick++) run(tick, [quiet], [round(150, [0, 0])]);
    expect(count(parent)).toBe(warm);
    view.destroy();
  });
});
