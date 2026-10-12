import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { TokenSpot } from './layout.ts';
import type { GhostArrow, OverlayState } from './interaction.ts';
import { setReducedMotion } from './motion.ts';
import { GHOST_REJECT_MS } from './style.ts';
import { createLayers } from './layers.ts';
import { OverlayView } from './overlayView.ts';

const map = DEFAULT_MAP;
const [a, b] = [map.nodes[0], map.nodes[5]];
if (a === undefined || b === undefined) throw new Error('map too small');

function setup() {
  const layers = createLayers();
  const view = new OverlayView(map, layers, 0);
  const none = (): TokenSpot | undefined => undefined;
  return { layers, view, none };
}

describe('OverlayView', () => {
  it('draws a ghost arrow from the group node to the destination', () => {
    const { layers, view, none } = setup();
    const state: OverlayState = {
      selection: null,
      ghosts: [{ from: a.id, dest: b.id, planned: false, path: null }],
      preview: null,
      road: null,
      candidates: [],
    };
    view.update(state, none);
    const bounds = layers.layer.intents.getLocalBounds();
    expect(bounds.width).toBeGreaterThan(Math.abs(b.x - a.x) * 0.8);
    expect(bounds.height).toBeGreaterThan(Math.abs(b.y - a.y) * 0.8);
    view.destroy();
  });

  it('follows the server path when the ack brought one', () => {
    const { layers, view, none } = setup();
    const via = map.nodes[1];
    if (via === undefined) throw new Error('map too small');
    view.update(
      {
        selection: null,
        ghosts: [{ from: a.id, dest: b.id, planned: false, path: [a.id, via.id, b.id] }],
        preview: null,
        road: null,
        candidates: [],
      },
      none,
    );
    const bounds = layers.layer.intents.getLocalBounds();
    const xs = [a.x, via.x, b.x];
    expect(bounds.width).toBeGreaterThanOrEqual(Math.max(...xs) - Math.min(...xs));
    view.destroy();
  });

  it('shows the frame of a selected group at its token, and hides it without one', () => {
    const { layers, view } = setup();
    const state: OverlayState = {
      selection: { kind: 'group', id: 'g' },
      ghosts: [],
      preview: null,
      road: null,
      candidates: [],
    };
    const frame = layers.layer.intents.children[2];
    view.update(state, () => ({ x: 50, y: 60, side: 30, scale: 1 }));
    expect(frame?.visible).toBe(true);
    expect(frame?.position.x).toBe(50);
    view.update(state, () => undefined);
    expect(frame?.visible).toBe(false);
    view.destroy();
  });

  describe('ghosts of sent orders', () => {
    const ghost = (extra: Partial<GhostArrow>): OverlayState => ({
      selection: null,
      ghosts: [{ from: a.id, dest: b.id, planned: false, path: null, ...extra }],
      preview: null,
      road: null,
      candidates: [],
    });
    /** The ghost Graphics is the last child of the layer. */
    const bounds = (layers: ReturnType<typeof setup>['layers']) => {
      // The Bounds object is reused by PixiJS: copy the numbers out.
      const { x, width } = layers.layer.intents.children.at(-1)?.getLocalBounds() ?? {
        x: 0,
        width: 0,
      };
      return { x, width };
    };

    it('draws a rejected ghost shaking, then fading to nothing', () => {
      const { layers, view, none } = setup();
      const rejected = ghost({ status: 'rejected', rejectedAt: 1000 });
      view.update(rejected, none, 1000);
      const first = bounds(layers);
      expect(first.width).toBeGreaterThan(0);
      // 12 ms in: the shake has moved the arrow sideways.
      view.update(rejected, none, 1012);
      expect(bounds(layers).x).not.toBe(first.x);
      // After the fade nothing is left to draw.
      view.update(rejected, none, 1000 + GHOST_REJECT_MS);
      expect(bounds(layers).width).toBe(0);
      view.destroy();
    });

    it('does not shake with less motion', () => {
      setReducedMotion(true);
      try {
        const { layers, view, none } = setup();
        const rejected = ghost({ status: 'rejected', rejectedAt: 1000 });
        view.update(rejected, none, 1000);
        const first = bounds(layers);
        view.update(rejected, none, 1012);
        expect(bounds(layers).x).toBe(first.x);
        view.destroy();
      } finally {
        setReducedMotion(null);
      }
    });

    it('draws a pending and an accepted ghost alike in extent', () => {
      const { layers, view, none } = setup();
      view.update(ghost({ status: 'pending' }), none, 0);
      const pending = bounds(layers);
      view.update(ghost({ status: 'accepted', path: [a.id, b.id] }), none, 0);
      const accepted = bounds(layers);
      expect(accepted.width).toBeCloseTo(pending.width, 0);
      view.destroy();
    });
  });
});
