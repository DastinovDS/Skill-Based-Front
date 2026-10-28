import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BakedSprite } from './bake.ts';
import { chargeLevel } from './layout.ts';
import { EntityKit, Token } from './shapes.ts';
import { ENEMY, UNIT_SIDES, YOU } from './style.ts';
import { testSprites } from './testSprites.ts';

// A group triangle is baked shapes (U1, #347): the back with its shadow (and the casing of an icon
// in a city), the charge fill scaled from the tip by the level, the outline with its rim, the shield.

describe('Token, the group triangle as baked sprites', () => {
  let kit: EntityKit;
  let token: Token;
  const sprites = (): {
    back: BakedSprite;
    level: BakedSprite;
    outline: BakedSprite;
    shield: BakedSprite;
  } => {
    const [back, level, outline, , , shield] = token.view.children as BakedSprite[];
    if (
      back === undefined ||
      level === undefined ||
      outline === undefined ||
      shield === undefined
    ) {
      throw new Error('a token is made of sprites');
    }
    return { back, level, outline, shield };
  };

  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
    kit = new EntityKit(0, testSprites());
    token = new Token(kit, 1);
  });
  afterEach(() => {
    token.view.destroy({ children: true });
    kit.destroy();
    vi.restoreAllMocks();
  });

  it('fills the triangle from the tip by the share of charged units, scaling one sprite', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 1 } });
    const { level } = sprites();
    expect(level.visible).toBe(true);
    expect(level.scale.x).toBeCloseTo(chargeLevel(4, 1));
    expect(level.spec?.key).toBe(`tri-level:${String(UNIT_SIDES[1])}:${String(YOU)}`);
    // A change of the numbers swaps nothing in the textures: the same shape, another scale.
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 3 } });
    expect(level.spec?.key).toBe(`tri-level:${String(UNIT_SIDES[1])}:${String(YOU)}`);
    expect(level.scale.x).toBeCloseTo(chargeLevel(4, 3));
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 0 } });
    expect(level.visible).toBe(false);
  });

  it('tells the owner by the outline shape too: own, the opponent with an inner outline, unknown dashed', () => {
    const side = String(UNIT_SIDES[1]);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 1 } });
    expect(sprites().outline.spec?.key).toBe(`tri-front:${side}:own:${String(YOU)}`);
    token.set({ owner: 1, modes: ['attack'], counts: { units: 4, charged: 1 } });
    expect(sprites().outline.spec?.key).toBe(`tri-front:${side}:enemy:${String(ENEMY)}`);
    token.set({ owner: 1, modes: ['attack'], counts: null });
    expect(sprites().outline.spec?.key).toBe(`tri-front:${side}:dashed:${String(ENEMY)}`);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 1 }, ghost: true });
    expect(sprites().outline.spec?.key).toBe(`tri-front:${side}:dashed:${String(YOU)}`);
  });

  it('takes the size of the triangle from the number of units, and the casing only inside a city', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 2, charged: 1 } });
    expect(sprites().back.spec?.key).toBe(`tri-back:${String(UNIT_SIDES[0])}:`);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 20, charged: 1 }, inside: true });
    expect(sprites().back.spec?.key).toBe(`tri-back:${String(UNIT_SIDES[3])}:i`);
    expect(token.side).toBe(UNIT_SIDES[3]);
  });

  it('shows the shield of "Defense" as a sprite of its own', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 3, charged: 3 } });
    expect(sprites().shield.visible).toBe(false);
    token.set({ owner: 0, modes: ['defense'], counts: { units: 3, charged: 3 } });
    expect(sprites().shield.visible).toBe(true);
    expect(sprites().shield.spec?.key).toBe(`shield:${String(YOU)}:`);
    token.set({ owner: 1, modes: ['defense'], counts: { units: 3, charged: 3 } });
    expect(sprites().shield.spec?.key).toBe(`shield:${String(ENEMY)}:e`);
  });
});
