import { describe, expect, it } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { lanePoint, presenceOf } from './supplyLayout.ts';

describe('what the layer draws (DEC-43)', () => {
  const base = devSnapshot(DEFAULT_MAP, DEV_RULES, 30).view;
  const enemyExact = base.nodes.find((n) => n.owner === 1 && n.detail === 'exact');
  const enemyPresence = base.nodes.find((n) => n.owner === 1 && n.detail === 'presence');
  if (enemyExact === undefined || enemyPresence === undefined) {
    throw new Error('the dev snapshot lacks seen enemy cities');
  }

  it('shows the enemy only as presence where it is seen now, not in fog', () => {
    const presence = presenceOf(base);
    expect(presence).toContainEqual({ kind: 'node', id: enemyExact.id });
    expect(presence).toContainEqual({ kind: 'node', id: enemyPresence.id });
    const fogged = base.nodes.map((n) =>
      n.id === enemyExact.id ? { ...n, detail: 'fog' as const } : n,
    );
    expect(presenceOf({ ...base, nodes: fogged })).not.toContainEqual({
      kind: 'node',
      id: enemyExact.id,
    });
  });
});

describe('lanes', () => {
  it('opposite directions of a road are on opposite sides of it', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 100, y: 0 };
    const there = lanePoint(a, b, 0.5, 8);
    const back = lanePoint(b, a, 0.5, 8);
    expect(there).toEqual({ x: 50, y: 8 });
    expect(back.x).toBeCloseTo(50);
    expect(back.y).toBeCloseTo(-8);
  });
});
