/**
 * The marks on the replay timeline (ui-style 13.7): a fight is a dot, a capture a diamond in the
 * colour of the side that took the city. Read from the file's events; nothing is decided here.
 */
import type { PlayerId } from '../protocol.gen.ts';
import type { ReplayFile } from './replayFile.ts';

export interface TimelineMark {
  readonly tick: number;
  readonly kind: 'fight' | 'capture';
  /** The side that took the city (a capture); a fight belongs to neither. */
  readonly side: PlayerId | null;
}

/**
 * One mark per fight start (`fight_started`, DEC-24; the old instant `fight` of files up to sim 9)
 * and per capture (`node_captured`), ascending by tick. A capture of a neutral city counts: it
 * is what the player sees on the map.
 */
export function replayMarks(events: ReplayFile['events']): TimelineMark[] {
  const marks: TimelineMark[] = [];
  const legacy = events.every(([, kind]) => kind !== 'fight_started');
  for (const [tick, kind, data] of events) {
    if (kind === 'fight_started' || (legacy && kind === 'fight')) {
      marks.push({ tick, kind: 'fight', side: null });
    } else if (kind === 'node_captured' && (data.player === 0 || data.player === 1)) {
      marks.push({ tick, kind: 'capture', side: data.player });
    }
  }
  return marks;
}
