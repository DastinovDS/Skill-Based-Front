import { describe, expect, it } from 'vitest';
import { SAMPLE, SAMPLE_RAW } from './fixture.ts';
import { parseReplay, ReplayError } from './replayFile.ts';

describe('parseReplay', () => {
  it('reads a frames file of the current format', () => {
    expect(SAMPLE.format).toBe(1);
    expect(SAMPLE.frames[0]?.t).toBe(0);
    expect(SAMPLE.frames.at(-1)?.t).toBe(SAMPLE.ticks);
    expect(SAMPLE.map.meta.name).toBe('siege');
  });

  it('refuses an unknown format', () => {
    const next = { ...(SAMPLE_RAW as object), format: 2 };
    expect(() => parseReplay(next)).toThrow(expect.objectContaining({ code: 'format' }));
  });

  it.each([null, 'text', [], {}, { format: 1 }, { ...(SAMPLE_RAW as object), frames: [] }])(
    'refuses what is not a replay: %j',
    (value) => {
      expect(() => parseReplay(value)).toThrow(ReplayError);
    },
  );

  it('refuses frames that do not fit the map', () => {
    const broken = { ...SAMPLE, frames: [{ ...SAMPLE.frames[0], n: [] }] };
    expect(() => parseReplay(broken)).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  it('refuses a frame whose city builds are not a list', () => {
    const broken = { ...SAMPLE, frames: [{ ...SAMPLE.frames[0], b: 3 }] };
    expect(() => parseReplay(broken)).toThrow(expect.objectContaining({ code: 'invalid' }));
  });
});
