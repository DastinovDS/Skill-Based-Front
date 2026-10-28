import type { EtaMark, MapInteraction, OverlayState } from '../render/interaction.ts';

/**
 * `?eta=<from>,<to>,<ticks>` on the dev screen: the travel-time label of an order from the node
 * `from` to the node `to`, pinned to a frozen scene (a fixture scene has no server to answer
 * `reach`), so the screenshots of #432 can look at it. `null`: no or a broken value.
 */
export function parseEta(value: string | null): EtaMark | null {
  if (value === null) return null;
  const [from, node, ticks, ...rest] = value.split(',').map((part) => Number(part));
  if (rest.length > 0 || from === undefined || node === undefined || ticks === undefined) {
    return null;
  }
  return [from, node, ticks].every((n) => Number.isInteger(n) && n >= 0)
    ? { from, node, ticks }
    : null;
}

/** The interaction of the map with the label added to its overlay; the same object while the overlay is. */
export function pinEta(base: MapInteraction, eta: EtaMark): MapInteraction {
  let seen: OverlayState | null = null;
  let pinned: OverlayState | null = null;
  return {
    overlay() {
      const overlay = base.overlay();
      if (seen !== overlay || pinned === null) {
        seen = overlay;
        pinned = { ...overlay, eta };
      }
      return pinned;
    },
    click: (hit, shift) => {
      base.click(hit, shift);
    },
    hover: (hit) => {
      base.hover(hit);
    },
  };
}
