import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BakedSprite } from './bake.ts';
import { TWEEN_MS } from './tween.ts';
import { EntityKit, Token } from './shapes.ts';
import { ENEMY, UNIT_SIDES, UNIT_TICKS, YOU } from './style.ts';
import { testSprites } from './testSprites.ts';

// A group triangle is baked shapes (U1, #347): the back with its shadow (and the casing of an icon
// in a city), the charge fill scaled from the tip by the level, the outline with its rim, the shield.

describe('Token, the group triangle as baked sprites', () => {
  let kit: EntityKit;
  let token: Token;
  const sprites = (): {
    back: BakedSprite;
    level: BakedSprite;
    ticks: BakedSprite;
    outline: BakedSprite;
    shield: BakedSprite;
  } => {
    const [back, level, ticks, outline, , shield] = token.view.children as BakedSprite[];
    if (
      back === undefined ||
      level === undefined ||
      ticks === undefined ||
      outline === undefined ||
      shield === undefined
    ) {
      throw new Error('a token is made of sprites');
    }
    return { back, level, ticks, outline, shield };
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
    // The height reads the share: 1 of 4 is a quarter of the height (#508).
    expect(level.scale.x).toBeCloseTo(0.25);
    expect(level.spec?.key).toBe(`tri-level:${String(UNIT_SIDES[1])}:${String(YOU)}`);
    // A change of the numbers swaps nothing in the textures: the same shape, another scale.
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 3 } });
    kit.advance(TWEEN_MS);
    expect(level.spec?.key).toBe(`tri-level:${String(UNIT_SIDES[1])}:${String(YOU)}`);
    expect(level.scale.x).toBeCloseTo(0.75);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 0 } });
    kit.advance(TWEEN_MS);
    expect(level.visible).toBe(false);
  });

  it('eases the fill toward a new level, without a new texture, and lands exactly', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 4 } });
    const { level } = sprites();
    const baked = kit.sprites.baked;
    expect(level.scale.x).toBe(1);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 1 } });
    // Nothing has moved yet: the drain starts from what was shown.
    expect(level.scale.x).toBe(1);
    kit.advance(TWEEN_MS / 4);
    expect(level.scale.x).toBeLessThan(1);
    expect(level.scale.x).toBeGreaterThan(0.25);
    const mid = level.scale.x;
    kit.advance(TWEEN_MS / 4);
    expect(level.scale.x).toBeLessThan(mid);
    kit.advance(TWEEN_MS);
    expect(level.scale.x).toBe(0.25);
    expect(kit.sprites.baked).toBe(baked);
  });

  it('retargets mid-flight from the shown value and fills up too', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 0 } });
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 4 } });
    const { level } = sprites();
    kit.advance(100);
    const shown = level.scale.x;
    expect(shown).toBeGreaterThan(0);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 2 } });
    expect(level.scale.x).toBe(shown);
    kit.advance(TWEEN_MS);
    expect(level.scale.x).toBe(0.5);
  });

  it('shows a new token, an unknown one and a ghost at once, with no easing', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 3 } });
    expect(sprites().level.scale.x).toBeCloseTo(0.75);
    token.set({ owner: 0, modes: ['attack'], counts: null });
    expect(sprites().level.visible).toBe(false);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 2 }, ghost: true });
    expect(sprites().level.scale.x).toBeCloseTo(0.5);
  });

  it('drops a token whose view is gone from the easing set', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 4 } });
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 1 } });
    token.view.destroy({ children: true });
    expect(() => {
      kit.advance(50);
    }).not.toThrow();
    token = new Token(kit, 1);
  });

  it('draws dividers between the units of a small group, none for one unit or a big group', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 1 } });
    const { ticks } = sprites();
    expect(ticks.visible).toBe(true);
    expect(ticks.spec?.key).toBe(`tri-ticks:${String(UNIT_SIDES[1])}:4`);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 1, charged: 1 } });
    expect(ticks.visible).toBe(false);
    token.set({ owner: 0, modes: ['attack'], counts: { units: UNIT_TICKS.max + 1, charged: 1 } });
    expect(ticks.visible).toBe(false);
    token.set({ owner: 0, modes: ['attack'], counts: null });
    expect(ticks.visible).toBe(false);
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

  it("has no shield on the icon of the units in a city: the sign is the city's own (#349)", () => {
    token.set({
      owner: 0,
      modes: ['defense'],
      counts: { units: 3, charged: 3 },
      inside: true,
    });
    expect(sprites().shield.visible).toBe(false);
  });
});
