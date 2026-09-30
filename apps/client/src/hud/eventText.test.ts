import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { eventText } from './eventText.ts';
import type { HudEvent } from './hudData.ts';

function event(kind: string, data: HudEvent['data']): HudEvent {
  return { seq: 1, tick: 10, kind, data };
}

describe('eventText', () => {
  const initial = getLocale();
  afterEach(() => {
    setLocale(initial);
  });

  it('tells my events from the enemy ones', () => {
    setLocale('en');
    const captured = { node: 2, player: 0 };
    expect(eventText(event('node_captured', captured), 0)).toBe('You captured node 2');
    expect(eventText(event('node_captured', captured), 1)).toBe('The enemy captured node 2');
  });

  it('reads the losses of the viewer from losses_<player>', () => {
    setLocale('en');
    const fight = { node: 3, edge: null, losses_0: 1, losses_1: 4 };
    expect(eventText(event('fight', fight), 0)).toBe(
      'Fight at node 3: your losses 1, enemy losses 4',
    );
    expect(eventText(event('fight', fight), 1)).toBe(
      'Fight at node 3: your losses 4, enemy losses 1',
    );
  });

  it('uses the road text for a fight on an edge', () => {
    setLocale('ru');
    const fight = { node: null, edge: 5, losses_0: 0, losses_1: 0 };
    expect(eventText(event('fight', fight), 0)).toContain('дороге 5');
  });

  it('shows the kind of an unknown event', () => {
    setLocale('en');
    expect(eventText(event('weather', {}), 0)).toBe('Event: weather');
  });
});
