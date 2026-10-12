import { describe, expect, it } from 'vitest';
import { DEV_RULES, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { SnapshotMsg } from '../protocol.gen.ts';
import { AlertState } from './alerts.svelte.ts';
import { lossIn, overflowAlerts } from './overflow.ts';

const base = devSnapshot(DEFAULT_MAP, DEV_RULES, 100);
const mine = base.view.nodes.filter((n) => n.owner === 0).map((n) => n.id);
const [a, b] = mine;
const enemyNode = base.view.nodes.find((n) => n.owner === 1)?.id;
if (a === undefined || b === undefined || enemyNode === undefined) throw new Error('small map');

function with_(
  changes: Record<number, { attrition_in?: number; grace_left?: number }>,
): SnapshotMsg {
  return {
    ...base,
    view: {
      ...base.view,
      nodes: base.view.nodes.map((n) => ({ ...n, ...(changes[n.id] ?? {}) })),
    },
  };
}

const ATTRITION = DEV_RULES.capacity.attrition_ticks;

describe('overflowAlerts', () => {
  it('lists own cities with a countdown, with the units standing there', () => {
    const units = base.view.groups
      .filter((g) => g.location.kind === 'node' && g.location.node === a)
      .reduce((total, g) => total + g.units, 0);
    const found = overflowAlerts(with_({ [a]: { attrition_in: 12 } }), 0, ATTRITION);
    expect(found).toEqual([
      {
        kind: 'overflow',
        node: a,
        units,
        capacity: base.view.nodes[a]?.capacity,
        attritionIn: 12,
        graceLeft: null,
      },
    ]);
  });

  it('has none without a countdown, and never lists a city of the enemy', () => {
    expect(overflowAlerts(base, 0, ATTRITION)).toEqual([]);
    expect(overflowAlerts(with_({ [enemyNode]: { attrition_in: 3 } }), 0, ATTRITION)).toEqual([]);
  });

  it('puts the soonest loss first; a grace counts as grace plus a whole attrition period', () => {
    const found = overflowAlerts(
      with_({ [a]: { grace_left: 5 }, [b]: { attrition_in: ATTRITION } }),
      0,
      ATTRITION,
    );
    expect(found.map((x) => x.node)).toEqual([b, a]);
    const [first, second] = found;
    if (first === undefined || second === undefined) throw new Error('two alerts');
    expect(lossIn(first, ATTRITION)).toBe(ATTRITION);
    expect(lossIn(second, ATTRITION)).toBe(5 + ATTRITION);
  });
});

describe('AlertState with overcrowding', () => {
  it('keeps the overflow list per snapshot and sends Space to the soonest city first', () => {
    const alerts = new AlertState(0, DEV_RULES);
    expect(alerts.nextNode()).toBeNull();
    alerts.onSnapshot(with_({ [a]: { attrition_in: 20 }, [b]: { attrition_in: 8 } }));
    expect(alerts.overflow.map((x) => x.node)).toEqual([b, a]);
    expect([alerts.nextNode(), alerts.nextNode(), alerts.nextNode()]).toEqual([b, a, b]);
    alerts.onSnapshot(base);
    expect(alerts.overflow).toEqual([]);
    expect(alerts.nextNode()).toBeNull();
  });

  it('forgets the overflow on a reset', () => {
    const alerts = new AlertState(0, DEV_RULES);
    alerts.onSnapshot(with_({ [a]: { attrition_in: 20 } }));
    alerts.reset();
    expect(alerts.overflow).toEqual([]);
  });
});
