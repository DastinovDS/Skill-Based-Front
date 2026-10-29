import { CanvasTextMetrics, Container, Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { defenseCounterSpec } from './bakedShapes.ts';
import { columnKinds, columnSlots } from './defenseLayout.ts';
import { DefenseView } from './defenseView.ts';
import { createLayers } from './layers.ts';
import { nodePoint } from './layout.ts';
import { ENEMY, YOU } from './style.ts';
import { testSprites } from './testSprites.ts';
import type { BakedSprite } from './bake.ts';

const map = DEFAULT_MAP;
const [a, b] = map.nodes;
if (a === undefined || b === undefined) throw new Error('small map');

function setup(barracks: (node: number) => boolean = () => false) {
  const layers = createLayers();
  const view = new DefenseView(map, layers, 0, testSprites(), () => 14, barracks);
  const root = layers.layer.intents.children[0] as Container;
  const drawn = (): { key: string | undefined; x: number; y: number; scale: number }[] =>
    root.children
      .filter((c) => c.visible)
      .map((c) => {
        const sprite = c.children[0] as BakedSprite;
        return { key: sprite.spec?.key, x: c.x, y: c.y, scale: c.scale.x };
      });
  const numbers = (): string[] =>
    root.children
      .filter((c) => c.visible)
      .flatMap((c) => c.children.filter((t) => t instanceof Text && t.visible))
      .map((t) => (t as Text).text);
  return { view, drawn, numbers };
}

describe('DefenseView (D1 in the left column, #349)', () => {
  beforeEach(() => {
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 6, height: 12 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('draws an own sign as the counter of its numbers, in the column left of the city', () => {
    const { view, drawn } = setup();
    view.update([{ node: a.id, owner: 0, pips: { bonus: 1, cap: 3 } }]);
    const [one] = drawn();
    expect(one?.key).toBe(defenseCounterSpec(YOU, false, { bonus: 1, cap: 3 }).key);
    const at = nodePoint(map, a.id);
    const [slot] = columnSlots(14, columnKinds(false, 1), 1);
    expect(one?.x).toBeCloseTo((at?.x ?? 0) + (slot?.x ?? 0));
    expect(one?.y).toBeCloseTo((at?.y ?? 0) + (slot?.y ?? 0));
    expect((slot?.x ?? 0) < 0).toBe(true);
    view.destroy();
  });

  it('draws the opponent as the badge alone: no capsule, even if numbers were given', () => {
    const { view, drawn } = setup();
    view.update([{ node: a.id, owner: 1, pips: { bonus: 2, cap: 3 } }]);
    expect(drawn()[0]?.key).toBe(`shield:${String(ENEMY)}:e`);
    view.destroy();
  });

  it('draws the badge alone for an own group with no places or no numbers', () => {
    const { view, drawn } = setup();
    view.update([
      { node: a.id, owner: 0, pips: { bonus: 0, cap: 0 } },
      { node: b.id, owner: 0, pips: null },
    ]);
    expect(drawn().map((d) => d.key)).toEqual([`shield:${String(YOU)}:`, `shield:${String(YOU)}:`]);
    view.destroy();
  });

  it('puts the sign under the barracks mark of the same city', () => {
    const { view, drawn } = setup((node) => node === a.id);
    view.update([{ node: a.id, owner: 0, pips: null }]);
    const [slot] = columnSlots(14, columnKinds(true, 1), 1).slice(1);
    const at = nodePoint(map, a.id);
    expect(drawn()[0]?.y).toBeCloseTo((at?.y ?? 0) + (slot?.y ?? 0));
    expect(slot?.y ?? 0).toBeGreaterThan(0);
    view.destroy();
  });

  it('keeps 16 px on screen below zoom 1 and hides what is gone', () => {
    const { view, drawn } = setup();
    view.setCameraScale(0.5);
    view.update([{ node: a.id, owner: 0, pips: null }]);
    expect(drawn()[0]?.scale).toBeCloseTo(2);
    view.update([]);
    expect(drawn()).toEqual([]);
    view.destroy();
  });

  it('writes the numbers above six places, and no text below', () => {
    const { view, numbers } = setup();
    view.update([{ node: a.id, owner: 0, pips: { bonus: 2, cap: 8 } }]);
    expect(numbers()).toEqual(['×2', '×6']);
    view.update([{ node: a.id, owner: 0, pips: { bonus: 2, cap: 4 } }]);
    expect(numbers()).toEqual([]);
    view.destroy();
  });
});

describe('defenseCounterSpec', () => {
  it('bakes one texture per look: the same row twice is the same key, a bonus more is another', () => {
    const k = (bonus: number, cap = 4): string =>
      defenseCounterSpec(YOU, false, { bonus, cap }).key;
    expect(k(1)).toBe(k(1));
    expect(k(1)).not.toBe(k(2));
    expect(k(1, 4)).not.toBe(k(1, 5));
  });

  it('does not depend on the numbers above six places (they are text): the key follows the width', () => {
    const k = (bonus: number, cap: number): string =>
      defenseCounterSpec(YOU, false, { bonus, cap }).key;
    expect(k(1, 8)).toBe(k(2, 9));
    expect(k(1, 8)).not.toBe(k(1, 18));
  });

  it('keeps the capsule inside its box, to the left of the badge', () => {
    const { box } = defenseCounterSpec(YOU, false, { bonus: 1, cap: 4 });
    expect(box.x).toBeLessThan(-30);
    expect(box.x + box.width).toBeGreaterThan(11);
  });
});
