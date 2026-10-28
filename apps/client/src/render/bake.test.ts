import { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MAX_BAKED, SpriteCache, type BakeSpec } from './bake.ts';
import { fakeBaker } from './testSprites.ts';

const spec = (key: string, size = 10): BakeSpec => ({
  key,
  box: { x: -size / 2, y: -size / 2, width: size, height: size },
  draw(into: Container) {
    into.addChild(new Graphics().circle(0, 0, size / 2).fill(0xffffff));
  },
});

function setup() {
  const baker = fakeBaker();
  const cache = new SpriteCache(baker);
  return { baker, cache };
}

describe('SpriteCache', () => {
  it('bakes a texture once per key and shares it between sprites', () => {
    const { baker, cache } = setup();
    const a = cache.sprite(spec('a'));
    const b = cache.sprite(spec('a'));
    cache.sprite(spec('b'));
    expect(baker.textures).toHaveLength(2);
    expect(a.texture).toBe(b.texture);
    expect(cache.size).toBe(2);
    cache.destroy();
  });

  it('puts the origin of the shape at the position of the sprite, and sizes the sprite in world units', () => {
    const { cache } = setup();
    const sprite = cache.sprite({ ...spec('s', 20), box: { x: -4, y: -6, width: 20, height: 20 } });
    expect(sprite.anchor.x).toBeCloseTo(4 / 20);
    expect(sprite.anchor.y).toBeCloseTo(6 / 20);
    expect(sprite.width).toBeCloseTo(20);
    expect(sprite.height).toBeCloseTo(20);
    cache.destroy();
  });

  it('does not bake again for the same key and swaps the texture for another one', () => {
    const { baker, cache } = setup();
    const sprite = cache.sprite(spec('a'));
    sprite.set(spec('a'));
    expect(baker.textures).toHaveLength(1);
    const before = sprite.texture;
    sprite.set(spec('b'));
    expect(sprite.texture).not.toBe(before);
    expect(baker.textures).toHaveLength(2);
    cache.destroy();
  });

  it('keeps the textures of sprites that show them and drops the unused ones past the bound', () => {
    const { baker, cache } = setup();
    const kept = cache.sprite(spec('kept'));
    for (let i = 0; i < MAX_BAKED + 50; i++) cache.sprite(spec(`k${String(i)}`)).set(null);
    expect(cache.size).toBeLessThanOrEqual(MAX_BAKED);
    // What a sprite shows is never dropped.
    expect(kept.texture.destroyed).toBe(false);
    expect(baker.textures.length).toBeGreaterThan(MAX_BAKED);
    cache.endFrame();
    cache.endFrame();
    cache.destroy();
  });

  it('destroys a dropped texture one frame later, so a frame being drawn keeps its texture', () => {
    const { baker, cache } = setup();
    const sprite = cache.sprite(spec('a'));
    cache.setResolution(2);
    const old = baker.textures[0];
    expect(old?.destroyed).toBe(false);
    cache.endFrame();
    expect(old?.destroyed).toBe(false);
    cache.endFrame();
    expect(old?.destroyed).toBe(true);
    // The sprite got the new texture right away.
    expect(sprite.texture).toBe(baker.textures[1]);
    cache.destroy();
  });

  it('re-bakes what is shown at the new resolution and nothing else', () => {
    const { baker, cache } = setup();
    cache.sprite(spec('a', 10));
    const held = cache.sprite(spec('b', 10));
    held.set(null);
    cache.setResolution(4);
    // Only the shape on show is baked again; `b` is let go of.
    expect(baker.textures).toHaveLength(3);
    expect(cache.size).toBe(1);
    expect(baker.textures[2]?.source.resolution).toBe(4);
    cache.destroy();
  });

  it('releases every texture when destroyed, with the sprites already gone or still alive', () => {
    const { baker, cache } = setup();
    const gone = cache.sprite(spec('a'));
    cache.sprite(spec('b'));
    gone.destroy();
    cache.destroy();
    expect(cache.size).toBe(0);
    expect(baker.textures.every((texture) => texture.destroyed)).toBe(true);
  });

  it('counts the memory of the textures', () => {
    const { cache } = setup();
    cache.sprite(spec('a', 10));
    expect(cache.bytes).toBe(10 * 10 * 4);
    cache.destroy();
  });
});
