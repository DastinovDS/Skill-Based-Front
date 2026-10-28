import { Texture, TextureSource } from 'pixi.js';
import { SpriteCache, type Baker } from './bake.ts';

/**
 * A baker for tests (no WebGL in jsdom): a texture of the size the real one would have, nothing drawn.
 * `textures` lists every texture made, in order (a test checks that they are all released).
 */
export function fakeBaker(): Baker & { textures: Texture[] } {
  const textures: Texture[] = [];
  return {
    textures,
    flat: true,
    generateTexture({ frame, resolution }) {
      const source = new TextureSource({
        width: frame.width,
        height: frame.height,
        resolution,
      });
      const texture = new Texture({ source });
      textures.push(texture);
      return texture;
    },
  };
}

/** A sprite cache that bakes nothing real: what the views need to be built in a test. */
export function testSprites(): SpriteCache {
  return new SpriteCache(fakeBaker());
}
