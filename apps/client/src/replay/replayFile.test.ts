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

  describe('fight records of the frame key "f" (#323)', () => {
    const OLD = [7, null, 1, 1250, null, 40, 50, [3, 4]];
    const NEW = [
      ...OLD,
      [
        [2, 1],
        [0, 1],
        [1, 0],
        [40, [1, 1], [0, 1], [1, 1], [0, 1]],
      ],
    ];
    const withFights = (f: unknown[]) => ({
      ...SAMPLE,
      frames: [{ ...SAMPLE.frames[0], f }],
    });

    it('accepts a record of eight elements (an old file) and of nine (with the round data)', () => {
      expect(() => parseReplay(withFights([OLD]))).not.toThrow();
      expect(() => parseReplay(withFights([NEW]))).not.toThrow();
      expect(() => parseReplay(withFights([OLD, NEW]))).not.toThrow();
    });

    it('accepts a fight before the first round: last_round is null', () => {
      const first = [...OLD, [[0, 0], [0, 0], [1, 1], null]];
      expect(() => parseReplay(withFights([first]))).not.toThrow();
    });

    it.each([
      ['a record of seven elements', OLD.slice(0, 7)],
      ['a record of ten elements', [...NEW, 0]],
      ['a ninth element that is not a list', [...OLD, 3]],
      [
        'a ninth element of three parts',
        [
          ...OLD,
          [
            [0, 0],
            [0, 0],
            [0, 0],
          ],
        ],
      ],
      ['a pair of three numbers', [...OLD, [[0, 0, 0], [0, 0], [0, 0], null]]],
      ['a float in a pair', [...OLD, [[0.5, 0], [0, 0], [0, 0], null]]],
      [
        'a last round with a missing part',
        [
          ...OLD,
          [
            [0, 0],
            [0, 0],
            [0, 0],
            [40, [0, 0]],
          ],
        ],
      ],
    ])('refuses %s', (_name, record) => {
      expect(() => parseReplay(withFights([record]))).toThrow(
        expect.objectContaining({ code: 'invalid' }),
      );
    });
  });
});
