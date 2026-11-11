import { Container, RenderLayer } from 'pixi.js';

/**
 * Layer names from bottom to top (AGENTS.md §7.2). The groups and the intents lie ABOVE the fog
 * (layers Sl2 «Over the haze», ui-style 27; the groups since #419): a ribbon is public (DEC-04) and
 * must not dim, and neither must the own group that marches along a road into a hidden city
 * (DEC-10: it sees its own edge, which lies in the veil of the hidden end). That is safe: the
 * server sends an enemy figure only where it is seen, and the memory ghosts of the fog are drawn in
 * the fog layer itself. `tolls` (the toll of a road fortification, #707) has a layer of its own above the
 * effects, above everything.
 *
 * `badges` (#797) holds no children of its own: it is a `RenderLayer` that draws the advantage and
 * disadvantage badges of the unit tokens (#791) over the selection and hover outlines of `intents`,
 * while each badge keeps its token as its parent (position, scale, fade and visibility come from it).
 */
export const LAYER_ORDER = [
  'background',
  'territory',
  'roads',
  'forts',
  'nodes',
  'fog',
  'groups',
  'intents',
  'badges',
  'effects',
  'tolls',
] as const;

type LayerName = (typeof LAYER_ORDER)[number];

/**
 * The world container (moved and scaled by the camera) with one child container per layer.
 * Layers stay empty until their issue fills them: groups and intents (CLI-04, #60), fog (CLI-05,
 * #61), effects.
 */
export interface MapLayers {
  readonly world: Container;
  readonly layer: Readonly<Record<LayerName, Container>>;
  /** The same object as `layer.badges`: a token attaches its badges to it (`EntityKit`). */
  readonly badges: RenderLayer;
}

export function createLayers(): MapLayers {
  const world = new Container({ label: 'world' });
  const layer = {} as Record<LayerName, Container>;
  const badges = new RenderLayer();
  badges.label = 'badges';
  for (const name of LAYER_ORDER) {
    layer[name] = world.addChild(name === 'badges' ? badges : new Container({ label: name }));
  }
  return { world, layer, badges };
}
