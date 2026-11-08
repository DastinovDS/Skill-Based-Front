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

/** Per helmet: whether its dome is filled (a charged unit). */
function filled(target: HTMLElement): boolean[] {
  return [...target.querySelectorAll('.helmet-icon')].map(
    (icon) => icon.querySelector('.fill') !== null,
  );
}

describe('ChargeTip: the unit card keeps its helmets (#847, ui-style 57u)', () => {
  it('shows a filled helmet per charged unit and an empty one per discharged unit', () => {
    const target = show(5, 2);
    expect(filled(target)).toEqual([true, true, false, false, false]);
    expect(target.querySelectorAll('.helmet-icon.engraved')).toHaveLength(5);
  });

  it('sets the helmets in threes', () => {
    const target = show(7, 7);
    expect([...target.querySelectorAll('.three')].map((t) => t.children.length)).toEqual([3, 3, 1]);
  });

  it('tells a screen reader the numbers', () => {
    const target = show(4, 3);
    expect(target.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(/3/);
  });
});
