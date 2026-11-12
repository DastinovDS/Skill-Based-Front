import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '../i18n/index.ts';
import { AlertState } from '../match/alerts.svelte.ts';
import AlertStack from './AlertStack.svelte';
import type { NodeNamer } from './nodeName.ts';
import ToastStack from './ToastStack.svelte';
import { ToastState } from './toastState.svelte.ts';

const names: NodeNamer = (id) => `Place${String(id)}`;

// #1004, item 14 (owner 2026-11-12): a message about a place takes the camera there on a click;
// only those are buttons.
describe('messages that show their place', () => {
  let mounted: Record<string, unknown>[] = [];

  afterEach(() => {
    for (const m of mounted) void unmount(m);
    mounted = [];
    document.body.innerHTML = '';
  });

  function toasts(onshow?: (node: number) => void): { root: HTMLElement; toasts: ToastState } {
    setLocale('en');
    const state = new ToastState();
    state.push({ tone: 'enemy', icon: 'flag', text: 'The enemy captured Place2', place: 2 });
    state.push({ tone: 'warn', icon: 'clock', text: 'Last minute' });
    const root = document.body.appendChild(document.createElement('div'));
    mounted.push(mount(ToastStack, { target: root, props: { toasts: state, names, onshow } }));
    flushSync();
    return { root, toasts: state };
  }

  it('a toast with a place is a button that takes the camera there', () => {
    const shown: number[] = [];
    const { root } = toasts((node) => shown.push(node));
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.toast .go')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toContain('The enemy captured Place2');
    expect(buttons[0]?.title).toBe('Show Place2 on the map');
    buttons[0]?.click();
    expect(shown).toEqual([2]);
    // A toast without a place stays plain, and the close button only closes.
    expect(root.querySelectorAll('.toast.place')).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('.close')?.click();
    expect(shown).toEqual([2]);
  });

  it('no toast is a button without a camera to move', () => {
    const { root } = toasts();
    expect(root.querySelectorAll('.go')).toHaveLength(0);
    expect(root.textContent).toContain('The enemy captured Place2');
  });

  it('an alert strip takes the camera to its city', () => {
    setLocale('en');
    const alerts = new AlertState(0, {
      tick_hz: 10,
      orders: { cost: {} },
      capacity: { attrition_ticks: 30 },
    } as unknown as ConstructorParameters<typeof AlertState>[1]);
    alerts.onStay(5, 3);
    const shown: number[] = [];
    const root = document.body.appendChild(document.createElement('div'));
    mounted.push(
      mount(AlertStack, {
        target: root,
        props: { alerts, names, onshow: (node: number) => shown.push(node) },
      }),
    );
    flushSync();
    const strip = root.querySelector('.strip.go');
    expect(strip?.getAttribute('aria-label')).toBe(
      'A recruit stays in Place5: no CP for the walk to Place3',
    );
    const button = root.querySelector<HTMLButtonElement>('.strip.go .cover');
    expect(button?.getAttribute('aria-label')).toBe('Show Place5 on the map');
    button?.click();
    expect(shown).toEqual([5]);
    alerts.clearStays();
  });
});
