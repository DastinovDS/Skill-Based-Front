/**
 * The coach of a tutorial chapter (`docs/design/tutorial.md`, sections 4.0 and 7.7): which card
 * shows, what is shown and what is allowed, from the `tutorial` messages of the server. The server
 * walks the beats (triggers, pauses, locks, the goal); the client only walks the UI beats (a
 * selection, between two server beats), pages the slides of a card and keeps the last card of a
 * goal with Continue before the result. No rule is decided here (`AGENTS.md` 7.1).
 *
 * `current` is replaced on a change only (a beat, a pause, a selection that starts a UI beat), not
 * per snapshot: the HUD and the map read it once per beat.
 *
 * Review 4 (#1047): a beat shows only once the map has drawn its tick (`TutorialMsg.tick`, P1: the
 * card speaks about what is seen; the map reports its tick through `onRender`); a card goes once
 * the player did what it asks (P2: Continue, or the orders it asks for standing); a focus beat
 * shows no card, only the places it lights (P5).
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
  /** A focus phase (P5): no card, the map lights these places; null otherwise. */
  readonly focus: readonly Mark[] | null;
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
  /**
   * A beat whose tick the map has not drawn after this long (ms) shows anyway: a map that draws
   * nothing (no WebGL) never holds the chapter. Default `BEAT_FALLBACK_MS`.
   */
  fallbackMs?: number;
}

/** How long a beat waits for the map to draw its tick before it shows anyway (ms). */
export const BEAT_FALLBACK_MS = 3000;

/**
 * The orders of `allow` that stand: the accepted commands of every entry, a cancel taking one back
 * (I.5: the army sent, called back, sent again).
 */
export function standingOrders(allow: readonly Allow[], used: readonly number[]): number {
  let n = 0;
  allow.forEach((entry, i) => {
    const count = used[i] ?? 0;
    n += entry.cancel_order != null ? -count : count;
  });
  return n;
}

/** The beats of a chapter that show a card (a focus beat does not): the step lozenges. */
function cardBeats(chapter: Chapter): readonly Beat[] {
  return chapter.beats.filter((b) => b.focus == null);
}

/** A selection the UI beats look at: the node the selected own group stands in, or none. */
export type SelectedGroup = { readonly node: number | null } | null;

export class TutorialCoach {
  readonly chapter: Chapter;
  current = $state.raw<CoachView>({
    card: null,
    focus: null,
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
  /** The latest message of the server. */
  #msg: TutorialMsg | null = null;
  /** The message whose beat is shown: the latest once the map has drawn its tick. */
  #shown: TutorialMsg | null = null;
  /** The tick the map has drawn (the base snapshot of its frame). */
  #rendered = -Infinity;
  #fallback: ReturnType<typeof setTimeout> | undefined;
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
    this.#msg = msg;
    this.#settle();
  }

  /**
   * The map drew the snapshot of `tick` (every frame; cheap when nothing waits): a beat waiting
   * for its tick shows now.
   */
  onRender(tick: number): void {
    if (tick <= this.#rendered) return;
    this.#rendered = tick;
    const msg = this.#msg;
    if (msg !== null && msg !== this.#shown && msg.tick <= tick) this.#settle();
  }

  /** The beat of the latest message shows when the map has drawn its tick (or the wait ran out). */
  #settle(force = false): void {
    const msg = this.#msg;
    if (msg === null) return;
    const sameBeat = this.#shown !== null && this.#shown.beat === msg.beat;
    if (!sameBeat && !force && msg.tick > this.#rendered) {
      clearTimeout(this.#fallback);
      this.#fallback = setTimeout(() => {
        if (this.#msg === msg) this.#settle(true);
      }, this.#o.fallbackMs ?? BEAT_FALLBACK_MS);
      // The pause and the locks are the server's now; the card waits.
      this.#publish();
      return;
    }
    clearTimeout(this.#fallback);
    const beatChanged = this.#shown?.beat !== msg.beat;
    this.#shown = msg;
    if (beatChanged) this.#uiBeat = null;
    const at = beatAt(this.chapter, msg.beat);
    if (at !== null && !at.fail) this.#lastMain = msg.beat;
    if (at?.fail === true && beatChanged) this.#failUi = [...this.#failUi, ...(at.beat.ui ?? [])];
    this.#publish();
  }

  /**
   * The selection changed: a UI beat after the current one begins when the selected own group
   * stands where its trigger says (any own group when it names none). It stays until the server
   * names another beat.
   */
  onSelection(selected: SelectedGroup): void {
    if (this.#uiBeat !== null || selected === null || this.#shown === null) return;
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

  /** The HUD pieces the card (or the focus phase) marks. */
  hudMarks(): readonly HudPiece[] {
    const out: HudPiece[] = [];
    const marks = this.current.card?.marks ?? this.current.focus ?? [];
    for (const mark of marks) if (mark.hud != null) out.push(mark.hud);
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
    const msg = this.#shown;
    if (msg === null) return null;
    if (this.#uiBeat !== null) return beatAt(this.chapter, this.#uiBeat);
    return beatAt(this.chapter, msg.beat);
  }

  /**
   * The player did what the shown card asks (P2): Continue on a card that asks for nothing more,
   * or the orders it asks for stand (`acts`, a cancel takes one back). Its marks go with it.
   */
  #done(beat: Beat, msg: TutorialMsg): boolean {
    if (msg.paused || beat.with_goal === true) return false;
    // A UI beat asks for the command of the server beat it stands in.
    const server = beatAt(this.chapter, msg.beat)?.beat ?? beat;
    const allow = allowOf(this.chapter, msg.beat);
    const asks = server.allow != null && server.allow.length > 0;
    if (asks) return standingOrders(allow, msg.used) >= (server.acts ?? 1);
    return server.pause === 'continue';
  }

  #publish(): void {
    const msg = this.#shown;
    const latest = this.#msg;
    const shown = this.#shownBeat();
    const gateBeat = this.#uiBeat ?? (shown?.fail === true ? this.#lastMain : (msg?.beat ?? null));
    const gate = gateWith(gateOf(this.chapter, gateBeat), [
      ...this.#failUi,
      ...(shown?.fail === true ? (shown.beat.ui ?? []) : []),
    ]);
    let card: CoachCard | null = null;
    let focus: readonly Mark[] | null = null;
    // A beat that waits for its tick shows nothing yet.
    const waiting = latest !== null && latest !== msg && latest.beat !== msg?.beat;
    if (shown !== null && msg !== null && !waiting) {
      const { beat } = shown;
      if (beat.focus != null) {
        focus = beat.mark ?? [];
      } else if (!this.#done(beat, msg)) {
        // A UI beat keeps the pause of the server beat before it: it never has a Continue.
        const ui = this.#uiBeat !== null;
        const goalCard = beat.with_goal === true && msg.done && !this.#goalContinued;
        const cards = cardBeats(this.chapter);
        card = {
          id: beat.id,
          key: `tutorial.${this.chapter.id}.${beat.id}`,
          step: shown.fail ? 0 : cards.indexOf(beat) + 1,
          steps: cards.length,
          fail: shown.fail,
          slides: Math.max(1, beat.slides ?? 1),
          marks: beat.mark ?? [],
          turns: beat.turns !== undefined && beat.turns.length > 0 ? beat.turns : null,
          canContinue: (!ui && beat.pause === 'continue' && msg.paused) || goalCard,
        };
      }
    }
    // A card or a focus phase that begins starts its motion again (a focus beat's id is its own).
    const showing = card?.id ?? (focus !== null ? (shown?.beat.id ?? null) : null);
    if (showing !== this.#cardId) {
      this.#cardId = showing;
      this.#seq += 1;
      this.slide = 0;
    }
    this.current = {
      card,
      focus,
      paused: latest?.paused ?? false,
      gate,
      allow: allowOf(this.chapter, latest?.beat ?? null),
      used: latest?.used ?? [],
      done: latest?.done ?? false,
      seq: this.#seq,
    };
  }
}
