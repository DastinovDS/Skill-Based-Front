import { describe, expect, it } from 'vitest';
import { FIXTURE_SCENES, frozenSource, parseFlood } from './scenarios.ts';

describe('a capture under way on a frozen scene (#819, `?flood=`)', () => {
  it('reads the age and the owners before', () => {
    expect(parseFlood('300,4:1,5:0,7:n')).toEqual({
      ms: 300,
      nodes: [
        { node: 4, from: 1 },
        { node: 5, from: 0 },
        { node: 7, from: null },
      ],
    });
    for (const bad of [null, '', '300', 'x,4:1', '300,4', '300,4:2', '-5,4:1']) {
      expect(parseFlood(bad)).toBeNull();
    }
  });

  it('gives the scene the owners before, the age and a flag event as old', () => {
    const scene = FIXTURE_SCENES.find((s) => s.id === 'artery');
    if (scene === undefined) throw new Error('no artery scene');
    const source = frozenSource(scene, undefined, { ms: 300, nodes: [{ node: 4, from: 1 }] });
    expect(source.floodHoldMs).toBe(300);
    expect(source.floodFrom?.[4]).toBe(1);
    expect(source.floodFrom?.[0]).toBe(scene.snapshot.view.nodes[0]?.owner);
    // The flag of the capture is 0.3 s old at the frame drawn.
    const captured = source.events().find((e) => e.kind === 'node_captured');
    expect(captured?.data).toEqual({ node: 4, player: 0 });
    expect((source.frame()?.tick ?? 0) - (captured?.tick ?? 0)).toBeCloseTo(3);
  });
});
