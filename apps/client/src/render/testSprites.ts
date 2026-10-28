import { Texture, TextureSource } from 'pixi.js';
import { SpriteCache, type Baker } from './bake.ts';

/**
 * A baker for tests (no WebGL in jsdom): a texture of the size the real one would have, nothing drawn.
 * `made` lists the frames baked, in order.
 */
export function fakeBaker(): Baker & { made: { width: number; height: number }[] } {
  const made: { width: number; height: number }[] = [];
  return {
    made,
    flat: true,
    generateTexture({ frame, resolution }) {
      made.push({ width: frame.width, height: frame.height });
      const source = new TextureSource({
        width: frame.width,
        height: frame.height,
        resolution,
      });
      return new Texture({ source });
    },
  };
}

/** A sprite cache that bakes nothing real: what the views need to be built in a test. */
export function testSprites(): SpriteCache {
  return new SpriteCache(fakeBaker());
}
