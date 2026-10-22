import type { Container, Graphics } from 'pixi.js';
import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { NodeView, SnapshotMsg } from '../protocol.gen.ts';
import { CityView } from './cityView.ts';
import { createLayers } from './layers.ts';
import { ENEMY, YOU } from './style.ts';

const map = DEFAULT_MAP;
const UPGRADES = { barracks: 100, warehouse: 100 };

/** The snapshot with `has_barracks` of node `id` replaced (the server decides it, DEC-31). */
function withBarracks(base: SnapshotMsg, id: number, value: boolean | null): SnapshotMsg {
  const nodes: NodeView[] = base.view.nodes.map((n) =>
    n.id === id ? { ...n, has_barracks: value } : n,
  );
  return { ...base, view: { ...base.view, nodes } };
}

/** What is drawn into the barracks mark of the city `id`: action, colour and shape, in order. */
function barracksShapes(nodes: Container, id: number): string[] {
  const city = nodes.children.find((c) => c.label === `node-${String(id)}`) as Container;
  const mark = city.children.find((c) => c.label === 'barracks') as Graphics;
  const instructions = mark.context.instructions as unknown as {
    action: string;
    data: {
      style: { color: number };
      path: { shapePath: { shapePrimitives: { shape: { type: string } }[] } };
    };
  }[];
  return instructions.flatMap((i) =>
    i.data.path.shapePath.shapePrimitives.map(
      (p) => `${i.action}:${String(i.data.style.color)}:${p.shape.type}`,
    ),
  );
}

/** An entry of `barracksShapes` without its colour. */
function shapeOnly(entry: string): string {
  const [action, , shape] = entry.split(':');
  return `${action ?? ''}:${shape ?? ''}`;
}

describe('CityView: the barracks of an enemy city next door (DEC-31)', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws the same house as on an own city and drops it when the city is no longer next door', () => {
    const snapshot = devSnapshot(map, DEV_RULES, 100);
    const own = snapshot.view.nodes.find((n) => n.owner === 0 && n.has_barracks === true);
    const enemy = map.nodes.find((n) => n.start_owner === 1 && n.kind !== 'province');
    expect(own).toBeDefined();
    expect(enemy).toBeDefined();
    if (own === undefined || enemy === undefined) return;
    const layers = createLayers();
    const view = new CityView(map, layers, 0, 1);
    const nodes = layers.layer.nodes;

    // Next to an own node, barracks built: the mark of an own city, shape for shape (the house,
    // not a colour, says «barracks»); only the rim takes the colour of the owner.
    view.update(withBarracks(snapshot, enemy.id, true), null, UPGRADES);
    const drawn = barracksShapes(nodes, enemy.id);
    const mine = barracksShapes(nodes, own.id);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.map(shapeOnly)).toEqual(mine.map(shapeOnly));
    expect(drawn).toContain(`stroke:${String(ENEMY)}:circle`);
    expect(mine).toContain(`stroke:${String(YOU)}:circle`);

    // Next door, but no barracks yet (or being built): no mark.
    view.update(withBarracks(snapshot, enemy.id, false), null, UPGRADES);
    expect(barracksShapes(nodes, enemy.id)).toEqual([]);

    // Built again, then the own neighbour is lost: the server sends `null`, the mark goes.
    view.update(withBarracks(snapshot, enemy.id, true), null, UPGRADES);
    expect(barracksShapes(nodes, enemy.id)).toEqual(drawn);
    view.update(withBarracks(snapshot, enemy.id, null), null, UPGRADES);
    expect(barracksShapes(nodes, enemy.id)).toEqual([]);
    view.destroy();
  });
});
