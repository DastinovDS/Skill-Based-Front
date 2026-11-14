/**
 * The map's source in the first match (#806, section 5): the match session's frames as they are
 * (the gate is "everything"), plus the Compass mark of the hint on screen (`render/coachMarkView.ts`).
 * Plain TypeScript.
 */
import type { EventMsg } from '../protocol.gen.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { CoachMarks } from '../render/coachMarks.ts';
import type { RenderSource } from '../render/source.ts';
import type { HintShow } from './hints.ts';

/** The marks of one hint: the wide ring round a place over its capacity or in a fight. */
export function hintMarks(hint: HintShow, seq: number, since: number): CoachMarks {
  const wide = hint.id === 'H2' || hint.id === 'H4';
  return {
    seq,
    since,
    nodes: hint.node === null ? [] : [{ id: hint.node, ring: wide }],
    groupsAt: [],
    roads: hint.road === null ? [] : [hint.road],
    vpBadges: [],
    capacities: [],
    warehouses: [],
    counts: [],
    turns: null,
    focus: false,
  };
}

export class HintSource implements RenderSource {
  readonly #session: RenderSource;
  readonly #hint: () => { readonly hint: HintShow | null; readonly seq: number };
  #marks: CoachMarks | null = null;

  constructor(
    session: RenderSource,
    hint: () => { readonly hint: HintShow | null; readonly seq: number },
  ) {
    this.#session = session;
    this.#hint = hint;
  }

  get rules(): RenderSource['rules'] {
    return this.#session.rules;
  }

  frame(): RenderFrame | null {
    return this.#session.frame();
  }

  events(): readonly EventMsg[] {
    return this.#session.events();
  }

  coachMarks(): CoachMarks | null {
    const { hint, seq } = this.#hint();
    if (hint === null) {
      this.#marks = null;
      return null;
    }
    if (this.#marks?.seq !== seq) this.#marks = hintMarks(hint, seq, performance.now());
    return this.#marks;
  }
}
