import { describe, expect, it } from 'vitest';
import { CUT_ICONS, CUT_SOLIDS } from '../theme/cutIcons.ts';
import { cornerBounds, parseCut, solidCorners } from './cutPath.ts';

describe('parseCut: the straight paths of the menu icons', () => {
  it('reads the move, line, horizontal, vertical and close commands', () => {
    const [shape, open] = parseCut('M-9 9 V-1 L0 -8.5 H9 V9 Z M0 0 L1 2');
    expect(shape?.closed).toBe(true);
    expect(shape?.points).toEqual([
      { x: -9, y: 9 },
      { x: -9, y: -1 },
      { x: 0, y: -8.5 },
      { x: 9, y: -8.5 },
      { x: 9, y: 9 },
    ]);
    expect(open?.closed).toBe(false);
    expect(open?.points).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
    ]);
  });

  it('refuses a curve: the map draws only what the menu draws with straight lines', () => {
    expect(() => parseCut('M0 0 C1 1 2 2 3 3')).toThrow(/unsupported/);
  });

  it('reads the barracks and the factory of the menu: a closed solid, the gate and the flag', () => {
    const barracks = parseCut(CUT_ICONS.barracks);
    expect(barracks).toHaveLength(3);
    expect(barracks[0]?.closed).toBe(true);
    expect(barracks[0]?.points).toHaveLength(5);
    const factory = parseCut(CUT_ICONS.factory);
    expect(factory).toHaveLength(3);
    // The ruled solid is the first subpath of the outline: the outline stands on it.
    expect(solidCorners(CUT_SOLIDS.barracks ?? '')).toEqual(barracks[0]?.points);
    expect(solidCorners(CUT_SOLIDS.factory ?? '')).toEqual(factory[0]?.points);
  });
});

describe('cornerBounds', () => {
  it('is the box round the corners', () => {
    expect(
      cornerBounds([
        { x: -9, y: 9 },
        { x: 0, y: -8.5 },
        { x: 9, y: 9 },
      ]),
    ).toEqual({ x: -9, y: -8.5, width: 18, height: 17.5 });
  });
});
