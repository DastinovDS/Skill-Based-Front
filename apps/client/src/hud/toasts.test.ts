import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLocale, setLocale } from '../i18n/index.ts';
import type { HudEvent } from './hudData.ts';
import { TOAST_LIMIT, TOAST_MS, ToastState } from './toastState.svelte.ts';
import type { NodeNamer } from './nodeName.ts';
import { TOAST_EVENT_KINDS, toastOf } from './toasts.ts';

const names: NodeNamer = (id) => `Place${String(id)}`;

const event = (kind: string, data: HudEvent['data']): HudEvent => ({ seq: 1, tick: 1, kind, data });

describe('toastOf', () => {
  const initial = getLocale();
  afterEach(() => {
    setLocale(initial);
  });

  it('makes toasts of fights, captures, unpaid captures, attrition, a lost recruit queue and a cut or rerouted supply line only', () => {
    expect([...TOAST_EVENT_KINDS].sort()).toEqual([
      'attrition',
      'capture_failed',
      'fight_ended',
      'line_cut',
      'line_rerouted',
      'node_captured',
      'recruit_queue_lost',
    ]);
    for (const kind of [
      'vp_awarded',
      'recruited',
      'stance_changed',
      'warehouse_lost',
      'build_started',
      'road_upgraded',
      'packet_lost',
      'charges_produced',
    ]) {
      expect(toastOf(event(kind, { node: 1, player: 0, vp: 1 }), 0, names), kind).toBeNull();
    }
  });

  it('warns of a recruit queue lost with its city (DEC-25)', () => {
    setLocale('en');
    expect(
      toastOf(event('recruit_queue_lost', { node: 4, player: 0, units: 2 }), 0, names),
    ).toMatchObject({ tone: 'warn', text: 'Recruit queue lost at Place4: 2 units' });
  });

  it('colours a capture by who took the city, and a loss in the colour of the enemy', () => {
    setLocale('en');
    expect(toastOf(event('node_captured', { node: 2, player: 0 }), 0, names)).toMatchObject({
      tone: 'mine',
      text: 'You captured Place2',
    });
    expect(toastOf(event('node_captured', { node: 2, player: 1 }), 0, names)).toMatchObject({
      tone: 'enemy',
      text: 'The enemy captured Place2',
    });
  });

  it('warns about attrition and keeps fights neutral', () => {
    setLocale('en');
    expect(toastOf(event('attrition', { node: 4, player: 0 }), 0, names)?.tone).toBe('warn');
    expect(
      toastOf(event('fight_ended', { node: 3, losses_0: 1, losses_1: 2 }), 0, names)?.tone,
    ).toBe('neutral');
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
