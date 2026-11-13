import { describe, expect, it } from 'vitest';
import { parseHint } from './hintPin.ts';

describe('parseHint', () => {
  it('pins a hint at a node, or the two versions of H3 at the HUD', () => {
    expect(parseHint('H2,3')).toEqual({ id: 'H2', variant: null, node: 3, road: null, hud: null });
    expect(parseHint('H3')?.hud).toBe('stance');
    expect(parseHint('H3cp')).toMatchObject({ id: 'H3', variant: 'cp', hud: 'cp' });
  });

  it('ignores anything else', () => {
    expect(parseHint(null)).toBeNull();
    expect(parseHint('H9,1')).toBeNull();
    expect(parseHint('H1')).toBeNull();
  });
});
