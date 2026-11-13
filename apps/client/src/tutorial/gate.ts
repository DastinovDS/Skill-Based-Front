/**
 * What a tutorial chapter shows (`docs/design/tutorial.md`, sections 4.9 and 7.7): the `ui` flags
 * of the current beat, and what it allows. Plain data from the chapter file and the beat the server
 * names; outside a chapter the gate is "everything" and nothing is locked, so a match changes in
 * nothing.
 */
import type { Allow, Chapter, UiFlag } from '../protocol.gen.ts';
import { beatAt } from './chapters.ts';

/** Every piece a beat can unlock (section 4.9), in the order of the table. */
export const UI_FLAGS: readonly UiFlag[] = [
  'terrainMode',
  'cp',
  'notices',
  'supply',
  'warehouse',
  'buildings',
  'factories',
  'recruit',
  'stance',
  'planned',
  'vp',
  'clock',
  'terrainMarks',
  'alerts',
  'fort',
  'groupSelect',
  'rally',
];

/** The pieces shown: a flag in the set is shown, one out of it hidden. */
export type Gate = ReadonlySet<UiFlag>;

/** A normal match: every piece shown. */
export const FULL_GATE: Gate = new Set(UI_FLAGS);

/** Nothing shown yet (a chapter before its first message). */
export const NO_GATE: Gate = new Set();

/** `gate` with `more` shown too. */
export function gateWith(gate: Gate, more: readonly UiFlag[]): Gate {
  if (more.every((flag) => gate.has(flag))) return gate;
  return new Set([...gate, ...more]);
}

/**
 * The pieces shown at beat `beat` of `chapter`: the chapter's start set, plus the `ui` of every
 * main beat up to it (a UI beat the client walked included), minus their `hide`, then the `ui` of
 * the failure beat when it is the one shown. `null`: before the first beat (chapter V).
 */
export function gateOf(chapter: Chapter, beat: string | null): Gate {
  const shown = new Set<UiFlag>(chapter.ui ?? []);
  const at = beatAt(chapter, beat);
  if (at === null) return shown;
  const upTo = at.fail ? -1 : at.index;
  for (let i = 0; i <= upTo; i++) {
    const step = chapter.beats[i];
    if (step === undefined) continue;
    for (const flag of step.ui ?? []) shown.add(flag);
    for (const flag of step.hide ?? []) shown.delete(flag);
  }
  if (at.fail) for (const flag of at.beat.ui ?? []) shown.add(flag);
  return shown;
}

/**
 * The `allow` in force at beat `beat` (section 7.3): its own, else that of the nearest beat before
 * it that has one (a UI beat never has one); a failure beat brings its own. Before the first beat
 * nothing is allowed.
 */
export function allowOf(chapter: Chapter, beat: string | null): readonly Allow[] {
  const at = beatAt(chapter, beat);
  if (at === null) return [];
  if (at.fail) return at.beat.allow ?? [];
  for (let i = at.index; i >= 0; i--) {
    const allow = chapter.beats[i]?.allow;
    if (allow !== undefined && allow !== null) return allow;
  }
  return [];
}

/** Two gates show the same pieces. */
export function sameGate(a: Gate, b: Gate): boolean {
  if (a.size !== b.size) return false;
  for (const flag of a) if (!b.has(flag)) return false;
  return true;
}
