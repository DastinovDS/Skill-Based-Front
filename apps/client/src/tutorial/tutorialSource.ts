/**
 * The map's source in a tutorial chapter (#806): the match session's frames filtered by the gate of
 * the current beat (`render/renderGate.ts`), and the goal marks of the card on screen resolved to
 * node ids for the map (`render/coachMarkView.ts`). Plain TypeScript.
 */
import type { EventMsg, MapFile, Terrain } from '../protocol.gen.ts';
import { t } from '../i18n/index.ts';
import type { RenderFrame } from '../net/interpolate.ts';
import type { CoachMarks } from '../render/coachMarks.ts';
import { FrameGate, type RenderGate } from '../render/renderGate.ts';
import type { RenderSource } from '../render/source.ts';
import { nodeNamed } from './chapters.ts';
import type { TutorialCoach } from './coach.svelte.ts';

const TERRAINS: readonly Terrain[] = ['plains', 'forest', 'mountains'];

export class TutorialSource implements RenderSource {
  readonly #session: RenderSource;
  readonly #coach: TutorialCoach;
  readonly #map: MapFile;
  /** The node whose city menu is open now, or null (a menu mark then marks the item, not the place). */
  readonly #menuAt: () => number | null;
  readonly #gate = new FrameGate();
  #marks: CoachMarks | null = null;
  #marksKey = '';

  constructor(
    session: RenderSource,
    coach: TutorialCoach,
    map: MapFile,
    menuAt: () => number | null = () => null,
  ) {
    this.#session = session;
    this.#coach = coach;
    this.#map = map;
    this.#menuAt = menuAt;
  }

  get rules(): RenderSource['rules'] {
    return this.#session.rules;
  }

  get floodFrom(): RenderSource['floodFrom'] {
    return this.#session.floodFrom;
  }

  get floodHoldMs(): RenderSource['floodHoldMs'] {
    return this.#session.floodHoldMs;
  }

  frame(): RenderFrame | null {
    this.#gate.setGate(this.#coach.current.gate);
    return this.#gate.frame(this.#session.frame());
  }

  events(): readonly EventMsg[] {
    this.#gate.setGate(this.#coach.current.gate);
    return this.#gate.events(this.#session.events());
  }

  gate(): RenderGate {
    return this.#coach.current.gate;
  }

  coachMarks(): CoachMarks | null {
    const view = this.#coach.current;
    const card = view.card;
    // The result (Seal) stands over the last frame: no marks under it.
    if (card === null || this.#coach.sealed) return null;
    const menuAt = this.#menuAt();
    const key = `${String(view.seq)}:${String(menuAt)}`;
    if (key === this.#marksKey) return this.#marks;
    const sameCard = this.#marks !== null && this.#marks.seq === view.seq;
    this.#marksKey = key;
    const id = (name: string | null | undefined): number | undefined =>
      name === null || name === undefined ? undefined : nodeNamed(this.#map, name);
    const nodes: { id: number; ring: boolean }[] = [];
    const groupsAt: number[] = [];
    const roads: (readonly [number, number])[] = [];
    const vpBadges: number[] = [];
    for (const mark of card.marks) {
      const node = id(mark.node);
      if (node !== undefined) nodes.push({ id: node, ring: mark.ring === true });
      const group = id(mark.group);
      if (group !== undefined) groupsAt.push(group);
      const badge = id(mark.vp_badge);
      if (badge !== undefined) vpBadges.push(badge);
      if (mark.road != null) {
        const a = id(mark.road[0]);
        const b = id(mark.road[1]);
        if (a !== undefined && b !== undefined) roads.push([a, b]);
      }
      // A menu item: the place until its menu is open, then the HTML marks the item itself.
      const at = id(mark.at);
      if (mark.menu != null && at !== undefined && menuAt !== at)
        nodes.push({ id: at, ring: false });
    }
    const turns =
      card.turns?.map((turn) => ({
        label: TERRAINS.some((x) => x === turn.word)
          ? t(`terrain.${turn.word as Terrain}`)
          : turn.word,
        nodes: turn.nodes.map((name) => id(name)).filter((n): n is number => n !== undefined),
      })) ?? null;
    this.#marks = {
      seq: view.seq,
      // A menu opening keeps the card's motion where it is.
      since: sameCard && this.#marks !== null ? this.#marks.since : performance.now(),
      nodes,
      groupsAt,
      roads,
      vpBadges,
      turns,
    };
    return this.#marks;
  }
}
