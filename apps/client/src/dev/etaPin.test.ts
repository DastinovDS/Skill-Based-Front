import { describe, expect, it } from 'vitest';
import { EMPTY_OVERLAY, type MapInteraction } from '../render/interaction.ts';
import { parseEta, pinEta } from './etaPin.ts';

describe('the pinned travel-time label of the dev screen', () => {
  it('reads from, to and ticks, and nothing else', () => {
    expect(parseEta('3,4,120')).toEqual({ from: 3, node: 4, ticks: 120, path: [3, 4] });
    // The nodes after the ticks are the route between the two ends.
    expect(parseEta('3,5,250,4')).toEqual({ from: 3, node: 5, ticks: 250, path: [3, 4, 5] });
    expect(parseEta(null)).toBeNull();
    expect(parseEta('3,4')).toBeNull();
    expect(parseEta('3,4,120,x')).toBeNull();
    expect(parseEta('a,4,120')).toBeNull();
    expect(parseEta('3,-4,120')).toBeNull();
  });

  it('adds the label to the overlay, the same object while the overlay is the same', () => {
    const base: MapInteraction = { overlay: () => EMPTY_OVERLAY, click: () => {}, hover: () => {} };
    const pinned = pinEta(base, { from: 3, node: 4, ticks: 120, path: [3, 4] });
    const first = pinned.overlay();
    expect(first.eta).toEqual({ from: 3, node: 4, ticks: 120, path: [3, 4] });
    expect(pinned.overlay()).toBe(first);
  });
});
