import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { FightPlace, RoundFx } from './fightFx.ts';
import { PARRY } from './parryLayout.ts';
import { ParryView } from './parryView.ts';
import { testSprites } from './testSprites.ts';

const place: FightPlace = { node: 1, edge: null, at: { x: 100, y: 100 }, ring: 20 };
const contacts = { own: { x: 40, y: 100 }, enemy: { x: 100, y: 100 } };
const round = (
  shots: [number, number],
  losses: [number, number],
  virtual: [number, number] = [0, 0],
): RoundFx => ({ kind: 'round', tick: 100, place, shots, virtual, losses, burned: [0, 0] });

function setup() {
  const parent = new Container();
  const view = new ParryView(parent, 0, testSprites());
  const run = (tick: number, rounds: RoundFx[], reduced = false): void => {
    view.update(tick, rounds, 20, () => contacts, 1, 0.5, reduced);
  };
  return { parent, view, run };
}

describe('ParryView (#856)', () => {
  it('draws a round while it plays and nothing after it', () => {
    const { view, run } = setup();
    const fx = [round([1, 1], [0, 0])];
    run(101, fx);
    expect(view.drawing()).toBe(true);
    run(100 + (PARRY.meet + PARRY.fx) * 20 + 0.5, fx);
    expect(view.drawing()).toBe(false);
    view.destroy();
  });

  it('puts an octagram on a bonus shot, and drops the unit a hit cost', () => {
    const { view, run } = setup();
    const fx = [round([1, 0], [0, 1], [1, 0])];
    run(101, fx);
    expect(view.bonusHeads()).toBe(1);
    run(100 + (PARRY.hit + 0.05) * 20, fx);
    expect(view.bonusHeads()).toBe(0);
    expect(view.dropping()).toBe(1);
    view.destroy();
  });

  it('draws nothing with less motion', () => {
    const { view, run } = setup();
    run(101, [round([1, 0], [0, 1], [1, 0])], true);
    expect(view.drawing()).toBe(false);
    expect(view.bonusHeads()).toBe(0);
    view.destroy();
  });

  it('reuses its objects: the pools do not grow frame after frame', () => {
    const { parent, view, run } = setup();
    const count = (node: Container): number =>
      1 + node.children.reduce((sum, child) => sum + count(child), 0);
    const fx = [round([1, 0], [0, 1], [1, 0])];
    for (let tick = 100; tick < 112; tick++) run(tick, fx);
    const warm = count(parent);
    for (let tick = 100; tick < 112; tick++) run(tick, fx);
    expect(count(parent)).toBe(warm);
    view.destroy();
  });
});
