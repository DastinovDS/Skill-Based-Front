import { CanvasTextMetrics, type Container, type Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BakedSprite } from './bake.ts';
import { TWEEN_MS } from './tween.ts';
import { EntityKit, Token, helmetWidth } from './shapes.ts';
import { helmet } from '../units/helmet.ts';
import { UNIT_SIDES, YOU } from './style.ts';
import { testSprites } from './testSprites.ts';
import { createLayers } from './layers.ts';

// The helmet (#784, variant Full of #775) is three baked sprites (U1, #347): the back with its
// shadow, casing, strap and plate, the charge fill shown from the bottom by a crop of its frame, and
// the light edge of the dome; the opponent's body flipped, the number in the middle of the dome.
describe('Token, the helmet as baked sprites', () => {
  let kit: EntityKit;
  let token: Token;
  const parts = (): {
    body: Container;
    back: BakedSprite;
    level: BakedSprite;
    outline: BakedSprite;
    question: Text;
    label: Container;
  } => {
    const [body, question, label] = token.view.children;
    const [back, level, outline] = (body?.children ?? []) as BakedSprite[];
    if (body === undefined || back === undefined || level === undefined || outline === undefined) {
      throw new Error('a token is made of sprites');
    }
    return {
      body,
      back,
      level,
      outline,
      question: question as Text,
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
    kit = new EntityKit(0, testSprites());
    token = new Token(kit, 1);
  });
  afterEach(() => {
    token.view.destroy({ children: true });
    kit.destroy();
    vi.restoreAllMocks();
  });

  it('fills the dome from the bottom by the share of charged units: a crop of one baked fill', () => {
    token.set({ owner: 0, counts: { units: 4, charged: 1 } });
    const { level } = parts();
    const width = String(helmetWidth(UNIT_SIDES[1], false));
    expect(level.visible).toBe(true);
    expect(level.spec?.key).toBe(`hel-level:own:${width}:${String(YOU)}`);
    expect(level.scale.x).toBe(1);
    // The height reads the share (#508): 1 of 4 is a quarter of the dome.
    expect(shown()).toBeCloseTo(0.25);
    token.set({ owner: 0, counts: { units: 4, charged: 3 } });
    kit.advance(TWEEN_MS);
    expect(level.spec?.key).toBe(`hel-level:own:${width}:${String(YOU)}`);
    expect(shown()).toBeCloseTo(0.75);
    token.set({ owner: 0, counts: { units: 4, charged: 0 } });
    kit.advance(TWEEN_MS);
    expect(level.visible).toBe(false);
  });

  it('eases the fill to a new level without a new texture (#508)', () => {
    token.set({ owner: 0, counts: { units: 4, charged: 4 } });
    const baked = kit.sprites.baked;
    expect(shown()).toBeCloseTo(1);
    token.set({ owner: 0, counts: { units: 4, charged: 1 } });
    // Nothing has moved yet: the drain starts from what was shown.
    expect(shown()).toBeCloseTo(1);
    kit.advance(TWEEN_MS / 4);
    const mid = shown();
    expect(mid).toBeLessThan(1);
    expect(mid).toBeGreaterThan(0.25);
    kit.advance(TWEEN_MS / 4);
    expect(shown()).toBeLessThan(mid);
    kit.advance(TWEEN_MS);
    expect(shown()).toBeCloseTo(0.25);
    expect(kit.sprites.baked).toBe(baked);
  });

  it('retargets mid-flight from the shown value and fills up too', () => {
    token.set({ owner: 0, counts: { units: 4, charged: 0 } });
    token.set({ owner: 0, counts: { units: 4, charged: 4 } });
    kit.advance(100);
    const now = shown();
    expect(now).toBeGreaterThan(0);
    token.set({ owner: 0, counts: { units: 4, charged: 2 } });
    expect(shown()).toBeCloseTo(now);
    kit.advance(TWEEN_MS);
    expect(shown()).toBeCloseTo(0.5);
  });

  it('shows a new token, an unknown one and a ghost at once, with no easing', () => {
    token.set({ owner: 0, counts: { units: 4, charged: 3 } });
    expect(shown()).toBeCloseTo(0.75);
    token.set({ owner: 0, counts: null });
    expect(parts().level.visible).toBe(false);
    token.set({ owner: 0, counts: { units: 4, charged: 2 }, ghost: true });
    expect(shown()).toBeCloseTo(0.5);
  });

  it('drops a token whose view is gone from the easing set', () => {
    token.set({ owner: 0, counts: { units: 4, charged: 4 } });
    token.set({ owner: 0, counts: { units: 4, charged: 1 } });
    token.view.destroy({ children: true });
    expect(() => {
      kit.advance(50);
    }).not.toThrow();
    token = new Token(kit, 1);
  });

  it('has no dividers: the fill edge is smooth, the body is three sprites', () => {
    token.set({ owner: 0, counts: { units: 4, charged: 2 } });
    expect(parts().body.children).toHaveLength(3);
  });

  it('tells the owner by the shape and the facing: own Rim to the right, the opponent Cut to the left', () => {
    token.set({ owner: 0, counts: { units: 4, charged: 1 } });
    expect(parts().body.scale.x).toBe(1);
    expect(parts().back.spec?.key).toContain('hel-back:own:');
    token.set({ owner: 1, counts: { units: 4, charged: 1 } });
    expect(parts().body.scale.x).toBe(-1);
    expect(parts().back.spec?.key).toContain('hel-back:enemy:');
    expect(parts().outline.spec?.key).toContain(':solid');
    token.set({ owner: 1, counts: null });
    expect(parts().outline.spec?.key).toContain(':dashed');
    expect(parts().question.visible).toBe(true);
    token.set({ owner: 0, counts: { units: 4, charged: 1 }, ghost: true });
    expect(parts().outline.spec?.key).toContain(':dashed');
  });

  it('takes the size of the helmet from the number of units, and the casing only inside a city', () => {
    token.set({ owner: 0, counts: { units: 2, charged: 1 } });
    expect(parts().back.spec?.key).toContain(`:${String(helmetWidth(UNIT_SIDES[0], false))}:`);
    expect(parts().back.spec?.key.endsWith(':')).toBe(true);
    token.set({ owner: 0, counts: { units: 20, charged: 1 }, inside: true });
    expect(parts().back.spec?.key).toContain(`:${String(helmetWidth(UNIT_SIDES[3], true))}:`);
    expect(parts().back.spec?.key.endsWith(':i')).toBe(true);
    expect(token.side).toBe(UNIT_SIDES[3]);
  });

  it('puts the one number, all the units, in the middle of the dome, on a road and in a city', () => {
    for (const inside of [false, true]) {
      token.set({ owner: 0, counts: { units: 5, charged: 3 }, inside });
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
    token.set({ owner: 0, counts: { units: 5, charged: 3 }, inside: true });
    const key = parts().back.spec?.key ?? '';
    expect(key).toContain(`:${String(helmetWidth(UNIT_SIDES[1], true))}:`);
    expect(key.endsWith(':i')).toBe(true);
    const h = helmet('own', helmetWidth(UNIT_SIDES[1], true));
    expect(token.bottom).toBeGreaterThan(h.domeBottom);
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
