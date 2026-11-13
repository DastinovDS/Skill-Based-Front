/**
 * What the map shows in a tutorial chapter (`docs/design/tutorial.md`, sections 4.9 and 7.7): the
 * `ui` flags turned into a filter of the frame the map draws. A hidden piece is simply not in the
 * frame (the warehouse row, the pocket and starvation marks, the packets, the building marks, the
 * recruit queue, the terrain chevrons, the road forts and their toll); the VP badges, drawn from
 * the map file, are switched by the scene. Plain data, no PixiJS. Outside a chapter there is no
 * gate and the frame goes through untouched, the same object.
 */
import type { EventMsg, NodeView, UiFlag, View } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { RenderSource } from './source.ts';

/** The pieces shown; `null`: everything (a normal match). */
export type RenderGate = ReadonlySet<UiFlag> | null;

/** The flags the frame filter reads. */
const FRAME_FLAGS: readonly UiFlag[] = [
  'warehouse',
  'supply',
  'buildings',
  'recruit',
  'rally',
  'terrainMarks',
  'fort',
];

/** The gate hides something the frame carries. */
export function gatesFrame(gate: RenderGate): boolean {
  return gate !== null && FRAME_FLAGS.some((flag) => !gate.has(flag));
}

function gateNode(node: NodeView, gate: ReadonlySet<UiFlag>): NodeView {
  let out = node;
  if (!gate.has('warehouse')) {
    // The diamonds under a place and the amber sign (it needs an empty warehouse).
    out = { ...out, warehouse: null, warehouse_cap: null };
  }
  if (!gate.has('supply')) {
    out = { ...out, starve_in: null, flow_pocket: null };
  }
  if (!gate.has('buildings')) {
    out = { ...out, building: null, factory: null, factory_build: null, has_barracks: null };
  }
  if (!gate.has('recruit')) {
    out = { ...out, recruit_queue: null, recruit_progress: null, recruit_waiting: null };
  }
  if (!gate.has('rally')) out = { ...out, rally_point: null };
  if (!gate.has('terrainMarks')) out = { ...out, terrain_mark: null };
  return out;
}

/** The view with the hidden pieces left out. */
export function gateView(view: View, gate: ReadonlySet<UiFlag>): View {
  return {
    ...view,
    nodes: view.nodes.map((node) => gateNode(node, gate)),
    edges: gate.has('fort') ? view.edges : view.edges.map((edge) => ({ ...edge, forts: [] })),
    packets: gate.has('supply') ? view.packets : [],
  };
}

/** Events of hidden pieces the map would animate (a toll, a charge flying to a building). */
function hiddenEvent(event: EventMsg, gate: ReadonlySet<UiFlag>): boolean {
  const kind = event.kind;
  if (!gate.has('fort') && (kind === 'toll_paid' || kind === 'toll_taken')) return true;
  if (!gate.has('buildings') && kind === 'build_paid') return true;
  return false;
}

/**
 * The gated frames and events of one source, kept while their input and the gate stay the same:
 * the map rebuilds what it draws when the base snapshot or the event list is a new object.
 */
export class FrameGate {
  #gate: RenderGate = null;
  #base: RenderFrame['base'] | null = null;
  #gatedBase: RenderFrame['base'] | null = null;
  #events: readonly EventMsg[] | null = null;
  #gatedEvents: readonly EventMsg[] = [];

  get gate(): RenderGate {
    return this.#gate;
  }

  setGate(gate: RenderGate): void {
    if (gate === this.#gate) return;
    this.#gate = gate;
    this.#base = null;
    this.#events = null;
  }

  frame(frame: RenderFrame | null): RenderFrame | null {
    const gate = this.#gate;
    if (frame === null || gate === null || !gatesFrame(gate)) return frame;
    if (frame.base !== this.#base) {
      this.#base = frame.base;
      this.#gatedBase = { ...frame.base, view: gateView(frame.base.view, gate) };
    }
    const base = this.#gatedBase ?? frame.base;
    return {
      ...frame,
      base,
      packets: gate.has('supply') ? frame.packets : [],
    };
  }

  events(events: readonly EventMsg[]): readonly EventMsg[] {
    const gate = this.#gate;
    if (gate === null) return events;
    if (events !== this.#events) {
      this.#events = events;
      this.#gatedEvents = events.some((e) => hiddenEvent(e, gate))
        ? events.filter((e) => !hiddenEvent(e, gate))
        : events;
    }
    return this.#gatedEvents;
  }
}

/** A source seen through a fixed gate (the dev screen's `?gate=`, #806: a frozen scene gated). */
export class GatedSource implements RenderSource {
  readonly #source: RenderSource;
  readonly #gate = new FrameGate();

  constructor(source: RenderSource, gate: ReadonlySet<UiFlag>) {
    this.#source = source;
    this.#gate.setGate(gate);
  }

  get rules(): RenderSource['rules'] {
    return this.#source.rules;
  }

  get floodFrom(): RenderSource['floodFrom'] {
    return this.#source.floodFrom;
  }

  get floodHoldMs(): RenderSource['floodHoldMs'] {
    return this.#source.floodHoldMs;
  }

  frame(): RenderFrame | null {
    return this.#gate.frame(this.#source.frame());
  }

  events(): readonly EventMsg[] {
    return this.#gate.events(this.#source.events());
  }

  gate(): RenderGate {
    return this.#gate.gate;
  }
}
