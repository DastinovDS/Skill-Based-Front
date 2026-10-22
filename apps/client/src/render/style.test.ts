import { describe, expect, it } from 'vitest';
import {
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

const sources = import.meta.glob<string>('../app.css', {
  eager: true,
  import: 'default',
  query: '?raw',
});
const css = Object.values(sources)[0] ?? '';

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  return match?.[1]?.toLowerCase() ?? '';
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

describe('palette tokens', () => {
  it.each([
    ['bg', BG],
    ['paper', PAPER],
    ['you', YOU],
    ['enemy', ENEMY],
    ['neutral', NEUTRAL_STROKE],
    ['neutral-fill', NEUTRAL_FILL],
    ['warn', WARN],
    ['vp', VP],
    ['terrain-plains', TERRAIN_FILL.plains],
    ['terrain-forest', TERRAIN_FILL.forest],
    ['terrain-mountains', TERRAIN_FILL.mountains],
  ])('--%s in app.css equals the constant in style.ts', (name, value) => {
    expect(token(name)).toBe(hex(value));
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
