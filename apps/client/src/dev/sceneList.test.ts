import { expect, test } from 'vitest';
import { SCENES } from '../../visual/scenes.ts';
import { FIXTURE_SCENES } from './scenarios.ts';

// `mise run shots` and the reference test shoot the scenes of visual/scenes.ts: a new scene of
// scenarios.ts has to be listed there (with its tick), or nobody would ever look at it.
test('visual/scenes.ts lists every fixture scene of the dev screen with its tick', () => {
  const byId = (a: readonly [string, number], b: readonly [string, number]) =>
    a[0].localeCompare(b[0]);
  expect(SCENES.map((scene) => [scene.id, scene.tick] as const).sort(byId)).toEqual(
    FIXTURE_SCENES.map((scene) => [scene.id, scene.snapshot.tick] as const).sort(byId),
  );
});
