import { describe, expect, it } from 'vitest';
import { DEV_RULES_FLOW, devSnapshot } from '../hud/devFeed.ts';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { EventMsg, UiFlag } from '../protocol.gen.ts';
import { FULL_GATE, UI_FLAGS } from '../tutorial/gate.ts';
import { FrameGate, gateView } from './renderGate.ts';

// The map's part of the tutorial gate (#806, docs/design/tutorial.md 4.9): each flag hides its
// pieces from the frame; everything shown (a normal match) leaves the frame as it is.
const snapshot = devSnapshot(DEFAULT_MAP, DEV_RULES_FLOW, 30);
const frame: RenderFrame = { tick: 30, base: snapshot, groups: [], packets: [], enemies: [] };
const without = (flag: UiFlag): Set<UiFlag> => new Set(UI_FLAGS.filter((f) => f !== flag));

describe('the render gate', () => {
  it('passes a frame through untouched when everything is shown, or without a gate', () => {
    const gate = new FrameGate();
    expect(gate.frame(frame)).toBe(frame);
    gate.setGate(FULL_GATE);
    expect(gate.frame(frame)).toBe(frame);
    const events: EventMsg[] = [{ type: 'event', tick: 1, kind: 'toll_paid', data: {} }];
    expect(gate.events(events)).toBe(events);
  });

  it('hides each piece of its flag', () => {
    const own = snapshot.view.nodes.find((n) => n.owner === 0 && n.warehouse !== null);
    expect(own).toBeDefined();
    const view = (flag: UiFlag) => gateView(snapshot.view, without(flag));
    expect(
      view('warehouse').nodes.every((n) => n.warehouse === null && n.warehouse_cap === null),
    ).toBe(true);
    expect(view('supply').packets).toEqual([]);
    expect(view('supply').nodes.every((n) => n.starve_in === null && n.flow_pocket === null)).toBe(
      true,
    );
    expect(
      view('buildings').nodes.every(
        (n) =>
          n.building === null &&
          n.factory === null &&
          n.has_barracks === null &&
          n.factory_build === null,
      ),
    ).toBe(true);
    expect(view('recruit').nodes.every((n) => n.recruit_queue === null)).toBe(true);
    expect(view('terrainMarks').nodes.every((n) => n.terrain_mark === null)).toBe(true);
    expect(view('fort').edges.every((e) => e.forts.length === 0)).toBe(true);
    // A shown piece is left as it is.
    expect(view('fort').nodes.map((n) => n.warehouse)).toEqual(
      snapshot.view.nodes.map((n) => n.warehouse),
    );
  });

  it('keeps the gated frame and events while their input stays the same', () => {
    const gate = new FrameGate();
    gate.setGate(new Set<UiFlag>());
    const a = gate.frame(frame);
    const b = gate.frame({ ...frame, tick: 30.5 });
    expect(a?.base).toBe(b?.base);
    expect(a?.base).not.toBe(snapshot);
    const events: EventMsg[] = [
      { type: 'event', tick: 1, kind: 'toll_paid', data: {} },
      { type: 'event', tick: 1, kind: 'build_paid', data: {} },
      { type: 'event', tick: 1, kind: 'node_captured', data: {} },
    ];
    const gated = gate.events(events);
    expect(gated.map((e) => e.kind)).toEqual(['node_captured']);
    expect(gate.events(events)).toBe(gated);
  });
});
