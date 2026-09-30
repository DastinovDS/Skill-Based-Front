import { Container } from 'pixi.js';

/** Layer names from bottom to top (AGENTS.md §7.2). */
export const LAYER_ORDER = [
  'background',
  'territory',
  'roads',
  'nodes',
  'groups',
  'intents',
  'fog',
  'effects',
] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

/**
 * The world container (moved and scaled by the camera) with one child container per layer.
 * Layers stay empty until their issue fills them: groups and intents (CLI-04, #60), fog (CLI-05,
 * #61), effects.
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
