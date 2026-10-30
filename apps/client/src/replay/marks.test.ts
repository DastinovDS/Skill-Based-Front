import { describe, expect, it } from 'vitest';
import { SAMPLE, SAMPLE_FIGHTS } from './fixture.ts';
import { replayMarks } from './marks.ts';

describe('replayMarks', () => {
  it('marks fight starts and captures of a file with fights', () => {
    const marks = replayMarks(SAMPLE_FIGHTS.events);
    expect(marks.filter((m) => m.kind === 'fight').map((m) => m.tick)).toEqual([
      172, 179, 272, 364, 439,
    ]);
    expect(marks.filter((m) => m.kind === 'capture')).toEqual([
      { tick: 89, kind: 'capture', side: 1 },
      { tick: 100, kind: 'capture', side: 0 },
      { tick: 113, kind: 'capture', side: 1 },
      { tick: 198, kind: 'capture', side: 1 },
      { tick: 241, kind: 'capture', side: 1 },
      { tick: 464, kind: 'capture', side: 1 },
    ]);
  });

  it('reads the instant fight of an older file', () => {
    const marks = replayMarks(SAMPLE.events);
    expect(marks.filter((m) => m.kind === 'fight').map((m) => m.tick)).toEqual([265, 409]);
  });

  it('is ascending by tick', () => {
    const ticks = replayMarks(SAMPLE_FIGHTS.events).map((m) => m.tick);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });
});
