import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ChargeTip from './ChargeTip.svelte';

let mounted: ReturnType<typeof mount> | null = null;

afterEach(() => {
  if (mounted !== null) void unmount(mounted);
  mounted = null;
  document.body.innerHTML = '';
});

function show(units: number, charged: number): HTMLElement {
  const target = document.body.appendChild(document.createElement('div'));
  mounted = mount(ChargeTip, { target, props: { units, charged } });
  return target;
}

describe('ChargeTip', () => {
  it('shows a filled circle with the charged number and an empty one with the discharged number', () => {
    const target = show(5, 2);
    expect(target.querySelectorAll('.dot.filled')).toHaveLength(1);
    expect(target.querySelectorAll('.dot.hollow')).toHaveLength(1);
    expect([...target.querySelectorAll('.num')].map((n) => n.textContent)).toEqual(['2', '3']);
  });

  it('shows only the filled circle for a fully charged group', () => {
    const target = show(4, 4);
    expect(target.querySelectorAll('.dot.hollow')).toHaveLength(0);
    expect([...target.querySelectorAll('.num')].map((n) => n.textContent)).toEqual(['4']);
  });
});
