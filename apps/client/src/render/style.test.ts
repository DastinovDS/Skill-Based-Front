import { describe, expect, it } from 'vitest';
import {
  BADGE_DOWN,
  BADGE_UP,
  BG,
  CASING,
  ENEMY,
  INK,
  NEUTRAL_FILL,
  NEUTRAL_STROKE,
  PAPER,
  DARK_PLATE,
  TERRAIN_FILL,
  VP,
  WARN,
  YOU,
  ownerColor,
  roadLanesWidth,
  roadSpan,
  sideOf,
} from './style.ts';

// The pieces of the map take the Engraved pair of the tokens (#847, part 2 of #829, ui-style 57),
// the same as the interface (`src/theme/tokens.test.ts`); the dark and white of the parts not
// restyled yet stay the old ones of ui-style 6. These pin the map colours.
function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

describe('the map palette (Engraved, ui-style 57)', () => {
  it.each([
    [BG, '#0d1117'],
    [PAPER, '#f0f6fc'],
    [YOU, '#86a6ea'],
    [ENEMY, '#e5785e'],
    [NEUTRAL_STROKE, '#b3a88f'],
    [NEUTRAL_FILL, '#221e18'],
    [WARN, '#e6ab42'],
    [VP, '#cfab62'],
    [BADGE_UP, '#8cc79a'],
    [BADGE_DOWN, '#ec6654'],
    // The ink of the map: darker and warmer than the ivory of the interface (#865).
    [INK, '#ccc0a6'],
    [CASING, '#060504'],
    [DARK_PLATE, '#0e0c09'],
    [TERRAIN_FILL.plains, '#3a4630'],
    [TERRAIN_FILL.forest, '#25392b'],
    [TERRAIN_FILL.mountains, '#4a453e'],
  ])('%#: is %s', (value, expected) => {
    expect(hex(value)).toBe(expected);
  });
});

describe('sides', () => {
  it('shows the viewing player as blue and the opponent as red, whoever that is', () => {
    expect(ownerColor(0, 0)).toBe(YOU);
    expect(ownerColor(0, 1)).toBe(ENEMY);
    expect(ownerColor(1, 1)).toBe(YOU);
    expect(ownerColor(1, 0)).toBe(ENEMY);
    expect(sideOf(1, 0)).toBe('enemy');
  });
});

describe('the lanes of a road (R1, #345)', () => {
  it('is 2 per lane and 1.7 between lanes, so level 1..3 is one, two or three lanes', () => {
    expect([1, 2, 3].map(roadLanesWidth)).toEqual([2, 5.7, 9.4]);
  });

  it('adds the casing of an own road to the width of its lanes', () => {
    expect(roadSpan(1)).toBeCloseTo(5.6);
    expect(roadSpan(3)).toBeCloseTo(13);
  });
});
