import type { OrderController } from '../match/orderController.ts';
import type { MapInteraction, OverlayState, PickHit } from '../render/interaction.ts';
import type { ScenePins } from './groupScene.ts';

/**
 * The pins of a `group_*` scene (DEC-48, #896) on the frozen dev screen: the groups selected
 * together, `E` held and the node under the pointer are held whatever the real pointer and keys do
 * (the screenshot tools move the pointer off the map before a frame), and a box is drawn. The
 * controller does the rest as for a player: the frames, the seals, the preview and its price.
 */
export function pinGroup(base: OrderController, pins: ScenePins): MapInteraction {
  const hit: PickHit | null = pins.hover === undefined ? null : { kind: 'node', id: pins.hover };
  let last: OverlayState | null = null;
  let shown: OverlayState | null = null;
  const hold = (): void => {
    // The selection needs the snapshot of the scene (its own groups): it is taken once there is one.
    if (pins.picks !== undefined && base.picks.length === 0) base.selectBox(pins.picks);
    if (pins.eHeld === true)
      base.key({ type: 'keydown', code: base.keys.planned, shiftKey: false });
    if (hit !== null) base.hover(hit);
  };
  return {
    overlay: () => {
      hold();
      const overlay = base.overlay();
      if (overlay !== last) {
        last = overlay;
        shown = pins.box === undefined ? overlay : { ...overlay, box: pins.box };
      }
      return shown ?? overlay;
    },
    click: (picked, shift) => {
      base.click(picked, shift);
    },
    hover: (picked) => {
      base.hover(hit ?? picked);
    },
    wheel: (input) => base.wheel(input),
    selectBox: (ids) => {
      base.selectBox(ids);
    },
  };
}
