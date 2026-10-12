import { afterEach, describe, expect, it } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import { eventText, HIDDEN_EVENT_KINDS, isLogged, LOGGED_EVENT_KINDS } from './eventText.ts';
import type { HudEvent } from './hudData.ts';
import { toastOf } from './toasts.ts';

function event(kind: string, data: HudEvent['data']): HudEvent {
  return { seq: 1, tick: 10, kind, data };
}

const initialLocale = getLocale();

describe('eventText', () => {
  const initial = initialLocale;
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

  it('does not show an unknown kind (never a raw kind name)', () => {
    expect(isLogged('weather')).toBe(false);
    expect(eventText(event('weather', {}), 0)).toBe('');
  });

  it('says what the new kinds mean', () => {
    setLocale('en');
    expect(eventText(event('attrition', { node: 4, player: 0 }), 0)).toBe(
      'Overcapacity at node 4: a unit was lost',
    );
    expect(eventText(event('road_upgraded', { edge: 2, width: 3 }), 0)).toBe(
      'Road 2 upgraded to width 3',
    );
    expect(
      eventText(event('build_started', { node: 4, edge: 2, width: 3, charges: 3, player: 0 }), 0),
    ).toBe('City 4 upgrades road 2 to width 3: 3 charges spent');
    expect(eventText(event('build_stopped', { node: 4, edge: 2, reason: 'interrupted' }), 0)).toBe(
      'The build of road 2 was interrupted',
    );
    expect(eventText(event('packet_lost', { edge: 1, charges: 5 }), 0)).toBe(
      'Charges lost on road 1: 5',
    );
    setLocale('ru');
    expect(eventText(event('attrition', { node: 4, player: 0 }), 0)).toContain('Перегрузка');
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
    expect(eventText(award, 0)).toBe('');
    expect(toastOf(award, 0)).toBeNull();
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

  it('each shown kind has a line in ru and en, and never a raw kind name', () => {
    for (const locale of ['ru', 'en'] as const) {
      setLocale(locale);
      for (const kind of LOGGED_EVENT_KINDS) {
        // Enough fields for every text; the values do not matter, the line must exist.
        const data = { node: 1, edge: 1, player: 0, vp: 1, stance: 'war', width: 2, charges: 3 };
        const text = eventText(event(kind, data), 0);
        expect(text, `${locale} ${kind}`).not.toBe('');
        expect(text, `${locale} ${kind}`).not.toMatch(/[a-z]+_[a-z]+/); // no raw `snake_case` kind
      }
    }
  });
});
