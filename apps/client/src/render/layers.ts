import { Container } from 'pixi.js';

/**
 * Layer names from bottom to top (AGENTS.md §7.2). The groups and the intents lie ABOVE the fog
 * (layers Sl2 «Over the haze», ui-style 27; the groups since #419): a ribbon is public (DEC-04) and
 * must not dim, and neither must the own group that marches along a road into a hidden city
 * (DEC-10: it sees its own edge, which lies in the veil of the hidden end). That is safe: the
 * server sends an enemy figure only where it is seen, and the memory ghosts of the fog are drawn in
 * the fog layer itself. `supply` is above everything.
 */
export const LAYER_ORDER = [
  'background',
  'territory',
  'roads',
  'nodes',
  'fog',
  'groups',
  'intents',
  'effects',
  'supply',
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

/**
 * The world container (moved and scaled by the camera) with one child container per layer.
 * Layers stay empty until their issue fills them: groups and intents (CLI-04, #60), fog (CLI-05,
 * #61), effects. `supply` is the «Supply» map mode (DEC-28, item 8): while it is on, the groups,
 * intents, fog and effects layers are hidden and this one draws.
 */
export interface MapLayers {
  readonly world: Container;
  readonly layer: Readonly<Record<LayerName, Container>>;
}

export function createLayers(): MapLayers {
  const world = new Container({ label: 'world' });
  const layer = {} as Record<LayerName, Container>;
  for (const name of LAYER_ORDER) {
    layer[name] = world.addChild(new Container({ label: name }));
  }
  return { world, layer };
}
