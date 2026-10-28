import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, LOCALES, setLocale } from '../i18n/index.ts';
import { eventText, HIDDEN_EVENT_KINDS, isLogged, LOGGED_EVENT_KINDS } from './eventText.ts';
import type { HudEvent } from './hudData.ts';
import type { NodeNamer } from './nodeName.ts';
import { toastOf } from './toasts.ts';

function event(kind: string, data: HudEvent['data']): HudEvent {
  return { seq: 1, tick: 10, kind, data };
}

const initialLocale = getLocale();
const PLACES = ['Alder', 'Birch', 'Cedar', 'Dune', 'Elm'];
const names: NodeNamer = (id) => PLACES[id] ?? `#${String(id)}`;

describe('eventText', () => {
  const initial = initialLocale;
  afterEach(() => {
    setLocale(initial);
  });

  it('tells my events from the enemy ones', () => {
    setLocale('en');
    const captured = { node: 2, player: 0 };
    expect(eventText(event('node_captured', captured), 0, names)).toBe('You captured Cedar');
    expect(eventText(event('node_captured', captured), 1, names)).toBe('The enemy captured Cedar');
  });

  it('reads the losses of the viewer from losses_<player>', () => {
    setLocale('en');
    const fight = { node: 3, edge: null, losses_0: 1, losses_1: 4 };
    expect(eventText(event('fight_ended', fight), 0, names)).toBe(
      'Fight at Dune: your losses 1, enemy losses 4',
    );
    expect(eventText(event('fight_ended', fight), 1, names)).toBe(
      'Fight at Dune: your losses 4, enemy losses 1',
    );
  });

  it('uses the road text for a fight on an edge', () => {
    setLocale('en');
    const fight = { node: null, edge: 5, losses_0: 0, losses_1: 0 };
    expect(eventText(event('fight_ended', fight), 0, names)).toContain('on road 5');
  });

  it('does not show an unknown kind (never a raw kind name)', () => {
    expect(isLogged('weather')).toBe(false);
    expect(eventText(event('weather', {}), 0, names)).toBe('');
  });

  it('says what the new kinds mean', () => {
    setLocale('en');
    expect(eventText(event('attrition', { node: 4, player: 0 }), 0, names)).toBe(
      'Overcapacity at Elm: a unit was lost',
    );
    expect(eventText(event('road_upgraded', { edge: 2, width: 3 }), 0, names)).toBe(
      'Road 2 upgraded to level 3',
    );
    expect(
      eventText(event('build_started', { kind: 'road', edge: 2, width: 2, player: 0 }), 0, names),
    ).toBe('Road 2 is being upgraded to level 2');
    expect(
      eventText(event('build_stopped', { node: 4, edge: 2, reason: 'interrupted' }), 0, names),
    ).toBe('The build of road 2 was interrupted');
    // DEC-26: the barracks and the warehouse of a city.
    expect(
      eventText(event('build_started', { node: 4, kind: 'barracks', player: 0 }), 0, names),
    ).toBe('Elm builds its barracks');
    expect(eventText(event('build_stopped', { node: 4, edge: null, player: 0 }), 0, names)).toBe(
      'The build in Elm was interrupted',
    );
    expect(eventText(event('barracks_built', { node: 4, player: 0 }), 0, names)).toBe(
      'Elm has its barracks: it recruits now',
    );
    expect(eventText(event('warehouse_upgraded', { node: 4, level: 2, player: 0 }), 0, names)).toBe(
      'The warehouse of Elm is now level 2',
    );
    expect(eventText(event('packet_lost', { edge: 1, charges: 5 }), 0, names)).toBe(
      'Charges lost on road 1: 5',
    );
  });
});

// Every kind the server can send to a player (shared with the Python side, see
// packages/protocol/vectors/README.md) is either shown with a translated line or hidden on purpose.
const kindFiles = import.meta.glob<string>(
  '../../../../packages/protocol/vectors/event_kinds.json',
  { eager: true, import: 'default', query: '?raw' },
);
const kindsText = Object.values(kindFiles)[0];
if (kindsText === undefined) {
  throw new Error('event_kinds.json not found');
}
const serverKinds = (JSON.parse(kindsText) as { kinds: string[] }).kinds;

describe('the VP award stays out of the feed (ui-style U2)', () => {
  it('is neither logged nor a toast, and has no line', () => {
    const award = event('vp_awarded', { player: 0, vp: 1 });
    expect(isLogged('vp_awarded')).toBe(false);
    expect(HIDDEN_EVENT_KINDS.has('vp_awarded')).toBe(true);
    expect(eventText(award, 0, names)).toBe('');
    expect(toastOf(award, 0, names)).toBeNull();
  });
});

describe('event kinds of the server', () => {
  afterEach(() => {
    setLocale(initialLocale);
  });

  it('each is shown or hidden on purpose', () => {
    for (const kind of serverKinds) {
      expect(isLogged(kind) || HIDDEN_EVENT_KINDS.has(kind), kind).toBe(true);
      expect(isLogged(kind) && HIDDEN_EVENT_KINDS.has(kind), kind).toBe(false);
    }
  });

  it('each shown kind has a line in every language, and never a raw kind name', () => {
    for (const locale of LOCALES) {
      setLocale(locale);
      for (const kind of LOGGED_EVENT_KINDS) {
        // Enough fields for every text; the values do not matter, the line must exist.
        const data = { node: 1, edge: 1, player: 0, vp: 1, stance: 'war', width: 2, charges: 3 };
        const text = eventText(event(kind, data), 0, names);
        expect(text, `${locale} ${kind}`).not.toBe('');
        expect(text, `${locale} ${kind}`).not.toMatch(/[a-z]+_[a-z]+/); // no raw `snake_case` kind
      }
    }
  });
});
