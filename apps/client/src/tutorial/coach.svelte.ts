/**
 * The coach of a tutorial chapter (`docs/design/tutorial.md`, sections 4.0 and 7.7): which card
 * shows, what is shown and what is allowed, from the `tutorial` messages of the server. The server
 * walks the beats (triggers, pauses, locks, the goal); the client only walks the UI beats (a
 * selection, between two server beats), pages the slides of a card and keeps the last card of a
 * goal with Continue before the result. No rule is decided here (`AGENTS.md` 7.1).
 *
 * `current` is replaced on a change only (a beat, a pause, a selection that starts a UI beat), not
 * per snapshot: the HUD and the map read it once per beat.
 */
import type {
  Allow,
  Beat,
  Chapter,
  Command,
  HudPiece,
  Mark,
  MenuItem,
  TutorialMsg,
  Turn,
  UiFlag,
} from '../protocol.gen.ts';
import { admits, commandAllowed, type AllowContext, type CommandFacts } from './allow.ts';
import { beatAt, nodeNamed } from './chapters.ts';
import { allowOf, gateOf, gateWith, NO_GATE, type Gate } from './gate.ts';

/** The card on screen. */
export interface CoachCard {
  /** The beat shown (a UI beat the client walked included). */
  readonly id: string;
  /** The dictionary key of its text, `tutorial.<chapter>.<beat>`. */
  readonly key: string;
  /** 1-based place among the chapter's beats (the step lozenges); 0 for the failure card. */
  readonly step: number;
  readonly steps: number;
  /** The failure card (IV.F): "Try again" in its head instead of the steps. */
  readonly fail: boolean;
  /** Slides of the card (IV.2: 3), 1 for a plain card. */
  readonly slides: number;
  readonly marks: readonly Mark[];
  /** The marks in turn (I.7), or null. */
  readonly turns: readonly Turn[] | null;
  /** The card has a Continue button: a `continue` pause, or the last card of a goal (A1.5). */
  readonly canContinue: boolean;
}

export interface CoachView {
  readonly card: CoachCard | null;
  /** The simulation waits for the card (the "Paused" plate). */
  readonly paused: boolean;
  /** The pieces shown. */
  readonly gate: Gate;
  /** The `allow` in force and the server's counts of it. */
  readonly allow: readonly Allow[];
  readonly used: readonly number[];
  /** The goal holds: the chapter ends with the next tick. */
  readonly done: boolean;
  /** Bumped whenever another card shows: the card and the marks start their motion again. */
  readonly seq: number;
}

export interface CoachOptions {
  /** "Continue" of a `continue` card: the `resume` message. */
  resume: () => void;
  /** The places of the chapter's map and the node an own group stands in. */
  context: AllowContext;
}

/** A selection the UI beats look at: the node the selected own group stands in, or none. */
export type SelectedGroup = { readonly node: number | null } | null;

export class TutorialCoach {
  readonly chapter: Chapter;
  current = $state.raw<CoachView>({
    card: null,
    paused: false,
    gate: NO_GATE,
    allow: [],
    used: [],
    done: false,
    seq: 0,
  });
  /** The slide of the card on screen (0-based); a new card starts at 0. */
  slide = $state(0);
  /** Bumped when a control or a command was refused by the lock: the action line pulses. */
  pulse = $state(0);
  /** The result (Seal) shows: the goal held, the match ended and the last card was continued. */
  sealed = $state(false);

  readonly #o: CoachOptions;
  #msg: TutorialMsg | null = null;
  /** The UI beat shown between two server beats (a selection), or null. */
  #uiBeat: string | null = null;
  /** The last main beat the server named: a failure card does not move it. */
  #lastMain: string | null = null;
  /** The pieces the failure beats seen in this session unlocked. */
  #failUi: UiFlag[] = [];
  #seq = 0;
  #cardId: string | null = null;
  #ended = false;
  #goalContinued = false;

  constructor(chapter: Chapter, options: CoachOptions) {
    this.chapter = chapter;
    this.#o = options;
    this.#publish();
  }

  /** A `tutorial` message of the server. */
  onMessage(msg: TutorialMsg): void {
    const beatChanged = this.#msg?.beat !== msg.beat;
    this.#msg = msg;
    if (beatChanged) this.#uiBeat = null;
    const at = beatAt(this.chapter, msg.beat);
    if (at !== null && !at.fail) this.#lastMain = msg.beat;
    if (at?.fail === true) this.#failUi = [...this.#failUi, ...(at.beat.ui ?? [])];
    this.#publish();
  }

  /**
   * The selection changed: a UI beat after the current one begins when the selected own group
   * stands where its trigger says (any own group when it names none). It stays until the server
   * names another beat.
   */
  onSelection(selected: SelectedGroup): void {
    if (this.#uiBeat !== null || selected === null || this.#msg === null) return;
    const after = beatAt(this.chapter, this.#lastMain);
    if (after === null) return;
    const next = this.chapter.beats[after.index + 1];
    if (next?.on.ui !== 'select') return;
    const want = next.on.group;
    if (want !== null && want !== undefined) {
      if (selected.node === null || nodeNamed(this.#o.context.map, want) !== selected.node) return;
    }
    this.#uiBeat = next.id;
    this.#publish();
  }

  /** "Continue" on the card: the server resumes; on the last card of a goal the result shows. */
  continue(): void {
    const card = this.current.card;
    if (card === null || !card.canContinue) return;
    const beat = beatAt(this.chapter, card.id)?.beat;
    if (beat?.with_goal === true && this.current.done) {
      this.#goalContinued = true;
      if (this.#ended) this.sealed = true;
      this.#publish();
      return;
    }
    this.#o.resume();
  }

  /** "Next" on a card with slides. */
  nextSlide(): void {
    const card = this.current.card;
    if (card !== null && this.slide < card.slides - 1) this.slide += 1;
  }

  /**
   * The match ended with the goal: the result shows now, or after Continue on a card that fires
   * with the goal (A1.5).
   */
  finish(): void {
    this.#ended = true;
    const card = this.current.card;
    const beat = card === null ? undefined : beatAt(this.chapter, card.id)?.beat;
    if (beat?.with_goal === true && !this.#goalContinued) {
      this.#publish();
      return;
    }
    this.sealed = true;
  }

  /** A control or a command the beat does not allow was used: the action line pulses. */
  refused(): void {
    this.pulse += 1;
  }

  /** The piece is shown. */
  shows(flag: UiFlag): boolean {
    return this.current.gate.has(flag);
  }

  /** The command is allowed now (leaving always is). */
  allows(cmd: Command): boolean {
    const view = this.current;
    return commandAllowed(view.allow, view.used, cmd, this.#o.context);
  }

  /** A command of these facts (unknown fields match any) is allowed now: a menu item's probe. */
  allowsFacts(facts: CommandFacts): boolean {
    const view = this.current;
    return admits(view.allow, view.used, facts, this.#o.context.map);
  }

  /** The HUD pieces the card marks. */
  hudMarks(): readonly HudPiece[] {
    const out: HudPiece[] = [];
    for (const mark of this.current.card?.marks ?? []) if (mark.hud != null) out.push(mark.hud);
    return out;
  }

  /** The menu items the card marks, with the node whose menu holds each. */
  menuMarks(): readonly { readonly item: MenuItem; readonly node: number }[] {
    const out: { item: MenuItem; node: number }[] = [];
    for (const mark of this.current.card?.marks ?? []) {
      if (mark.menu == null || mark.at == null) continue;
      const node = nodeNamed(this.#o.context.map, mark.at);
      if (node !== undefined) out.push({ item: mark.menu, node });
    }
    return out;
  }

  #shownBeat(): { beat: Beat; index: number; fail: boolean } | null {
    const msg = this.#msg;
    if (msg === null) return null;
    if (this.#uiBeat !== null) return beatAt(this.chapter, this.#uiBeat);
    return beatAt(this.chapter, msg.beat);
  }

  #publish(): void {
    const msg = this.#msg;
    const shown = this.#shownBeat();
    const gateBeat = this.#uiBeat ?? (shown?.fail === true ? this.#lastMain : (msg?.beat ?? null));
    const gate = gateWith(gateOf(this.chapter, gateBeat), [
      ...this.#failUi,
      ...(shown?.fail === true ? (shown.beat.ui ?? []) : []),
    ]);
    let card: CoachCard | null = null;
    if (shown !== null && msg !== null) {
      const { beat } = shown;
      // A UI beat keeps the pause of the server beat before it: it never has a Continue.
      const ui = this.#uiBeat !== null;
      const goalCard = beat.with_goal === true && msg.done && !this.#goalContinued;
      card = {
        id: beat.id,
        key: `tutorial.${this.chapter.id}.${beat.id}`,
        step: shown.fail ? 0 : shown.index + 1,
        steps: this.chapter.beats.length,
        fail: shown.fail,
        slides: Math.max(1, beat.slides ?? 1),
        marks: beat.mark ?? [],
        turns: beat.turns !== undefined && beat.turns.length > 0 ? beat.turns : null,
        canContinue: (!ui && beat.pause === 'continue' && msg.paused) || goalCard,
      };
    }
    if ((card?.id ?? null) !== this.#cardId) {
      this.#cardId = card?.id ?? null;
      this.#seq += 1;
      this.slide = 0;
    }
    this.current = {
      card,
      paused: msg?.paused ?? false,
      gate,
      allow: allowOf(this.chapter, msg?.beat ?? null),
      used: msg?.used ?? [],
      done: msg?.done ?? false,
      seq: this.#seq,
    };
  }
}
