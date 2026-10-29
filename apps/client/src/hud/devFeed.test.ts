import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP } from '../map/bundledMaps.ts';
import { tracked } from '../net/eventFields.fixture.ts';
import { devEvent, devFightEvents } from './devFeed.ts';

describe('the made-up events of the dev feed (ARC-02)', () => {
  it('have only fields the server sends for their kind', () => {
    const kinds = new Set<string>();
    for (let tick = 0; tick < 1500; tick += 1) {
      const events = [
        devEvent(DEFAULT_MAP, tick) ?? [],
        ...devFightEvents(DEFAULT_MAP, tick),
      ].flat();
      for (const { kind, data } of events) {
        kinds.add(kind);
        tracked(kind, data); // fails on a field the server does not send
        expect(Object.keys(data).length).toBeGreaterThan(0);
      }
    }
    expect([...kinds].sort()).toEqual(
      ['fight_ended', 'fight_round', 'fight_started', 'node_captured', 'vp_awarded'].sort(),
    );
  });
});
