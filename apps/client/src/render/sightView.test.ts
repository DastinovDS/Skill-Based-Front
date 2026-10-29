import type { Container, Graphics } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { Detail, NodeView } from '../protocol.gen.ts';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { createLayers } from './layers.ts';
import { SightView } from './sightView.ts';

const map = DEFAULT_MAP;
const nodes = devSnapshot(map, DEV_RULES, 100).view.nodes;
const withDetail = (detail: Detail): NodeView[] =>
  nodes.map((n) => (n.owner === 0 ? n : { ...n, detail }));

function build() {
  const layers = createLayers();
  const view = new SightView(map, layers, 0, () => 14);
  const root = layers.layer.nodes.children.find((c) => c.label === 'sight') as Container;
  const graphics = root.children[0] as Graphics;
  /** How many shapes the signs have: a plate and three bars per sign. */
  const shapes = () => graphics.context.instructions.length;
  return { view, root, shapes };
}

describe('SightView: the sight signs of the terrain mode (#429)', () => {
  it('draws nothing while the mode is off', () => {
    const { view, root, shapes } = build();
    view.update(false, withDetail('exact'), 1);
    expect(root.visible).toBe(false);
    expect(shapes()).toBe(0);
  });

  it('draws a sign beside each place that is not yours and that is seen, none in the fog', () => {
    const { view, root, shapes } = build();
    view.update(true, withDetail('fog'), 1);
    expect(root.visible).toBe(true);
    expect(shapes()).toBe(0);
    view.update(true, withDetail('presence'), 1);
    const presence = shapes();
    expect(presence).toBeGreaterThan(0);
    // More bars are filled for a range and an exact view: more fills, fewer outlines, same signs.
    view.update(true, withDetail('exact'), 1);
    expect(shapes()).toBe(presence);
  });

  it('is hidden when the map is zoomed too far out to read it', () => {
    const { view, root } = build();
    view.update(true, withDetail('exact'), 0.3);
    expect(root.visible).toBe(false);
    view.update(true, withDetail('exact'), 0.5);
    expect(root.visible).toBe(true);
  });
});
