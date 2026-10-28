import { CanvasTextMetrics } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { TokenSpot } from './layout.ts';
import type { GhostArrow, OverlayState } from './interaction.ts';
import { setReducedMotion } from './motion.ts';
import { badgeScale } from './alertLayout.ts';
import { ETA_LABEL, GHOST_REJECT_MS, REACH_RING, roadSpan } from './style.ts';
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
  it('draws no arrow for an order sent or accepted (the snapshot shows it)', () => {
    const { layers, view, none } = setup();
    const via = map.nodes[1];
    if (via === undefined) throw new Error('map too small');
    const state = (ghosts: OverlayState['ghosts']): OverlayState => ({
      selection: null,
      ghosts,
      preview: null,
      candidates: [],
      beacon: null,
      supply: null,
      reach: [],
      split: [],
      eta: null,
    });
    view.update(state([{ from: a.id, dest: b.id, planned: false, path: null }]), none);
    expect(layers.layer.intents.getLocalBounds().width).toBe(0);
    view.update(
      state([
        { from: a.id, dest: b.id, planned: true, path: [a.id, via.id, b.id], status: 'accepted' },
      ]),
      none,
    );
    expect(layers.layer.intents.getLocalBounds().width).toBe(0);
    view.destroy();
  });

  it('draws the dotted preview of a planned order only', () => {
    const { layers, view, none } = setup();
    const state = (planned: boolean): OverlayState => ({
      selection: null,
      ghosts: [],
      preview: { from: a.id, to: b.id, planned },
      candidates: [],
      beacon: null,
      supply: null,
      reach: [],
      split: [],
      eta: null,
    });
    view.update(state(false), none);
    expect(layers.layer.intents.getLocalBounds().width).toBe(0);
    view.update(state(true), none);
    expect(layers.layer.intents.getLocalBounds().width).toBeGreaterThan(Math.abs(b.x - a.x) * 0.8);
    view.destroy();
  });

  it('shows the frame of a selected group at its token, and hides it without one', () => {
    const { layers, view } = setup();
    const state: OverlayState = {
      selection: { kind: 'group', id: 'g' },
      ghosts: [],
      preview: null,
      candidates: [],
      beacon: null,
      supply: null,
      reach: [],
      split: [],
      eta: null,
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
      candidates: [],
      beacon: null,
      supply: null,
      reach: [],
      split: [],
      eta: null,
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

    it('draws nothing for a pending or an accepted ghost', () => {
      const { layers, view, none } = setup();
      view.update(ghost({ status: 'pending' }), none, 0);
      expect(bounds(layers).width).toBe(0);
      view.update(ghost({ status: 'accepted', path: [a.id, b.id] }), none, 0);
      expect(bounds(layers).width).toBe(0);
      view.destroy();
    });
  });
});

describe('OverlayView, the travel time of an order on its road (#432)', () => {
  const state = (eta: OverlayState['eta']): OverlayState => ({
    selection: null,
    ghosts: [],
    preview: null,
    candidates: [],
    beacon: null,
    supply: null,
    reach: [],
    split: [],
    eta,
  });
  const label = (layers: ReturnType<typeof setup>['layers']) =>
    layers.layer.intents.children.find((c) => c.label === 'order-eta');
  /** The texts of the label. */
  const textOf = (layers: ReturnType<typeof setup>['layers']): string =>
    (label(layers)?.children.find((c) => 'text' in c) as { text: string } | undefined)?.text ?? '';

  beforeEach(() => {
    // jsdom has no canvas to measure text on: seven units a letter.
    vi.spyOn(CanvasTextMetrics, 'measureText').mockImplementation(
      (text: string) => ({ width: text.length * 7, height: 14 }) as CanvasTextMetrics,
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Where the label of an order from node `from` to node `to` stands, along and off the line. */
  function spotOf(from: number, to: number) {
    const { layers, view, none } = setup();
    view.setTickHz(10);
    view.setCameraScale(1);
    view.update(state({ from, node: to, ticks: 25 }), none);
    const plate = label(layers);
    expect(plate?.visible).toBe(true);
    expect(textOf(layers)).toBe('3 s');
    const p = map.nodes[from];
    const q = map.nodes[to];
    if (p === undefined || q === undefined) throw new Error('no such node');
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const ux = (q.x - p.x) / length;
    const uy = (q.y - p.y) / length;
    const px = (plate?.x ?? 0) - p.x;
    const py = (plate?.y ?? 0) - p.y;
    const rim = (n: typeof p) => (n.capital_of === null ? 14 : 17) + REACH_RING.gap;
    const result = {
      along: px * ux + py * uy,
      off: Math.abs(px * -uy + py * ux),
      length,
      rimFrom: rim(p),
      rimTo: rim(q),
    };
    view.destroy();
    return result;
  }

  it('on a road between two cities: in the middle of it between the rims, above it', () => {
    const edge = map.edges[0];
    if (edge === undefined) throw new Error('a map without roads');
    const spot = spotOf(edge.a, edge.b);
    expect(spot.along).toBeCloseTo((spot.rimFrom + spot.length - spot.rimTo) / 2);
    expect(spot.off).toBeGreaterThanOrEqual((roadSpan(3) / 2 + ETA_LABEL.roadGap) * badgeScale(1));
  });

  it('for cities with no road between them: the last piece before the destination, not on a city', () => {
    const linked = map.edges.some(
      (e) => (e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id),
    );
    expect(linked).toBe(false);
    const spot = spotOf(a.id, b.id);
    // Past the middle, short of the rim of the destination, and clear of the line.
    expect(spot.along).toBeGreaterThan(spot.length / 2);
    expect(spot.along).toBeLessThan(spot.length - spot.rimTo);
    expect(spot.off).toBeGreaterThanOrEqual((roadSpan(3) / 2 + ETA_LABEL.roadGap) * badgeScale(1));
  });

  it('keeps its size on screen: the scale follows the camera, within the badge bounds', () => {
    const { layers, view, none } = setup();
    view.setTickHz(10);
    view.setCameraScale(0.6);
    view.update(state({ from: a.id, node: b.id, ticks: 25 }), none);
    // 13 px of text at a 60% map scale: world scale 1 / 0.6, so 13 * (1 / 0.6) * 0.6 = 13 px.
    expect(label(layers)?.scale.x).toBeCloseTo(1 / 0.6);
    expect(13 * (label(layers)?.scale.x ?? 0) * 0.6).toBeGreaterThanOrEqual(12);
    view.destroy();
  });

  it('is hidden without a mark', () => {
    const { layers, view, none } = setup();
    view.setTickHz(10);
    view.update(state({ from: a.id, node: b.id, ticks: 25 }), none);
    view.update(state(null), none);
    expect(label(layers)?.visible).toBe(false);
    view.destroy();
  });
});
