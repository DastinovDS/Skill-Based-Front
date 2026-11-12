import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import type { EventMsg } from '../protocol.gen.ts';
import { declaredFields, expectDeclared, filledData, tracked } from '../net/eventFields.fixture.ts';
import { TOAST_LIMIT, TOAST_MS, ToastState } from './toastState.svelte.ts';
import type { NodeNamer } from './nodeName.ts';
import { TOAST_EVENT_KINDS, toastOf } from './toasts.ts';

const names: NodeNamer = (id) => `Place${String(id)}`;

const event = (kind: string, data: EventMsg['data']) => ({ kind, data });

describe('toastOf', () => {
  const initial = getLocale();
  afterEach(() => {
    setLocale(initial);
  });

  it('makes toasts of an enemy capture, an unpaid capture and a finished building only (#765)', () => {
    expect([...TOAST_EVENT_KINDS].sort()).toEqual([
      'barracks_built',
      'capture_failed',
      'factory_built',
      'node_captured',
    ]);
    // The owner's marks on the pop-up catalogue (#765): A1 (own capture), A3 and A4 (fights), A5
    // (attrition), A6 (lost recruit queue), A9 (lost rally point) are no toasts any more.
    for (const kind of [
      'fight_ended',
      'attrition',
      'recruit_queue_lost',
      'rally_point_cleared',
      // #930 (W10): a recruit that stays home hangs a strip from the bar, not a toast.
      'rally_walk_no_cp',
      'vp_awarded',
      'recruited',
      'stance_changed',
      'warehouse_lost',
      'build_started',
      'packet_lost',
      'charges_produced',
    ]) {
      expect(toastOf(event(kind, { node: 1, player: 0, vp: 1 }), 0, names), kind).toBeNull();
    }
  });

  it('tells the builder of a finished barracks or factory with the building icon (#972)', () => {
    setLocale('en');
    expect(toastOf(event('barracks_built', { node: 4, player: 0 }), 0, names)).toEqual({
      tone: 'mine',
      icon: 'barracks',
      cut: true,
      text: 'Place4 has its barracks: it recruits now',
    });
    expect(toastOf(event('factory_built', { node: 4, player: 0 }), 0, names)).toEqual({
      tone: 'mine',
      icon: 'factory',
      cut: true,
      text: 'Place4 is a factory now: it makes charges',
    });
    // The other player's event is no news here.
    expect(toastOf(event('factory_built', { node: 4, player: 1 }), 0, names)).toBeNull();
  });

  it('tells only the enemy capture, in the colour of the enemy (#765, A1)', () => {
    setLocale('en');
    expect(toastOf(event('node_captured', { node: 2, player: 0 }), 0, names)).toBeNull();
    expect(toastOf(event('node_captured', { node: 2, player: 1 }), 0, names)).toEqual({
      tone: 'enemy',
      icon: 'flag',
      text: 'The enemy captured Place2',
    });
  });

  it('tells a capture the group could not pay for (DEC-38), as a warning', () => {
    setLocale('en');
    const bounce = event('capture_failed', { node: 1, player: 0, group: 'g', result: 'bounce' });
    const lost = event('capture_failed', { node: 2, player: 0, group: 'g', result: 'encircled' });
    expect(toastOf(bounce, 0, names)).toEqual({
      tone: 'warn',
      icon: 'alert',
      text: 'Place1 not taken: no charge to pay, the group turns back',
    });
    expect(toastOf(lost, 0, names)?.text).toBe(
      'Place2 not retaken: no charge to pay, the group is lost',
    );
  });
});

describe('the fields the toasts read (ARC-02)', () => {
  it.each([...TOAST_EVENT_KINDS])('%s: only fields the server sends', (kind) => {
    const reads = new Set<string>();
    for (const me of [0, 1] as const) {
      for (const variant of [{}, { result: 'encircled' }]) {
        const own = Object.entries(variant).filter(([key]) => declaredFields(kind).has(key));
        const { data, reads: read } = tracked(kind, filledData(kind, Object.fromEntries(own)));
        toastOf(event(kind, data), me, names);
        for (const key of read) reads.add(key);
      }
    }
    expectDeclared(kind, reads);
  });
});

describe('ToastState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const body = (text: string) => ({ tone: 'neutral', icon: 'info', text }) as const;

  it('shows the newest first and at most three', () => {
    const toasts = new ToastState();
    for (const text of ['a', 'b', 'c', 'd']) toasts.push(body(text));
    expect(TOAST_LIMIT).toBe(3);
    expect(toasts.current.map((t) => t.text)).toEqual(['d', 'c', 'b']);
  });

  it('fades each toast after six seconds', () => {
    const toasts = new ToastState();
    toasts.push(body('a'));
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(toasts.current).toHaveLength(1);
    toasts.push(body('b'));
    vi.advanceTimersByTime(1);
    expect(toasts.current.map((t) => t.text)).toEqual(['b']);
    vi.advanceTimersByTime(TOAST_MS);
    expect(toasts.current).toEqual([]);
  });

  it('dismisses one and clears all, without a timer left behind', () => {
    const toasts = new ToastState();
    toasts.push(body('a'));
    toasts.push(body('b'));
    const first = toasts.current[1];
    if (first === undefined) throw new Error('no toast');
    toasts.dismiss(first.id);
    expect(toasts.current.map((t) => t.text)).toEqual(['b']);
    toasts.clear();
    expect(toasts.current).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
