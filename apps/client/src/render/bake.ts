import { Container, FillGradient, Rectangle, Sprite, type Texture } from 'pixi.js';
import { shadeEnds } from './shading.ts';

/**
 * What a baked shape is: a `key` that tells it apart from every other (look, size, owner, state:
 * the same key is the same texture), the `box` of the sprite around the origin of the shape in world
 * units, and `draw`, which puts the shape into a scratch container (only called when the key is
 * not in the cache yet). The origin of the drawing is the position of the sprite.
 */
export interface BakeSpec {
  readonly key: string;
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  draw(into: Container, tools: BakeTools): void;
}

/** What `draw` may use besides Graphics. */
export interface BakeTools {
  /** The gradient of a colour (BL1: lighter at the top, darker at the bottom), made once and kept by the cache. */
  gradient(color: number): FillGradient | number;
}

/** What turns a scratch container into a texture: `renderer.generateTexture` (a fake one in tests). */
export interface Baker {
  /** No canvas to make gradients with (a test in jsdom): fills are flat, in the colour of the top. */
  readonly flat?: boolean;
  generateTexture(options: {
    target: Container;
    frame: Rectangle;
    resolution: number;
    antialias: boolean;
  }): Texture;
}

interface Entry {
  texture: Texture;
  /** Sprites showing this texture now. */
  users: number;
}

/** Textures kept beyond this many are dropped, the ones nobody shows first. */
export const MAX_BAKED = 384;

/**
 * Shapes of the map baked into textures (BL1, #347): a city, a token, a plate costs one sprite
 * instead of its vector geometry, and carries a gradient and a soft shadow that vectors cannot
 * draw cheaply. A texture is made once per key by `renderer.generateTexture`, shared by every
 * sprite with that key and released here: `destroy()` frees them all (AGENTS.md 7.2).
 *
 * The number of keys is bounded by the looks themselves (kinds, radii, capacity classes, sides),
 * not by the match; on top of that textures nobody shows are dropped past `MAX_BAKED`. A texture is
 * baked at `resolution` texture pixels per world unit (the zoom of the camera, rounded up to a
 * power of two like the text); `setResolution` re-bakes what is on the map when it changes.
 */
export class SpriteCache implements BakeTools {
  private readonly gradients = new Map<number, FillGradient>();
  private readonly entries = new Map<string, Entry>();
  private readonly sprites = new Set<BakedSprite>();
  private current = 1;
  /**
   * Textures let go this frame and the last: a sprite batched in a frame still being drawn must not
   * lose its texture, so a texture is destroyed one `endFrame` after it was dropped.
   */
  private retired: Texture[] = [];
  private dying: Texture[] = [];
  /** Textures made since the start (a test and the performance check read it). */
  baked = 0;

  constructor(private readonly baker: Baker) {}

  get resolution(): number {
    return this.current;
  }

  /** The number of textures held now. */
  get size(): number {
    return this.entries.size;
  }

  /** Texture memory held now, in bytes (RGBA). */
  get bytes(): number {
    let sum = 0;
    for (const { texture } of this.entries.values()) {
      sum += Math.ceil(texture.source.pixelWidth) * Math.ceil(texture.source.pixelHeight) * 4;
    }
    return sum;
  }

  /** A sprite that shows baked shapes (put it into a container; `destroy()` also lets go of its texture). */
  sprite(spec: BakeSpec | null = null): BakedSprite {
    const sprite = new BakedSprite(this);
    if (spec !== null) sprite.set(spec);
    return sprite;
  }

  /** The pixel density of the textures; the sprites on the map get the new ones at once. */
  setResolution(resolution: number): void {
    if (resolution === this.current || resolution <= 0) return;
    this.current = resolution;
    const keep = new Map<BakedSprite, BakeSpec>();
    for (const sprite of this.sprites) {
      const spec = sprite.spec;
      if (spec !== null) keep.set(sprite, spec);
    }
    for (const sprite of keep.keys()) sprite.release();
    this.dropAll();
    for (const [sprite, spec] of keep) sprite.set(spec);
  }

  /** Called once per frame (after the views have updated): destroys what was dropped a frame ago. */
  endFrame(): void {
    for (const texture of this.dying) texture.destroy(true);
    this.dying = this.retired;
    this.retired = [];
  }

  destroy(): void {
    for (const sprite of [...this.sprites]) sprite.release();
    this.sprites.clear();
    this.dropAll();
    for (const texture of [...this.dying, ...this.retired]) texture.destroy(true);
    this.dying = [];
    this.retired = [];
    for (const fill of this.gradients.values()) fill.destroy();
    this.gradients.clear();
  }

  /** @internal Takes a texture for `spec` (baked now if it is new) and counts a user of it. */
  acquire(spec: BakeSpec): Texture {
    let entry = this.entries.get(spec.key);
    if (entry === undefined) {
      entry = { texture: this.bake(spec), users: 0 };
      this.entries.set(spec.key, entry);
      this.trim();
    } else {
      // Most recently used last: the map keeps the order of insertion.
      this.entries.delete(spec.key);
      this.entries.set(spec.key, entry);
    }
    entry.users++;
    return entry.texture;
  }

  /** @internal */
  letGo(key: string): void {
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.users > 0) entry.users--;
  }

  /** @internal */
  register(sprite: BakedSprite, on: boolean): void {
    if (on) this.sprites.add(sprite);
    else this.sprites.delete(sprite);
  }

  gradient(color: number): FillGradient | number {
    if (this.baker.flat === true) return shadeEnds(color).top;
    let fill = this.gradients.get(color);
    if (fill === undefined) {
      const { top, bottom } = shadeEnds(color);
      fill = new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        colorStops: [
          { offset: 0, color: top },
          { offset: 1, color: bottom },
        ],
        textureSpace: 'local',
      });
      this.gradients.set(color, fill);
    }
    return fill;
  }

  private bake(spec: BakeSpec): Texture {
    const scratch = new Container();
    spec.draw(scratch, this);
    const { x, y, width, height } = spec.box;
    const texture = this.baker.generateTexture({
      target: scratch,
      frame: new Rectangle(x, y, width, height),
      resolution: this.current,
      antialias: true,
    });
    scratch.destroy({ children: true });
    this.baked++;
    return texture;
  }

  /** Drops the textures nobody shows, the oldest first, until the cache is within `MAX_BAKED`. */
  private trim(): void {
    if (this.entries.size <= MAX_BAKED) return;
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= MAX_BAKED) return;
      if (entry.users > 0) continue;
      this.retired.push(entry.texture);
      this.entries.delete(key);
    }
  }

  private dropAll(): void {
    for (const { texture } of this.entries.values()) this.retired.push(texture);
    this.entries.clear();
  }
}

/**
 * A sprite showing one baked shape; `set` swaps the shape (a no-op for the same key). The sprite is
 * positioned at the origin of the shape. Destroying it lets go of the texture, which stays in the
 * cache for the next sprite with the same key.
 */
export class BakedSprite extends Sprite {
  spec: BakeSpec | null = null;

  constructor(private readonly cache: SpriteCache) {
    super();
    cache.register(this, true);
  }

  /** Shows `spec` (`null`: nothing; the caller hides the sprite: its `visible` is not touched here). */
  set(spec: BakeSpec | null): void {
    if (spec === null) {
      this.release();
      return;
    }
    if (this.spec?.key === spec.key && !this.texture.destroyed) return;
    // Take the new texture before letting go of the old one: the same key twice must not drop it.
    const texture = this.cache.acquire(spec);
    this.release();
    this.spec = spec;
    this.texture = texture;
    const { x, y, width, height } = spec.box;
    this.anchor.set(-x / width, -y / height);
  }

  /** Lets go of the texture (it stays cached). */
  release(): void {
    if (this.spec !== null) this.cache.letGo(this.spec.key);
    this.spec = null;
  }

  override destroy(options?: Parameters<Sprite['destroy']>[0]): void {
    this.release();
    this.cache.register(this, false);
    // A Sprite leaves its texture alone unless asked: the cache owns it, so it is never asked.
    super.destroy(options);
  }
}
