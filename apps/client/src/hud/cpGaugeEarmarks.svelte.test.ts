import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import CpGauge from './CpGauge.svelte';
import type { DueWalk } from './rallyDue.ts';

const due: DueWalk = { node: 13, slot: 0, ticks: 9, share: 0.5, running: true, short: false };

describe('CpGauge earmarks (#930, W10)', () => {
  let component: Record<string, unknown> | undefined;
  afterEach(() => {
    if (component !== undefined) void unmount(component);
    component = undefined;
    document.body.innerHTML = '';
  });

  /** The first earmark and its helmet, as painted. */
  const first = (): { mark: string | null; helm: string | null } => {
    const mark = document.body.querySelector('.earmark');
    return {
      mark: mark?.getAttribute('visibility') ?? null,
      helm: mark?.querySelector('.ear-helm')?.getAttribute('visibility') ?? null,
    };
  };

  it('leaves no helmet on the rail once nothing is reserved any more', () => {
    const props = $state<{ dues: readonly DueWalk[] }>({ dues: [due] });
    component = mount(CpGauge, {
      target: document.body,
      props: {
        value: 200,
        cap: 500,
        next: 0.5,
        quantum: 50,
        short: false,
        price: null,
        text: '2',
        walkCost: 50,
        get dues() {
          return props.dues;
        },
      },
    });
    flushSync();
    expect(first()).toEqual({ mark: 'visible', helm: 'inherit' });
    props.dues = [];
    flushSync();
    // The earmark is hidden, and its helmet must not say `visible` (it would show through).
    expect(first().mark).toBe('hidden');
    expect(first().helm).not.toBe('visible');
  });
});
