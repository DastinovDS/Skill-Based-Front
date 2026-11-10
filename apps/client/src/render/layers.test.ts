import { describe, expect, it } from 'vitest';
import { LAYER_ORDER, createLayers } from './layers.ts';

describe('layer order', () => {
  const at = (name: (typeof LAYER_ORDER)[number]): number => LAYER_ORDER.indexOf(name);

  it('draws the intents above the fog (the haze does not dim a public ribbon)', () => {
    expect(at('intents')).toBeGreaterThan(at('fog'));
  });

  it('draws the groups above the fog: an own group on a road into the fog is not dimmed (#419)', () => {
    expect(at('groups')).toBeGreaterThan(at('fog'));
    // The cities and roads stay under the haze, the intents over the groups.
    expect(at('nodes')).toBeLessThan(at('fog'));
    expect(at('roads')).toBeLessThan(at('fog'));
    expect(at('intents')).toBeGreaterThan(at('groups'));
  });

  it('keeps the tolls above the effects', () => {
    expect(at('tolls')).toBe(LAYER_ORDER.length - 1);
    expect(at('effects')).toBeGreaterThan(at('intents'));
  });

  it('draws the badges of the units over the outlines of the intents, under the effects (#797)', () => {
    expect(at('badges')).toBe(at('intents') + 1);
    expect(at('effects')).toBeGreaterThan(at('badges'));
  });

  it('adds one container per layer in that order', () => {
    const { world, layer } = createLayers();
    expect(world.children.map((child) => child.label)).toEqual([...LAYER_ORDER]);
    expect(Object.keys(layer)).toEqual([...LAYER_ORDER]);
    world.destroy({ children: true });
  });
});
