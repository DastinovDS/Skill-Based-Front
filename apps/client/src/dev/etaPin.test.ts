import { describe, expect, it } from 'vitest';
import { EMPTY_OVERLAY, type MapInteraction } from '../render/interaction.ts';
import { parseEta, pinEta } from './etaPin.ts';

describe('the pinned travel-time label of the dev screen', () => {
  it('reads from, to and ticks, and nothing else', () => {
    expect(parseEta('3,4,120')).toEqual({ from: 3, node: 4, ticks: 120 });
    expect(parseEta(null)).toBeNull();
    expect(parseEta('3,4')).toBeNull();
    expect(parseEta('3,4,120,5')).toBeNull();
    expect(parseEta('a,4,120')).toBeNull();
    expect(parseEta('3,-4,120')).toBeNull();
  });

  it('adds the label to the overlay, the same object while the overlay is the same', () => {
    const base: MapInteraction = { overlay: () => EMPTY_OVERLAY, click: () => {}, hover: () => {} };
    const pinned = pinEta(base, { from: 3, node: 4, ticks: 120 });
    const first = pinned.overlay();
    expect(first.eta).toEqual({ from: 3, node: 4, ticks: 120 });
    expect(pinned.overlay()).toBe(first);
  });
});
