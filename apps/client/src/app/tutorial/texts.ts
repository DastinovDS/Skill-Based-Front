/**
 * The words of a chapter on the tutorial screens (#806): its name, its line, its goals, its lessons,
 * all from the dictionary (`tutorial.<id>.*`, `AGENTS.md` 7.4).
 */
import { t, tf, type MessageKey } from '../../i18n/index.ts';
import type { Chapter, ChapterId } from '../../protocol.gen.ts';
import { GOAL_COUNT, numeral } from '../../tutorial/chapters.ts';

export function chapterName(chapter: Pick<Chapter, 'id'>): string {
  return t(`tutorial.${chapter.id}.name`);
}

export function chapterWhy(chapter: Pick<Chapter, 'id'>): string {
  return t(`tutorial.${chapter.id}.why`);
}

export function chapterLength(chapter: Pick<Chapter, 'id'>): string {
  return t(`tutorial.${chapter.id}.length`);
}

/** "Chapter I", "Advanced I": the eyebrow of a chapter on Charter and the Seal. */
export function chapterKicker(chapter: Chapter): string {
  return tf(chapter.road === 'main' ? 'tutorial.eyebrow.chapter' : 'tutorial.eyebrow.advanced', {
    n: numeral(chapter),
  });
}

/** The head of a card: "I · Units and movement", "Advanced I · Group orders". */
export function cardKicker(chapter: Chapter): string {
  return tf(chapter.road === 'main' ? 'tutorial.card.kicker' : 'tutorial.card.kickerAdvanced', {
    n: numeral(chapter),
    name: chapterName(chapter),
  });
}

/** The goals of the intro. */
export function goalsOf(id: ChapterId): string[] {
  const out: string[] = [];
  for (let i = 1; i <= GOAL_COUNT[id]; i++)
    out.push(t(`tutorial.${id}.goal${String(i)}` as MessageKey));
  return out;
}

/** The three lessons of the Seal. */
export function lessonsOf(chapter: Pick<Chapter, 'id'>): string[] {
  return [1, 2, 3].map((i) => t(`tutorial.${chapter.id}.lesson${String(i)}` as MessageKey));
}
