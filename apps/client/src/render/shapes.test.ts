import { CanvasTextMetrics, type Container, type Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BakedSprite } from './bake.ts';
import { TWEEN_MS } from './tween.ts';
import { EntityKit, Token, helmetWidth } from './shapes.ts';
import { helmet } from '../units/helmet.ts';
import { ENEMY, UNIT_SIDES, UNIT_TICKS, YOU } from './style.ts';
import { testSprites } from './testSprites.ts';
import { createLayers } from './layers.ts';
import { DEFAULT_UNIT_STYLE, setUnitStyle } from '../units/unitStyle.ts';

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
    const [body, , shield] = token.view.children as BakedSprite[];
    const [back, level, ticks, outline] = (body?.children ?? []) as BakedSprite[];
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
    setUnitStyle('triangle', null);
    kit = new EntityKit(0, testSprites());
    token = new Token(kit, 1);
  });
  afterEach(() => {
    token.view.destroy({ children: true });
    kit.destroy();
    vi.restoreAllMocks();
    setUnitStyle(DEFAULT_UNIT_STYLE, null);
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

// The helmet (#784, variant Full of #775): the same three baked sprites, the fill shown from the
// bottom by a crop of its frame, the opponent's body flipped, the number in the middle of the dome.
describe('Token, the helmet as baked sprites', () => {
  let kit: EntityKit;
  let token: Token;
  const parts = (): {
    body: Container;
    back: BakedSprite;
    level: BakedSprite;
    ticks: BakedSprite;
    outline: BakedSprite;
    question: Text;
    shield: BakedSprite;
    label: Container;
  } => {
    const [body, question, shield, label] = token.view.children;
    const [back, level, ticks, outline] = (body?.children ?? []) as BakedSprite[];
    if (
      body === undefined ||
      back === undefined ||
      level === undefined ||
      ticks === undefined ||
      outline === undefined
    ) {
      throw new Error('a token is made of sprites');
    }
    return {
      body,
      back,
      level,
      ticks,
      outline,
      question: question as Text,
      shield: shield as BakedSprite,
      label: label as Container,
    };
  };
  /** The share of the dome the fill shows now. */
  const shown = (): number => {
    const { level } = parts();
    const h = helmet('own', helmetWidth(UNIT_SIDES[1], false));
    return (level.texture.frame.height - 1) / (h.domeBottom - h.domeTop);
  };

  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
    setUnitStyle('helmet', null);
    kit = new EntityKit(0, testSprites());
    token = new Token(kit, 1);
  });
  afterEach(() => {
    token.view.destroy({ children: true });
    kit.destroy();
    vi.restoreAllMocks();
    setUnitStyle(DEFAULT_UNIT_STYLE, null);
  });

  it('fills the dome from the bottom by the share of charged units: a crop of one baked fill', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 1 } });
    const { level } = parts();
    const width = String(helmetWidth(UNIT_SIDES[1], false));
    expect(level.visible).toBe(true);
    expect(level.spec?.key).toBe(`hel-level:own:${width}:${String(YOU)}`);
    expect(level.scale.x).toBe(1);
    // The height reads the share, as the triangle's does (#508): 1 of 4 is a quarter of the dome.
    expect(shown()).toBeCloseTo(0.25);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 3 } });
    kit.advance(TWEEN_MS);
    expect(level.spec?.key).toBe(`hel-level:own:${width}:${String(YOU)}`);
    expect(shown()).toBeCloseTo(0.75);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 0 } });
    kit.advance(TWEEN_MS);
    expect(level.visible).toBe(false);
  });

  it('eases the fill to a new level without a new texture (#508)', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 4 } });
    const baked = kit.sprites.baked;
    expect(shown()).toBeCloseTo(1);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 1 } });
    expect(shown()).toBeCloseTo(1);
    kit.advance(TWEEN_MS / 4);
    const mid = shown();
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.25);
    kit.advance(TWEEN_MS);
    expect(shown()).toBeCloseTo(0.25);
    expect(kit.sprites.baked).toBe(baked);
  });

  it('has no dividers: the fill edge is smooth', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 2 } });
    expect(parts().ticks.visible).toBe(false);
  });

  it('tells the owner by the shape and the facing: own Rim to the right, the opponent Cut to the left', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 1 } });
    expect(parts().body.scale.x).toBe(1);
    expect(parts().back.spec?.key).toContain('hel-back:own:');
    token.set({ owner: 1, modes: ['attack'], counts: { units: 4, charged: 1 } });
    expect(parts().body.scale.x).toBe(-1);
    expect(parts().back.spec?.key).toContain('hel-back:enemy:');
    expect(parts().outline.spec?.key).toContain(':solid');
    token.set({ owner: 1, modes: ['attack'], counts: null });
    expect(parts().outline.spec?.key).toContain(':dashed');
    expect(parts().question.visible).toBe(true);
  });

  it('puts the one number, all the units, in the middle of the dome, on a road and in a city', () => {
    for (const inside of [false, true]) {
      token.set({ owner: 0, modes: ['attack'], counts: { units: 5, charged: 3 }, inside });
      token.setLabel(true);
      const { label } = parts();
      const count = label.children[1] as Text;
      expect(count.text).toBe('5');
      const h = helmet('own', helmetWidth(UNIT_SIDES[1], inside));
      expect(label.position.y).toBeCloseTo(h.middle.y);
      // No pill: the number is not a chip under the helmet.
      expect(label.position.y).toBeLessThan(token.bottom);
    }
  });

  it('keeps the strap in a city: the icon in a city is the same helmet, a little smaller, with a casing', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 5, charged: 3 }, inside: true });
    const key = parts().back.spec?.key ?? '';
    expect(key).toContain(`:${String(helmetWidth(UNIT_SIDES[1], true))}:`);
    expect(key.endsWith(':i')).toBe(true);
    const h = helmet('own', helmetWidth(UNIT_SIDES[1], true));
    expect(token.bottom).toBeGreaterThan(h.domeBottom);
  });

  it('keeps the top right corner free: the shield of "Defense" goes to the top left (#776)', () => {
    token.set({ owner: 0, modes: ['defense'], counts: { units: 3, charged: 3 } });
    const { shield } = parts();
    expect(shield.visible).toBe(true);
    expect(shield.position.x).toBeLessThan(0);
  });

  it('draws again in the other look when the viewer switches it', () => {
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 2 } });
    expect(parts().back.spec?.key).toContain('hel-back');
    setUnitStyle('triangle', null);
    token.set({ owner: 0, modes: ['attack'], counts: { units: 4, charged: 2 } });
    expect(parts().back.spec?.key).toContain('tri-back');
    expect(parts().body.scale.x).toBe(1);
    expect(parts().level.scale.x).toBeCloseTo(0.5);
  });
});

describe('Token, the badges over the outlines (#797)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('draws its badges through the badge layer, above the overlay, its token still their parent', () => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
    const layers = createLayers();
    const kit = new EntityKit(0, testSprites(), layers.badges);
    const token = new Token(kit, 1);
    layers.layer.groups.addChild(token.view);
    token.set({
      owner: 0,
      modes: ['attack'],
      counts: { units: 3, charged: 3 },
      inside: true,
      badges: [{ dir: 'down', count: 1 }],
    });
    expect(token.badgeKeys).toHaveLength(1);
    const [attached] = layers.badges.renderLayerChildren;
    expect(layers.badges.renderLayerChildren).toHaveLength(1);
    // The badges follow the token (position, scale, fade) and are drawn after the intents.
    expect(attached?.parent).toBe(token.view);
    const order = layers.world.children;
    expect(order.indexOf(layers.badges)).toBeGreaterThan(order.indexOf(layers.layer.intents));
    // A token that goes takes its badges out of the layer.
    token.view.destroy({ children: true });
    expect(layers.badges.renderLayerChildren).toHaveLength(0);
    kit.destroy();
    layers.world.destroy({ children: true });
  });
});
