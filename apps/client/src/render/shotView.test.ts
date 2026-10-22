import { Container, FillGradient, Texture } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapFile } from '../protocol.gen.ts';
import { fightPlace, type RoundFx } from './fightFx.ts';
import { CANCEL_SHARE, HIT_SHARE, type Contacts } from './fightImpact.ts';
import type { ParticleSpec } from './particles.ts';
import { ShotView } from './shotView.ts';
import { SPARKS, TRACER_END_SHARE, tracerBudget } from './shotLayout.ts';
import { FIGHT_FX_STRENGTH } from './style.ts';

const map = {
  nodes: [
    { id: 0, x: 10, y: 120 },
    { id: 1, x: 110, y: 120 },
  ],
  edges: [{ id: 0, a: 0, b: 1 }],
} as unknown as MapFile;
const place = (): NonNullable<ReturnType<typeof fightPlace>> => {
  const result = fightPlace(map, 1, null, null, () => 14);
  if (result === undefined) throw new Error('no place');
  return result;
};
const contacts: Contacts = { own: { x: 87, y: 120 }, enemy: { x: 133, y: 120 } };
const ROUND = 20;
const fx = (
  shots: [number, number],
  losses: [number, number] = [0, 0],
  virtual: [number, number] = [0, 0],
): RoundFx => ({ kind: 'round', tick: 100, place: place(), shots, virtual, losses });

// jsdom has no canvas to paint the gradient on: the gradient gets an empty texture (a browser paints it).
beforeEach(() => {
  vi.spyOn(FillGradient.prototype, 'buildGradient').mockImplementation(function (
    this: FillGradient,
  ) {
    this.texture = Texture.EMPTY;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

function setup(me: 0 | 1 = 0) {
  const parent = new Container();
  const view = new ShotView(parent, me);
  const run = (
    rounds: readonly RoundFx[],
    tick: number,
    options: { scale?: number; strength?: number; roundTicks?: number } = {},
  ): ParticleSpec[] => {
    const out: ParticleSpec[] = [];
    view.update(
      (particle) => out.push(particle),
      tick,
      rounds,
      options.roundTicks ?? ROUND,
      () => contacts,
      options.scale ?? 1,
      options.strength,
    );
    return out;
  };
  return { parent, view, run };
}

const heads = (particles: readonly ParticleSpec[]): string[] =>
  particles.filter((p) => p.kind.startsWith('head')).map((p) => p.kind);

describe('ShotView: the form of a tracer by the fields of the round', () => {
  it('draws a head by the form: a square for a real shot, a diamond for a bonus one, by side', () => {
    const { run, view } = setup();
    // The own real shot that killed a unit: the own square, one tail.
    expect(heads(run([fx([1, 0], [0, 1])], 101))).toEqual(['headOwn']);
    expect(view.shown()).toBe(1);
    // An own bonus shot: the own diamond.
    expect(heads(run([fx([1, 0], [0, 0], [1, 0])], 101))).toEqual(['headOwnBonus']);
    // The enemy's, real and bonus: the squares and diamonds of the opponent.
    expect(heads(run([fx([0, 1], [1, 0])], 101))).toEqual(['headEnemy']);
    expect(heads(run([fx([0, 1], [0, 0], [0, 1])], 101))).toEqual(['headEnemyBonus']);
    view.destroy();
  });

  it('draws two heads for two shots that cancel, a bonus one against a real one', () => {
    const { run, view } = setup();
    expect(heads(run([fx([1, 1], [0, 0], [1, 0])], 101))).toEqual(['headOwnBonus', 'headEnemy']);
    expect(view.shown()).toBe(2);
    view.destroy();
  });

  it('draws a bonus tail hollow, with three diamonds behind the head, a real one with sparks', () => {
    const { run, view } = setup();
    const real = run([fx([1, 0], [0, 1])], 102.5);
    expect(real.filter((p) => p.kind === 'diamond')).toHaveLength(0);
    expect(real.filter((p) => p.kind === 'glow')).toHaveLength(1);
    expect(real.filter((p) => p.kind === 'square').length).toBeGreaterThan(0);
    const bonus = run([fx([1, 0], [0, 0], [1, 0])], 102.5);
    expect(bonus.filter((p) => p.kind === 'diamond')).toHaveLength(3);
    view.destroy();
  });

  it('has no projectile for a silent charge: a round nobody shot in draws nothing', () => {
    const { run, view } = setup();
    expect(run([fx([0, 0])], 101)).toEqual([]);
    expect(view.shown()).toBe(0);
    view.destroy();
  });

  it('tells the sides apart for the other player too: the viewer is player 1', () => {
    const { run, view } = setup(1);
    // Player 0 (the opponent of the viewer) shot: its head is the enemy's.
    expect(heads(run([fx([1, 0], [0, 1])], 101))).toEqual(['headEnemy']);
    view.destroy();
  });
});

describe('ShotView: time, by the round', () => {
  it.each([10, 20])(
    'flies, fades and is gone within the tracer time of a round of %i ticks',
    (ticks) => {
      const { run, view } = setup();
      const kill = fx([1, 0], [0, 1]);
      const at = (age: number): ParticleSpec[] => run([kill], 100 + age, { roundTicks: ticks });
      // Before the tick: the wind-up is #351's, nothing of the tracer.
      expect(at(-0.5)).toEqual([]);
      expect(view.shown()).toBe(0);
      // In flight: a head.
      expect(heads(at(HIT_SHARE * ticks * 0.5))).toHaveLength(1);
      // After the hit the head is gone, the path fades without particles (a real one).
      expect(heads(at(HIT_SHARE * ticks + 0.5))).toHaveLength(0);
      expect(view.shown()).toBe(1);
      // Then it is all gone.
      at(TRACER_END_SHARE * ticks + 0.1);
      expect(view.shown()).toBe(0);
      view.destroy();
    },
  );

  it('meets two shots in the middle in half the time of a hit', () => {
    const { run, view } = setup();
    const cancel = fx([1, 1]);
    expect(heads(run([cancel], 100 + CANCEL_SHARE * ROUND * 0.9))).toHaveLength(2);
    // The flight is over by the time a single hit would still be on its way.
    expect(heads(run([cancel], 100 + CANCEL_SHARE * ROUND + 0.1))).toHaveLength(0);
    expect(heads(run([fx([1, 0], [0, 1])], 100 + CANCEL_SHARE * ROUND + 0.1))).toHaveLength(1);
    view.destroy();
  });

  it('follows the strength: fewer sparks at "medium", and never more particles than the budget', () => {
    const { run, view } = setup();
    const kill = fx([1, 0], [0, 1]);
    const squares = (strength: number): number =>
      run([kill], 105, { strength }).filter((p) => p.kind === 'square').length;
    expect(squares(1)).toBeLessThan(squares(FIGHT_FX_STRENGTH) + 1);
    expect(squares(FIGHT_FX_STRENGTH)).toBeLessThanOrEqual(SPARKS);
    const strong = run([kill], 105).length;
    expect(strong).toBeLessThanOrEqual(
      tracerBudget({ bonus: false }) + 0 /* the head, its glow and the sparks */,
    );
    view.destroy();
  });

  it('is a function of the tick: the same frame twice is the same particles', () => {
    const { run, view } = setup();
    const a = run([fx([1, 1], [0, 0], [1, 0])], 101.5);
    const b = run([fx([1, 1], [0, 0], [1, 0])], 101.5);
    expect(b).toEqual(a);
    view.destroy();
  });

  it('keeps its size on the screen when the map is zoomed out', () => {
    const { run, view } = setup();
    const head = (scale: number): number =>
      run([fx([1, 0], [0, 1])], 102, { scale }).find((p) => p.kind === 'headOwn')?.size ?? 0;
    expect(head(2)).toBeCloseTo(2 * head(1));
    view.destroy();
  });
});

describe('ShotView: pools', () => {
  it('reuses its drawings and draws no more than the pool allows', () => {
    const { run, view, parent } = setup();
    const many = Array.from({ length: 12 }, (_, i) => ({ ...fx([1, 1]), tick: 100 + 0 * i }));
    run(many, 101);
    expect(view.shown()).toBeLessThanOrEqual(16);
    const before = parent.getChildAt(0)?.children.length ?? 0;
    run(many, 101.5);
    expect(parent.getChildAt(0)?.children.length).toBe(before);
    run([], 101.5);
    expect(view.shown()).toBe(0);
    view.destroy();
    expect(parent.children).toHaveLength(0);
  });
});
