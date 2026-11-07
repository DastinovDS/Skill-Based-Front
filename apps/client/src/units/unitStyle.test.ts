import { afterEach, describe, expect, it } from 'vitest';
import { framePolygon } from '../render/overlayView.ts';
import { helmetWidth } from '../render/shapes.ts';
import { HELMET_FRAME, UNIT_SIDES } from '../render/style.ts';
import { helmet, inside, type Point } from './helmet.ts';
import {
  DEFAULT_UNIT_STYLE,
  UNIT_STYLE_KEY,
  loadUnitStyle,
  onUnitStyle,
  setUnitStyle,
  unitStyle,
} from './unitStyle.ts';

/** A storage of one browser, in memory. */
function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => {
      items.clear();
    },
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

describe('the unit look (#784)', () => {
  afterEach(() => {
    setUnitStyle(DEFAULT_UNIT_STYLE, null);
  });

  it('is helmets by default and keeps the choice per browser', () => {
    const store = memory();
    expect(DEFAULT_UNIT_STYLE).toBe('helmet');
    expect(loadUnitStyle(store)).toBe('helmet');
    setUnitStyle('triangle', store);
    expect(store.getItem(UNIT_STYLE_KEY)).toBe('triangle');
    expect(loadUnitStyle(store)).toBe('triangle');
    store.setItem(UNIT_STYLE_KEY, 'squares');
    expect(loadUnitStyle(store)).toBe('helmet');
  });

  it('survives a storage that throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadUnitStyle(broken)).toBe('helmet');
    expect(() => {
      setUnitStyle('triangle', broken);
    }).not.toThrow();
    expect(unitStyle()).toBe('triangle');
  });

  it('tells the listeners once per change', () => {
    const seen: string[] = [];
    const stop = onUnitStyle((style) => seen.push(style));
    setUnitStyle('triangle', null);
    setUnitStyle('triangle', null);
    setUnitStyle('helmet', null);
    stop();
    setUnitStyle('triangle', null);
    expect(seen).toEqual(['triangle', 'helmet']);
  });
});

describe('the selection and hover outline of a helmet (#784)', () => {
  const pairs = (flat: readonly number[]): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) out.push({ x: flat[i] ?? 0, y: flat[i + 1] ?? 0 });
    return out;
  };
  afterEach(() => {
    setUnitStyle(DEFAULT_UNIT_STYLE, null);
  });

  it('goes round the whole helmet, strap included, and flips with the opponent', () => {
    setUnitStyle('helmet', null);
    const side = UNIT_SIDES[1];
    for (const enemy of [false, true]) {
      const h = helmet(enemy ? 'enemy' : 'own', helmetWidth(side, false));
      const flip = enemy ? -1 : 1;
      for (const offset of [HELMET_FRAME.select, HELMET_FRAME.hover]) {
        const outline = pairs(framePolygon({ x: 0, y: 0, side, scale: 1, enemy }, 1.45, offset));
        for (const p of [...h.dome, ...h.strap]) {
          expect(inside({ x: flip * p.x, y: p.y }, outline)).toBe(true);
        }
      }
    }
  });

  it('is the bigger triangle with triangles', () => {
    setUnitStyle('triangle', null);
    expect(framePolygon({ x: 0, y: 0, side: 30, scale: 1 }, 1.45, 7)).toHaveLength(6);
  });
});
