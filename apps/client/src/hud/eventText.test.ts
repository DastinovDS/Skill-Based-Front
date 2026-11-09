import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, LOCALES, setLocale } from '../i18n/index.ts';
import { eventText, HIDDEN_EVENT_KINDS, isLogged, LOGGED_EVENT_KINDS } from './eventText.ts';
import { declaredFields, expectDeclared, filledData, tracked } from '../net/eventFields.fixture.ts';
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

  it('tells the supply lines and the builds of economy v2 by the names of their places (#649)', () => {
    setLocale('en');
    const line = { player: 0, line: 3, from_node: 0, to_node: 2 };
    expect(eventText(event('line_cut', line), 0, names)).toBe(
      'Supply line Alder → Cedar is cut: draw it again',
    );
    expect(eventText(event('line_rerouted', line), 0, names)).toBe(
      'Supply line Alder → Cedar goes another way',
    );
    expect(eventText(event('line_auto', line), 0, names)).toBe(
      'Supply line Alder → Cedar drawn by itself',
    );
    expect(eventText(event('factory_built', { player: 0, node: 1 }), 0, names)).toBe(
      'Birch is a factory now: it makes charges',
    );
    const started = { player: 0, node: 4, kind: 'fort', level: null, edge: null, width: null };
    expect(eventText(event('build_started', started), 0, names)).toBe('Elm builds a bunker');
    expect(toastOf(event('line_cut', line), 0, names)?.tone).toBe('warn');
  });

  it('tells road fortifications (DEC-43, item D): a line done, lost with its city, a toll paid or taken (#707)', () => {
    setLocale('en');
    for (const kind of ['road_fort_built', 'road_fort_destroyed', 'toll_paid', 'toll_taken']) {
      expect(isLogged(kind), kind).toBe(true);
      expect(HIDDEN_EVENT_KINDS.has(kind), kind).toBe(false);
    }
    expect(eventText(event('road_fort_built', { player: 0, node: 2, edge: 7 }), 0, names)).toBe(
      'The line of Cedar on road 7 is ready: it takes its toll',
    );
    const lost = { player: 0, node: 2, edge: 7, built: true };
    expect(eventText(event('road_fort_destroyed', lost), 0, names)).toBe(
      'The line of Cedar on road 7 is lost with the city',
    );
    expect(eventText(event('road_fort_destroyed', { ...lost, built: false }), 0, names)).toBe(
      'The unfinished line of Cedar on road 7 is lost with the city',
    );
    const paid = { player: 0, group: 'g', node: 3, edge: 7, charges: 2 };
    expect(eventText(event('toll_paid', paid), 0, names)).toBe(
      'Your group paid a toll at Dune: charges lost 2',
    );
    const taken = { player: 0, node: 1, edge: 7, charges: 1 };
    expect(eventText(event('toll_taken', taken), 0, names)).toBe(
      'Your line at Birch took a toll: charges taken 1',
    );
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

  it('tells a capture the group could not pay for (DEC-38), as a warning toast', () => {
    setLocale('en');
    const bounce = event('capture_failed', { node: 1, player: 0, group: 'g', result: 'bounce' });
    const lost = event('capture_failed', { node: 2, player: 0, group: 'g', result: 'encircled' });
    expect(isLogged('capture_failed')).toBe(true);
    expect(eventText(bounce, 0, names)).toBe(
      'Birch not taken: no charge to pay, the group turns back',
    );
    expect(eventText(lost, 0, names)).toBe(
      'Cedar not retaken: no charge to pay, the group is lost',
    );
    expect(toastOf(bounce, 0, names)).toEqual({
      tone: 'warn',
      icon: 'alert',
      text: 'Birch not taken: no charge to pay, the group turns back',
    });
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
    // DEC-26: the barracks of a city.
    expect(
      eventText(event('build_started', { node: 4, kind: 'barracks', player: 0 }), 0, names),
    ).toBe('Elm builds its barracks');
    expect(eventText(event('build_stopped', { node: 4, edge: null, player: 0 }), 0, names)).toBe(
      'The build in Elm was interrupted',
    );
    expect(eventText(event('barracks_built', { node: 4, player: 0 }), 0, names)).toBe(
      'Elm has its barracks: it recruits now',
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

describe('the fields the feed and the toasts read (ARC-02)', () => {
  // `match_ended` has a line but is no `event` message: the result comes as `match_end`.
  const kinds = [...LOGGED_EVENT_KINDS].filter((kind) => kind !== 'match_ended');
  // The branches of the texts: a city or a road, a barracks, a warehouse or a road to build.
  const variants = [
    {},
    { edge: null },
    { node: null },
    { kind: 'barracks' },
    { kind: 'warehouse' },
    { stance: 'war' },
    { built: false },
  ];

  it.each(kinds)('%s: only fields the server sends', (kind) => {
    const reads = new Set<string>();
    for (const me of [0, 1] as const) {
      for (const variant of variants) {
        // The variant is only as far as the kind has the field.
        const own = Object.entries(variant).filter(([key]) => declaredFields(kind).has(key));
        const { data, reads: read } = tracked(kind, filledData(kind, Object.fromEntries(own)));
        const e = event(kind, data);
        expect(eventText(e, me, names), kind).not.toBe('');
        toastOf(e, me, names);
        for (const key of read) reads.add(key);
      }
    }
    expectDeclared(kind, reads);
  });
});
