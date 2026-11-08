import { describe, expect, it } from 'vitest';
import {
  BADGE_DOWN,
  BADGE_UP,
  BG,
  ENEMY,
  NEUTRAL_FILL,
  NEUTRAL_STROKE,
  PAPER,
  TERRAIN_FILL,
  VP,
  WARN,
  YOU,
  ownerColor,
  roadLanesWidth,
  roadSpan,
  sideOf,
} from './style.ts';

// The map keeps the palette of ui-style 6 until its Engraved piece (#829); the interface tokens of
// app.css moved to Lapis and Engraved (#841, src/theme/tokens.test.ts). These pin the map colours.
function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

describe('the map palette (ui-style 6)', () => {
  it.each([
    [BG, '#0d1117'],
    [PAPER, '#f0f6fc'],
    [YOU, '#5b9bff'],
    [ENEMY, '#e5484d'],
    [NEUTRAL_STROKE, '#8b949e'],
    [NEUTRAL_FILL, '#2b3139'],
    [WARN, '#ffb020'],
    [VP, '#e3b341'],
    [BADGE_UP, '#3ddc72'],
    [BADGE_DOWN, '#ff4f4f'],
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
